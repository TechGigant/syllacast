// Syllacast - Standalone Spotify Lyrics Kiosk
// Copyright (C) 2026 TechGigant
// SPDX-License-Identifier: AGPL-3.0-or-later

pub mod actions;
pub mod discovery;
pub mod ui;

pub async fn run_installer() -> Result<(), Box<dyn std::error::Error>> {
    ui::run_tui().await
}
