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

    let settings = EmbeddedAssets::get("settings.html");
    assert!(
        settings.is_some(),
        "settings.html must be embedded in the binary"
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

    for env_var in ["SOLOIST_DATA_DIR", "SOLOIST_WS_URL"] {
        if let Ok(val) = std::env::var(env_var) {
            if val.trim().is_empty() {
                std::env::remove_var(env_var);
            }
        }
    }

    assert!(std::env::var("SOLOIST_DATA_DIR").is_err());
    assert!(std::env::var("SOLOIST_WS_URL").is_err());
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
