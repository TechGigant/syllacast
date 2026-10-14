// Syllacast - Standalone Spotify Lyrics Kiosk
// Copyright (C) 2026 TechGigant
// SPDX-License-Identifier: AGPL-3.0-or-later

use crate::soloist::models::*;
use crate::spicy::models::*;

#[test]
fn test_soloist_playback_state_deserialization() {
    let json = r#"{
            "type": "playback_state",
            "status": "playing",
            "item": {
                "uri": "spotify:track:1QV6tiMFM6fSOKOGLMHYYg",
                "entity_type": "track",
                "decorations": {
                    "identity": { "name": "Poker Face" },
                    "playback": { "duration_ms": 237000 },
                    "parent": {
                        "entity": {
                            "decorations": {
                                "identity": { "name": "The Fame" }
                            }
                        }
                    },
                    "creators": [
                        {
                            "decorations": {
                                "identity": { "name": "Lady Gaga" }
                            }
                        }
                    ],
                    "visual_identity": {
                        "cover": [
                            { "url": "https://i.scdn.co/image/test", "size": "large" }
                        ]
                    }
                }
            },
            "position": {
                "position_ms": 12500,
                "timestamp_ms": 1747654321000,
                "speed": 1.0
            }
        }"#;

    let event: SoloistServerEvent = serde_json::from_str(json).expect("Failed to parse");
    match event {
        SoloistServerEvent::PlaybackState {
            status,
            item,
            position,
            ..
        } => {
            assert_eq!(status, "playing");
            assert!(item.is_some());
            let pos = position.expect("Missing position");
            assert_eq!(pos.position_ms, 12500);
            assert_eq!(pos.speed, 1.0);
        }
        _ => panic!("Expected PlaybackState variant"),
    }
}

#[test]
fn test_spicy_lyrics_syllable_deserialization() {
    let json = r#"{
            "Status": 200,
            "Type": "object",
            "Body": {
                "Type": "Syllable",
                "id": "1QV6tiMFM6fSOKOGLMHYYg",
                "source": "spicy_lyrics",
                "StartTime": 7.377,
                "EndTime": 234.0,
                "UploadAttribution": {
                    "Uploader": {
                        "id": "123",
                        "username": "spikerko",
                        "url": "https://spicylyrics.org/uid/123"
                    }
                },
                "Content": [
                    {
                        "Type": "Vocal",
                        "OppositeAligned": false,
                        "Lead": {
                            "StartTime": 7.377,
                            "EndTime": 8.73,
                            "Syllables": [
                                { "Text": "Mum-", "IsPartOfWord": true, "StartTime": 7.377, "EndTime": 7.585 },
                                { "Text": "mah", "IsPartOfWord": false, "StartTime": 8.129, "EndTime": 8.73 }
                            ]
                        }
                    }
                ]
            }
        }"#;

    let envelope: LyricsEnvelope =
        serde_json::from_str(json).expect("Failed to parse Spicy Lyrics payload");
    assert_eq!(envelope.Status, 200);
    match envelope.Body {
        LyricsBody::Syllable {
            id,
            source,
            Content,
            UploadAttribution,
            ..
        } => {
            assert_eq!(id, "1QV6tiMFM6fSOKOGLMHYYg");
            assert_eq!(source, "spicy_lyrics");
            assert_eq!(Content.len(), 1);
            assert_eq!(Content[0].Lead.Syllables.len(), 2);
            let attr = UploadAttribution.expect("Missing UploadAttribution");
            assert_eq!(attr.Uploader.username, "spikerko");
        }
        _ => panic!("Expected Syllable variant"),
    }
}

#[test]
fn test_secret_key_not_leaked_in_debug_or_snapshots() {
    use crate::config::Config;
    use crate::spicy::cache::LyricsCache;
    use crate::spicy::SpicyClient;
    use crate::sync::protocol::{AppStateSnapshot, LyricsStatus, ServerMessage};
    use std::sync::Arc;

    let test_secret = "sl_sk_super_secret_production_key_999";

    // 1. Verify Config Debug redaction
    let config = Config {
        port: 8080,
        bind: "0.0.0.0".to_string(),
        soloist_ws: None,
        soloist_data_dir: None,
        spicy_key: Some(test_secret.to_string()),
        cache_dir: None,
        config_dir: None,
        spicy_api_url: "https://api.spicylyrics.org/v1/lyrics".to_string(),
        frontend_dist: None,
    };
    let config_debug = format!("{:?}", config);
    assert!(
        !config_debug.contains(test_secret),
        "Secret key leaked in Config Debug output"
    );
    assert!(
        config_debug.contains("[REDACTED]"),
        "Config Debug output should contain [REDACTED]"
    );

    // 2. Verify SpicyClient Debug redaction
    let cache = Arc::new(LyricsCache::new(None));
    let client = SpicyClient::new(
        "https://api.spicylyrics.org/v1/lyrics".to_string(),
        Some(test_secret.to_string()),
        cache,
    );
    let client_debug = format!("{:?}", client);
    assert!(
        !client_debug.contains(test_secret),
        "Secret key leaked in SpicyClient Debug output"
    );
    assert!(
        client_debug.contains("[REDACTED]"),
        "SpicyClient Debug output should contain [REDACTED]"
    );

    // 3. Verify AppStateSnapshot serialized for WebSocket clients contains no secret
    let snapshot = AppStateSnapshot {
        is_playing: true,
        status: "playing".to_string(),
        track: None,
        position: None,
        queue_upcoming: Vec::new(),
        lyrics: None,
        lyrics_status: LyricsStatus::Found,
        volume: Some(75),
        shuffle: Some(true),
        repeat: Some("context".to_string()),
    };
    let msg = ServerMessage::State(Box::new(snapshot));
    let serialized = serde_json::to_string(&msg).expect("Failed to serialize state");
    assert!(!serialized.contains(test_secret));
}

#[test]
fn test_client_message_playback_commands() {
    use crate::sync::protocol::ClientMessage;

    let play_json = r#"{"type":"play","uri":"spotify:track:123"}"#;
    let msg: ClientMessage = serde_json::from_str(play_json).expect("deserialize play");
    match msg {
        ClientMessage::Play { uri } => assert_eq!(uri.as_deref(), Some("spotify:track:123")),
        _ => panic!("wrong variant"),
    }

    let pause_json = r#"{"type":"pause"}"#;
    let msg: ClientMessage = serde_json::from_str(pause_json).expect("deserialize pause");
    assert!(matches!(msg, ClientMessage::Pause));

    let toggle_json = r#"{"type":"toggle_play"}"#;
    let msg: ClientMessage = serde_json::from_str(toggle_json).expect("deserialize toggle_play");
    assert!(matches!(msg, ClientMessage::TogglePlay));

    let next_json = r#"{"type":"skip_next"}"#;
    let msg: ClientMessage = serde_json::from_str(next_json).expect("deserialize skip_next");
    assert!(matches!(msg, ClientMessage::SkipNext));

    let prev_json = r#"{"type":"skip_prev"}"#;
    let msg: ClientMessage = serde_json::from_str(prev_json).expect("deserialize skip_prev");
    assert!(matches!(msg, ClientMessage::SkipPrev));

    let seek_json = r#"{"type":"seek","position_ms":45000}"#;
    let msg: ClientMessage = serde_json::from_str(seek_json).expect("deserialize seek");
    match msg {
        ClientMessage::Seek { position_ms } => assert_eq!(position_ms, 45000),
        _ => panic!("wrong variant"),
    }

    let vol_json = r#"{"type":"set_volume","volume":65}"#;
    let msg: ClientMessage = serde_json::from_str(vol_json).expect("deserialize set_volume");
    match msg {
        ClientMessage::SetVolume { volume } => assert_eq!(volume, 65),
        _ => panic!("wrong variant"),
    }

    let shuffle_json = r#"{"type":"set_shuffle","enabled":true}"#;
    let msg: ClientMessage = serde_json::from_str(shuffle_json).expect("deserialize set_shuffle");
    match msg {
        ClientMessage::SetShuffle { enabled } => assert!(enabled),
        _ => panic!("wrong variant"),
    }

    let repeat_json = r#"{"type":"set_repeat","mode":"track"}"#;
    let msg: ClientMessage = serde_json::from_str(repeat_json).expect("deserialize set_repeat");
    match msg {
        ClientMessage::SetRepeat { mode } => assert_eq!(mode, "track"),
        _ => panic!("wrong variant"),
    }
}

#[test]
fn test_soloist_command_serialization() {
    use crate::soloist::models::SoloistCommand;

    let cmd = SoloistCommand::play(Some("spotify:track:abc".to_string()));
    let json = serde_json::to_string(&cmd).unwrap();
    assert_eq!(
        json,
        r#"{"type":"command","command":"play","uri":"spotify:track:abc"}"#
    );

    let cmd = SoloistCommand::seek(30000);
    let json = serde_json::to_string(&cmd).unwrap();
    assert_eq!(
        json,
        r#"{"type":"command","command":"seek","position_ms":30000}"#
    );

    let cmd = SoloistCommand::pause();
    let json = serde_json::to_string(&cmd).unwrap();
    assert_eq!(json, r#"{"type":"command","command":"pause"}"#);

    let cmd = SoloistCommand::set_volume(80);
    let json = serde_json::to_string(&cmd).unwrap();
    assert_eq!(
        json,
        r#"{"type":"command","command":"set_volume","volume":80}"#
    );

    let cmd = SoloistCommand::set_shuffle(true);
    let json = serde_json::to_string(&cmd).unwrap();
    assert_eq!(
        json,
        r#"{"type":"command","command":"set_shuffle","enabled":true}"#
    );

    let cmd = SoloistCommand::set_repeat_context(true);
    let json = serde_json::to_string(&cmd).unwrap();
    assert_eq!(
        json,
        r#"{"type":"command","command":"set_repeat_context","enabled":true}"#
    );

    let cmd = SoloistCommand::set_repeat_track(false);
    let json = serde_json::to_string(&cmd).unwrap();
    assert_eq!(
        json,
        r#"{"type":"command","command":"set_repeat_track","enabled":false}"#
    );
}

#[test]
fn test_soloist_volume_and_options_events() {
    use crate::soloist::models::SoloistServerEvent;

    let vol_json = r#"{"type":"volume_changed","volume":42}"#;
    let event: SoloistServerEvent =
        serde_json::from_str(vol_json).expect("deserialize volume_changed");
    match event {
        SoloistServerEvent::VolumeChanged { volume } => assert_eq!(volume, 42),
        _ => panic!("wrong variant"),
    }

    let opt_json = r#"{"type":"options_changed","options":{"shuffle":true,"repeat":"context"}}"#;
    let event: SoloistServerEvent =
        serde_json::from_str(opt_json).expect("deserialize options_changed");
    match event {
        SoloistServerEvent::OptionsChanged { options } => {
            assert!(options.shuffle);
            assert_eq!(options.repeat, "context");
        }
        _ => panic!("wrong variant"),
    }
}

#[test]
fn test_embedded_assets_load_from_binary() {
    use crate::server::assets::EmbeddedAssets;

    let index =
        EmbeddedAssets::get("index.html").expect("index.html must be embedded in the binary");
    let html_str = std::str::from_utf8(index.data.as_ref()).expect("valid utf-8 html");
    assert!(
        html_str.contains("<!DOCTYPE html>") || html_str.contains("<html"),
        "index.html must contain HTML"
    );
    assert!(
        !html_str.contains("fonts.spikerko.org"),
        "index.html must not contain external fonts.spikerko.org links"
    );

    let settings =
        EmbeddedAssets::get("settings.html").expect("settings.html must be embedded in binary");
    let settings_html = std::str::from_utf8(settings.data.as_ref()).expect("valid utf-8 html");
    assert!(
        !settings_html.contains("fonts.spikerko.org"),
        "settings.html must not contain external fonts.spikerko.org links"
    );

    // Verify offline .woff2 fonts are embedded in the binary
    let woff2_count = EmbeddedAssets::iter()
        .filter(|file| file.ends_with(".woff2"))
        .count();
    assert!(
        woff2_count > 0,
        "Embedded binary must bundle offline .woff2 fonts (found {})",
        woff2_count
    );
}

#[test]
fn test_version_comparison_logic() {
    use crate::updater::client::is_newer_version;

    assert!(is_newer_version("0.2.0", "0.1.0"));
    assert!(is_newer_version("0.1.1", "0.1.0"));
    assert!(is_newer_version("v1.0.0", "0.9.9"));
    assert!(is_newer_version("v0.2.0", "v0.1.9"));
    assert!(!is_newer_version("0.1.0", "0.1.0"));
    assert!(!is_newer_version("0.0.9", "0.1.0"));
    assert!(!is_newer_version("0.1.0", "0.2.0"));
    assert!(is_newer_version("0.1.0", "0.1.0-beta"));
}

#[test]
fn test_release_manifest_deserialization_standard() {
    use crate::updater::models::ReleaseManifest;

    let json = r#"{
            "version": "0.2.0",
            "tag_name": "v0.2.0",
            "published_at": "2026-10-13T19:00:00Z",
            "is_critical_security_update": false,
            "html_url": "https://github.com/TechGigant/syllacast/releases/tag/v0.2.0",
            "release_notes": "Added feature X",
            "targets": {
                "aarch64-unknown-linux-musl": {
                    "archive_name": "syllacast-v0.2.0-aarch64-unknown-linux-musl.tar.gz",
                    "download_url": "https://github.com/TechGigant/syllacast/releases/download/v0.2.0/syllacast-v0.2.0-aarch64-unknown-linux-musl.tar.gz",
                    "sha256": "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
                    "size": 6123456
                }
            }
        }"#;

    let manifest: ReleaseManifest =
        serde_json::from_str(json).expect("Failed to deserialize manifest");
    assert_eq!(manifest.version, "0.2.0");
    assert_eq!(manifest.tag_name, "v0.2.0");
    assert!(!manifest.is_critical_security_update);
    assert!(manifest.targets.contains_key("aarch64-unknown-linux-musl"));
    let target = &manifest.targets["aarch64-unknown-linux-musl"];
    assert_eq!(target.size, 6123456);
    assert_eq!(
        target.sha256,
        "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"
    );
}

#[test]
fn test_release_manifest_deserialization_critical_security() {
    use crate::updater::models::ReleaseManifest;

    let json = r#"{
            "version": "0.2.1",
            "tag_name": "v0.2.1-security",
            "published_at": "2026-10-13T20:00:00Z",
            "is_critical_security_update": true,
            "html_url": "https://github.com/TechGigant/syllacast/releases/tag/v0.2.1-security",
            "release_notes": "[SECURITY] Fixed buffer overflow vulnerability",
            "targets": {}
        }"#;

    let manifest: ReleaseManifest =
        serde_json::from_str(json).expect("Failed to deserialize critical manifest");
    assert_eq!(manifest.version, "0.2.1");
    assert!(manifest.is_critical_security_update);
}

#[test]
fn test_sha256_checksum_verification() {
    use sha2::{Digest, Sha256};

    let dummy_data = b"Syllacast Standalone Binary Content";
    let mut hasher = Sha256::new();
    hasher.update(dummy_data);
    let hash = format!("{:x}", hasher.finalize());

    assert_eq!(hash.len(), 64);

    // Verify recomputed hash matches
    let mut hasher2 = Sha256::new();
    hasher2.update(dummy_data);
    let hash2 = format!("{:x}", hasher2.finalize());
    assert_eq!(hash, hash2);

    // Corrupted data mismatch
    let mut hasher_bad = Sha256::new();
    hasher_bad.update(b"Corrupted Content");
    let hash_bad = format!("{:x}", hasher_bad.finalize());
    assert_ne!(hash, hash_bad);
}

#[test]
fn test_update_settings_defaults_and_serialization() {
    use crate::settings::KioskSettings;

    let settings = KioskSettings::default();
    assert_eq!(settings.update_mode, "notify");
    assert_eq!(settings.update_channel, "stable");
    assert_eq!(settings.update_check_interval_hours, 24);
    assert!(settings.snoozed_update_until.is_none());

    let json = serde_json::to_string(&settings).expect("serialize settings");
    let deserialized: KioskSettings = serde_json::from_str(&json).expect("deserialize settings");
    assert_eq!(deserialized.update_mode, "notify");
    assert_eq!(deserialized.update_check_interval_hours, 24);
}

#[test]
fn test_resolve_destination_path_custom_and_default() {
    use crate::updater::installer::UpdateInstaller;

    // Test with SYLLACAST_BIN_PATH override
    std::env::set_var("SYLLACAST_BIN_PATH", "/custom/bin/syllacast");
    let dest = UpdateInstaller::resolve_destination_path().expect("resolve path");
    assert_eq!(dest, std::path::PathBuf::from("/custom/bin/syllacast"));
    std::env::remove_var("SYLLACAST_BIN_PATH");

    // Test without override
    let dest_default = UpdateInstaller::resolve_destination_path().expect("resolve path");
    assert!(!dest_default.as_os_str().is_empty());
}

#[test]
fn test_empty_env_var_sanitization() {
    // Simulate systemd EnvironmentFile setting empty values
    std::env::set_var("SOLOIST_DATA_DIR", "");
    std::env::set_var("SOLOIST_WS_URL", "   ");
    std::env::set_var("FRONTEND_DIST", "valid_path");

    crate::sanitize_empty_env_vars();

    assert!(std::env::var("SOLOIST_DATA_DIR").is_err());
    assert!(std::env::var("SOLOIST_WS_URL").is_err());
    assert_eq!(std::env::var("FRONTEND_DIST").unwrap(), "valid_path");
    std::env::remove_var("FRONTEND_DIST");
}

#[tokio::test]
async fn test_sync_lyrics_for_track_deduplication() {
    use crate::config::Config;
    use crate::server::SharedState;
    use crate::settings::{KioskSettings, SettingsManager};
    use crate::spicy::cache::LyricsCache;
    use crate::spicy::SpicyClient;
    use crate::sync::protocol::{AppStateSnapshot, LyricsStatus, TrackMetadata};
    use crate::sync_lyrics_for_track;
    use crate::updater::UpdateService;
    use std::sync::Arc;
    use tokio::sync::{broadcast, RwLock};

    let temp_dir =
        std::env::temp_dir().join(format!("syllacast-test-dedup-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&temp_dir);
    let cache = Arc::new(LyricsCache::new(Some(temp_dir.clone())));
    let spicy_client = SpicyClient::new("http://127.0.0.1:9999".into(), None, cache);

    let (tx, _rx) = broadcast::channel(16);
    let (soloist_cmd_tx, _soloist_cmd_rx) = tokio::sync::mpsc::channel(16);
    let settings_manager = SettingsManager::new(&temp_dir);

    let shared_state = Arc::new(SharedState {
        config: Config::default(),
        current_state: RwLock::new(AppStateSnapshot {
            is_playing: true,
            status: "playing".to_string(),
            track: None,
            position: None,
            queue_upcoming: Vec::new(),
            lyrics: None,
            lyrics_status: LyricsStatus::Idle,
            volume: None,
            shuffle: None,
            repeat: None,
        }),
        tx: tx.clone(),
        settings: RwLock::new(KioskSettings::default()),
        settings_manager,
        soloist_cmd_tx,
        updater: Arc::new(UpdateService::new()),
    });

    let track = TrackMetadata {
        id: "test_track_id".to_string(),
        uri: "spotify:track:test_track_id".to_string(),
        title: "Test Track".to_string(),
        artist: "Test Artist".to_string(),
        album: "Test Album".to_string(),
        cover_url: None,
        duration_ms: 180_000,
    };

    // Case 1: Track is Loading -> calling sync_lyrics_for_track should return early and remain Loading
    let mut current = AppStateSnapshot {
        is_playing: true,
        status: "playing".to_string(),
        track: Some(track.clone()),
        position: None,
        queue_upcoming: Vec::new(),
        lyrics: None,
        lyrics_status: LyricsStatus::Loading,
        volume: None,
        shuffle: None,
        repeat: None,
    };

    sync_lyrics_for_track(
        &mut current,
        Some("test_track_id".to_string()),
        &spicy_client,
        &shared_state,
        &tx,
    );

    assert_eq!(current.lyrics_status, LyricsStatus::Loading);
    assert!(current.lyrics.is_none());

    // Case 2: None track_id resets lyrics to None and status to Idle
    sync_lyrics_for_track(&mut current, None, &spicy_client, &shared_state, &tx);
    assert_eq!(current.lyrics_status, LyricsStatus::Idle);
    assert!(current.lyrics.is_none());

    let _ = std::fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_lyrics_status_serialization() {
    use crate::sync::protocol::LyricsStatus;

    assert_eq!(
        serde_json::to_string(&LyricsStatus::Idle).unwrap(),
        "\"idle\""
    );
    assert_eq!(
        serde_json::to_string(&LyricsStatus::Loading).unwrap(),
        "\"loading\""
    );
    assert_eq!(
        serde_json::to_string(&LyricsStatus::Found).unwrap(),
        "\"found\""
    );
    assert_eq!(
        serde_json::to_string(&LyricsStatus::NotFound).unwrap(),
        "\"not_found\""
    );
    assert_eq!(
        serde_json::to_string(&LyricsStatus::Error).unwrap(),
        "\"error\""
    );

    let idle: LyricsStatus = serde_json::from_str("\"idle\"").unwrap();
    assert_eq!(idle, LyricsStatus::Idle);
    let err: LyricsStatus = serde_json::from_str("\"error\"").unwrap();
    assert_eq!(err, LyricsStatus::Error);
}

#[test]
fn test_server_message_update_serialization() {
    use crate::sync::protocol::ServerMessage;
    use crate::updater::models::UpdateNotificationDto;

    let dto = UpdateNotificationDto {
        current_version: "1.0.0".to_string(),
        latest_version: "1.0.1".to_string(),
        is_critical_security_update: false,
        release_notes_url: "https://github.com/TechGigant/syllacast/releases/tag/v1.0.1"
            .to_string(),
        release_notes: Some("Fixes and features".to_string()),
        published_at: "2026-10-13T20:00:00Z".to_string(),
        download_url: None,
    };

    let msg = ServerMessage::UpdateAvailable(dto);
    let json_str = serde_json::to_string(&msg).expect("Serialize UpdateAvailable");
    let v: serde_json::Value = serde_json::from_str(&json_str).expect("Parse JSON Value");

    assert_eq!(v["type"], "update_available");
    assert_eq!(v["current_version"], "1.0.0");
    assert_eq!(v["latest_version"], "1.0.1");
    assert_eq!(v["is_critical_security_update"], false);
    assert_eq!(v["release_notes"], "Fixes and features");

    let progress = ServerMessage::UpdateProgress {
        stage: "downloading".to_string(),
        percent: 45,
        message: "Downloading release archive...".to_string(),
    };
    let prog_json = serde_json::to_string(&progress).expect("Serialize UpdateProgress");
    let pv: serde_json::Value = serde_json::from_str(&prog_json).expect("Parse JSON Value");
    assert_eq!(pv["type"], "update_progress");
    assert_eq!(pv["stage"], "downloading");
    assert_eq!(pv["percent"], 45);
}

#[tokio::test]
async fn test_ws_on_connect_update_notification_logic() {
    use crate::settings::KioskSettings;
    use crate::updater::models::{UpdateNotificationDto, UpdatePhase, UpdateStatusResponse};
    use chrono::Utc;

    let dto = UpdateNotificationDto {
        current_version: "1.0.0".to_string(),
        latest_version: "1.0.1".to_string(),
        is_critical_security_update: false,
        release_notes_url: "https://github.com/TechGigant/syllacast/releases/tag/v1.0.1"
            .to_string(),
        release_notes: None,
        published_at: "2026-10-13T20:00:00Z".to_string(),
        download_url: None,
    };

    let _status = UpdateStatusResponse {
        current_version: "1.0.0".to_string(),
        latest_version: Some("1.0.1".to_string()),
        status: UpdatePhase::Available,
        progress_percent: None,
        last_checked_at: None,
        error_message: None,
        update_available: Some(dto.clone()),
        snoozed_until: None,
    };

    let mut settings = KioskSettings {
        update_mode: "notify".to_string(),
        ..Default::default()
    };

    // 1. When unsnoozed and update_mode == "notify": update should be dispatched
    let now_ms = Utc::now().timestamp_millis();
    let is_snoozed = !dto.is_critical_security_update
        && settings
            .snoozed_update_until
            .map(|s| s > now_ms)
            .unwrap_or(false);
    assert!(!is_snoozed);
    assert!(settings.update_mode != "disabled" || dto.is_critical_security_update);

    // 2. When snoozed: should NOT dispatch
    settings.snoozed_update_until = Some(now_ms + 10_000);
    let is_snoozed_now = !dto.is_critical_security_update
        && settings
            .snoozed_update_until
            .map(|s| s > now_ms)
            .unwrap_or(false);
    assert!(is_snoozed_now);

    // 3. When disabled: should NOT dispatch standard update
    settings.snoozed_update_until = None;
    settings.update_mode = "disabled".to_string();
    let can_dispatch = !(!dto.is_critical_security_update
        && settings
            .snoozed_update_until
            .map(|s| s > now_ms)
            .unwrap_or(false))
        && (settings.update_mode != "disabled" || dto.is_critical_security_update);
    assert!(!can_dispatch);

    // 4. Critical update bypasses disabled mode & snooze
    let critical_dto = UpdateNotificationDto {
        is_critical_security_update: true,
        ..dto
    };
    settings.snoozed_update_until = Some(now_ms + 10_000);
    settings.update_mode = "disabled".to_string();
    let is_snoozed_crit = !critical_dto.is_critical_security_update
        && settings
            .snoozed_update_until
            .map(|s| s > now_ms)
            .unwrap_or(false);
    let can_dispatch_crit = !is_snoozed_crit
        && (settings.update_mode != "disabled" || critical_dto.is_critical_security_update);
    assert!(can_dispatch_crit);
}

#[test]
fn test_settings_ignores_deprecated_attribution_and_source_link_toggles() {
    let legacy_json = r#"{
        "show_controls_buttons": true,
        "startup_mode": "cinema",
        "lyrics_source_enabled": false,
        "source_link_enabled": false,
        "clock_enabled": true
    }"#;
    let settings: crate::settings::KioskSettings =
        serde_json::from_str(legacy_json).expect("Should deserialize legacy json");
    assert_eq!(settings.startup_mode, "cinema");

    // Re-serializing should not output lyrics_source_enabled or source_link_enabled
    let serialized = serde_json::to_string(&settings).expect("Should serialize");
    assert!(!serialized.contains("lyrics_source_enabled"));
    assert!(!serialized.contains("source_link_enabled"));
}

#[test]
fn test_cache_prune_expired_runs_without_panic() {
    let temp_dir =
        std::env::temp_dir().join(format!("syllacast-test-cache-{}", std::process::id()));
    let cache = crate::spicy::cache::LyricsCache::new(Some(temp_dir.clone()));
    cache.prune_expired_disk_cache();
    let _ = std::fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_updater_verify_archive_checksum_fail_closed() {
    use crate::updater::installer::verify_archive_checksum;

    let test_bytes = b"hello syllacast security test";
    let valid_hash = "6371b663ef161df65e21cfa7b0083ff1b7d42311cc1583af33fbefb6a13607a0";

    // 1. Fail closed on empty checksum
    let err_empty = verify_archive_checksum(test_bytes, "").unwrap_err();
    assert!(err_empty.contains("could not retrieve expected SHA256 checksum"));

    let err_whitespace = verify_archive_checksum(test_bytes, "   ").unwrap_err();
    assert!(err_whitespace.contains("could not retrieve expected SHA256 checksum"));

    // 2. Fail on checksum mismatch
    let err_mismatch = verify_archive_checksum(
        test_bytes,
        "0000000000000000000000000000000000000000000000000000000000000000",
    )
    .unwrap_err();
    assert!(err_mismatch.contains("SHA256 checksum mismatch"));

    // 3. Succeed on valid lowercase hash
    assert!(verify_archive_checksum(test_bytes, valid_hash).is_ok());

    // 4. Succeed on valid uppercase hash (case-insensitive)
    let uppercase_hash = valid_hash.to_uppercase();
    assert!(verify_archive_checksum(test_bytes, &uppercase_hash).is_ok());
}

#[tokio::test]
async fn test_updater_concurrent_update_guard() {
    use crate::updater::models::UpdatePhase;
    use crate::updater::UpdateService;
    use tokio::sync::broadcast;

    let service = UpdateService::new();
    let (tx, _rx) = broadcast::channel(16);

    // 1. Idle with no manifest -> errors with no update available
    let res = service.apply_update(tx.clone()).await;
    assert_eq!(res.unwrap_err(), "No update currently available to apply.");

    // 2. When in Downloading phase -> guard rejects concurrent request
    service.set_status_for_test(UpdatePhase::Downloading).await;
    let res = service.apply_update(tx.clone()).await;
    assert_eq!(res.unwrap_err(), "An update is already in progress.");

    // 3. When in Verifying phase -> guard rejects concurrent request
    service.set_status_for_test(UpdatePhase::Verifying).await;
    let res = service.apply_update(tx.clone()).await;
    assert_eq!(res.unwrap_err(), "An update is already in progress.");

    // 4. When in Installing phase -> guard rejects concurrent request
    service.set_status_for_test(UpdatePhase::Installing).await;
    let res = service.apply_update(tx.clone()).await;
    assert_eq!(res.unwrap_err(), "An update is already in progress.");

    // 5. When in Restarting phase -> guard rejects concurrent request
    service.set_status_for_test(UpdatePhase::Restarting).await;
    let res = service.apply_update(tx.clone()).await;
    assert_eq!(res.unwrap_err(), "An update is already in progress.");
}

#[test]
fn test_is_allowed_origin() {
    use crate::server::origin::is_allowed_origin;

    // 1. Missing or empty origin -> allowed (same-origin / non-browser / curl)
    assert!(is_allowed_origin("", None));
    assert!(is_allowed_origin("   ", Some("localhost:8080")));

    // 2. Loopback
    assert!(is_allowed_origin("http://localhost", None));
    assert!(is_allowed_origin("http://localhost:8080", None));
    assert!(is_allowed_origin("http://127.0.0.1:8080", None));
    assert!(is_allowed_origin("http://[::1]:8080", None));

    // 3. RFC 1918 Private LAN subnets
    assert!(is_allowed_origin("http://192.168.1.100:8080", None));
    assert!(is_allowed_origin("http://10.0.5.21:3000", None));
    assert!(is_allowed_origin("http://172.16.0.1:8080", None));
    assert!(is_allowed_origin("http://172.31.255.255:8080", None));
    assert!(is_allowed_origin("http://169.254.1.1:8080", None)); // link-local
    assert!(is_allowed_origin("http://kiosk.local:8080", None)); // Zeroconf mDNS

    // 4. Match against Host header (reverse proxy / same-origin domain)
    assert!(is_allowed_origin(
        "https://kiosk.company.internal",
        Some("kiosk.company.internal")
    ));
    assert!(is_allowed_origin(
        "http://kiosk.company.internal:8080",
        Some("kiosk.company.internal:8080")
    ));

    // 5. Reject unauthorized external / public origins
    assert!(!is_allowed_origin(
        "http://evil.com",
        Some("192.168.1.50:8080")
    ));
    assert!(!is_allowed_origin(
        "https://attacker.org:8080",
        Some("localhost:8080")
    ));
    assert!(!is_allowed_origin("http://172.32.0.1:8080", None)); // 172.32 is public, not 172.16-31
    assert!(!is_allowed_origin("http://8.8.8.8:8080", None));

    // 6. SYLLACAST_ALLOWED_ORIGINS environment override
    std::env::set_var(
        "SYLLACAST_ALLOWED_ORIGINS",
        "https://allowed.custom.site,http://special.kiosk",
    );
    assert!(is_allowed_origin("https://allowed.custom.site", None));
    assert!(is_allowed_origin("http://special.kiosk", None));
    assert!(!is_allowed_origin("https://notallowed.custom.site", None));
    std::env::remove_var("SYLLACAST_ALLOWED_ORIGINS");
}

#[test]
fn test_is_valid_track_id() {
    use crate::spicy::cache::is_valid_track_id;

    // 1. Valid Spotify Base-62 track IDs
    assert!(is_valid_track_id("1QV6tiMFM6fSOKOGLMHYYg"));
    assert!(is_valid_track_id("3n3Ppam7vgaVa1iaRUc9Lp"));
    assert!(is_valid_track_id("track_123_valid"));

    // 2. Reject path traversal attempts
    assert!(!is_valid_track_id("../track"));
    assert!(!is_valid_track_id("../../etc/passwd"));
    assert!(!is_valid_track_id(".."));
    assert!(!is_valid_track_id("/etc/shadow"));
    assert!(!is_valid_track_id("track/subpath"));
    assert!(!is_valid_track_id(r"track\subpath"));

    // 3. Reject invalid characters
    assert!(!is_valid_track_id("track.json"));
    assert!(!is_valid_track_id("track;rm -rf"));
    assert!(!is_valid_track_id("track name with spaces"));
    assert!(!is_valid_track_id("track$"));

    // 4. Reject empty or oversized strings
    assert!(!is_valid_track_id(""));
    assert!(!is_valid_track_id("   "));
    let long_id = "a".repeat(65);
    assert!(!is_valid_track_id(&long_id));
    let valid_64 = "a".repeat(64);
    assert!(is_valid_track_id(&valid_64));
}

#[test]
fn test_settings_atomic_save_and_reload() {
    use crate::settings::{KioskSettings, SettingsManager};

    let temp_dir =
        std::env::temp_dir().join(format!("syllacast-test-settings-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&temp_dir);
    let manager = SettingsManager::new(&temp_dir);

    let mut custom_settings = KioskSettings {
        startup_mode: "cinema".to_string(),
        calibration_offset_ms: 150,
        update_channel: "prerelease".to_string(),
        dismissed_update_version: Some("1.2.0".to_string()),
        ..Default::default()
    };

    // Save settings atomically
    assert!(manager.save(&custom_settings).is_ok());

    // Verify main json file exists and temporary .tmp file is cleanly cleaned up
    let main_file = temp_dir.join("syllacast_settings.json");
    let tmp_file = temp_dir.join("syllacast_settings.json.tmp");
    assert!(main_file.exists());
    assert!(!tmp_file.exists());

    // Reload settings
    let loaded = manager.load();
    assert_eq!(loaded.startup_mode, "cinema");
    assert_eq!(loaded.calibration_offset_ms, 150);
    assert_eq!(loaded.update_channel, "prerelease");
    assert_eq!(loaded.dismissed_update_version.as_deref(), Some("1.2.0"));

    // Modify and re-save
    custom_settings.calibration_offset_ms = -50;
    assert!(manager.save(&custom_settings).is_ok());
    let reloaded = manager.load();
    assert_eq!(reloaded.calibration_offset_ms, -50);

    let _ = std::fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_dismissed_update_version_suppression() {
    use crate::settings::KioskSettings;
    use crate::updater::models::UpdateNotificationDto;

    let dto = UpdateNotificationDto {
        current_version: "1.0.0".to_string(),
        latest_version: "1.1.0".to_string(),
        is_critical_security_update: false,
        release_notes_url: "https://example.com".to_string(),
        release_notes: None,
        published_at: "2026-01-01T00:00:00Z".to_string(),
        download_url: None,
    };

    let mut settings = KioskSettings {
        update_mode: "notify".to_string(),
        dismissed_update_version: Some("1.1.0".to_string()),
        ..Default::default()
    };

    let now_ms = chrono::Utc::now().timestamp_millis();

    // 1. When non-critical and latest_version matches dismissed_update_version -> suppressed
    let is_dismissed = settings.dismissed_update_version.as_deref() == Some(&dto.latest_version);
    let is_snoozed = !dto.is_critical_security_update
        && (is_dismissed
            || settings
                .snoozed_update_until
                .map(|s| s > now_ms)
                .unwrap_or(false));
    let should_notify =
        !is_snoozed && (settings.update_mode != "disabled" || dto.is_critical_security_update);
    assert!(!should_notify);

    // 2. When a newer version comes along (1.2.0) that is not dismissed -> notify
    settings.dismissed_update_version = Some("1.0.9".to_string());
    let is_dismissed_new =
        settings.dismissed_update_version.as_deref() == Some(&dto.latest_version);
    let is_snoozed_new = !dto.is_critical_security_update
        && (is_dismissed_new
            || settings
                .snoozed_update_until
                .map(|s| s > now_ms)
                .unwrap_or(false));
    let should_notify_new =
        !is_snoozed_new && (settings.update_mode != "disabled" || dto.is_critical_security_update);
    assert!(should_notify_new);

    // 3. Critical security update bypasses dismissal
    let critical_dto = UpdateNotificationDto {
        is_critical_security_update: true,
        ..dto
    };
    settings.dismissed_update_version = Some("1.1.0".to_string());
    let is_dismissed_crit =
        settings.dismissed_update_version.as_deref() == Some(&critical_dto.latest_version);
    let is_snoozed_crit = !critical_dto.is_critical_security_update
        && (is_dismissed_crit
            || settings
                .snoozed_update_until
                .map(|s| s > now_ms)
                .unwrap_or(false));
    let should_notify_crit = !is_snoozed_crit
        && (settings.update_mode != "disabled" || critical_dto.is_critical_security_update);
    assert!(should_notify_crit);
}

#[test]
fn test_installer_format_env_file_newline_sanitization() {
    use crate::installer::actions::{format_env_file, InstallConfig};
    use std::path::PathBuf;

    let malicious_config = InstallConfig {
        spicy_key: "valid_key\nMALICIOUS_VAR=injected\r\nANOTHER=evil".to_string(),
        soloist_data_dir: PathBuf::from("/var/data\nEVIL_PATH=true"),
        port: 8080,
        bind: "127.0.0.1\nINJECTED_BIND=true".to_string(),
        service_user: "syllacast".to_string(),
        service_group: "syllacast".to_string(),
    };

    let env = format_env_file(&malicious_config);

    // Assert that newlines were stripped and no extra variables were injected as separate lines
    assert!(!env.contains("\nMALICIOUS_VAR="));
    assert!(!env.contains("\nEVIL_PATH="));
    assert!(!env.contains("\nINJECTED_BIND="));

    for line in env.lines() {
        if !line.starts_with('#') && !line.trim().is_empty() {
            assert!(
                line.starts_with("SPICY_LYRICS_SECRET_KEY=")
                    || line.starts_with("SOLOIST_DATA_DIR=")
                    || line.starts_with("SYLLACAST_PORT=")
                    || line.starts_with("SYLLACAST_BIND="),
                "Found unexpectedly injected line: {}",
                line
            );
        }
    }
    assert!(env.contains("SPICY_LYRICS_SECRET_KEY=valid_keyMALICIOUS_VAR=injectedANOTHER=evil\n"));
    assert!(env.contains("SOLOIST_DATA_DIR=/var/dataEVIL_PATH=true\n"));
    assert!(env.contains("SYLLACAST_BIND=127.0.0.1INJECTED_BIND=true\n"));
    assert!(env.contains("SYLLACAST_PORT=8080\n"));
}

#[test]
fn test_installer_is_root_fails_closed_on_non_root() {
    // In standard CI / user environments (and on Windows), is_root should fail-closed and return false
    #[cfg(not(unix))]
    {
        assert!(!crate::installer::discovery::is_root());
    }
    #[cfg(unix)]
    {
        // On Unix, unless executed as actual root (UID 0), is_root must return false
        if let Ok(output) = std::process::Command::new("id").arg("-u").output() {
            if let Ok(uid) = std::str::from_utf8(&output.stdout) {
                if uid.trim() != "0" {
                    assert!(!crate::installer::discovery::is_root());
                }
            }
        }
    }
}

#[test]
fn test_installer_input_validation_helpers() {
    // 1. IP validation
    assert!("0.0.0.0".parse::<std::net::IpAddr>().is_ok());
    assert!("127.0.0.1".parse::<std::net::IpAddr>().is_ok());
    assert!("192.168.1.50".parse::<std::net::IpAddr>().is_ok());
    assert!("::1".parse::<std::net::IpAddr>().is_ok());

    assert!("localhost".parse::<std::net::IpAddr>().is_err());
    assert!("256.0.0.1".parse::<std::net::IpAddr>().is_err());
    assert!("".parse::<std::net::IpAddr>().is_err());

    // 2. Custom username character validation
    let is_valid_username_char = |c: char| c.is_ascii_alphanumeric() || c == '_' || c == '-';
    assert!(is_valid_username_char('a'));
    assert!(is_valid_username_char('Z'));
    assert!(is_valid_username_char('9'));
    assert!(is_valid_username_char('_'));
    assert!(is_valid_username_char('-'));

    assert!(!is_valid_username_char(';'));
    assert!(!is_valid_username_char(' '));
    assert!(!is_valid_username_char('/'));
    assert!(!is_valid_username_char('$'));
    assert!(!is_valid_username_char('\n'));
}

#[tokio::test]
async fn test_api_health_endpoint() {
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use std::sync::Arc;
    use tokio::sync::{broadcast, RwLock};
    use tower::ServiceExt;

    use crate::config::Config;
    use crate::server::SharedState;
    use crate::settings::{KioskSettings, SettingsManager};
    use crate::sync::protocol::{AppStateSnapshot, LyricsStatus};
    use crate::updater::UpdateService;

    let temp_dir =
        std::env::temp_dir().join(format!("syllacast_test_health_{}", std::process::id()));
    let _ = std::fs::create_dir_all(&temp_dir);

    let (tx, _rx) = broadcast::channel(16);
    let (soloist_cmd_tx, _soloist_cmd_rx) = tokio::sync::mpsc::channel(16);
    let settings_manager = SettingsManager::new(&temp_dir);

    let shared_state = Arc::new(SharedState {
        config: Config::default(),
        current_state: RwLock::new(AppStateSnapshot {
            is_playing: false,
            status: "paused".to_string(),
            track: None,
            position: None,
            queue_upcoming: Vec::new(),
            lyrics: None,
            lyrics_status: LyricsStatus::Idle,
            volume: None,
            shuffle: None,
            repeat: None,
        }),
        tx,
        settings: RwLock::new(KioskSettings::default()),
        settings_manager,
        soloist_cmd_tx,
        updater: Arc::new(UpdateService::new()),
    });
    let router = crate::server::routes::create_routes(shared_state);

    let response = router
        .oneshot(
            Request::builder()
                .uri("/api/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let _ = std::fs::remove_dir_all(&temp_dir);
}
