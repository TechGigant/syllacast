// Syllacast - Standalone Spotify Lyrics Kiosk
// Copyright (C) 2026 TechGigant
// SPDX-License-Identifier: AGPL-3.0-or-later

pub mod cache;
pub mod models;

use reqwest::{Client, StatusCode};
use std::sync::Arc;
use tracing::{error, info, warn};

use cache::LyricsCache;
use models::LyricsEnvelope;

#[derive(Clone)]
pub struct SpicyClient {
    http: Client,
    api_url: String,
    secret_key: Option<String>,
    cache: Arc<LyricsCache>,
}

impl std::fmt::Debug for SpicyClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SpicyClient")
            .field("api_url", &self.api_url)
            .field(
                "secret_key",
                &self.secret_key.as_ref().map(|_| "[REDACTED]"),
            )
            .finish()
    }
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub enum LyricsFetchResult {
    Found(Box<LyricsEnvelope>),
    NotFound,
    Error(String),
}

impl SpicyClient {
    pub fn new(api_url: String, secret_key: Option<String>, cache: Arc<LyricsCache>) -> Self {
        let http = Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .expect("Failed to build HTTP client");

        Self {
            http,
            api_url: api_url.trim_end_matches('/').to_string(),
            secret_key,
            cache,
        }
    }

    pub fn lookup_cached(&self, track_id: &str) -> cache::CacheLookup {
        self.cache.lookup(track_id)
    }

    #[allow(dead_code)]
    pub fn get_cached(&self, track_id: &str) -> Option<LyricsEnvelope> {
        self.cache.get(track_id)
    }

    pub fn prune_expired_cache(&self) {
        self.cache.prune_expired_disk_cache();
    }

    pub async fn fetch_lyrics(&self, track_id: &str) -> LyricsFetchResult {
        // 1. Check Cache first
        match self.cache.lookup(track_id) {
            cache::CacheLookup::Hit(cached) => {
                info!("Serving lyrics for {} from cache", track_id);
                return LyricsFetchResult::Found(cached);
            }
            cache::CacheLookup::NegativeHit => {
                info!(
                    "Serving negative cache (no lyrics upstream) for {}",
                    track_id
                );
                return LyricsFetchResult::NotFound;
            }
            cache::CacheLookup::Miss => {}
        }

        let key = match &self.secret_key {
            Some(k) if !k.trim().is_empty() => k.trim(),
            _ => {
                warn!("No SPICY_LYRICS_SECRET_KEY configured; cannot fetch remote lyrics");
                return LyricsFetchResult::Error("No API key configured".to_string());
            }
        };

        let url = format!("{}/{}", self.api_url, track_id);
        info!("Fetching lyrics from Spicy Lyrics API for {}...", track_id);

        let resp = match self
            .http
            .get(&url)
            .header("Authorization", format!("Bearer {}", key))
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => {
                error!("HTTP request error fetching lyrics for {}: {}", track_id, e);
                return LyricsFetchResult::Error(e.to_string());
            }
        };

        if resp.status() == StatusCode::OK {
            match resp.json::<LyricsEnvelope>().await {
                Ok(envelope) => {
                    info!("Successfully retrieved lyrics for {}", track_id);
                    self.cache.store(track_id, &envelope);
                    LyricsFetchResult::Found(Box::new(envelope))
                }
                Err(e) => {
                    error!(
                        "JSON deserialization error for lyrics of {}: {}",
                        track_id, e
                    );
                    LyricsFetchResult::Error(e.to_string())
                }
            }
        } else if resp.status() == StatusCode::NOT_FOUND {
            info!(
                "Spicy Lyrics returned 404 (lyrics not found) for {}",
                track_id
            );
            self.cache.store_not_found(track_id);
            LyricsFetchResult::NotFound
        } else {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            warn!("Spicy Lyrics API error {}: {}", status, body);
            LyricsFetchResult::Error(format!("API returned {}: {}", status, body))
        }
    }

    #[allow(dead_code)]
    pub async fn get_lyrics(&self, track_id: &str) -> Option<LyricsEnvelope> {
        match self.fetch_lyrics(track_id).await {
            LyricsFetchResult::Found(envelope) => Some(*envelope),
            _ => None,
        }
    }
}
