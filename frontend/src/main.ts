/*
 * Syllacast - Standalone Spotify Lyrics Kiosk
 * Copyright (C) 2026 TechGigant
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Syllacast - Standalone 1:1 Spicy Lyrics Web Kiosk
import { setShimProgressGetter, setShimCommandSender } from "./bridge/spicetifyShim.ts";
import "./style.css";
import "./styles/grid-layout.css";
import "./styles/customize-studio.css";
import { ClockSync } from "./sync/clock.ts";
import { PlaybackTimeline, type PositionAnchor } from "./sync/timeline.ts";
import { setCustomProgressProvider } from "./spicy/utils/Gets/GetProgress.ts";
import { ResetLastLine, QueueForceScroll } from "./spicy/utils/Scrolling/ScrollToActiveLine.ts";
import PageView from "./spicy/components/Pages/PageView.ts";
import { SpotifyPlayer } from "./spicy/components/Global/SpotifyPlayer.ts";
import Global from "./spicy/components/Global/Global.ts";
import fetchLyrics, {
  setLyricsPayload,
  presentLyrics,
  ShowLoaderContainer,
  HideLoaderContainer,
  ClearLyricsPageContainer,
} from "./spicy/utils/Lyrics/fetchLyrics.ts";
import ApplyLyrics from "./spicy/utils/Lyrics/Global/Applyer.ts";
import { DestroyAllLyricsContainers } from "./spicy/utils/Lyrics/Applyer/CreateLyricsContainer.ts";
import { ClearLyricsContentArrays } from "./spicy/utils/Lyrics/lyrics.ts";
import { ClearScrollSimplebar } from "./spicy/utils/Scrolling/Simplebar/ScrollSimplebar.ts";
import ApplyDynamicBackground from "./spicy/components/DynamicBG/dynamicBackground.ts";
import { UpdateNowBar } from "./spicy/components/Utils/NowBar.ts";
import { ScrollToActiveLine } from "./spicy/utils/Scrolling/ScrollToActiveLine.ts";
import { ScrollSimplebar } from "./spicy/utils/Scrolling/Simplebar/ScrollSimplebar.ts";
import { IntervalManager } from "./spicy/utils/IntervalManager.ts";
import { ScrollingIntervalTime } from "./spicy/utils/Lyrics/lyrics.ts";
import { updateSpotifyPlayerState, type AppStateSnapshot } from "./bridge/spotifyPlayer.ts";
import { createKioskClock } from "./kiosk/clock.ts";
import { createKioskUpNext } from "./kiosk/upNext.ts";
import { createKioskFooter } from "./kiosk/footer.ts";
import { createKioskUpdateBanner } from "./kiosk/updateBanner.ts";
import { createCustomizeStudio, type KioskSettings } from "./kiosk/customizeStudio.ts";
import { isTypingInInput } from "./kiosk/gridMath.ts";
import { DEFAULT_LAYOUT_PROFILES } from "./kiosk/widgets/types.ts";
import { $nowBarSide, $isNowBarOpen } from "./spicy/utils/uiState.ts";
import { $staticBackgroundMode } from "./spicy/utils/stores.ts";
import Fullscreen from "./spicy/components/Utils/Fullscreen.ts";

export type { KioskSettings };

// Subsystems
const clockSync = new ClockSync();
const timeline = new PlaybackTimeline(clockSync);
let activeWs: WebSocket | null = null;
let latestAppState: AppStateSnapshot | null = null;

// Connect Syllacast high-precision NTP-anchored timeline directly to Spicy Lyrics & Spicetify shim
setCustomProgressProvider(() => timeline.getInterpolatedPositionMs());
setShimProgressGetter(() => timeline.getInterpolatedPositionMs());

// Mount the authentic Spicy Lyrics DOM
const appRoot = document.getElementById("app") || document.body;
PageView.Open(appRoot);

// Mount Kiosk Digital Clock & Up Next Queue Card
const kioskClock = createKioskClock();
appRoot.appendChild(kioskClock.element);
kioskClock.start();

const kioskUpNext = createKioskUpNext();
appRoot.appendChild(kioskUpNext.element);

// Mount persistent on-screen footer (bottom-left lyrics source, bottom-right source link)
const kioskFooter = createKioskFooter();
appRoot.appendChild(kioskFooter.element);

// Mount on-screen update toast & critical alert banner
const kioskUpdateBanner = createKioskUpdateBanner();
document.body.appendChild(kioskUpdateBanner.element);

// Mount Interactive Layout Customization & Widget Studio
const customizeStudio = createCustomizeStudio({
  clockElement: kioskClock.element,
  upNextElement: kioskUpNext.element,
  getInterpolatedPositionMs: () => timeline.getInterpolatedPositionMs(),
  sendCommand: (cmd) => {
    if (activeWs && activeWs.readyState === WebSocket.OPEN) {
      activeWs.send(JSON.stringify(cmd));
    }
  },
  getLatestState: () => latestAppState,
});

// Apply initial default grid layout immediately before server settings arrive
customizeStudio.applySettings({
  show_controls_buttons: true,
  startup_mode: "standard",
  nowbar_open: true,
  nowbar_side: "left",
  clock_enabled: true,
  up_next_enabled: true,
  calibration_offset_ms: 0,
  dynamic_bg_mode: "dynamic",
  active_profile_id: "default",
  layout_profiles: DEFAULT_LAYOUT_PROFILES,
});

// Start authentic Spicy Lyrics auto-scrolling manager
new IntervalManager(ScrollingIntervalTime, () => {
  if (ScrollSimplebar) {
    ScrollToActiveLine(ScrollSimplebar);
  }
}).Start();

// Settings & Diagnostics DOM (Overlay)
const settingsDialog = document.getElementById("settings-dialog") as HTMLElement;
const settingsClose = document.getElementById("settings-close") as HTMLButtonElement;
const openCustomizeBtn = document.getElementById("open-customize-studio-btn") as HTMLButtonElement | null;
const calibSlider = document.getElementById("calib-slider") as HTMLInputElement;
const calibMs = document.getElementById("calib-ms") as HTMLElement;
const diagRtt = document.getElementById("diag-rtt") as HTMLElement;
const diagOffset = document.getElementById("diag-offset") as HTMLElement;

if (calibSlider && calibMs) {
  calibSlider.value = timeline.getCalibrationMs().toString();
  calibMs.textContent = `${calibSlider.value} ms`;
  calibSlider.addEventListener("input", () => {
    const val = parseInt(calibSlider.value, 10);
    calibMs.textContent = `${val} ms`;
    timeline.setCalibrationMs(val);
  });
}

if (settingsClose && settingsDialog) {
  settingsClose.addEventListener("click", () => {
    settingsDialog.style.display = "none";
  });
}

if (openCustomizeBtn) {
  openCustomizeBtn.addEventListener("click", () => {
    if (settingsDialog) {
      settingsDialog.style.display = "none";
    }
    customizeStudio.enterEditMode();
  });
}

window.addEventListener("keydown", (e) => {
  if (isTypingInInput(e.target)) return;

  if ((e.key === "s" || e.key === "S") && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (!settingsDialog) return;
    const isHidden = settingsDialog.style.display === "none" || !settingsDialog.style.display;
    settingsDialog.style.display = isHidden ? "block" : "none";
  } else if (e.key === "Escape") {
    if (settingsDialog) {
      settingsDialog.style.display = "none";
    }
  }
});

// Dynamic Settings Application from Server
function applyKioskSettings(settings: KioskSettings) {
  if (!settings) return;

  // 1. Controls buttons visibility
  const viewControls = document.querySelector<HTMLElement>(".ViewControls");
  if (viewControls) {
    viewControls.style.display = settings.show_controls_buttons ? "flex" : "none";
  }

  // 2. Calibration offset
  if (typeof settings.calibration_offset_ms === "number") {
    timeline.setCalibrationMs(settings.calibration_offset_ms);
    if (calibSlider) calibSlider.value = settings.calibration_offset_ms.toString();
    if (calibMs) calibMs.textContent = `${settings.calibration_offset_ms} ms`;
  }

  // 3. NowBar side & open/closed state
  const pageContainer = document.getElementById("SpicyLyricsPage");
  const nowBar = pageContainer?.querySelector<HTMLElement>(".ContentBox .NowBar");
  if (pageContainer && nowBar) {
    const isLeft = settings.nowbar_side === "left";
    $nowBarSide.set(isLeft ? "left" : "right");
    pageContainer.classList.toggle("NowBarSide__Left", isLeft);
    pageContainer.classList.toggle("NowBarSide__Right", !isLeft);
    nowBar.classList.toggle("LeftSide", isLeft);
    nowBar.classList.toggle("RightSide", !isLeft);

    const isOpen = settings.nowbar_open !== false;
    $isNowBarOpen.set(isOpen);
    pageContainer.classList.toggle("NowBarStatus__Open", isOpen);
    pageContainer.classList.toggle("NowBarStatus__Closed", !isOpen);
    nowBar.classList.toggle("Active", isOpen);
  }

  // 4. Startup / Display Mode
  if (settings.startup_mode === "cinema" && !Fullscreen.IsOpen) {
    Fullscreen.Open(true, false);
  } else if (settings.startup_mode === "standard" && Fullscreen.IsOpen) {
    Fullscreen.CloseImmediately();
  }

  // 5. Dynamic Background Mode
  if (settings.dynamic_bg_mode === "static") {
    $staticBackgroundMode.set("artistHeader");
  } else {
    $staticBackgroundMode.set("off");
  }

  // 6. Apply 24x12 Grid Layout Profile & Widgets
  customizeStudio.applySettings(settings);
}

// Fetch initial settings over HTTP so custom profiles apply immediately
fetch("/api/settings")
  .then((res) => (res.ok ? res.json() : null))
  .then((settings) => {
    if (settings) applyKioskSettings(settings);
  })
  .catch(() => {});

// WebSocket Connection to Syllacast backend
function connectWebSocket() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}/ws`;
  const ws = new WebSocket(wsUrl);
  activeWs = ws;

  ws.onopen = () => {
    clockSync.attach(ws);
    setShimCommandSender((cmd) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(cmd));
      }
    });
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === "pong") {
        clockSync.handlePong(msg.t1, msg.t2, msg.t3);
      } else if (msg.type === "position_sync") {
        const anchor: PositionAnchor = msg.position || (typeof msg.position_ms === "number" ? msg : null);
        if (anchor) {
          timeline.setAnchor(anchor);
        }
      } else if (msg.type === "settings") {
        applyKioskSettings(msg.data ?? msg);
      } else if (msg.type === "state") {
        const state: AppStateSnapshot = msg.track ? msg : msg.data ?? msg;
        handleStateUpdate(state);
      } else if (msg.type === "update_available") {
        const updateInfo = msg.data ?? msg;
        if (updateInfo && updateInfo.latest_version) {
          kioskUpdateBanner.show(updateInfo);
        }
      } else if (msg.type === "update_progress") {
        kioskUpdateBanner.showProgress(msg);
      }
    } catch (e) {
      console.error("Failed to parse server WS message:", e);
    }
  };

  ws.onclose = () => {
    if (activeWs === ws) activeWs = null;
    setShimCommandSender(() => {});
    clockSync.detach();
    setTimeout(connectWebSocket, 2000);
  };
}

let lastTrackUri: string | null = null;
let lastLyricsKey: string | null = null;
let lastKnownPositionMs = 0;

function handleStateUpdate(state: AppStateSnapshot) {
  latestAppState = state;
  customizeStudio.onStateUpdate(state);
  const { songChanged, playPauseChanged } = updateSpotifyPlayerState(state);
  const currentUri = state.track?.uri || "";

  // 1. Position & timeline synchronization
  if (songChanged || currentUri !== lastTrackUri) {
    lastTrackUri = currentUri;
    lastLyricsKey = null; // force re-eval of lyrics for new track
    ResetLastLine();
    QueueForceScroll();

    // When song changes, immediately anchor timeline at 0ms if state.position is missing or stale
    const serverEpochMs = clockSync.getEstimatedServerEpoch();
    if (state.position && Math.abs(serverEpochMs - state.position.timestamp_ms) < 3000) {
      timeline.setAnchor(state.position);
    } else {
      timeline.setAnchor({
        position_ms: 0,
        timestamp_ms: serverEpochMs,
        speed: state.is_playing ? 1.0 : 0.0,
      });
    }

    UpdateNowBar(true);

    Global.Event.evoke("playback:songchange", {
      data: { item: Spicetify.Player.data.item },
    });

    // Update dynamic fluid background with the new track's album artwork!
    const contentBox = document.querySelector<HTMLElement>("#SpicyLyricsPage .ContentBox");
    if (contentBox) {
      void ApplyDynamicBackground(contentBox, "lpagebg");
    }
  } else if (state.position) {
    timeline.setAnchor(state.position);
  }

  // Detect track rewind or backward scrub within the same song
  const currentPosMs = state.position?.position_ms ?? 0;
  if (!songChanged && currentUri === lastTrackUri && currentPosMs > 0 && lastKnownPositionMs > 0) {
    if (currentPosMs < lastKnownPositionMs - 1500) {
      ResetLastLine();
      QueueForceScroll();
    }
  }
  lastKnownPositionMs = currentPosMs;

  // 2. Play / Pause state change
  if (playPauseChanged) {
    if (state.position) {
      timeline.setAnchor(state.position);
    }
    Global.Event.evoke("playback:playpause", {
      data: { isPaused: !state.is_playing },
    });
  }

  // 3. Up next queue update
  kioskUpNext.update(state.queue_upcoming);

  // 4. Lyrics State Machine
  const lyricsStatus = state.lyrics_status || (state.lyrics ? "found" : (currentUri ? "not_found" : "idle"));
  const lyricsKey = `${currentUri}:${lyricsStatus}:${state.lyrics?.Body?.id || ""}`;

  if (lyricsKey !== lastLyricsKey) {
    lastLyricsKey = lyricsKey;

    if (!currentUri || lyricsStatus === "idle") {
      // Idle / no song playing: clean up lyrics containers and loaders without showing error notice
      setLyricsPayload(null, null);
      HideLoaderContainer();
      DestroyAllLyricsContainers();
      ClearLyricsContentArrays();
      ClearScrollSimplebar();
      ClearLyricsPageContainer();
      kioskFooter.updateLyricsSource(null);
    } else if (lyricsStatus === "loading") {
      // Server is currently fetching lyrics
      ShowLoaderContainer(currentUri);
      DestroyAllLyricsContainers();
      ClearLyricsContentArrays();
      ClearScrollSimplebar();
      ClearLyricsPageContainer();
      kioskFooter.updateLyricsSource(null);
    } else if (lyricsStatus === "found" && state.lyrics?.Body) {
      // Lyrics retrieved successfully
      ResetLastLine();
      QueueForceScroll();
      const lyricsBody = state.lyrics.Body;
      setLyricsPayload(lyricsBody, currentUri);
      presentLyrics(lyricsBody);
      void ApplyLyrics([lyricsBody, 200, currentUri]);
      const uploader =
        lyricsBody.UploadAttribution?.Uploader ??
        lyricsBody.TTMLUploadMetadata?.Uploader;
      const maker =
        lyricsBody.UploadAttribution?.Maker ??
        lyricsBody.TTMLUploadMetadata?.Maker;
      kioskFooter.updateLyricsSource(lyricsBody.source, uploader, maker);
    } else if (lyricsStatus === "not_found") {
      // 404 - no lyrics available for this song
      setLyricsPayload(null, currentUri);
      void ApplyLyrics(["lyrics-not-found", 404, currentUri]);
      kioskFooter.updateLyricsSource(null);
    } else if (lyricsStatus === "error") {
      // Server error or network issue
      setLyricsPayload(null, currentUri);
      void ApplyLyrics(["unknown-error", 500, currentUri]);
      kioskFooter.updateLyricsSource(null);
    }
  }
}

// Continuous frame loop for timeline slider updates and diagnostics
function frameLoop() {
  const currentPosMs = timeline.getInterpolatedPositionMs();

  // Update NowBar timeline slider and position display
  Global.Event.evoke("playback:position", currentPosMs);

  // Update settings diagnostics if dialog is visible
  if (settingsDialog && settingsDialog.style.display !== "none") {
    const diag = clockSync.getDiagnostics();
    if (diagRtt) diagRtt.textContent = `${diag.rttMs.toFixed(1)} ms`;
    if (diagOffset) {
      const sign = diag.offsetMs > 0 ? "+" : "";
      diagOffset.textContent = `${sign}${diag.offsetMs.toFixed(1)} ms`;
    }
  }

  requestAnimationFrame(frameLoop);
}

// Launch
connectWebSocket();
requestAnimationFrame(frameLoop);
