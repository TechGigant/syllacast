// Syllacast - Standalone Spotify Lyrics Kiosk
// Copyright (C) 2026 TechGigant
// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Clone, PartialEq)]
#[allow(dead_code)]
pub enum DiscoverySource {
    RunningProcess,
    StandardPath,
    Manual,
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct DiscoveredSoloist {
    pub pid: Option<u32>,
    pub exe_path: Option<String>,
    pub cmdline: Option<String>,
    pub data_dir: Option<PathBuf>,
    pub ws_arg: Option<String>,
    pub has_ws_enabled: bool,
    pub source: DiscoverySource,
}

#[derive(Debug, Clone, Default)]
pub struct ExistingSyllacast {
    pub is_installed: bool,
    pub is_service_active: bool,
    pub bin_path: Option<PathBuf>,
    pub service_path: Option<PathBuf>,
    pub env_file: Option<PathBuf>,
    pub existing_key: Option<String>,
    pub existing_data_dir: Option<PathBuf>,
    pub existing_port: Option<u16>,
    pub existing_user: Option<String>,
}

/// Checks whether the current process is running with root privileges (UID 0).
pub fn is_root() -> bool {
    #[cfg(unix)]
    {
        // Try reading /proc/self/status or calling id -u
        if let Ok(output) = Command::new("id").arg("-u").output() {
            if let Ok(uid_str) = std::str::from_utf8(&output.stdout) {
                return uid_str.trim() == "0";
            }
        }
    }
    true
}

/// Detects the user who invoked sudo (if any), otherwise falls back to USER env var or "syllacast".
pub fn detect_calling_user() -> (String, String) {
    if let Ok(sudo_user) = std::env::var("SUDO_USER") {
        let clean = sudo_user.trim();
        if !clean.is_empty() && clean != "root" {
            return (clean.to_string(), clean.to_string());
        }
    }

    if let Ok(user) = std::env::var("USER") {
        let clean = user.trim();
        if !clean.is_empty() && clean != "root" {
            return (clean.to_string(), clean.to_string());
        }
    }

    ("syllacast".to_string(), "syllacast".to_string())
}

/// Scans `/proc` for running Spotify Soloist processes on Linux.
pub fn scan_running_processes() -> Vec<DiscoveredSoloist> {
    let mut results = Vec::new();
    let proc_dir = Path::new("/proc");
    if !proc_dir.exists() {
        return results;
    }

    if let Ok(entries) = std::fs::read_dir(proc_dir) {
        for entry in entries.flatten() {
            let file_name = entry.file_name();
            let pid_str = file_name.to_string_lossy();
            if let Ok(pid) = pid_str.parse::<u32>() {
                let pid_path = entry.path();
                let comm_path = pid_path.join("comm");
                let cmdline_path = pid_path.join("cmdline");

                let comm = std::fs::read_to_string(&comm_path)
                    .unwrap_or_default()
                    .trim()
                    .to_string();

                let cmdline_bytes = std::fs::read(&cmdline_path).unwrap_or_default();
                let args: Vec<String> = cmdline_bytes
                    .split(|&b| b == 0)
                    .filter(|s| !s.is_empty())
                    .map(|s| String::from_utf8_lossy(s).to_string())
                    .collect();

                let is_soloist = comm == "soloist"
                    || comm.contains("soloist")
                    || args
                        .first()
                        .map(|a| a.ends_with("/soloist") || a == "soloist")
                        .unwrap_or(false);

                if is_soloist {
                    let mut data_dir = None;
                    let mut ws_arg = None;
                    let mut has_ws_enabled = false;

                    let mut i = 0;
                    while i < args.len() {
                        if args[i] == "--data-dir" && i + 1 < args.len() {
                            data_dir = Some(PathBuf::from(&args[i + 1]));
                            i += 1;
                        } else if args[i].starts_with("--data-dir=") {
                            data_dir = Some(PathBuf::from(&args[i]["--data-dir=".len()..]));
                        } else if args[i] == "--ws" && i + 1 < args.len() {
                            ws_arg = Some(args[i + 1].clone());
                            has_ws_enabled = true;
                            i += 1;
                        } else if args[i].starts_with("--ws=") {
                            ws_arg = Some(args[i]["--ws=".len()..].to_string());
                            has_ws_enabled = true;
                        }
                        i += 1;
                    }

                    results.push(DiscoveredSoloist {
                        pid: Some(pid),
                        exe_path: args.first().cloned(),
                        cmdline: Some(args.join(" ")),
                        data_dir,
                        ws_arg,
                        has_ws_enabled,
                        source: DiscoverySource::RunningProcess,
                    });
                }
            }
        }
    }
    results
}

/// Scans generic common directories for Soloist runtime files (ws.port, ws.addr, soloist.pid).
pub fn scan_common_soloist_directories() -> Vec<DiscoveredSoloist> {
    let mut results = Vec::new();

    let mut candidate_paths = vec![
        PathBuf::from("/var/lib/soloist"),
        PathBuf::from("/var/lib/soloist-data"),
        PathBuf::from("/var/lib/spotify-soloist"),
        PathBuf::from("/tmp/soloist-data"),
    ];

    if let Ok(home) = std::env::var("HOME") {
        candidate_paths.push(PathBuf::from(&home).join(".local/share/soloist"));
        candidate_paths.push(PathBuf::from(&home).join(".local/share/soloist-data"));
    }

    if let Ok(sudo_user) = std::env::var("SUDO_USER") {
        if !sudo_user.trim().is_empty() && sudo_user != "root" {
            candidate_paths.push(PathBuf::from(format!(
                "/home/{}/.local/share/soloist",
                sudo_user
            )));
            candidate_paths.push(PathBuf::from(format!(
                "/home/{}/.local/share/soloist-data",
                sudo_user
            )));
        }
    }

    for dir in candidate_paths {
        if dir.exists() {
            let has_port = dir.join("ws.port").exists();
            let has_addr = dir.join("ws.addr").exists();
            let has_pid = dir.join("soloist.pid").exists();

            if has_port || has_addr || has_pid {
                results.push(DiscoveredSoloist {
                    pid: None,
                    exe_path: None,
                    cmdline: None,
                    data_dir: Some(dir),
                    ws_arg: None,
                    has_ws_enabled: has_port || has_addr,
                    source: DiscoverySource::StandardPath,
                });
            }
        }
    }

    results
}

/// Checks if Syllacast is already installed on the system at `/opt/syllacast`.
pub fn detect_existing_installation() -> ExistingSyllacast {
    let mut info = ExistingSyllacast::default();

    let opt_dir = Path::new("/opt/syllacast");
    let bin_path = opt_dir.join("syllacast");
    let env_path = opt_dir.join(".env");
    let service_path = PathBuf::from("/etc/systemd/system/syllacast.service");

    info.is_installed = bin_path.exists();
    if bin_path.exists() {
        info.bin_path = Some(bin_path);
    }
    if service_path.exists() {
        info.service_path = Some(service_path.clone());
    }
    if env_path.exists() {
        info.env_file = Some(env_path.clone());
        if let Ok(content) = std::fs::read_to_string(&env_path) {
            for line in content.lines() {
                let trimmed = line.trim();
                if trimmed.starts_with('#') || trimmed.is_empty() {
                    continue;
                }
                if let Some((k, v)) = trimmed.split_once('=') {
                    let k = k.trim();
                    let v = v.trim().trim_matches('"').trim_matches('\'');
                    match k {
                        "SPICY_LYRICS_SECRET_KEY" => info.existing_key = Some(v.to_string()),
                        "SOLOIST_DATA_DIR" => info.existing_data_dir = Some(PathBuf::from(v)),
                        "SYLLACAST_PORT" => info.existing_port = v.parse().ok(),
                        _ => {}
                    }
                }
            }
        }
    }

    // Check systemd status
    if Command::new("which").arg("systemctl").output().is_ok() {
        if let Ok(output) = Command::new("systemctl")
            .args(["is-active", "syllacast.service"])
            .output()
        {
            let status = String::from_utf8_lossy(&output.stdout).trim().to_string();
            info.is_service_active = status == "active";
        }

        // Try reading User from service file
        if let Some(ref path) = info.service_path {
            if let Ok(content) = std::fs::read_to_string(path) {
                for line in content.lines() {
                    let trimmed = line.trim();
                    if let Some(user) = trimmed.strip_prefix("User=") {
                        info.existing_user = Some(user.trim().to_string());
                        break;
                    }
                }
            }
        }
    }

    info
}

/// Retrieves the primary local LAN IP address for displaying kiosk URLs.
pub fn detect_local_ip() -> String {
    // Try checking hostname -I
    if let Ok(output) = Command::new("hostname").arg("-I").output() {
        let text = String::from_utf8_lossy(&output.stdout);
        if let Some(ip) = text.split_whitespace().next() {
            if !ip.is_empty() && ip != "127.0.0.1" {
                return ip.to_string();
            }
        }
    }

    // Try ip route get 1.1.1.1
    if let Ok(output) = Command::new("ip")
        .args(["route", "get", "1.1.1.1"])
        .output()
    {
        let text = String::from_utf8_lossy(&output.stdout);
        let parts: Vec<&str> = text.split_whitespace().collect();
        if let Some(pos) = parts.iter().position(|&p| p == "src") {
            if let Some(ip) = parts.get(pos + 1) {
                return ip.to_string();
            }
        }
    }

    "localhost".to_string()
}
