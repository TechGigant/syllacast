// Syllacast - Standalone Spotify Lyrics Kiosk
// Copyright (C) 2026 TechGigant
// SPDX-License-Identifier: AGPL-3.0-or-later

use std::net::Ipv4Addr;

/// Checks whether an incoming HTTP Origin header is authorized to access the API
/// or establish a WebSocket connection.
///
/// Permitted origins:
/// 1. Missing or empty Origin (same-origin / non-browser HTTP clients like curl/local webview)
/// 2. Explicit match in `SYLLACAST_ALLOWED_ORIGINS` environment variable (comma-separated or "*")
/// 3. Host match with incoming `Host` request header (same-origin)
/// 4. Loopback addresses (`localhost`, `127.0.0.1`, `::1`, `[::1]`)
/// 5. Private / LAN IPv4 ranges (RFC 1918: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, RFC 3927: 169.254.0.0/16)
/// 6. Local network Zeroconf/mDNS hostnames ending in `.local`
pub fn is_allowed_origin(origin: &str, host: Option<&str>) -> bool {
    let origin = origin.trim();
    if origin.is_empty() {
        return true;
    }

    // 1. Check explicit SYLLACAST_ALLOWED_ORIGINS environment variable
    if let Ok(allowed_env) = std::env::var("SYLLACAST_ALLOWED_ORIGINS") {
        for allowed in allowed_env.split(',') {
            let allowed = allowed.trim();
            if !allowed.is_empty() && (allowed == "*" || origin.eq_ignore_ascii_case(allowed)) {
                return true;
            }
        }
    }

    // 2. Parse scheme and host:port
    let stripped = if let Some(rest) = origin.strip_prefix("http://") {
        rest
    } else if let Some(rest) = origin.strip_prefix("https://") {
        rest
    } else if let Some(rest) = origin.strip_prefix("ws://") {
        rest
    } else if let Some(rest) = origin.strip_prefix("wss://") {
        rest
    } else {
        return false;
    };

    // Strip any trailing path or query if present (Origin should not have path, but handle safely)
    let authority = stripped.split('/').next().unwrap_or("").trim();
    if authority.is_empty() {
        return false;
    }

    // Extract host and optional port
    let (origin_host, _origin_port) = if authority.starts_with('[') {
        // IPv6 e.g. [::1]:8080 or [::1]
        if let Some(close_bracket) = authority.find(']') {
            let h = &authority[1..close_bracket];
            let rest = &authority[close_bracket + 1..];
            let p = rest.strip_prefix(':');
            (h, p)
        } else {
            return false;
        }
    } else if let Some((h, p)) = authority.split_once(':') {
        (h, Some(p))
    } else {
        (authority, None)
    };

    // 3. Match against request Host header (same-origin)
    if let Some(host_hdr) = host {
        let host_clean = host_hdr.trim();
        if authority.eq_ignore_ascii_case(host_clean)
            || origin_host.eq_ignore_ascii_case(host_clean)
        {
            return true;
        }
    }

    // 4. Loopback
    if origin_host.eq_ignore_ascii_case("localhost")
        || origin_host == "127.0.0.1"
        || origin_host == "::1"
    {
        return true;
    }

    // 5. Private / LAN IPv4 subnets
    if let Ok(ip) = origin_host.parse::<Ipv4Addr>() {
        let octets = ip.octets();
        // 127.0.0.0/8 loopback
        if octets[0] == 127 {
            return true;
        }
        // 10.0.0.0/8 private network
        if octets[0] == 10 {
            return true;
        }
        // 172.16.0.0/12 (172.16.0.0 to 172.31.255.255)
        if octets[0] == 172 && (16..=31).contains(&octets[1]) {
            return true;
        }
        // 192.168.0.0/16 private network
        if octets[0] == 192 && octets[1] == 168 {
            return true;
        }
        // 169.254.0.0/16 link-local
        if octets[0] == 169 && octets[1] == 254 {
            return true;
        }
    }

    // 6. Zeroconf / mDNS domain (.local)
    if origin_host.ends_with(".local") {
        return true;
    }

    false
}
