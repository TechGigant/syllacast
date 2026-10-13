// Syllacast - Standalone Spotify Lyrics Kiosk
// Copyright (C) 2026 TechGigant
// SPDX-License-Identifier: AGPL-3.0-or-later

use clap::Parser;
use std::path::PathBuf;

#[derive(Parser, Clone)]
#[command(
    name = "syllacast",
    about = "Network-synchronized Spotify lyrics display server"
)]
pub struct Config {
    /// Port to serve HTTP and WebSocket clients on
    #[arg(short, long, default_value = "8080", env = "SYLLACAST_PORT")]
    pub port: u16,

    /// Bind address
    #[arg(short, long, default_value = "0.0.0.0", env = "SYLLACAST_BIND")]
    pub bind: String,

    /// Spotify Soloist WebSocket URL (e.g. ws://127.0.0.1:9090).
    /// If not provided, syllacast tries to discover it from Soloist runtime files.
    #[arg(long, env = "SOLOIST_WS_URL")]
    pub soloist_ws: Option<String>,

    /// Path to Spotify Soloist data directory (defaults to ~/.local/share/soloist)
    #[arg(long, env = "SOLOIST_DATA_DIR")]
    pub soloist_data_dir: Option<PathBuf>,

    /// Spicy Lyrics API secret key (sl_sk_...)
    #[arg(long, env = "SPICY_LYRICS_SECRET_KEY")]
    pub spicy_key: Option<String>,

    /// Directory for caching lyrics on disk (30-day TTL)
    #[arg(long, env = "LYRICS_CACHE_DIR")]
    pub cache_dir: Option<PathBuf>,

    /// Directory for storing Syllacast configuration (defaults to standard OS config directory)
    #[arg(long, env = "SYLLACAST_CONFIG_DIR")]
    pub config_dir: Option<PathBuf>,

    /// Spicy Lyrics API base endpoint URL
    #[arg(
        long,
        default_value = "https://api.spicylyrics.org/v1/lyrics",
        env = "SPICY_LYRICS_API_URL"
    )]
    pub spicy_api_url: String,

    /// Optional path to the frontend dist directory (overrides embedded binary web assets)
    #[arg(long, env = "FRONTEND_DIST")]
    pub frontend_dist: Option<PathBuf>,
}

impl Config {
    /// Resolves disk override for frontend dist directory if explicitly configured and exists on disk.
    /// Returns None to indicate that embedded binary web assets should be served.
    pub fn resolve_frontend_dist(&self) -> Option<PathBuf> {
        if let Some(ref dir) = self.frontend_dist {
            if dir.exists() {
                return Some(dir.clone());
            }
        }
        None
    }
}

impl std::fmt::Debug for Config {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Config")
            .field("port", &self.port)
            .field("bind", &self.bind)
            .field("soloist_ws", &self.soloist_ws)
            .field("soloist_data_dir", &self.soloist_data_dir)
            .field("spicy_key", &self.spicy_key.as_ref().map(|_| "[REDACTED]"))
            .field("cache_dir", &self.cache_dir)
            .field("config_dir", &self.config_dir)
            .field("spicy_api_url", &self.spicy_api_url)
            .field("frontend_dist", &self.frontend_dist)
            .finish()
    }
}
