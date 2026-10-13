// Syllacast - Standalone Spotify Lyrics Kiosk
// Copyright (C) 2026 TechGigant
// SPDX-License-Identifier: AGPL-3.0-or-later

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TargetArchiveInfo {
    pub archive_name: String,
    pub download_url: String,
    pub sha256: String,
    #[serde(default)]
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReleaseManifest {
    pub version: String,
    pub tag_name: String,
    pub published_at: String,
    #[serde(default)]
    pub is_critical_security_update: bool,
    #[serde(default)]
    pub html_url: String,
    #[serde(default)]
    pub release_notes: Option<String>,
    #[serde(default)]
    pub release_notes_url: Option<String>,
    #[serde(default)]
    pub targets: HashMap<String, TargetArchiveInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum UpdatePhase {
    Idle,
    Checking,
    Available,
    Downloading,
    Verifying,
    Installing,
    Restarting,
    UpToDate,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateNotificationDto {
    pub current_version: String,
    pub latest_version: String,
    pub is_critical_security_update: bool,
    pub release_notes_url: String,
    #[serde(default)]
    pub release_notes: Option<String>,
    pub published_at: String,
    #[serde(default)]
    pub download_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateStatusResponse {
    pub current_version: String,
    pub latest_version: Option<String>,
    pub status: UpdatePhase,
    pub progress_percent: Option<u8>,
    pub last_checked_at: Option<String>,
    pub error_message: Option<String>,
    pub update_available: Option<UpdateNotificationDto>,
    pub snoozed_until: Option<i64>,
}
