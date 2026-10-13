// Syllacast - Standalone Spotify Lyrics Kiosk
// Copyright (C) 2026 TechGigant
// SPDX-License-Identifier: AGPL-3.0-or-later

pub mod client;
pub mod installer;
pub mod models;
pub mod service;

#[allow(unused_imports)]
pub use models::{ReleaseManifest, UpdateNotificationDto, UpdatePhase, UpdateStatusResponse};
pub use service::UpdateService;
