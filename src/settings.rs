// Syllacast - Standalone Spotify Lyrics Kiosk
// Copyright (C) 2026 TechGigant
// SPDX-License-Identifier: AGPL-3.0-or-later

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tracing::{error, info};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KioskSettings {
    #[serde(default = "default_true")]
    pub show_controls_buttons: bool,

    #[serde(default = "default_standard")]
    pub startup_mode: String,

    #[serde(default = "default_true")]
    pub nowbar_open: bool,

    #[serde(default = "default_left")]
    pub nowbar_side: String,

    #[serde(default = "default_true")]
    pub clock_enabled: bool,

    #[serde(default = "default_true")]
    pub up_next_enabled: bool,

    #[serde(default = "default_true")]
    pub source_link_enabled: bool,

    #[serde(default = "default_true")]
    pub lyrics_source_enabled: bool,

    #[serde(default)]
    pub calibration_offset_ms: i32,

    #[serde(default = "default_dynamic")]
    pub dynamic_bg_mode: String,

    #[serde(default = "default_update_mode")]
    pub update_mode: String,

    #[serde(default = "default_update_channel")]
    pub update_channel: String,

    #[serde(default = "default_update_interval_hours")]
    pub update_check_interval_hours: u32,

    #[serde(default)]
    pub dismissed_update_version: Option<String>,

    #[serde(default)]
    pub snoozed_update_until: Option<i64>,
}

fn default_true() -> bool {
    true
}

fn default_standard() -> String {
    "standard".to_string()
}

fn default_left() -> String {
    "left".to_string()
}

fn default_dynamic() -> String {
    "dynamic".to_string()
}

fn default_update_mode() -> String {
    "notify".to_string()
}

fn default_update_channel() -> String {
    "stable".to_string()
}

fn default_update_interval_hours() -> u32 {
    24
}

impl Default for KioskSettings {
    fn default() -> Self {
        Self {
            show_controls_buttons: true,
            startup_mode: "standard".to_string(),
            nowbar_open: true,
            nowbar_side: "left".to_string(),
            clock_enabled: true,
            up_next_enabled: true,
            source_link_enabled: true,
            lyrics_source_enabled: true,
            calibration_offset_ms: 0,
            dynamic_bg_mode: "dynamic".to_string(),
            update_mode: "notify".to_string(),
            update_channel: "stable".to_string(),
            update_check_interval_hours: 24,
            dismissed_update_version: None,
            snoozed_update_until: None,
        }
    }
}

pub struct SettingsManager {
    file_path: PathBuf,
}

impl SettingsManager {
    pub fn new(data_dir: &Path) -> Self {
        let file_path = data_dir.join("syllacast_settings.json");
        Self { file_path }
    }

    pub fn load(&self) -> KioskSettings {
        if self.file_path.exists() {
            match std::fs::read_to_string(&self.file_path) {
                Ok(content) => match serde_json::from_str::<KioskSettings>(&content) {
                    Ok(settings) => {
                        info!("Loaded kiosk settings from {:?}", self.file_path);
                        return settings;
                    }
                    Err(e) => {
                        error!(
                            "Failed to parse kiosk settings from {:?}: {}",
                            self.file_path, e
                        );
                    }
                },
                Err(e) => {
                    error!(
                        "Failed to read kiosk settings from {:?}: {}",
                        self.file_path, e
                    );
                }
            }
        }
        let default_settings = KioskSettings::default();
        let _ = self.save(&default_settings);
        default_settings
    }

    pub fn save(&self, settings: &KioskSettings) -> Result<(), std::io::Error> {
        if let Some(parent) = self.file_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let json = serde_json::to_string_pretty(settings).map_err(std::io::Error::other)?;
        std::fs::write(&self.file_path, json)?;
        info!("Saved kiosk settings to {:?}", self.file_path);
        Ok(())
    }
}
