// Syllacast - Standalone Spotify Lyrics Kiosk
// Copyright (C) 2026 TechGigant
// SPDX-License-Identifier: AGPL-3.0-or-later

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::RwLock;
use tracing::{debug, error, info, warn};

use super::models::LyricsEnvelope;

const MAX_CACHE_AGE_DAYS: i64 = 29; // Stay strictly below the 30-day legal cap
const NEGATIVE_CACHE_AGE_HOURS: i64 = 24; // Re-check unindexed songs after 24h
const MAX_MEM_CACHE_ENTRIES: usize = 200; // Cap memory usage on 24/7 kiosks

#[derive(Serialize, Deserialize, Clone)]
pub enum CachePayload {
    Found(Box<LyricsEnvelope>),
    NotFound,
}

#[derive(Serialize, Deserialize)]
struct CacheEntry {
    cached_at: DateTime<Utc>,
    payload: CachePayload,
}

#[derive(Debug, Clone)]
pub enum CacheLookup {
    Hit(Box<LyricsEnvelope>),
    NegativeHit,
    Miss,
}

pub struct LyricsCache {
    disk_dir: Option<PathBuf>,
    mem_cache: RwLock<HashMap<String, (DateTime<Utc>, CachePayload)>>,
}

impl LyricsCache {
    pub fn new(disk_dir: Option<PathBuf>) -> Self {
        if let Some(ref dir) = disk_dir {
            if let Err(e) = fs::create_dir_all(dir) {
                error!("Failed to create lyrics cache directory {:?}: {}", dir, e);
            } else {
                info!("Initialized disk cache at {:?}", dir);
            }
        }

        let cache = Self {
            disk_dir,
            mem_cache: RwLock::new(HashMap::new()),
        };

        cache.prune_expired_disk_cache();
        cache
    }

    pub fn lookup(&self, track_id: &str) -> CacheLookup {
        let now = Utc::now();

        // 1. Check in-memory cache
        {
            let mem = self.mem_cache.read().unwrap_or_else(|e| e.into_inner());
            if let Some((cached_at, ref payload)) = mem.get(track_id) {
                match payload {
                    CachePayload::Found(lyrics) => {
                        if now.signed_duration_since(*cached_at)
                            < Duration::days(MAX_CACHE_AGE_DAYS)
                        {
                            return CacheLookup::Hit(lyrics.clone());
                        }
                    }
                    CachePayload::NotFound => {
                        if now.signed_duration_since(*cached_at)
                            < Duration::hours(NEGATIVE_CACHE_AGE_HOURS)
                        {
                            return CacheLookup::NegativeHit;
                        }
                    }
                }
            }
        }

        // 2. Check disk cache
        if let Some(ref dir) = self.disk_dir {
            let file_path = dir.join(format!("{}.json", track_id));
            if file_path.exists() {
                if let Ok(data) = fs::read_to_string(&file_path) {
                    if let Ok(entry) = serde_json::from_str::<CacheEntry>(&data) {
                        match entry.payload {
                            CachePayload::Found(lyrics) => {
                                if now.signed_duration_since(entry.cached_at)
                                    < Duration::days(MAX_CACHE_AGE_DAYS)
                                {
                                    self.store_mem(
                                        track_id,
                                        entry.cached_at,
                                        CachePayload::Found(lyrics.clone()),
                                    );
                                    return CacheLookup::Hit(lyrics);
                                } else {
                                    let _ = fs::remove_file(&file_path);
                                }
                            }
                            CachePayload::NotFound => {
                                if now.signed_duration_since(entry.cached_at)
                                    < Duration::hours(NEGATIVE_CACHE_AGE_HOURS)
                                {
                                    self.store_mem(
                                        track_id,
                                        entry.cached_at,
                                        CachePayload::NotFound,
                                    );
                                    return CacheLookup::NegativeHit;
                                } else {
                                    let _ = fs::remove_file(&file_path);
                                }
                            }
                        }
                    }
                }
            }
        }

        CacheLookup::Miss
    }

    #[allow(dead_code)]
    pub fn get(&self, track_id: &str) -> Option<LyricsEnvelope> {
        match self.lookup(track_id) {
            CacheLookup::Hit(lyrics) => Some(*lyrics),
            _ => None,
        }
    }

    pub fn store(&self, track_id: &str, lyrics: &LyricsEnvelope) {
        let now = Utc::now();
        self.store_mem(track_id, now, CachePayload::Found(Box::new(lyrics.clone())));

        if let Some(ref dir) = self.disk_dir {
            let file_path = dir.join(format!("{}.json", track_id));
            let entry = CacheEntry {
                cached_at: now,
                payload: CachePayload::Found(Box::new(lyrics.clone())),
            };
            if let Ok(json) = serde_json::to_string(&entry) {
                if let Err(e) = fs::write(&file_path, json) {
                    warn!("Failed to write cache file {:?}: {}", file_path, e);
                }
            }
        }
    }

    pub fn store_not_found(&self, track_id: &str) {
        let now = Utc::now();
        self.store_mem(track_id, now, CachePayload::NotFound);

        if let Some(ref dir) = self.disk_dir {
            let file_path = dir.join(format!("{}.json", track_id));
            let entry = CacheEntry {
                cached_at: now,
                payload: CachePayload::NotFound,
            };
            if let Ok(json) = serde_json::to_string(&entry) {
                if let Err(e) = fs::write(&file_path, json) {
                    warn!("Failed to write cache file {:?}: {}", file_path, e);
                }
            }
        }
    }

    fn store_mem(&self, track_id: &str, time: DateTime<Utc>, payload: CachePayload) {
        let mut mem = self.mem_cache.write().unwrap_or_else(|e| e.into_inner());
        if mem.len() >= MAX_MEM_CACHE_ENTRIES && !mem.contains_key(track_id) {
            // Evict oldest 20 entries
            let mut entries: Vec<(String, DateTime<Utc>)> =
                mem.iter().map(|(k, (t, _))| (k.clone(), *t)).collect();
            entries.sort_by_key(|(_, t)| *t);
            for (k, _) in entries.into_iter().take(20) {
                mem.remove(&k);
            }
        }
        mem.insert(track_id.to_string(), (time, payload));
    }

    fn prune_expired_disk_cache(&self) {
        if let Some(ref dir) = self.disk_dir {
            if let Ok(entries) = fs::read_dir(dir) {
                let now = Utc::now();
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.extension().and_then(|e| e.to_str()) == Some("json") {
                        if let Ok(data) = fs::read_to_string(&path) {
                            if let Ok(parsed) = serde_json::from_str::<CacheEntry>(&data) {
                                let max_age = match parsed.payload {
                                    CachePayload::Found(_) => Duration::days(MAX_CACHE_AGE_DAYS),
                                    CachePayload::NotFound => {
                                        Duration::hours(NEGATIVE_CACHE_AGE_HOURS)
                                    }
                                };
                                if now.signed_duration_since(parsed.cached_at) >= max_age {
                                    let _ = fs::remove_file(&path);
                                    debug!("Pruned expired lyrics file: {:?}", path);
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
