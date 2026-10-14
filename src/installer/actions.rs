// Syllacast - Standalone Spotify Lyrics Kiosk
// Copyright (C) 2026 TechGigant
// SPDX-License-Identifier: AGPL-3.0-or-later

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

#[derive(Debug, Clone)]
pub struct InstallConfig {
    pub spicy_key: String,
    pub soloist_data_dir: PathBuf,
    pub port: u16,
    pub bind: String,
    pub service_user: String,
    pub service_group: String,
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct HealthStatus {
    pub is_running: bool,
    pub http_status: u16,
    pub is_playing: bool,
    pub track_title: Option<String>,
    pub track_artist: Option<String>,
    pub lyrics_status: String,
}

/// Executes installation or binary upgrade of Syllacast.
pub fn install_or_update(config: &InstallConfig) -> Result<Vec<String>, String> {
    let mut log = Vec::new();

    if !super::discovery::is_root() {
        return Err(
            "Installation requires root privileges. Please re-run with 'sudo syllacast setup'."
                .to_string(),
        );
    }

    let opt_dir = Path::new("/opt/syllacast");
    if !opt_dir.exists() {
        fs::create_dir_all(opt_dir)
            .map_err(|e| format!("Failed to create /opt/syllacast: {}", e))?;
        log.push("Created directory: /opt/syllacast".to_string());
    }

    // Ensure service user exists
    if config.service_user == "syllacast" {
        let user_check = Command::new("id").arg(&config.service_user).output();
        if user_check.is_err() || !user_check.unwrap().status.success() {
            let useradd = Command::new("useradd")
                .args(["-r", "-s", "/bin/false", "-M", "syllacast"])
                .status();
            if let Ok(st) = useradd {
                if st.success() {
                    log.push("Created dedicated system user: syllacast".to_string());
                }
            }
        }
    }

    // Copy binary
    let current_exe = std::env::current_exe()
        .map_err(|e| format!("Failed to determine current executable path: {}", e))?;
    let target_bin = opt_dir.join("syllacast");

    // Copy binary to /opt/syllacast/syllacast
    fs::copy(&current_exe, &target_bin)
        .map_err(|e| format!("Failed to copy binary to {:?}: {}", target_bin, e))?;
    log.push(format!("Installed binary to: {:?}", target_bin));

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&target_bin, fs::Permissions::from_mode(0o755));
        let _ = Command::new("chown")
            .arg(format!("{}:{}", config.service_user, config.service_group))
            .arg(&target_bin)
            .status();
    }

    // Create /usr/local/bin/syllacast symlink
    let symlink_path = Path::new("/usr/local/bin/syllacast");
    let _ = fs::remove_file(symlink_path);
    #[cfg(unix)]
    {
        if let Err(e) = std::os::unix::fs::symlink(&target_bin, symlink_path) {
            log.push(format!(
                "Warning: Could not create symlink at {:?}: {}",
                symlink_path, e
            ));
        } else {
            log.push(
                "Created symlink: /usr/local/bin/syllacast -> /opt/syllacast/syllacast".to_string(),
            );
        }
    }

    // Write /opt/syllacast/.env
    let env_content = format_env_file(config);
    let env_path = opt_dir.join(".env");
    fs::write(&env_path, env_content)
        .map_err(|e| format!("Failed to write configuration file {:?}: {}", env_path, e))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        // Strictly protect .env from non-root / other users
        let _ = fs::set_permissions(&env_path, fs::Permissions::from_mode(0o600));
        let _ = Command::new("chown")
            .arg(format!("{}:{}", config.service_user, config.service_group))
            .arg(&env_path)
            .status();
    }
    log.push("Wrote protected configuration file: /opt/syllacast/.env".to_string());

    // Give service user ownership of /opt/syllacast
    let _ = Command::new("chown")
        .args([
            "-R",
            &format!("{}:{}", config.service_user, config.service_group),
            "/opt/syllacast",
        ])
        .status();

    // Write systemd unit file
    let service_content = format!(
        "[Unit]\n\
         Description=Syllacast Network-Synchronized Spotify Lyrics Server\n\
         After=network.target network-online.target\n\
         Wants=network-online.target\n\n\
         [Service]\n\
         Type=simple\n\
         User={}\n\
         Group={}\n\
         WorkingDirectory=/opt/syllacast\n\
         EnvironmentFile=/opt/syllacast/.env\n\
         ExecStart=/opt/syllacast/syllacast\n\
         Restart=always\n\
         RestartSec=3\n\
         NoNewPrivileges=true\n\n\
         [Install]\n\
         WantedBy=multi-user.target\n",
        config.service_user, config.service_group
    );

    let unit_path = Path::new("/etc/systemd/system/syllacast.service");
    fs::write(unit_path, service_content).map_err(|e| {
        format!(
            "Failed to write systemd service file {:?}: {}",
            unit_path, e
        )
    })?;
    log.push("Installed systemd unit file: /etc/systemd/system/syllacast.service".to_string());

    // Reload and start systemd service
    let _ = Command::new("systemctl").arg("daemon-reload").status();
    let _ = Command::new("systemctl")
        .args(["enable", "syllacast.service"])
        .status();
    let restart = Command::new("systemctl")
        .args(["restart", "syllacast.service"])
        .status();

    if let Ok(st) = restart {
        if st.success() {
            log.push("Started syllacast.service via systemd".to_string());
        } else {
            return Err(
                "systemctl restart syllacast.service returned non-zero exit status".to_string(),
            );
        }
    } else {
        return Err("Failed to invoke systemctl restart syllacast.service".to_string());
    }

    Ok(log)
}

pub fn format_env_file(config: &InstallConfig) -> String {
    let clean_data_dir = config
        .soloist_data_dir
        .to_string_lossy()
        .replace(['\r', '\n'], "");
    let clean_key = config.spicy_key.replace(['\r', '\n'], "");
    let clean_bind = config.bind.replace(['\r', '\n'], "");

    let soloist_line = if !clean_data_dir.is_empty() {
        format!("SOLOIST_DATA_DIR={}\n", clean_data_dir)
    } else {
        "# SOLOIST_DATA_DIR=\n".to_string()
    };

    let spicy_line = if !clean_key.is_empty() {
        format!("SPICY_LYRICS_SECRET_KEY={}\n", clean_key)
    } else {
        "# SPICY_LYRICS_SECRET_KEY=\n".to_string()
    };

    format!(
        "# Syllacast Environment Configuration\n\
         {}\
         {}\
         SYLLACAST_PORT={}\n\
         SYLLACAST_BIND={}\n",
        spicy_line, soloist_line, config.port, clean_bind
    )
}

/// Reconfigures settings in `/opt/syllacast/.env` and restarts the service.
pub fn reconfigure(config: &InstallConfig) -> Result<Vec<String>, String> {
    let mut log = Vec::new();
    let env_path = Path::new("/opt/syllacast/.env");
    let env_content = format_env_file(config);
    fs::write(env_path, env_content)
        .map_err(|e| format!("Failed to write configuration file {:?}: {}", env_path, e))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(env_path, fs::Permissions::from_mode(0o600));
        let _ = Command::new("chown")
            .arg(format!("{}:{}", config.service_user, config.service_group))
            .arg(env_path)
            .status();
    }
    log.push("Updated /opt/syllacast/.env".to_string());

    let _ = Command::new("systemctl")
        .args(["restart", "syllacast.service"])
        .status();
    log.push("Restarted syllacast.service".to_string());

    Ok(log)
}

/// Completely uninstalls Syllacast from systemd and optionally removes configuration.
pub fn uninstall(remove_data: bool) -> Result<Vec<String>, String> {
    let mut log = Vec::new();

    let _ = Command::new("systemctl")
        .args(["stop", "syllacast.service"])
        .status();
    let _ = Command::new("systemctl")
        .args(["disable", "syllacast.service"])
        .status();
    log.push("Stopped and disabled syllacast.service".to_string());

    let unit_path = Path::new("/etc/systemd/system/syllacast.service");
    if unit_path.exists() {
        let _ = fs::remove_file(unit_path);
        log.push("Removed /etc/systemd/system/syllacast.service".to_string());
    }
    let _ = Command::new("systemctl").arg("daemon-reload").status();

    let symlink = Path::new("/usr/local/bin/syllacast");
    if symlink.exists() {
        let _ = fs::remove_file(symlink);
        log.push("Removed symlink: /usr/local/bin/syllacast".to_string());
    }

    if remove_data {
        let opt_dir = Path::new("/opt/syllacast");
        if opt_dir.exists() {
            let _ = fs::remove_dir_all(opt_dir);
            log.push("Removed directory: /opt/syllacast".to_string());
        }
    } else {
        log.push("Retained configuration and cache in /opt/syllacast".to_string());
    }

    Ok(log)
}

/// Performs a live HTTP health check against `http://127.0.0.1:<port>/state`.
pub async fn check_service_health(port: u16, max_attempts: usize) -> Result<HealthStatus, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(800))
        .build()
        .map_err(|e| e.to_string())?;

    let url = format!("http://127.0.0.1:{}/state", port);

    for _ in 0..max_attempts {
        tokio::time::sleep(Duration::from_millis(500)).await;
        if let Ok(resp) = client.get(&url).send().await {
            let status_code = resp.status().as_u16();
            if resp.status().is_success() {
                if let Ok(json) = resp.json::<serde_json::Value>().await {
                    let is_playing = json
                        .get("is_playing")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false);
                    let lyrics_status = json
                        .get("lyrics_status")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown")
                        .to_string();

                    let track_title = json
                        .get("track")
                        .and_then(|t| t.get("title"))
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());

                    let track_artist = json
                        .get("track")
                        .and_then(|t| t.get("artist"))
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());

                    return Ok(HealthStatus {
                        is_running: true,
                        http_status: status_code,
                        is_playing,
                        track_title,
                        track_artist,
                        lyrics_status,
                    });
                }
            }
        }
    }

    Err(format!(
        "Could not connect to Syllacast HTTP endpoint at http://127.0.0.1:{}/state",
        port
    ))
}

/// Retrieves the most recent log lines from `journalctl -u syllacast.service`.
pub fn get_service_logs(n_lines: usize) -> String {
    if let Ok(output) = Command::new("journalctl")
        .args([
            "-u",
            "syllacast.service",
            "-n",
            &n_lines.to_string(),
            "--no-pager",
        ])
        .output()
    {
        String::from_utf8_lossy(&output.stdout).to_string()
    } else {
        "Unable to retrieve journalctl output.".to_string()
    }
}

/// Checks GitHub Releases and updates /opt/syllacast with the latest static binary.
pub async fn check_and_install_github_release() -> Result<Vec<String>, String> {
    let mut log = Vec::new();
    let client = crate::updater::client::UpdateClient::new();
    let current_ver = env!("CARGO_PKG_VERSION");

    log.push(format!(
        "Checking GitHub Releases (current version: v{})...",
        current_ver
    ));
    let manifest = client
        .check_for_update(current_ver, "stable")
        .await
        .map_err(|e| format!("Update check failed: {}", e))?;

    let manifest = match manifest {
        Some(m) => m,
        None => {
            log.push(format!(
                "✓ Syllacast is already running the latest release (v{}).",
                current_ver
            ));
            return Ok(log);
        }
    };

    log.push(format!(
        "Found newer release: v{} (published {})",
        manifest.version, manifest.published_at
    ));
    if manifest.is_critical_security_update {
        log.push("⚠ This release contains CRITICAL SECURITY fixes.".to_string());
    }

    let installer = crate::updater::installer::UpdateInstaller::new();
    let path = installer
        .install_update(&manifest, |_stage, _percent, _msg| {})
        .await?;

    log.push(format!("✓ Successfully installed binary to {:?}", path));

    let _ = Command::new("systemctl").arg("daemon-reload").status();
    let restart = Command::new("systemctl")
        .args(["restart", "syllacast.service"])
        .status();

    if let Ok(st) = restart {
        if st.success() {
            log.push("Restarted syllacast.service via systemd".to_string());
        } else {
            log.push("Note: systemctl restart returned non-zero (service will restart on next boot or trigger)".to_string());
        }
    }

    Ok(log)
}
