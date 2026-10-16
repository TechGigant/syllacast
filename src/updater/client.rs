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

/// Parses a version string, stripping an optional leading 'v'.
pub fn parse_semver(v: &str) -> Result<semver::Version, semver::Error> {
    let clean = v.trim().strip_prefix('v').unwrap_or(v.trim());
    semver::Version::parse(clean)
}

/// Compares two version strings according to SemVer 2.0.0 precedence rules.
/// Returns true if `candidate` has strictly greater precedence than `current`.
/// Build metadata (+build...) is strictly ignored per SemVer 2.0.0 §10.
/// Returns false if candidate or current is invalid SemVer.
pub fn is_newer_version(candidate: &str, current: &str) -> bool {
    let (Ok(cand), Ok(curr)) = (parse_semver(candidate), parse_semver(current)) else {
        return false;
    };
    cand.cmp_precedence(&curr).is_gt()
}

/// Checked version comparison returning descriptive errors if parsing fails.
#[allow(dead_code)]
pub fn is_newer_version_checked(candidate: &str, current: &str) -> Result<bool, String> {
    let cand = parse_semver(candidate)
        .map_err(|e| format!("Invalid candidate version '{candidate}': {e}"))?;
    let curr = parse_semver(current)
        .map_err(|e| format!("Invalid current application version '{current}': {e}"))?;
    Ok(cand.cmp_precedence(&curr).is_gt())
}

/// Validates whether a release candidate is eligible for the stable channel.
/// Returns Ok(true) if valid and stable.
/// Returns Ok(false) if the candidate is an identifiable pre-release.
/// Returns Err(...) if release metadata is contradictory or malformed.
pub fn is_eligible_for_stable(manifest: &ReleaseManifest) -> Result<bool, String> {
    // 1. Tag name must match manifest version (ignoring optional leading 'v')
    let tag_clean = manifest
        .tag_name
        .trim()
        .strip_prefix('v')
        .unwrap_or(manifest.tag_name.trim());
    let version_clean = manifest
        .version
        .trim()
        .strip_prefix('v')
        .unwrap_or(manifest.version.trim());
    if tag_clean != version_clean {
        return Err(format!(
            "Contradictory release metadata: tag '{}' does not match version '{}'",
            manifest.tag_name, manifest.version
        ));
    }

    // 2. Parsed SemVer must NOT have a pre-release component
    let parsed_ver = parse_semver(&manifest.version)
        .map_err(|e| format!("Invalid SemVer in manifest '{}': {e}", manifest.version))?;
    if !parsed_ver.pre.is_empty() {
        return Ok(false);
    }

    // 3. Manifest is_prerelease flag (when present) must not be true
    if manifest.is_prerelease == Some(true) {
        return Ok(false);
    }

    Ok(true)
}

/// Parses a GitHub API release JSON object into a `ReleaseManifest`.
pub fn parse_release_value(release_json: &serde_json::Value) -> Option<ReleaseManifest> {
    let tag_name = release_json
        .get("tag_name")
        .and_then(|v| v.as_str())?
        .to_string();
    let version = tag_name.trim_start_matches('v').to_string();

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
    let is_prerelease = release_json.get("prerelease").and_then(|v| v.as_bool());

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

    Some(ReleaseManifest {
        version,
        tag_name,
        published_at,
        is_critical_security_update: is_critical_security,
        is_prerelease,
        html_url: html_url.clone(),
        release_notes: Some(body),
        release_notes_url: Some(html_url),
        targets,
    })
}

/// Client for checking and querying Syllacast releases on GitHub.
pub struct UpdateClient {
    http: reqwest::Client,
    repo: String,
}

impl Default for UpdateClient {
    fn default() -> Self {
        Self::new()
    }
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

    /// Checks for a newer release on GitHub according to update channel policy.
    /// When `channel == "prerelease"`, paginates through non-draft releases and selects
    /// the candidate with highest SemVer precedence.
    /// When `channel == "stable"`, queries rate-limit-free release-manifest.json (falling back to `/releases/latest`)
    /// and strictly rejects pre-releases and contradictory metadata.
    pub async fn check_for_update(
        &self,
        current_version: &str,
        channel: &str,
    ) -> Result<Option<ReleaseManifest>, String> {
        let current_semver = parse_semver(current_version)
            .map_err(|e| format!("Invalid current application version '{current_version}': {e}"))?;

        let channel_normalized = match channel.trim().to_lowercase().as_str() {
            "prerelease" | "beta" => "prerelease",
            _ => "stable",
        };

        info!(
            "Checking for updates against repo {} (channel: {}, current: v{})",
            self.repo, channel_normalized, current_version
        );

        // 1. Prerelease channel: query paginated GitHub Releases API to find highest precedence non-draft release
        if channel_normalized == "prerelease" {
            let mut page = 1;
            const MAX_PAGES: u32 = 5; // Up to 150 releases
            let mut eligible_candidates: Vec<ReleaseManifest> = Vec::new();

            loop {
                let api_url = format!(
                    "https://api.github.com/repos/{}/releases?per_page=30&page={}",
                    self.repo, page
                );
                let resp = self.http.get(&api_url).send().await.map_err(|e| {
                    format!("Failed to reach GitHub API for prereleases (page {page}): {e}")
                })?;

                if !resp.status().is_success() {
                    return Err(format!(
                        "GitHub API returned HTTP {} on page {}",
                        resp.status(),
                        page
                    ));
                }

                let releases: Vec<serde_json::Value> = resp.json().await.map_err(|e| {
                    format!("Failed to parse GitHub releases list (page {page}): {e}")
                })?;

                if releases.is_empty() {
                    break;
                }

                let count = releases.len();
                for rel in releases {
                    // Ignore draft releases
                    if rel.get("draft").and_then(|v| v.as_bool()).unwrap_or(false) {
                        continue;
                    }

                    // Try downloading release-manifest.json asset if bundled
                    let manifest = if let Some(assets) =
                        rel.get("assets").and_then(|v| v.as_array())
                    {
                        let manifest_asset = assets.iter().find(|a| {
                            a.get("name").and_then(|n| n.as_str()) == Some("release-manifest.json")
                        });
                        if let Some(asset) = manifest_asset {
                            if let Some(dl_url) =
                                asset.get("browser_download_url").and_then(|u| u.as_str())
                            {
                                if let Ok(m_resp) = self.http.get(dl_url).send().await {
                                    if m_resp.status().is_success() {
                                        m_resp.json::<ReleaseManifest>().await.ok()
                                    } else {
                                        None
                                    }
                                } else {
                                    None
                                }
                            } else {
                                None
                            }
                        } else {
                            None
                        }
                    } else {
                        None
                    };

                    let manifest = manifest.or_else(|| parse_release_value(&rel));

                    if let Some(m) = manifest {
                        if let Ok(cand_ver) = parse_semver(&m.version) {
                            if cand_ver.cmp_precedence(&current_semver).is_gt() {
                                eligible_candidates.push(m);
                            }
                        }
                    }
                }

                if count < 30 || page >= MAX_PAGES {
                    break;
                }
                page += 1;
            }

            if eligible_candidates.is_empty() {
                return Ok(None);
            }

            // Global maximum: select candidate with greatest SemVer precedence
            eligible_candidates.sort_by(|a, b| {
                let a_ver = parse_semver(&a.version).ok();
                let b_ver = parse_semver(&b.version).ok();
                match (a_ver, b_ver) {
                    (Some(av), Some(bv)) => bv.cmp_precedence(&av), // descending precedence
                    _ => std::cmp::Ordering::Equal,
                }
            });

            return Ok(eligible_candidates.into_iter().next());
        }

        // 2. Stable channel: attempt downloading static release-manifest.json from GitHub Releases asset CDN
        let manifest_url = format!(
            "https://github.com/{}/releases/latest/download/release-manifest.json",
            self.repo
        );

        match self.http.get(&manifest_url).send().await {
            Ok(resp) if resp.status().is_success() => {
                if let Ok(manifest) = resp.json::<ReleaseManifest>().await {
                    info!("Fetched release manifest for tag {}", manifest.tag_name);
                    match is_eligible_for_stable(&manifest) {
                        Ok(true) => {
                            if is_newer_version(&manifest.version, current_version) {
                                return Ok(Some(manifest));
                            } else {
                                return Ok(None);
                            }
                        }
                        Ok(false) => {
                            warn!(
                                "Manifest {} is marked prerelease; skipping on stable channel",
                                manifest.tag_name
                            );
                        }
                        Err(e) => {
                            warn!(
                                "Manifest metadata validation failed: {}; falling back to GitHub API",
                                e
                            );
                        }
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

        // 3. Fallback to standard GitHub Releases API (/releases/latest)
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

        if let Some(manifest) = parse_release_value(&release_json) {
            match is_eligible_for_stable(&manifest) {
                Ok(true) => {
                    if is_newer_version(&manifest.version, current_version) {
                        return Ok(Some(manifest));
                    }
                }
                Ok(false) => {
                    warn!(
                        "Release {} is marked prerelease; skipping on stable channel",
                        manifest.tag_name
                    );
                }
                Err(e) => {
                    warn!("Release metadata validation failed: {}", e);
                }
            }
        }

        Ok(None)
    }
}
