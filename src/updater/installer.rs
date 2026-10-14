// Syllacast - Standalone Spotify Lyrics Kiosk
// Copyright (C) 2026 TechGigant
// SPDX-License-Identifier: AGPL-3.0-or-later

use flate2::read::GzDecoder;
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;
use tar::Archive;
use tracing::info;

use super::client::current_target_triple;
use super::models::ReleaseManifest;

pub struct UpdateInstaller {
    http: reqwest::Client,
}

impl Default for UpdateInstaller {
    fn default() -> Self {
        Self::new()
    }
}

/// Verifies SHA256 checksum of downloaded bytes. Fails closed if expected hash is empty.
pub fn verify_archive_checksum(bytes: &[u8], expected_sha256: &str) -> Result<(), String> {
    let expected = expected_sha256.trim();
    if expected.is_empty() {
        return Err("Aborted update: could not retrieve expected SHA256 checksum.".to_string());
    }

    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let computed_sha256 = format!("{:x}", hasher.finalize());

    if !computed_sha256.eq_ignore_ascii_case(expected) {
        return Err(format!(
            "SHA256 checksum mismatch! Expected: {}, got: {}",
            expected, computed_sha256
        ));
    }

    Ok(())
}

impl UpdateInstaller {
    pub fn new() -> Self {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(120))
            .user_agent(format!("Syllacast-Updater/{}", env!("CARGO_PKG_VERSION")))
            .build()
            .unwrap_or_default();

        Self { http }
    }

    /// Resolves the target binary path to update.
    ///
    /// Priority:
    /// 1. `SYLLACAST_BIN_PATH` environment variable (if explicitly configured)
    /// 2. Canonical path of the currently executing binary (`current_exe`), provided it is not in a temporary directory
    /// 3. Standard default installation path `/opt/syllacast/syllacast` (if it exists)
    /// 4. Fallback to `current_exe`
    pub fn resolve_destination_path() -> Result<PathBuf, String> {
        // 1. Explicit override via environment variable
        if let Ok(env_path) = std::env::var("SYLLACAST_BIN_PATH") {
            let p = PathBuf::from(env_path.trim());
            if !p.as_os_str().is_empty() {
                info!(
                    "Using SYLLACAST_BIN_PATH override for update target: {:?}",
                    p
                );
                return Ok(p);
            }
        }

        // 2. Query currently running executable
        if let Ok(exe) = std::env::current_exe() {
            let canonical_exe = fs::canonicalize(&exe).unwrap_or(exe);
            let in_temp = canonical_exe.starts_with("/tmp")
                || canonical_exe.starts_with("/var/tmp")
                || canonical_exe.starts_with(std::env::temp_dir());

            if !in_temp {
                info!(
                    "Targeting currently executing binary for update: {:?}",
                    canonical_exe
                );
                return Ok(canonical_exe);
            }
        }

        // 3. Default standard installation path if present
        let default_opt = Path::new("/opt/syllacast/syllacast");
        if default_opt.exists() {
            info!("Targeting default installation path: {:?}", default_opt);
            return Ok(default_opt.to_path_buf());
        }

        // 4. Fallback to current_exe
        std::env::current_exe()
            .map_err(|e| format!("Could not determine target executable path: {}", e))
    }

    /// Downloads, verifies, and installs the release matching the current host architecture.
    pub async fn install_update<F>(
        &self,
        manifest: &ReleaseManifest,
        progress_callback: F,
    ) -> Result<PathBuf, String>
    where
        F: Fn(&str, u8, &str) + Send + Sync + 'static,
    {
        let target_arch = current_target_triple()
            .ok_or_else(|| "Self-update is only supported on Linux (musl) targets.".to_string())?;

        let target_info = manifest.targets.get(target_arch).ok_or_else(|| {
            format!(
                "No release archive found for target architecture {}",
                target_arch
            )
        })?;

        progress_callback(
            "downloading",
            10,
            &format!("Downloading {}...", target_info.archive_name),
        );

        // Create staging temporary directory with nanosecond randomization
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let temp_dir =
            std::env::temp_dir().join(format!("syllacast-update-{}-{}", std::process::id(), nanos));
        if temp_dir.exists() {
            let _ = fs::remove_dir_all(&temp_dir);
        }
        fs::create_dir_all(&temp_dir)
            .map_err(|e| format!("Failed to create temporary directory {:?}: {}", temp_dir, e))?;

        let archive_path = temp_dir.join(&target_info.archive_name);

        // 1. Download archive with progress
        let resp = match self.http.get(&target_info.download_url).send().await {
            Ok(r) => r,
            Err(e) => {
                let _ = fs::remove_dir_all(&temp_dir);
                return Err(format!("Failed to download archive: {}", e));
            }
        };

        if !resp.status().is_success() {
            let _ = fs::remove_dir_all(&temp_dir);
            return Err(format!("Download returned HTTP status {}", resp.status()));
        }

        let bytes = match resp.bytes().await {
            Ok(b) => b,
            Err(e) => {
                let _ = fs::remove_dir_all(&temp_dir);
                return Err(format!("Failed to read archive bytes: {}", e));
            }
        };

        progress_callback("verifying", 50, "Verifying SHA256 integrity checksum...");

        // 2. Resolve expected SHA256 checksum (from manifest or SHA256SUMS.txt)
        let mut expected_sha256 = target_info.sha256.clone();
        if expected_sha256.is_empty() {
            let repo = std::env::var("SYLLACAST_GITHUB_REPO")
                .unwrap_or_else(|_| "TechGigant/syllacast".to_string());
            let sums_url = format!(
                "https://github.com/{}/releases/download/{}/SHA256SUMS.txt",
                repo, manifest.tag_name
            );
            if let Ok(sums_resp) = self.http.get(&sums_url).send().await {
                if sums_resp.status().is_success() {
                    if let Ok(text) = sums_resp.text().await {
                        for line in text.lines() {
                            let parts: Vec<&str> = line.split_whitespace().collect();
                            if parts.len() >= 2 && parts[1].contains(&target_info.archive_name) {
                                expected_sha256 = parts[0].to_string();
                                break;
                            }
                        }
                    }
                }
            }
        }

        // Fail-closed verification: abort immediately if expected checksum is missing
        if expected_sha256.is_empty() {
            let _ = fs::remove_dir_all(&temp_dir);
            return Err("Aborted update: could not retrieve expected SHA256 checksum.".to_string());
        }

        // Offload verification & disk writes to blocking task
        let temp_dir_for_verify = temp_dir.clone();
        let bytes_for_verify = bytes.clone();
        let expected_sha256_for_verify = expected_sha256.clone();
        let archive_path_for_verify = archive_path.clone();

        tokio::task::spawn_blocking(move || -> Result<(), String> {
            verify_archive_checksum(&bytes_for_verify, &expected_sha256_for_verify).inspect_err(
                |_| {
                    let _ = fs::remove_dir_all(&temp_dir_for_verify);
                },
            )?;

            fs::write(&archive_path_for_verify, &bytes_for_verify).map_err(|e| {
                let _ = fs::remove_dir_all(&temp_dir_for_verify);
                format!("Failed to write archive to disk: {}", e)
            })?;

            Ok(())
        })
        .await
        .map_err(|e| {
            let _ = fs::remove_dir_all(&temp_dir);
            format!("Verification task failed: {}", e)
        })??;

        info!(
            "✓ SHA256 integrity verified for {}",
            target_info.archive_name
        );

        progress_callback(
            "installing",
            75,
            "Extracting binary and preparing atomic replacement...",
        );

        // 3. Resolve destination path
        let dest_path = match Self::resolve_destination_path() {
            Ok(p) => p,
            Err(e) => {
                let _ = fs::remove_dir_all(&temp_dir);
                return Err(e);
            }
        };

        let temp_dir_for_install = temp_dir.clone();
        let dest_path_for_install = dest_path.clone();

        // 4. Offload extraction, permissions, and atomic replacement to blocking task
        tokio::task::spawn_blocking(move || -> Result<PathBuf, String> {
            let tar_gz = File::open(&archive_path).map_err(|e| {
                let _ = fs::remove_dir_all(&temp_dir_for_install);
                format!("Failed to open downloaded archive: {}", e)
            })?;
            let tar = GzDecoder::new(tar_gz);
            let mut archive = Archive::new(tar);

            let extract_dir = temp_dir_for_install.join("extracted");
            fs::create_dir_all(&extract_dir).map_err(|e| {
                let _ = fs::remove_dir_all(&temp_dir_for_install);
                format!("Failed to create extract directory: {}", e)
            })?;

            archive.unpack(&extract_dir).map_err(|e| {
                let _ = fs::remove_dir_all(&temp_dir_for_install);
                format!("Failed to extract archive contents: {}", e)
            })?;

            let extracted_bin = extract_dir.join("syllacast");
            if !extracted_bin.exists() {
                let _ = fs::remove_dir_all(&temp_dir_for_install);
                return Err(
                    "Extracted archive does not contain 'syllacast' executable.".to_string()
                );
            }

            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = fs::set_permissions(&extracted_bin, fs::Permissions::from_mode(0o755));
            }

            let temp_dest = dest_path_for_install.with_extension("new");
            if let Err(e) = (|| -> Result<(), String> {
                fs::copy(&extracted_bin, &temp_dest)
                    .map_err(|e| format!("Failed to copy new binary to {:?}: {}", temp_dest, e))?;

                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    let _ = fs::set_permissions(&temp_dest, fs::Permissions::from_mode(0o755));
                }

                fs::rename(&temp_dest, &dest_path_for_install).map_err(|e| {
                    format!(
                        "Failed to atomically replace binary at {:?}: {}",
                        dest_path_for_install, e
                    )
                })?;

                Ok(())
            })() {
                let _ = fs::remove_file(&temp_dest);
                let _ = fs::remove_dir_all(&temp_dir_for_install);
                return Err(e);
            }

            info!(
                "✓ Successfully replaced binary at {:?}",
                dest_path_for_install
            );

            let _ = fs::remove_dir_all(&temp_dir_for_install);

            Ok(dest_path_for_install)
        })
        .await
        .map_err(|e| {
            let _ = fs::remove_dir_all(&temp_dir);
            format!("Installation task failed: {}", e)
        })??;

        progress_callback("restarting", 95, "Restarting service...");

        Ok(dest_path)
    }

    /// Triggers service restart via systemctl or graceful shutdown
    pub fn trigger_service_restart() {
        info!("Initiating service restart after successful update...");

        // Try systemctl first if running as service
        let res = Command::new("systemctl")
            .args(["restart", "syllacast.service"])
            .status();

        if let Ok(st) = res {
            if st.success() {
                info!("systemctl restart syllacast.service invoked successfully");
                return;
            }
        }

        // If systemctl cannot be called directly, graceful exit allows systemd Restart=always to respawn
        info!("Triggering graceful exit for systemd to reload updated binary");
        tokio::spawn(async {
            tokio::time::sleep(Duration::from_millis(800)).await;
            std::process::exit(0);
        });
    }
}
