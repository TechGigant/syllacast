// Syllacast - Standalone Spotify Lyrics Kiosk
// Copyright (C) 2026 TechGigant
// SPDX-License-Identifier: AGPL-3.0-or-later

use ratatui::style::{Color, Modifier, Style};

pub const SPOTIFY_GREEN: Color = Color::Rgb(29, 185, 84);
pub const SLATE_BG: Color = Color::Rgb(18, 18, 18);
pub const PANEL_BG: Color = Color::Rgb(28, 28, 28);
pub const TEXT_WHITE: Color = Color::Rgb(255, 255, 255);
pub const TEXT_MUTED: Color = Color::Rgb(160, 160, 160);
pub const ACCENT_BLUE: Color = Color::Rgb(80, 160, 255);
pub const STATUS_RED: Color = Color::Rgb(230, 60, 60);
pub const STATUS_YELLOW: Color = Color::Rgb(240, 180, 40);

pub fn style_header() -> Style {
    Style::default()
        .fg(SPOTIFY_GREEN)
        .add_modifier(Modifier::BOLD)
}

pub fn style_card() -> Style {
    Style::default().fg(TEXT_WHITE).bg(PANEL_BG)
}

pub fn style_selected() -> Style {
    Style::default()
        .fg(Color::Black)
        .bg(SPOTIFY_GREEN)
        .add_modifier(Modifier::BOLD)
}

pub fn style_muted() -> Style {
    Style::default().fg(TEXT_MUTED)
}

pub const ASCII_BANNER: &[&str] = &[
    "███████╗██╗   ██╗██╗     ██╗      █████╗  ██████╗ █████╗ ███████╗████████╗",
    "██╔════╝╚██╗ ██╔╝██║     ██║     ██╔══██╗██╔════╝██╔══██╗██╔════╝╚══██╔══╝",
    "███████╗ ╚████╔╝ ██║     ██║     ███████║██║     ███████║███████╗   ██║   ",
    "╚════██║  ╚██╔╝  ██║     ██║     ██╔══██║██║     ██╔══██║╚════██║   ██║   ",
    "███████║   ██║   ███████╗███████╗██║  ██║╚██████╗██║  ██║███████║   ██║   ",
    "╚══════╝   ╚═╝   ╚══════╝╚══════╝╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝╚══════╝   ╚═╝   ",
];

pub const ASCII_BANNER_SMALL: &[&str] = &[
    "   _______  ____    __    ___   _________   ___________",
    r#"  / ___/\ \/ / /   / /   /   | / ____/   | / ___/_  __/"#,
    r#"  \__ \  \  / /   / /   / /| |/ /   / /| | \__ \ / /   "#,
    " ___/ /  / / /___/ /___/ ___ / /___/ ___ |___/ // /    ",
    r#"/____/  /_/_____/_____/_/  |_\____/_/  |_/____//_/     "#,
];
