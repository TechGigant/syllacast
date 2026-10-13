// Syllacast - Standalone Spotify Lyrics Kiosk
// Copyright (C) 2026 TechGigant
// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::{Path, PathBuf};
use tracing::{info, warn};

pub fn discover_soloist_ws(custom_data_dir: Option<&Path>) -> Option<String> {
    let candidates = if let Some(dir) = custom_data_dir {
        vec![dir.to_path_buf()]
    } else {
        let mut dirs_list = Vec::new();
        if let Ok(state_dir) = std::env::var("STATE_DIRECTORY") {
            dirs_list.push(PathBuf::from(state_dir));
        }
        if let Ok(xdg_data) = std::env::var("XDG_DATA_HOME") {
            dirs_list.push(PathBuf::from(xdg_data).join("soloist"));
        }
        if let Some(home) = dirs::home_dir() {
            dirs_list.push(home.join(".local/share/soloist"));
            dirs_list.push(home.join(".config/soloist"));
        }
        dirs_list.push(PathBuf::from("/var/lib/soloist"));
        dirs_list.push(PathBuf::from("/var/lib/soloist-appliance/soloist-data"));
        dirs_list.push(PathBuf::from("/run/soloist"));
        dirs_list
    };

    for dir in candidates {
        let addr_file = dir.join("ws.addr");
        let port_file = dir.join("ws.port");
        if addr_file.exists() && port_file.exists() {
            if let (Ok(addr), Ok(port)) = (
                std::fs::read_to_string(&addr_file),
                std::fs::read_to_string(&port_file),
            ) {
                let addr = addr.trim();
                let port = port.trim();
                if !addr.is_empty() && !port.is_empty() {
                    let url = format!("ws://{}:{}", addr, port);
                    info!("Discovered Soloist WebSocket at {}", url);
                    return Some(url);
                }
            }
        }
    }

    warn!("Could not discover Soloist ws.addr / ws.port in standard directories");
    None
}
