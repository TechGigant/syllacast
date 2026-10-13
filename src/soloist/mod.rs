// Syllacast - Standalone Spotify Lyrics Kiosk
// Copyright (C) 2026 TechGigant
// SPDX-License-Identifier: AGPL-3.0-or-later

pub mod discovery;
pub mod models;

use futures_util::{SinkExt, StreamExt};
use tokio::sync::broadcast;
use tokio::time::{sleep, Duration};
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message;
use tracing::{error, info, warn};

use models::{SoloistCommand, SoloistServerEvent};
use std::path::PathBuf;

pub async fn run_soloist_client(
    static_ws_url: Option<String>,
    soloist_data_dir: Option<PathBuf>,
    event_tx: broadcast::Sender<SoloistServerEvent>,
    mut cmd_rx: tokio::sync::mpsc::Receiver<SoloistCommand>,
) {
    let mut backoff_secs = 1u64;

    loop {
        let ws_url = if let Some(ref url) = static_ws_url {
            url.clone()
        } else if let Some(discovered) = discovery::discover_soloist_ws(soloist_data_dir.as_deref())
        {
            discovered
        } else {
            "ws://127.0.0.1:9090".to_string()
        };

        info!("Connecting to Soloist WebSocket at {}...", ws_url);
        match connect_async(&ws_url).await {
            Ok((ws_stream, _)) => {
                info!("Connected to Soloist WebSocket!");
                backoff_secs = 1;
                let (mut write, mut read) = ws_stream.split();

                // Request initial state and queue
                let get_state =
                    serde_json::to_string(&SoloistCommand::get_state()).unwrap_or_default();
                let get_queue =
                    serde_json::to_string(&SoloistCommand::get_queue(Some(10))).unwrap_or_default();

                let _ = write.send(Message::Text(get_state.into())).await;
                let _ = write.send(Message::Text(get_queue.into())).await;

                // Periodic position & state sync every 4 seconds
                let mut poll_interval = tokio::time::interval(Duration::from_secs(4));
                poll_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

                loop {
                    tokio::select! {
                        Some(cmd) = cmd_rx.recv() => {
                            if let Ok(text) = serde_json::to_string(&cmd) {
                                if let Err(e) = write.send(Message::Text(text.into())).await {
                                    error!("Error sending command to Soloist: {}", e);
                                    break;
                                }
                            }
                        }
                        _ = poll_interval.tick() => {
                            let cmd = SoloistCommand::get_state();
                            if let Ok(text) = serde_json::to_string(&cmd) {
                                if let Err(e) = write.send(Message::Text(text.into())).await {
                                    error!("Error sending periodic get_state to Soloist: {}", e);
                                    break;
                                }
                            }
                        }
                        msg = read.next() => {
                            match msg {
                                Some(Ok(Message::Text(text))) => {
                                    match serde_json::from_str::<SoloistServerEvent>(&text) {
                                        Ok(event) => {
                                            let _ = event_tx.send(event);
                                        }
                                        Err(e) => {
                                            warn!("Unrecognized or non-standard Soloist event: {} (Raw: {})", e, text);
                                        }
                                    }
                                }
                                Some(Ok(Message::Close(_))) => {
                                    warn!("Soloist closed WebSocket connection");
                                    break;
                                }
                                Some(Err(e)) => {
                                    error!("Error reading Soloist WebSocket frame: {}", e);
                                    break;
                                }
                                None => {
                                    warn!("Soloist WebSocket stream ended");
                                    break;
                                }
                                _ => {}
                            }
                        }
                    }
                }
            }
            Err(e) => {
                warn!(
                    "Failed to connect to Soloist at {}: {}. Retrying in {}s...",
                    ws_url, e, backoff_secs
                );
            }
        }

        sleep(Duration::from_secs(backoff_secs)).await;
        backoff_secs = (backoff_secs * 2).min(30);
    }
}
