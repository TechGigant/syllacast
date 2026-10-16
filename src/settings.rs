// Syllacast - Standalone Spotify Lyrics Kiosk
// Copyright (C) 2026 TechGigant
// SPDX-License-Identifier: AGPL-3.0-or-later

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use tracing::{error, info, warn};

static BACKUP_COUNTER: AtomicU64 = AtomicU64::new(0);
pub const MAX_BACKUPS: usize = 10;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WidgetType {
    Lyrics,
    Nowbar,
    Clock,
    UpNext,
    PlayerControls,
    Iframe,
    Visualizer,
    Weather,
    ExtendedQueue,
    Note,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WidgetInstance {
    pub id: String,
    pub widget_type: WidgetType,
    pub x: u8,
    pub y: u8,
    pub w: u8,
    pub h: u8,
    #[serde(default = "default_true")]
    pub show_glass: bool,
    #[serde(default = "default_empty_object")]
    pub config: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LayoutProfile {
    pub id: String,
    pub name: String,
    pub widgets: Vec<WidgetInstance>,
}

pub fn default_layout_profiles() -> Vec<LayoutProfile> {
    vec![
        LayoutProfile {
            id: "default".to_string(),
            name: "Standard Kiosk".to_string(),
            widgets: vec![
                WidgetInstance {
                    id: "nowbar-1".to_string(),
                    widget_type: WidgetType::Nowbar,
                    x: 2,
                    y: 2,
                    w: 9,
                    h: 10,
                    show_glass: false,
                    config: serde_json::json!({}),
                },
                WidgetInstance {
                    id: "lyrics-1".to_string(),
                    widget_type: WidgetType::Lyrics,
                    x: 12,
                    y: 1,
                    w: 12,
                    h: 11,
                    show_glass: false,
                    config: serde_json::json!({}),
                },
                WidgetInstance {
                    id: "up_next-1".to_string(),
                    widget_type: WidgetType::UpNext,
                    x: 19,
                    y: 12,
                    w: 6,
                    h: 1,
                    show_glass: true,
                    config: serde_json::json!({}),
                },
                WidgetInstance {
                    id: "clock-1".to_string(),
                    widget_type: WidgetType::Clock,
                    x: 1,
                    y: 1,
                    w: 3,
                    h: 1,
                    show_glass: true,
                    config: serde_json::json!({}),
                },
            ],
        },
        LayoutProfile {
            id: "living_room_tv".to_string(),
            name: "Living Room Hub".to_string(),
            widgets: vec![
                WidgetInstance {
                    id: "nowbar-1".to_string(),
                    widget_type: WidgetType::Nowbar,
                    x: 1,
                    y: 1,
                    w: 8,
                    h: 8,
                    show_glass: true,
                    config: serde_json::json!({}),
                },
                WidgetInstance {
                    id: "visualizer-1".to_string(),
                    widget_type: WidgetType::Visualizer,
                    x: 1,
                    y: 9,
                    w: 8,
                    h: 4,
                    show_glass: true,
                    config: serde_json::json!({
                        "style": "bars",
                        "bar_count": 32,
                        "sensitivity": 1.0,
                        "color_mode": "cover_accent",
                        "mirror": false
                    }),
                },
                WidgetInstance {
                    id: "lyrics-1".to_string(),
                    widget_type: WidgetType::Lyrics,
                    x: 9,
                    y: 1,
                    w: 10,
                    h: 12,
                    show_glass: true,
                    config: serde_json::json!({}),
                },
                WidgetInstance {
                    id: "weather-1".to_string(),
                    widget_type: WidgetType::Weather,
                    x: 19,
                    y: 1,
                    w: 6,
                    h: 3,
                    show_glass: true,
                    config: serde_json::json!({
                        "location_name": "Berlin",
                        "latitude": 52.52,
                        "longitude": 13.41,
                        "unit": "celsius",
                        "show_forecast": true
                    }),
                },
                WidgetInstance {
                    id: "extended_queue-1".to_string(),
                    widget_type: WidgetType::ExtendedQueue,
                    x: 19,
                    y: 4,
                    w: 6,
                    h: 5,
                    show_glass: true,
                    config: serde_json::json!({
                        "mode": "tabs",
                        "max_items": 8,
                        "show_covers": true,
                        "click_to_play": true
                    }),
                },
                WidgetInstance {
                    id: "note-1".to_string(),
                    widget_type: WidgetType::Note,
                    x: 19,
                    y: 9,
                    w: 6,
                    h: 4,
                    show_glass: true,
                    config: serde_json::json!({
                        "mode": "wifi_qr",
                        "title": "Guest Wi-Fi",
                        "body_text": "Scan to connect",
                        "text_align": "center",
                        "wifi_ssid": "GuestWiFi",
                        "wifi_password": "",
                        "wifi_encryption": "WPA",
                        "wifi_hidden": false,
                        "show_password_text": true,
                        "qr_url": ""
                    }),
                },
            ],
        },
        LayoutProfile {
            id: "party".to_string(),
            name: "Party & Visualizer".to_string(),
            widgets: vec![
                WidgetInstance {
                    id: "nowbar-1".to_string(),
                    widget_type: WidgetType::Nowbar,
                    x: 1,
                    y: 1,
                    w: 7,
                    h: 7,
                    show_glass: true,
                    config: serde_json::json!({}),
                },
                WidgetInstance {
                    id: "extended_queue-1".to_string(),
                    widget_type: WidgetType::ExtendedQueue,
                    x: 1,
                    y: 8,
                    w: 7,
                    h: 5,
                    show_glass: true,
                    config: serde_json::json!({
                        "mode": "upcoming_only",
                        "max_items": 8,
                        "show_covers": true,
                        "click_to_play": true
                    }),
                },
                WidgetInstance {
                    id: "lyrics-1".to_string(),
                    widget_type: WidgetType::Lyrics,
                    x: 8,
                    y: 1,
                    w: 11,
                    h: 9,
                    show_glass: false,
                    config: serde_json::json!({}),
                },
                WidgetInstance {
                    id: "visualizer-1".to_string(),
                    widget_type: WidgetType::Visualizer,
                    x: 8,
                    y: 10,
                    w: 17,
                    h: 3,
                    show_glass: true,
                    config: serde_json::json!({
                        "style": "waves",
                        "bar_count": 48,
                        "sensitivity": 1.2,
                        "color_mode": "neon_gradient",
                        "mirror": true
                    }),
                },
                WidgetInstance {
                    id: "note-1".to_string(),
                    widget_type: WidgetType::Note,
                    x: 19,
                    y: 1,
                    w: 6,
                    h: 5,
                    show_glass: true,
                    config: serde_json::json!({
                        "mode": "wifi_qr",
                        "title": "Party Wi-Fi",
                        "body_text": "Scan to join the network",
                        "text_align": "center",
                        "wifi_ssid": "GuestWiFi",
                        "wifi_password": "",
                        "wifi_encryption": "WPA",
                        "wifi_hidden": false,
                        "show_password_text": true,
                        "qr_url": ""
                    }),
                },
                WidgetInstance {
                    id: "player_controls-1".to_string(),
                    widget_type: WidgetType::PlayerControls,
                    x: 19,
                    y: 6,
                    w: 6,
                    h: 4,
                    show_glass: true,
                    config: serde_json::json!({}),
                },
            ],
        },
        LayoutProfile {
            id: "minimal".to_string(),
            name: "Cinema Lyrics".to_string(),
            widgets: vec![
                WidgetInstance {
                    id: "lyrics-1".to_string(),
                    widget_type: WidgetType::Lyrics,
                    x: 3,
                    y: 1,
                    w: 20,
                    h: 12,
                    show_glass: false,
                    config: serde_json::json!({}),
                },
                WidgetInstance {
                    id: "clock-1".to_string(),
                    widget_type: WidgetType::Clock,
                    x: 22,
                    y: 1,
                    w: 3,
                    h: 1,
                    show_glass: true,
                    config: serde_json::json!({}),
                },
            ],
        },
    ]
}

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

    #[serde(default = "default_active_profile_id")]
    pub active_profile_id: String,

    #[serde(default = "default_layout_profiles")]
    pub layout_profiles: Vec<LayoutProfile>,
}

fn default_true() -> bool {
    true
}

fn default_empty_object() -> serde_json::Value {
    serde_json::Value::Object(serde_json::Map::new())
}

fn default_active_profile_id() -> String {
    "default".to_string()
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
            calibration_offset_ms: 0,
            dynamic_bg_mode: "dynamic".to_string(),
            update_mode: "notify".to_string(),
            update_channel: "stable".to_string(),
            update_check_interval_hours: 24,
            dismissed_update_version: None,
            snoozed_update_until: None,
            active_profile_id: "default".to_string(),
            layout_profiles: default_layout_profiles(),
        }
    }
}

pub struct SettingsManager {
    data_dir: PathBuf,
    file_path: PathBuf,
    backup_dir: PathBuf,
}

impl SettingsManager {
    pub fn new(data_dir: &Path) -> Self {
        let data_dir_buf = data_dir.to_path_buf();
        let file_path = data_dir_buf.join("syllacast_settings.json");
        let backup_dir = data_dir_buf.join("backups");
        Self {
            data_dir: data_dir_buf,
            file_path,
            backup_dir,
        }
    }

    pub fn file_path(&self) -> &Path {
        &self.file_path
    }

    pub fn backup_dir(&self) -> &Path {
        &self.backup_dir
    }

    pub fn list_backups(&self) -> Vec<PathBuf> {
        let mut backups = Vec::new();
        if let Ok(entries) = std::fs::read_dir(&self.backup_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() {
                    if let Some(file_name) = path.file_name().and_then(|n| n.to_str()) {
                        if file_name.starts_with("syllacast_settings_")
                            && file_name.ends_with(".json")
                        {
                            backups.push(path);
                        }
                    }
                }
            }
        }
        // Chronological descending (newest first). ISO 8601 formatting guarantees
        // that lexicographical filename sort descending matches chronological descending.
        backups.sort_by(|a, b| b.file_name().cmp(&a.file_name()));
        backups
    }

    pub fn prune_backups(&self, keep: usize) {
        let backups = self.list_backups();
        if backups.len() > keep {
            for old_backup in &backups[keep..] {
                if let Err(e) = std::fs::remove_file(old_backup) {
                    warn!("Failed to prune old backup {:?}: {}", old_backup, e);
                } else {
                    info!("Pruned old settings backup {:?}", old_backup);
                }
            }
        }
    }

    pub fn load(&self) -> KioskSettings {
        if self.file_path.exists() {
            match std::fs::read_to_string(&self.file_path) {
                Ok(content) => match serde_json::from_str::<KioskSettings>(&content) {
                    Ok(mut settings) => {
                        if settings.layout_profiles.is_empty() {
                            settings.layout_profiles = default_layout_profiles();
                        } else if let Some(def_prof) = settings
                            .layout_profiles
                            .iter_mut()
                            .find(|p| p.id == "default")
                        {
                            let has_legacy_up_next = def_prof.widgets.iter().any(|w| {
                                w.widget_type == WidgetType::UpNext && w.x == 18 && w.y == 1
                            });
                            if has_legacy_up_next {
                                if let Some(fresh_def) = default_layout_profiles()
                                    .into_iter()
                                    .find(|p| p.id == "default")
                                {
                                    def_prof.widgets = fresh_def.widgets;
                                }
                            }
                        }
                        info!("Loaded kiosk settings from {:?}", self.file_path);
                        return settings;
                    }
                    Err(parse_err) => {
                        error!(
                            "Corrupted kiosk settings detected in {:?}: {}",
                            self.file_path, parse_err
                        );

                        // Quarantine corrupted file to avoid data loss
                        let now_str = chrono::Utc::now()
                            .format("%Y%m%dT%H%M%S.%fZ")
                            .to_string()
                            .replace(':', "");
                        let quarantine_path = self
                            .data_dir
                            .join(format!("syllacast_settings.json.corrupt.{}", now_str));
                        if let Err(e) = std::fs::rename(&self.file_path, &quarantine_path) {
                            error!(
                                "Failed to quarantine corrupted settings to {:?}: {}",
                                quarantine_path, e
                            );
                        } else {
                            warn!("Quarantined corrupted settings to {:?}", quarantine_path);
                        }

                        // Attempt auto-recovery from backups (newest to oldest)
                        let backups = self.list_backups();
                        for backup_path in backups {
                            if let Ok(backup_content) = std::fs::read_to_string(&backup_path) {
                                if let Ok(mut recovered) =
                                    serde_json::from_str::<KioskSettings>(&backup_content)
                                {
                                    if recovered.layout_profiles.is_empty() {
                                        recovered.layout_profiles = default_layout_profiles();
                                    }
                                    warn!(
                                        "Recovering kiosk settings from valid backup: {:?}",
                                        backup_path
                                    );
                                    if let Err(e) = std::fs::copy(&backup_path, &self.file_path) {
                                        error!(
                                            "Failed to restore backup {:?} to active settings: {}",
                                            backup_path, e
                                        );
                                    } else {
                                        info!(
                                            "Successfully restored settings from backup to {:?}",
                                            self.file_path
                                        );
                                    }
                                    return recovered;
                                }
                            }
                        }

                        warn!(
                            "No valid backup found in {:?}. Initializing default settings.",
                            self.backup_dir
                        );
                    }
                },
                Err(io_err) => {
                    error!(
                        "Failed to read kiosk settings from {:?}: {}",
                        self.file_path, io_err
                    );
                    if io_err.kind() == std::io::ErrorKind::PermissionDenied {
                        return KioskSettings::default();
                    }
                }
            }
        }

        let default_settings = KioskSettings::default();
        let _ = self.save(&default_settings);
        default_settings
    }

    pub fn save(&self, settings: &KioskSettings) -> Result<(), std::io::Error> {
        use std::io::Write;

        std::fs::create_dir_all(&self.data_dir)?;
        std::fs::create_dir_all(&self.backup_dir)?;

        let json = serde_json::to_string_pretty(settings).map_err(std::io::Error::other)?;

        let seq = BACKUP_COUNTER.fetch_add(1, Ordering::SeqCst);
        let pid = std::process::id();
        let tmp_file_path = self
            .data_dir
            .join(format!("syllacast_settings.json.tmp.{pid}.{seq}"));

        {
            let mut file = std::fs::File::create(&tmp_file_path)?;
            file.write_all(json.as_bytes())?;
            file.sync_all()?;
        }

        // If active settings file exists and is valid JSON, archive it into backup_dir
        if self.file_path.exists() {
            if let Ok(existing_bytes) = std::fs::read(&self.file_path) {
                if serde_json::from_slice::<KioskSettings>(&existing_bytes).is_ok() {
                    let now_str = chrono::Utc::now()
                        .format("%Y%m%dT%H%M%S.%fZ")
                        .to_string()
                        .replace(':', "");
                    let backup_filename =
                        format!("syllacast_settings_{}_{:04}.json", now_str, seq % 10000);
                    let backup_path = self.backup_dir.join(backup_filename);

                    if let Ok(mut backup_file) = std::fs::File::create(&backup_path) {
                        let _ = backup_file.write_all(&existing_bytes);
                        let _ = backup_file.sync_all();
                    }
                }
            }
        }

        // Atomically replace active settings file with temporary file
        std::fs::rename(&tmp_file_path, &self.file_path)?;

        // Prune backups exceeding MAX_BACKUPS (10)
        self.prune_backups(MAX_BACKUPS);

        info!("Saved kiosk settings to {:?}", self.file_path);
        Ok(())
    }
}
