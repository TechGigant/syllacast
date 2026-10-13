// Syllacast - Standalone Spotify Lyrics Kiosk
// Copyright (C) 2026 TechGigant
// SPDX-License-Identifier: AGPL-3.0-or-later

use axum::{
    extract::{
        ws::{Message, WebSocket},
        State, WebSocketUpgrade,
    },
    response::IntoResponse,
};
use chrono::Utc;
use futures_util::{SinkExt, StreamExt};
use std::sync::Arc;
use tracing::debug;

use crate::server::SharedState;
use crate::sync::protocol::{ClientMessage, ServerMessage};

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<SharedState>>,
) -> impl IntoResponse {
    ws.on_upgrade(|socket| handle_socket(socket, state))
}

use crate::soloist::models::SoloistCommand;

async fn handle_socket(socket: WebSocket, state: Arc<SharedState>) {
    let (mut sender, mut receiver) = socket.split();
    let mut rx = state.tx.subscribe();
    let (direct_tx, mut direct_rx) = tokio::sync::mpsc::channel::<ServerMessage>(32);

    // Send the current settings immediately on connection
    {
        let settings = state.settings.read().await;
        let settings_msg = ServerMessage::Settings(settings.clone());
        if let Ok(text) = serde_json::to_string(&settings_msg) {
            let _ = sender.send(Message::Text(text.into())).await;
        }
    }

    // Send the current snapshot immediately on connection
    {
        let current = state.current_state.read().await;
        let snapshot_msg = ServerMessage::State(Box::new(current.clone()));
        if let Ok(text) = serde_json::to_string(&snapshot_msg) {
            let _ = sender.send(Message::Text(text.into())).await;
        }
    }

    // Task to send messages (both direct replies and broadcasts) down to this client
    let mut send_task = tokio::spawn(async move {
        loop {
            tokio::select! {
                Some(direct_msg) = direct_rx.recv() => {
                    if let Ok(text) = serde_json::to_string(&direct_msg) {
                        if sender.send(Message::Text(text.into())).await.is_err() {
                            break;
                        }
                    }
                }
                broadcast_res = rx.recv() => {
                    match broadcast_res {
                        Ok(broadcast_msg) => {
                            if let Ok(text) = serde_json::to_string(&broadcast_msg) {
                                if sender.send(Message::Text(text.into())).await.is_err() {
                                    break;
                                }
                            }
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                    }
                }
                else => break,
            }
        }
    });

    // Task to process incoming client messages (isolated Clock Sync, GetState, and Playback Controls)
    let state_clone = Arc::clone(&state);
    let mut recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = receiver.next().await {
            let t2 = Utc::now().timestamp_millis();
            match msg {
                Message::Text(text) => {
                    if let Ok(client_msg) = serde_json::from_str::<ClientMessage>(&text) {
                        match client_msg {
                            ClientMessage::Ping { t1 } => {
                                let t3 = Utc::now().timestamp_millis();
                                let pong = ServerMessage::Pong { t1, t2, t3 };
                                // Reply directly to this client only
                                let _ = direct_tx.send(pong).await;
                            }
                            ClientMessage::GetState => {
                                let current = state_clone.current_state.read().await;
                                let snapshot_msg = ServerMessage::State(Box::new(current.clone()));
                                // Reply directly to this client only
                                let _ = direct_tx.send(snapshot_msg).await;
                            }
                            ClientMessage::Play { uri } => {
                                let _ = state_clone
                                    .soloist_cmd_tx
                                    .try_send(SoloistCommand::play(uri));
                            }
                            ClientMessage::Pause => {
                                let _ =
                                    state_clone.soloist_cmd_tx.try_send(SoloistCommand::pause());
                            }
                            ClientMessage::TogglePlay => {
                                let is_playing = state_clone.current_state.read().await.is_playing;
                                let cmd = if is_playing {
                                    SoloistCommand::pause()
                                } else {
                                    SoloistCommand::play(None)
                                };
                                let _ = state_clone.soloist_cmd_tx.try_send(cmd);
                            }
                            ClientMessage::SkipNext => {
                                let _ = state_clone
                                    .soloist_cmd_tx
                                    .try_send(SoloistCommand::skip_next());
                            }
                            ClientMessage::SkipPrev => {
                                let _ = state_clone
                                    .soloist_cmd_tx
                                    .try_send(SoloistCommand::skip_prev());
                            }
                            ClientMessage::Seek { position_ms } => {
                                let _ = state_clone
                                    .soloist_cmd_tx
                                    .try_send(SoloistCommand::seek(position_ms));
                            }
                            ClientMessage::SetVolume { volume } => {
                                let _ = state_clone
                                    .soloist_cmd_tx
                                    .try_send(SoloistCommand::set_volume(volume));
                            }
                            ClientMessage::SetShuffle { enabled } => {
                                let _ = state_clone
                                    .soloist_cmd_tx
                                    .try_send(SoloistCommand::set_shuffle(enabled));
                            }
                            ClientMessage::SetRepeat { mode } => match mode.as_str() {
                                "track" => {
                                    let _ = state_clone
                                        .soloist_cmd_tx
                                        .try_send(SoloistCommand::set_repeat_context(false));
                                    let _ = state_clone
                                        .soloist_cmd_tx
                                        .try_send(SoloistCommand::set_repeat_track(true));
                                }
                                "context" => {
                                    let _ = state_clone
                                        .soloist_cmd_tx
                                        .try_send(SoloistCommand::set_repeat_track(false));
                                    let _ = state_clone
                                        .soloist_cmd_tx
                                        .try_send(SoloistCommand::set_repeat_context(true));
                                }
                                _ => {
                                    let _ = state_clone
                                        .soloist_cmd_tx
                                        .try_send(SoloistCommand::set_repeat_track(false));
                                    let _ = state_clone
                                        .soloist_cmd_tx
                                        .try_send(SoloistCommand::set_repeat_context(false));
                                }
                            },
                        }
                    }
                }
                Message::Close(_) => break,
                _ => {}
            }
        }
    });

    // Wait until either task finishes (client disconnected)
    tokio::select! {
        _ = (&mut send_task) => recv_task.abort(),
        _ = (&mut recv_task) => send_task.abort(),
    };

    debug!("Client WebSocket disconnected");
}
