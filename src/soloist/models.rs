// Syllacast - Standalone Spotify Lyrics Kiosk
// Copyright (C) 2026 TechGigant
// SPDX-License-Identifier: AGPL-3.0-or-later

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoverImage {
    pub url: String,
    pub size: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VisualIdentity {
    pub cover: Option<Vec<CoverImage>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Identity {
    pub name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaybackDecoration {
    pub duration_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatorInnerEntity {
    pub uri: Option<String>,
    pub entity_type: Option<String>,
    pub decorations: Option<IdentityDecorations>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatorEntity {
    pub entity: Option<CreatorInnerEntity>,
    pub decorations: Option<IdentityDecorations>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdentityDecorations {
    pub identity: Option<Identity>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParentEntity {
    pub entity: Option<ParentInnerEntity>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParentInnerEntity {
    pub decorations: Option<IdentityDecorations>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntityDecorations {
    pub identity: Option<Identity>,
    pub visual_identity: Option<VisualIdentity>,
    pub playback: Option<PlaybackDecoration>,
    pub parent: Option<ParentEntity>,
    pub creators: Option<Vec<CreatorEntity>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SoloistEntity {
    #[serde(default)]
    pub uri: String,
    pub entity_type: Option<String>,
    pub decorations: Option<EntityDecorations>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PositionAnchor {
    pub position_ms: i64,
    pub timestamp_ms: i64,
    pub speed: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueItem {
    pub uid: Option<String>,
    pub source: Option<String>,
    pub item: Option<SoloistEntity>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SoloistOptions {
    #[serde(default)]
    pub shuffle: bool,
    #[serde(default = "default_repeat")]
    pub repeat: String,
    pub playback_speed: Option<f64>,
}

fn default_repeat() -> String {
    "off".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum SoloistServerEvent {
    #[serde(rename = "auth_state")]
    AuthState {
        logged_in: bool,
        is_active: Option<bool>,
        device_name: Option<String>,
    },

    #[serde(rename = "playback_state")]
    PlaybackState {
        status: String,
        item: Option<SoloistEntity>,
        position: Option<PositionAnchor>,
        is_active: Option<bool>,
        volume: Option<u8>,
        options: Option<SoloistOptions>,
    },

    #[serde(rename = "options_changed")]
    OptionsChanged { options: SoloistOptions },

    #[serde(rename = "volume_changed")]
    VolumeChanged { volume: u8 },

    #[serde(rename = "track_changed")]
    TrackChanged { item: Option<SoloistEntity> },

    #[serde(rename = "playback_changed")]
    PlaybackChanged { status: String },

    #[serde(rename = "position_sync")]
    PositionSync { position: PositionAnchor },

    #[serde(rename = "queue_changed")]
    QueueChanged {
        #[serde(default)]
        previous: Vec<QueueItem>,
        #[serde(default)]
        upcoming: Vec<QueueItem>,
    },

    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SoloistCommand {
    pub r#type: String,
    pub command: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uri: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub volume: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
}

impl SoloistCommand {
    pub fn new(command: impl Into<String>) -> Self {
        Self {
            r#type: "command".to_string(),
            command: command.into(),
            limit: None,
            uri: None,
            position_ms: None,
            volume: None,
            enabled: None,
        }
    }

    pub fn get_state() -> Self {
        Self::new("get_state")
    }

    pub fn get_queue(limit: Option<u32>) -> Self {
        let mut cmd = Self::new("get_queue");
        cmd.limit = limit;
        cmd
    }

    pub fn play(uri: Option<String>) -> Self {
        let mut cmd = Self::new("play");
        cmd.uri = uri;
        cmd
    }

    pub fn pause() -> Self {
        Self::new("pause")
    }

    pub fn skip_next() -> Self {
        Self::new("skip_next")
    }

    pub fn skip_prev() -> Self {
        Self::new("skip_prev")
    }

    pub fn seek(position_ms: u64) -> Self {
        let mut cmd = Self::new("seek");
        cmd.position_ms = Some(position_ms);
        cmd
    }

    pub fn set_volume(volume: u8) -> Self {
        let mut cmd = Self::new("set_volume");
        cmd.volume = Some(volume.min(100));
        cmd
    }

    pub fn set_shuffle(enabled: bool) -> Self {
        let mut cmd = Self::new("set_shuffle");
        cmd.enabled = Some(enabled);
        cmd
    }

    pub fn set_repeat_context(enabled: bool) -> Self {
        let mut cmd = Self::new("set_repeat_context");
        cmd.enabled = Some(enabled);
        cmd
    }

    pub fn set_repeat_track(enabled: bool) -> Self {
        let mut cmd = Self::new("set_repeat_track");
        cmd.enabled = Some(enabled);
        cmd
    }
}
