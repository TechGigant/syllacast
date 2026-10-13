// Syllacast - Standalone Spotify Lyrics Kiosk
// Copyright (C) 2026 TechGigant
// SPDX-License-Identifier: AGPL-3.0-or-later

use crate::soloist::models::PositionAnchor;
use crate::spicy::models::LyricsEnvelope;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackMetadata {
    pub id: String,
    pub uri: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub cover_url: Option<String>,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueItemDto {
    pub title: String,
    pub artist: String,
    pub cover_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LyricsStatus {
    Idle,
    Loading,
    Found,
    NotFound,
    Error,
}

fn default_lyrics_status() -> LyricsStatus {
    LyricsStatus::Idle
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppStateSnapshot {
    pub is_playing: bool,
    pub status: String,
    pub track: Option<TrackMetadata>,
    pub position: Option<PositionAnchor>,
    pub queue_upcoming: Vec<QueueItemDto>,
    pub lyrics: Option<LyricsEnvelope>,
    #[serde(default = "default_lyrics_status")]
    pub lyrics_status: LyricsStatus,
    #[serde(default)]
    pub volume: Option<u8>,
    #[serde(default)]
    pub shuffle: Option<bool>,
    #[serde(default)]
    pub repeat: Option<String>,
}

/// Client to server WebSocket messages
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ClientMessage {
    #[serde(rename = "ping")]
    Ping { t1: f64 },
    #[serde(rename = "get_state")]
    GetState,
    #[serde(rename = "play")]
    Play { uri: Option<String> },
    #[serde(rename = "pause")]
    Pause,
    #[serde(rename = "toggle_play")]
    TogglePlay,
    #[serde(rename = "skip_next")]
    SkipNext,
    #[serde(rename = "skip_prev")]
    SkipPrev,
    #[serde(rename = "seek")]
    Seek { position_ms: u64 },
    #[serde(rename = "set_volume")]
    SetVolume { volume: u8 },
    #[serde(rename = "set_shuffle")]
    SetShuffle { enabled: bool },
    #[serde(rename = "set_repeat")]
    SetRepeat { mode: String },
}

/// Server to client WebSocket messages
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ServerMessage {
    #[serde(rename = "pong")]
    Pong { t1: f64, t2: i64, t3: i64 },
    #[serde(rename = "state")]
    State(Box<AppStateSnapshot>),
    #[serde(rename = "position_sync")]
    PositionSync { position: PositionAnchor },
    #[serde(rename = "settings")]
    Settings(crate::settings::KioskSettings),
    #[serde(rename = "update_available")]
    UpdateAvailable(crate::updater::models::UpdateNotificationDto),
    #[serde(rename = "update_progress")]
    UpdateProgress {
        stage: String,
        percent: u8,
        message: String,
    },
}
