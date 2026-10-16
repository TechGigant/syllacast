// Syllacast - Standalone Spotify Lyrics Kiosk
// Copyright (C) 2026 TechGigant
// SPDX-License-Identifier: AGPL-3.0-or-later

mod config;
mod installer;
mod server;
mod settings;
mod soloist;
mod spicy;
mod sync;
mod updater;

#[cfg(test)]
mod tests;

use clap::{Parser, Subcommand};
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};
use tracing::{info, warn};

use config::Config;
use soloist::models::{PositionAnchor, SoloistCommand, SoloistEntity, SoloistServerEvent};
use soloist::run_soloist_client;
use spicy::cache::{CacheLookup, LyricsCache};
use spicy::{LyricsFetchResult, SpicyClient};
use sync::protocol::{AppStateSnapshot, LyricsStatus, QueueItemDto, ServerMessage, TrackMetadata};

#[derive(Parser)]
#[command(
    name = "syllacast",
    about = "Network-synchronized Spotify lyrics display server"
)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Option<Commands>,

    /// Launch interactive Ratatui installer & service manager
    #[arg(long)]
    pub install: bool,

    #[command(flatten)]
    pub server_config: Config,
}

#[derive(Subcommand)]
pub enum Commands {
    /// Launch the interactive Ratatui installer & service manager
    Install,
    /// Launch the interactive Ratatui installer & service manager (alias for install)
    Setup,
    /// Run the server daemon
    Serve(Box<Config>),
}

/// Sanitizes empty environment variables from systemd or shell to avoid clap argument errors.
pub fn sanitize_empty_env_vars() {
    for env_var in [
        "SOLOIST_DATA_DIR",
        "SOLOIST_WS_URL",
        "FRONTEND_DIST",
        "LYRICS_CACHE_DIR",
        "SYLLACAST_CONFIG_DIR",
        "SPICY_LYRICS_SECRET_KEY",
        "SYLLACAST_BIND",
        "SYLLACAST_PORT",
    ] {
        if let Ok(val) = std::env::var(env_var) {
            if val.trim().is_empty() {
                std::env::remove_var(env_var);
            }
        }
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    // 1. Load .env file before parsing CLI or evaluating clap env attributes
    let _ = dotenvy::dotenv();

    // 2. Sanitize empty environment variables on the single main thread
    sanitize_empty_env_vars();

    // 3. Parse CLI arguments
    let cli = Cli::parse();

    // 4. Initialize multi-threaded Tokio runtime
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?
        .block_on(async_main(cli))
}

async fn async_main(cli: Cli) -> Result<(), Box<dyn std::error::Error>> {
    if cli.install || matches!(cli.command, Some(Commands::Install | Commands::Setup)) {
        return installer::run_installer().await;
    }

    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "syllacast=info,tower_http=info".into()),
        )
        .init();

    // 3. Resolve config
    let config = match cli.command {
        Some(Commands::Serve(c)) => *c,
        _ => cli.server_config,
    };
    info!("Starting Syllacast on {}:{}", config.bind, config.port);

    // 4. Initialize Lyrics Cache and Client
    let cache_dir = config
        .cache_dir
        .clone()
        .or_else(|| dirs::cache_dir().map(|c| c.join("syllacast").join("lyrics")));
    let lyrics_cache = Arc::new(LyricsCache::new(cache_dir));
    let spicy_client = SpicyClient::new(
        config.spicy_api_url.clone(),
        config.spicy_key.clone(),
        lyrics_cache,
    );

    // 5. State channels
    let (soloist_tx, mut soloist_rx) = broadcast::channel::<SoloistServerEvent>(100);
    let (soloist_cmd_tx, soloist_cmd_rx) = tokio::sync::mpsc::channel::<SoloistCommand>(32);
    let (client_tx, _) = broadcast::channel::<ServerMessage>(200);

    let initial_state = AppStateSnapshot {
        is_playing: false,
        status: "idle".to_string(),
        track: None,
        position: None,
        queue_upcoming: Vec::new(),
        lyrics: None,
        lyrics_status: LyricsStatus::Idle,
        volume: None,
        shuffle: None,
        repeat: None,
    };

    let settings_dir_buf = config
        .config_dir
        .clone()
        .or_else(|| dirs::config_dir().map(|d| d.join("syllacast")))
        .or_else(|| dirs::data_dir().map(|d| d.join("syllacast")))
        .unwrap_or_else(|| std::path::PathBuf::from("."));
    let settings_manager = settings::SettingsManager::new(&settings_dir_buf);
    let initial_settings = settings_manager.load();
    let update_service = Arc::new(updater::UpdateService::new());

    let shared_state = Arc::new(server::SharedState {
        config: config.clone(),
        current_state: RwLock::new(initial_state),
        tx: client_tx.clone(),
        settings: RwLock::new(initial_settings),
        settings_lock: tokio::sync::Mutex::new(()),
        settings_manager,
        soloist_cmd_tx: soloist_cmd_tx.clone(),
        updater: Arc::clone(&update_service),
    });

    // 6. Spawn Soloist Client worker with dynamic discovery and command receiver
    tokio::spawn(run_soloist_client(
        config.soloist_ws.clone(),
        config.soloist_data_dir.clone(),
        soloist_tx,
        soloist_cmd_rx,
    ));

    // 7. Spawn Background Auto-Update Worker
    let updater_ref = Arc::clone(&update_service);
    let state_updater_ref = Arc::clone(&shared_state);
    let updater_client_tx = client_tx.clone();

    tokio::spawn(async move {
        // Initial grace period after startup before first check
        tokio::time::sleep(tokio::time::Duration::from_secs(15)).await;

        loop {
            let (mode, interval_hours) = {
                let s = state_updater_ref.settings.read().await;
                (s.update_mode.clone(), s.update_check_interval_hours)
            };

            if mode != "disabled" {
                let settings = state_updater_ref.settings.read().await.clone();
                match updater_ref
                    .check_for_updates(&settings, Some(&updater_client_tx))
                    .await
                {
                    Ok(Some(manifest)) => {
                        info!("Update check found new version: v{}", manifest.version);
                        if mode == "auto" {
                            // If critical security update, install immediately.
                            // If non-critical, wait until playback is not active.
                            if !manifest.is_critical_security_update {
                                loop {
                                    let is_playing =
                                        state_updater_ref.current_state.read().await.is_playing;
                                    if !is_playing {
                                        tokio::time::sleep(tokio::time::Duration::from_secs(10))
                                            .await;
                                        let still_not_playing = !state_updater_ref
                                            .current_state
                                            .read()
                                            .await
                                            .is_playing;
                                        if still_not_playing {
                                            break;
                                        }
                                    }
                                    tokio::time::sleep(tokio::time::Duration::from_secs(30)).await;
                                }
                            }

                            info!(
                                "Auto-update mode active: installing update v{} now",
                                manifest.version
                            );
                            let _ = updater_ref.apply_update(updater_client_tx.clone()).await;
                        }
                    }
                    Ok(None) => {
                        info!("Update check: Syllacast is up to date");
                    }
                    Err(e) => {
                        warn!("Background update check error: {}", e);
                    }
                }
            }

            let sleep_secs = (interval_hours as u64).max(1) * 3600;
            tokio::time::sleep(tokio::time::Duration::from_secs(sleep_secs)).await;
        }
    });

    // 8. Spawn Event Coordinator (Soloist -> State -> Spicy Lyrics -> WebSockets)
    let state_ref = Arc::clone(&shared_state);
    let spicy_ref = spicy_client.clone();
    let client_tx_ref = client_tx.clone();
    let soloist_cmd_tx_ref = soloist_cmd_tx.clone();

    tokio::spawn(async move {
        while let Ok(event) = soloist_rx.recv().await {
            match event {
                SoloistServerEvent::PlaybackState {
                    status,
                    item,
                    position,
                    volume,
                    options,
                    ..
                } => {
                    let is_playing = status == "playing";
                    let track = item.as_ref().and_then(extract_metadata);
                    let track_id = track.as_ref().map(|t| t.id.clone());

                    let mut current = state_ref.current_state.write().await;
                    let track_changed = current.track.as_ref().map(|t| &t.id) != track_id.as_ref();

                    current.is_playing = is_playing;
                    current.status = status;
                    current.position = position.clone();
                    if volume.is_some() {
                        current.volume = volume;
                    }
                    if let Some(opts) = options {
                        current.shuffle = Some(opts.shuffle);
                        current.repeat = Some(opts.repeat);
                    }

                    if track_changed {
                        current.track = track;
                        current.lyrics = None;
                        current.lyrics_status = LyricsStatus::Idle;
                        sync_lyrics_for_track(
                            &mut current,
                            track_id,
                            &spicy_ref,
                            &state_ref,
                            &client_tx_ref,
                        );
                    } else if current.track.is_some() && current.lyrics_status == LyricsStatus::Idle
                    {
                        sync_lyrics_for_track(
                            &mut current,
                            track_id,
                            &spicy_ref,
                            &state_ref,
                            &client_tx_ref,
                        );
                    } else if let Some(new_meta) = track {
                        // If same track, enrich metadata if previously missing duration or cover
                        if let Some(existing) = current.track.as_mut() {
                            if existing.duration_ms == 0 && new_meta.duration_ms > 0 {
                                existing.duration_ms = new_meta.duration_ms;
                            }
                            if existing.cover_url.is_none() && new_meta.cover_url.is_some() {
                                existing.cover_url = new_meta.cover_url;
                            }
                        }
                    }

                    let snapshot = current.clone();
                    let _ = client_tx_ref.send(ServerMessage::State(Box::new(snapshot)));
                    if let Some(pos) = position {
                        let _ = client_tx_ref.send(ServerMessage::PositionSync { position: pos });
                    }
                }

                SoloistServerEvent::TrackChanged { item } => {
                    let track = item.as_ref().and_then(extract_metadata);
                    let track_id = track.as_ref().map(|t| t.id.clone());

                    let mut current = state_ref.current_state.write().await;
                    let track_changed = current.track.as_ref().map(|t| &t.id) != track_id.as_ref();

                    if track_changed {
                        current.track = track;
                        current.lyrics = None;
                        current.lyrics_status = LyricsStatus::Idle;
                        // Reset timeline anchor immediately to 0 ms at current server epoch
                        current.position = Some(PositionAnchor {
                            position_ms: 0,
                            timestamp_ms: chrono::Utc::now().timestamp_millis(),
                            speed: if current.is_playing { 1.0 } else { 0.0 },
                        });

                        // Query Soloist immediately for fresh ground-truth state & queue
                        let _ = soloist_cmd_tx_ref.try_send(SoloistCommand::get_state());
                        let _ = soloist_cmd_tx_ref.try_send(SoloistCommand::get_queue(Some(10)));

                        sync_lyrics_for_track(
                            &mut current,
                            track_id,
                            &spicy_ref,
                            &state_ref,
                            &client_tx_ref,
                        );

                        let snapshot = current.clone();
                        let _ = client_tx_ref.send(ServerMessage::State(Box::new(snapshot)));
                    }
                }

                SoloistServerEvent::PlaybackChanged { status } => {
                    let is_playing = status == "playing";
                    let mut current = state_ref.current_state.write().await;
                    current.is_playing = is_playing;
                    current.status = status;

                    if let Some(pos) = current.position.as_mut() {
                        let now = chrono::Utc::now().timestamp_millis();
                        if pos.speed > 0.0 {
                            let elapsed = ((now - pos.timestamp_ms) as f64 * pos.speed) as i64;
                            pos.position_ms += elapsed;
                        }
                        pos.timestamp_ms = now;
                        pos.speed = if is_playing { 1.0 } else { 0.0 };
                    }

                    let snapshot = current.clone();
                    let _ = client_tx_ref.send(ServerMessage::State(Box::new(snapshot)));

                    // Query Soloist to re-sync exact anchor
                    let _ = soloist_cmd_tx_ref.try_send(SoloistCommand::get_state());
                }

                SoloistServerEvent::PositionSync { position } => {
                    {
                        let mut current = state_ref.current_state.write().await;
                        current.position = Some(position.clone());
                    }
                    let _ = client_tx_ref.send(ServerMessage::PositionSync { position });
                }

                SoloistServerEvent::QueueChanged { upcoming, .. } => {
                    let items: Vec<QueueItemDto> = upcoming
                        .into_iter()
                        .filter_map(|q| q.item.as_ref().and_then(extract_queue_item))
                        .collect();

                    let mut current = state_ref.current_state.write().await;
                    current.queue_upcoming = items;
                    let snapshot = current.clone();
                    let _ = client_tx_ref.send(ServerMessage::State(Box::new(snapshot)));
                }

                SoloistServerEvent::VolumeChanged { volume } => {
                    let mut current = state_ref.current_state.write().await;
                    current.volume = Some(volume);
                    let snapshot = current.clone();
                    let _ = client_tx_ref.send(ServerMessage::State(Box::new(snapshot)));
                }

                SoloistServerEvent::OptionsChanged { options } => {
                    let mut current = state_ref.current_state.write().await;
                    current.shuffle = Some(options.shuffle);
                    current.repeat = Some(options.repeat);
                    let snapshot = current.clone();
                    let _ = client_tx_ref.send(ServerMessage::State(Box::new(snapshot)));
                }

                _ => {}
            }
        }
    });

    // 9. Periodic disk cache pruning (every 12 hours) to discard expired lyrics files on 24/7 kiosks
    let cache_pruner = spicy_client.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(12 * 3600));
        interval.tick().await;
        loop {
            interval.tick().await;
            tracing::info!("Running scheduled periodic pruning of expired lyrics cache files...");
            cache_pruner.prune_expired_cache();
        }
    });

    // 10. Start Axum HTTP/WebSocket server
    let app = server::create_router(shared_state);
    let addr: SocketAddr = format!("{}:{}", config.bind, config.port).parse()?;
    let listener = tokio::net::TcpListener::bind(addr).await?;
    info!("Server listening on http://{}", addr);

    axum::serve(listener, app).await?;
    Ok(())
}

/// Helper to check if currently loaded lyrics match the given track ID.
pub fn lyrics_match_track(lyrics: &Option<spicy::models::LyricsEnvelope>, track_id: &str) -> bool {
    lyrics.as_ref().is_some_and(|l| match &l.Body {
        spicy::models::LyricsBody::Syllable { id, .. }
        | spicy::models::LyricsBody::Line { id, .. }
        | spicy::models::LyricsBody::Static { id, .. } => id == track_id,
    })
}

/// Helper to synchronize lyrics for a track, checking cache and deduplicating in-flight requests.
pub fn sync_lyrics_for_track(
    current: &mut AppStateSnapshot,
    track_id: Option<String>,
    spicy_client: &SpicyClient,
    shared_state: &Arc<server::SharedState>,
    client_tx: &broadcast::Sender<ServerMessage>,
) {
    let id = match track_id {
        Some(id) => id,
        None => {
            current.lyrics = None;
            current.lyrics_status = LyricsStatus::Idle;
            return;
        }
    };

    // If lyrics are already loaded or currently loading for this exact track, skip redundant fetch
    if current.track.as_ref().map(|t| &t.id) == Some(&id) {
        if current.lyrics_status == LyricsStatus::Loading {
            return;
        }
        if current.lyrics_status == LyricsStatus::Found && lyrics_match_track(&current.lyrics, &id)
        {
            return;
        }
    }

    current.lyrics = None;

    // Check disk & memory cache synchronously
    match spicy_client.lookup_cached(&id) {
        CacheLookup::Hit(cached) => {
            current.lyrics = Some(*cached);
            current.lyrics_status = LyricsStatus::Found;
        }
        CacheLookup::NegativeHit => {
            current.lyrics = None;
            current.lyrics_status = LyricsStatus::NotFound;
        }
        CacheLookup::Miss => {
            current.lyrics_status = LyricsStatus::Loading;
            let spicy = spicy_client.clone();
            let state_inner = Arc::clone(shared_state);
            let client_tx_inner = client_tx.clone();

            tokio::spawn(async move {
                let res = spicy.fetch_lyrics(&id).await;
                let mut s = state_inner.current_state.write().await;
                if s.track.as_ref().map(|t| &t.id) == Some(&id) {
                    match res {
                        LyricsFetchResult::Found(l) => {
                            s.lyrics = Some(*l);
                            s.lyrics_status = LyricsStatus::Found;
                        }
                        LyricsFetchResult::NotFound => {
                            s.lyrics = None;
                            s.lyrics_status = LyricsStatus::NotFound;
                        }
                        LyricsFetchResult::Error(_) => {
                            s.lyrics = None;
                            s.lyrics_status = LyricsStatus::Error;
                        }
                    }
                    let snapshot = s.clone();
                    let _ = client_tx_inner.send(ServerMessage::State(Box::new(snapshot)));
                }
            });
        }
    }
}

fn extract_metadata(entity: &SoloistEntity) -> Option<TrackMetadata> {
    let uri = entity.uri.clone();
    let id = uri.strip_prefix("spotify:track:")?.to_string();

    let dec = entity.decorations.as_ref()?;
    let title = dec.identity.as_ref()?.name.clone()?;

    let album = dec
        .parent
        .as_ref()
        .and_then(|p| p.entity.as_ref())
        .and_then(|p| p.decorations.as_ref())
        .and_then(|d| d.identity.as_ref())
        .and_then(|i| i.name.clone())
        .unwrap_or_else(|| "Unknown Album".to_string());

    let artists: Vec<String> = dec
        .creators
        .as_ref()
        .map(|creators| {
            creators
                .iter()
                .filter_map(|c| {
                    c.entity
                        .as_ref()
                        .and_then(|e| e.decorations.as_ref())
                        .or(c.decorations.as_ref())
                        .and_then(|d| d.identity.as_ref())
                        .and_then(|i| i.name.clone())
                })
                .collect()
        })
        .unwrap_or_default();

    let artist = if artists.is_empty() {
        "Unknown Artist".to_string()
    } else {
        artists.join(", ")
    };

    let cover_url = dec
        .visual_identity
        .as_ref()
        .and_then(|v| v.cover.as_ref())
        .and_then(|covers| {
            covers
                .iter()
                .find(|c| c.size.as_deref() == Some("large") || c.size.as_deref() == Some("xlarge"))
                .or_else(|| covers.first())
        })
        .map(|c| c.url.clone());

    let duration_ms = dec
        .playback
        .as_ref()
        .and_then(|p| p.duration_ms)
        .unwrap_or(0);

    Some(TrackMetadata {
        id,
        uri,
        title,
        artist,
        album,
        cover_url,
        duration_ms,
    })
}

fn extract_queue_item(entity: &SoloistEntity) -> Option<QueueItemDto> {
    let dec = entity.decorations.as_ref()?;
    let title = dec.identity.as_ref()?.name.clone()?;

    let artists: Vec<String> = dec
        .creators
        .as_ref()
        .map(|creators| {
            creators
                .iter()
                .filter_map(|c| {
                    c.entity
                        .as_ref()
                        .and_then(|e| e.decorations.as_ref())
                        .or(c.decorations.as_ref())
                        .and_then(|d| d.identity.as_ref())
                        .and_then(|i| i.name.clone())
                })
                .collect()
        })
        .unwrap_or_default();

    let artist = artists.join(", ");

    let cover_url = dec
        .visual_identity
        .as_ref()
        .and_then(|v| v.cover.as_ref())
        .and_then(|covers| covers.first())
        .map(|c| c.url.clone());

    Some(QueueItemDto {
        title,
        artist,
        cover_url,
    })
}
