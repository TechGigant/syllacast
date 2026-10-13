# Open Source Attributions & Notices

Syllacast is licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**.
This project incorporates source code, visual designs, and typography algorithms from upstream open-source software.

---

## Upstream Project: Spicy Lyrics

- **Project**: [Spicy Lyrics](https://github.com/Spikerko/spicy-lyrics)
- **Author**: Spikerko ([GitHub](https://github.com/Spikerko) · [Ko-fi](https://ko-fi.com/spikerko) · [Discord](https://discord.gg/lyrc))
- **Original License**: [GNU Affero General Public License v3.0 (AGPL-3.0)](https://github.com/Spikerko/spicy-lyrics/blob/main/LICENSE)
- **Copyright**: Copyright (C) 2026 Spikerko

### Ported Components & Modifications
Syllacast adapts and ports the following components from Spicy Lyrics into a standalone network-synchronized kiosk display service:
- **Typography Rendering Pipeline**: Word-by-word and syllable-by-syllable karaoke layout and highlight engine (`frontend/src/spicy/utils/Lyrics/`), adapted for standalone web execution with dual-alignment support (`OppositeAligned` vocals).
- **Smooth & Auto Scrolling**: Active line centering with spring physics scrolling, and automated progressive line scrolling for non-line-synced/static lyrics.
- **Animation Physics**: Dynamic cubic spline interpolation and second-order spring physics for character/word sweep, scaling pulse, and text glow (`cubic-spline`, `d3-ease`).
- **Dynamic Fluid Background**: Real-time WebGL fluid simulation canvas integration (`@kawarp/core`).
- **Styles & Layout**: Visual themes, color extraction, typography styling, and UI layout primitives (`frontend/src/css/`).
- **Playback Controls & UI**: Fullscreen media box, NowBar metadata display, volume capsule with drag/wheel/mute support, repeat mode toggle (`off`, `context`, `track` with dedicated visual indicators), shuffle toggle, seek bar, and track skip controls (`frontend/src/spicy/components/Utils/NowBar.ts`). Unsupported desktop Spotify actions (heart/favourite and library buttons) and redundant in-lyrics provider tags ("Provided by: unknown") have been removed.
- **Kiosk Features**: Integrated digital clock header (`frontend/src/spicy/components/Utils/Clock.ts`), up-next queue drawer, multi-client isolated state synchronization, and a persistent footer linking to the source repository.
- **Spicetify Bridge Shims**: Custom adapters in `frontend/src/bridge/` providing standalone compatibility shims for `Spicetify.Player`, `Spicetify.Platform`, and `Spicetify.LocalStorage` events so the UI runs outside the desktop Spotify client without requiring Spicetify.

All adaptations and Syllacast-specific additions are Copyright (C) 2026 TechGigant and released under the terms of the AGPL-3.0.

> [!NOTE]
> Spicy Lyrics was independently written by Spikerko as a Spicetify extension.

### Support the Upstream Creator
Spicy Lyrics is maintained by Spikerko. If you enjoy this lyrics visualizer, please consider supporting the creator:
- Support Spikerko on [Ko-fi](https://ko-fi.com/spikerko)
- Join the Spicy Lyrics community on [Discord](https://discord.gg/lyrc)
- Star the upstream repository on [GitHub](https://github.com/Spikerko/spicy-lyrics)

---

## Spotify Soloist Integration

Syllacast interfaces with **Spotify Soloist** (the Spotify Connect audio appliance daemon) over its local WebSocket API:
- **Automatic Endpoint Discovery**: Discovers runtime connection parameters via `ws.addr` and `ws.port` in the Soloist state directory (e.g. `/var/lib/soloist-appliance/soloist-data/`).
- **State & Timeline Synchronization**: Real-time streaming of `playback_state`, `position_sync`, and `queue_changed` events.
- **Remote Playback Controls**: Full command dispatch for playback toggle (`play`, `pause`), track skipping (`skip_next`, `skip_prev`), seeking (`seek`), volume percentage (`set_volume`), shuffle toggling (`set_shuffle`), and repeat coordination (`set_repeat_track`, `set_repeat_context`).
- **Unsupported Features**: Note that Spotify Soloist does not provide user library modification or song liking APIs; library and favourite elements from the desktop UI are intentionally omitted.

---

## Spicy Lyrics API

Syllacast integrates with the official **Spicy Lyrics API** (`https://api.spicylyrics.org/v1/lyrics`) to retrieve synchronized syllable, line, and static lyrics envelopes:
- Server-side cached disk storage for instant offline and repeat lookup.
- API authentication is kept strictly on the server backend with secret keys never exposed to client browsers or WebSockets.

---

## Bundled Third-Party Libraries

Syllacast bundles and utilizes the following open-source dependencies in its frontend and backend:

### Frontend Dependencies

| Package | Upstream License | Usage |
| :--- | :--- | :--- |
| [@kawarp/core](https://github.com/kawarp/core) | MIT | WebGL fluid simulation canvas |
| [d3-ease](https://github.com/d3/d3-ease) | BSD-3-Clause | Easing curves for syllable transitions |
| [cubic-spline](https://github.com/chrv/cubic-spline) | MIT | Natural cubic spline math for character highlight sweep |
| [nanostores](https://github.com/nanostores/nanostores) | MIT | Lightweight reactive state management |
| [simplebar](https://github.com/Grsmto/simplebar) | MIT | Cross-browser smooth custom scrollbars |
| [@tanstack/virtual-core](https://tanstack.com/virtual) | MIT | DOM virtualization for long lyric sheets |

### Backend Dependencies (Rust)

| Package | Upstream License | Usage |
| :--- | :--- | :--- |
| [Axum](https://github.com/tokio-rs/axum) | MIT | Async web server framework |
| [Tokio](https://github.com/tokio-rs/tokio) | MIT | Asynchronous runtime |
| [tokio-tungstenite](https://github.com/snapview/tokio-tungstenite) | MIT | WebSocket client for Spotify Soloist integration |
| [reqwest](https://github.com/seanmonstar/reqwest) | MIT / Apache-2.0 | HTTP client for Spicy Lyrics API |
| [serde](https://github.com/serde-rs/serde) / [serde_json](https://github.com/serde-rs/json) | MIT / Apache-2.0 | Serialization and deserialization |
| [chrono](https://github.com/chronotope/chrono) | MIT / Apache-2.0 | High-precision timestamps and clock sync |
| [clap](https://github.com/clap-rs/clap) | MIT / Apache-2.0 | Command-line argument parsing |
| [tower](https://github.com/tower-rs/tower) / [tower-http](https://github.com/tower-rs/tower-http) | MIT | HTTP middleware, CORS, static file serving |
| [tracing](https://github.com/tokio-rs/tracing) / [tracing-subscriber](https://github.com/tokio-rs/tracing) | MIT | Structured diagnostics logging |
| [dirs](https://github.com/soc/dirs-rs) | MIT / Apache-2.0 | Cross-platform configuration and cache directories |
| [dotenvy](https://github.com/allan2/dotenvy) | MIT | Environment variable configuration |
| [rust-embed](https://github.com/pyrossh/rust-embed) | MIT / Apache-2.0 | Compile-time static asset embedding for single-binary packaging |
| [ratatui](https://github.com/ratatui/ratatui) | MIT | Terminal UI framework for the interactive setup wizard |
| [crossterm](https://github.com/crossterm-rs/crossterm) | MIT | Cross-platform terminal manipulation library |
| [flate2](https://github.com/rust-lang/flate2-rs) / [tar](https://github.com/alexcrichton/tar-rs) | MIT / Apache-2.0 | Archive streaming, compression, and extraction for updates |
| [sha2](https://github.com/RustCrypto/hashes) | MIT / Apache-2.0 | Cryptographic SHA-256 integrity verification |

---

## AGPL-3.0 Remote Network Interaction (Section 13)

Under **Section 13 of the GNU Affero General Public License v3.0**, if you modify this Program, your modified version must prominently offer all users interacting with it remotely through a computer network an opportunity to receive the Corresponding Source of your version by providing access to the Corresponding Source from a network server at no charge.

- **Syllacast Source Code Repository**: [https://github.com/TechGigant/syllacast](https://github.com/TechGigant/syllacast)
- This source repository link is displayed in the persistent footer of the kiosk display and within the web control settings interface.
