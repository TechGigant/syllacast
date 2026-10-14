// Syllacast - Standalone Spotify Lyrics Kiosk
// Copyright (C) 2026 TechGigant
// SPDX-License-Identifier: AGPL-3.0-or-later

pub mod assets;
pub mod origin;
pub mod routes;
pub mod ws;

use axum::Router;
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};

use crate::config::Config;
use crate::sync::protocol::{AppStateSnapshot, ServerMessage};

pub struct SharedState {
    pub config: Config,
    pub current_state: RwLock<AppStateSnapshot>,
    pub tx: broadcast::Sender<ServerMessage>,
    pub settings: RwLock<crate::settings::KioskSettings>,
    pub settings_manager: crate::settings::SettingsManager,
    pub soloist_cmd_tx: tokio::sync::mpsc::Sender<crate::soloist::models::SoloistCommand>,
    pub updater: Arc<crate::updater::UpdateService>,
}

pub fn create_router(shared_state: Arc<SharedState>) -> Router {
    routes::create_routes(shared_state)
}
