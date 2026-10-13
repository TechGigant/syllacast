// Syllacast - Standalone Spotify Lyrics Kiosk
// Copyright (C) 2026 TechGigant
// SPDX-License-Identifier: AGPL-3.0-or-later

use std::collections::HashMap;
use std::time::Duration;
use tracing::{info, warn};

use super::models::{ReleaseManifest, TargetArchiveInfo};

pub const DEFAULT_GITHUB_REPO: &str = "TechGigant/syllacast";

/// Returns the static musl target triple corresponding to the current host OS and architecture.
pub fn current_target_triple() -> Option<&'static str> {
    #[cfg(target_os = "linux")]
    {
        #[cfg(target_arch = "x86_64")]
        return Some("x86_64-unknown-linux-musl");

        #[cfg(target_arch = "aarch64")]
        return Some("aarch64-unknown-linux-musl");

        #[cfg(target_arch = "arm")]
        return Some("armv7-unknown-linux-musleabihf");
    }

    #[cfg(not(target_os = "linux"))]
    {
        None
    }
}

/// Parses and compares two version strings (e.g. "0.1.0" vs "v0.2.0").
/// Returns true if `candidate` is strictly greater than `current`.
pub fn is_newer_version(candidate: &str, current: &str) -> bool {
    let parse = |v: &str| -> (Vec<u64>, bool) {
        let clean = v.trim().trim_start_matches('v');
        let parts: Vec<&str> = clean.split('-').collect();
        let num_parts: Vec<u64> = parts[0]
            .split('.')
            .map(|s| s.parse::<u64>().unwrap_or(0))
            .collect();
        let is_prerelease = parts.len() > 1;
        (num_parts, is_prerelease)
    };

    let (cand_nums, cand_pre) = parse(candidate);
    let (curr_nums, curr_pre) = parse(current);

    let max_len = cand_nums.len().max(curr_nums.len());
    for i in 0..max_len {
        let c_num = cand_nums.get(i).copied().unwrap_or(0);
        let u_num = curr_nums.get(i).copied().unwrap_or(0);
        if c_num > u_num {
            return true;
        } else if c_num < u_num {
            return false;
        }
    }

    // If numerical components are equal, a non-prerelease is newer than a prerelease
    if curr_pre && !cand_pre {
        return true;
    }

    false
}

/// Client for checking and querying Syllacast releases on GitHub.
pub struct UpdateClient {
    http: reqwest::Client,
    repo: String,
}

impl UpdateClient {
    pub fn new() -> Self {
        let repo = std::env::var("SYLLACAST_GITHUB_REPO")
            .unwrap_or_else(|_| DEFAULT_GITHUB_REPO.to_string());

        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .user_agent(format!("Syllacast-Updater/{}", env!("CARGO_PKG_VERSION")))
            .build()
            .unwrap_or_default();

        Self { http, repo }
    }

    /// Checks for a newer release on GitHub.
    /// First queries the rate-limit-free release-manifest.json, falling back to GitHub API.
    pub async fn check_for_update(
        &self,
        current_version: &str,
    ) -> Result<Option<ReleaseManifest>, String> {
        info!(
            "Checking for updates against repo {} (current: v{})",
            self.repo, current_version
        );

        // 1. Attempt downloading static release-manifest.json from GitHub Releases asset CDN
        let manifest_url = format!(
            "https://github.com/{}/releases/latest/download/release-manifest.json",
            self.repo
        );

        match self.http.get(&manifest_url).send().await {
            Ok(resp) if resp.status().is_success() => {
                if let Ok(manifest) = resp.json::<ReleaseManifest>().await {
                    info!("Fetched release manifest for tag {}", manifest.tag_name);
                    if is_newer_version(&manifest.version, current_version) {
                        return Ok(Some(manifest));
                    } else {
                        return Ok(None);
                    }
                }
            }
            Ok(resp) => {
                warn!(
                    "Manifest URL {} returned status {}, falling back to GitHub Releases API",
                    manifest_url,
                    resp.status()
                );
            }
            Err(e) => {
                warn!(
                    "Manifest request failed ({}), falling back to GitHub Releases API",
                    e
                );
            }
        }

        // 2. Fallback to standard GitHub Releases API
        let api_url = format!("https://api.github.com/repos/{}/releases/latest", self.repo);
        let resp = self
            .http
            .get(&api_url)
            .send()
            .await
            .map_err(|e| format!("Failed to reach GitHub API: {}", e))?;

        if !resp.status().is_success() {
            return Err(format!("GitHub API returned HTTP {}", resp.status()));
        }

        let release_json = resp
            .json::<serde_json::Value>()
            .await
            .map_err(|e| format!("Failed to parse GitHub API response: {}", e))?;
        let tag_name = release_json
            .get("tag_name")
            .and_then(|v| v.as_str())
            .unwrap_or_default();
        let version = tag_name.trim_start_matches('v').to_string();

        if !is_newer_version(&version, current_version) {
            return Ok(None);
        }

        let published_at = release_json
            .get("published_at")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let html_url = release_json
            .get("html_url")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let body = release_json
            .get("body")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();

        let is_critical_security = body.to_lowercase().contains("[security]")
            || body.to_lowercase().contains("critical security")
            || tag_name.to_lowercase().contains("security");

        let mut targets = HashMap::new();
        if let Some(assets) = release_json.get("assets").and_then(|v| v.as_array()) {
            for asset in assets {
                let name = asset
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();
                let download_url = asset
                    .get("browser_download_url")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string();
                let size = asset.get("size").and_then(|v| v.as_u64()).unwrap_or(0);

                for &arch in &[
                    "x86_64-unknown-linux-musl",
                    "aarch64-unknown-linux-musl",
                    "armv7-unknown-linux-musleabihf",
                ] {
                    if name.contains(arch) && name.ends_with(".tar.gz") {
                        targets.insert(
                            arch.to_string(),
                            TargetArchiveInfo {
                                archive_name: name.to_string(),
                                download_url: download_url.clone(),
                                sha256: String::new(), // will check against SHA256SUMS.txt if empty
                                size,
                            },
                        );
                    }
                }
            }
        }

        Ok(Some(ReleaseManifest {
            version,
            tag_name: tag_name.to_string(),
            published_at,
            is_critical_security_update: is_critical_security,
            html_url: html_url.clone(),
            release_notes: Some(body),
            release_notes_url: Some(html_url),
            targets,
        }))
    }
}
