// Syllacast - Standalone Spotify Lyrics Kiosk
// Copyright (C) 2026 TechGigant
// SPDX-License-Identifier: AGPL-3.0-or-later

use axum::{
    extract::State,
    response::{IntoResponse, Redirect},
    routing::get,
    Json, Router,
};
use std::sync::Arc;
use tower_http::cors::CorsLayer;
use tower_http::services::ServeDir;
use tracing::{error, info};

use super::{ws::ws_handler, SharedState};
use crate::settings::KioskSettings;
use crate::sync::protocol::ServerMessage;

pub fn create_routes(state: Arc<SharedState>) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(tower_http::cors::AllowOrigin::predicate(
            |origin: &axum::http::HeaderValue, parts: &axum::http::request::Parts| {
                if let Ok(origin_str) = origin.to_str() {
                    let host_str = parts
                        .headers
                        .get(axum::http::header::HOST)
                        .and_then(|h| h.to_str().ok());
                    super::origin::is_allowed_origin(origin_str, host_str)
                } else {
                    false
                }
            },
        ))
        .allow_methods(tower_http::cors::Any)
        .allow_headers(tower_http::cors::Any);

    let frontend_dir = state.config.resolve_frontend_dist();

    let router = Router::new()
        .route("/ws", get(ws_handler))
        .route(
            "/settings",
            get(|| async { Redirect::temporary("/settings.html") }),
        )
        .route("/api/settings", get(get_settings).post(update_settings))
        .route("/api/updates/status", get(get_update_status))
        .route("/api/updates/check", axum::routing::post(check_updates))
        .route("/api/updates/apply", axum::routing::post(apply_update))
        .route("/api/updates/snooze", axum::routing::post(snooze_update))
        .route("/state", get(get_state))
        .route("/api/state", get(get_state))
        .route("/api/health", get(|| async { "ok" }));

    let router = if let Some(ref dir) = frontend_dir {
        info!("Serving frontend assets from disk override: {:?}", dir);
        router.fallback_service(ServeDir::new(dir))
    } else {
        info!("Serving embedded frontend web assets from binary");
        router.fallback(super::assets::embedded_asset_handler)
    };

    router.layer(cors).with_state(state)
}

async fn get_state(State(state): State<Arc<SharedState>>) -> impl IntoResponse {
    let current = state.current_state.read().await.clone();
    Json(current)
}

async fn get_settings(State(state): State<Arc<SharedState>>) -> impl IntoResponse {
    let settings = state.settings.read().await.clone();
    Json(settings)
}

async fn update_settings(
    State(state): State<Arc<SharedState>>,
    Json(payload): Json<KioskSettings>,
) -> impl IntoResponse {
    let mut current = state.settings.write().await;
    *current = payload.clone();

    if let Err(e) = state.settings_manager.save(&payload) {
        error!("Failed to save settings: {}", e);
    }

    // Broadcast the new settings to all connected WebSocket clients
    let _ = state.tx.send(ServerMessage::Settings(payload.clone()));

    Json(payload)
}

async fn get_update_status(State(state): State<Arc<SharedState>>) -> impl IntoResponse {
    let status = state.updater.get_status().await;
    Json(status)
}

async fn check_updates(State(state): State<Arc<SharedState>>) -> impl IntoResponse {
    let settings = state.settings.read().await.clone();
    let _ = state
        .updater
        .check_for_updates(&settings, Some(&state.tx))
        .await;
    let status = state.updater.get_status().await;
    Json(status)
}

async fn apply_update(State(state): State<Arc<SharedState>>) -> impl IntoResponse {
    let updater = Arc::clone(&state.updater);
    let tx = state.tx.clone();
    tokio::spawn(async move {
        let _ = updater.apply_update(tx).await;
    });
    Json(serde_json::json!({ "status": "started" }))
}

async fn snooze_update(State(state): State<Arc<SharedState>>) -> impl IntoResponse {
    let until = state.updater.snooze_24h().await;
    let mut current_settings = state.settings.write().await;
    current_settings.snoozed_update_until = Some(until);
    let _ = state.settings_manager.save(&current_settings);
    Json(serde_json::json!({ "snoozed_until": until }))
}
