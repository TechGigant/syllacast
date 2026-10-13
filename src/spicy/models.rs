// Syllacast - Standalone Spotify Lyrics Kiosk
// Copyright (C) 2026 TechGigant
// SPDX-License-Identifier: AGPL-3.0-or-later

#![allow(non_snake_case, non_camel_case_types)]
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Contributor {
    pub id: String,
    pub username: String,
    pub url: String,
    pub avatar: Option<String>,
    #[serde(default)]
    pub hasProfileBanner: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UploadAttribution {
    pub Uploader: Contributor,
    pub Maker: Option<Contributor>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Syllable {
    pub Text: String,
    pub StartTime: f64,
    pub EndTime: f64,
    #[serde(default)]
    pub IsPartOfWord: bool,
    pub TransliteratedText: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VocalGroup {
    pub Syllables: Vec<Syllable>,
    pub StartTime: Option<f64>,
    pub EndTime: Option<f64>,
    pub TransliteratedText: Option<String>,
    pub TranslatedText: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyllableLine {
    pub Type: String,
    #[serde(default)]
    pub OppositeAligned: bool,
    pub Lead: VocalGroup,
    pub Background: Option<Vec<VocalGroup>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LineLine {
    pub Type: String,
    #[serde(default)]
    pub OppositeAligned: bool,
    pub Text: String,
    pub StartTime: f64,
    pub EndTime: f64,
    pub TransliteratedText: Option<String>,
    pub TranslatedText: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StaticLine {
    pub Text: String,
    pub TransliteratedText: Option<String>,
    pub TranslatedText: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "Type")]
pub enum LyricsBody {
    Syllable {
        id: String,
        source: String,
        SongWriters: Option<Vec<String>>,
        UploadAttribution: Option<UploadAttribution>,
        StartTime: Option<f64>,
        EndTime: Option<f64>,
        Content: Vec<SyllableLine>,
        HasTransliterations: Option<bool>,
        HasTranslations: Option<bool>,
    },
    Line {
        id: String,
        source: String,
        SongWriters: Option<Vec<String>>,
        UploadAttribution: Option<UploadAttribution>,
        StartTime: Option<f64>,
        EndTime: Option<f64>,
        Content: Vec<LineLine>,
        HasTransliterations: Option<bool>,
        HasTranslations: Option<bool>,
    },
    Static {
        id: String,
        source: String,
        SongWriters: Option<Vec<String>>,
        UploadAttribution: Option<UploadAttribution>,
        Lines: Vec<StaticLine>,
        HasTransliterations: Option<bool>,
        HasTranslations: Option<bool>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LyricsEnvelope {
    pub Body: LyricsBody,
    pub Status: u16,
    pub Type: String,
}
