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

import type { AppStateSnapshot } from "../../bridge/spotifyPlayer.ts";
import type { MountedWidget, WidgetContext } from "./types.ts";

export interface PlayerControlsWidgetConfig {
  layout_mode: "auto" | "mini" | "single_row" | "standard";
  show_seek_bar: "auto" | "show" | "hide" | boolean;
  show_seek_time: "auto" | "show" | "hide" | boolean;
  show_shuffle_repeat: "auto" | "show" | "hide" | boolean;
  show_prev: "auto" | "show" | "hide" | boolean;
  show_volume: "auto" | "show" | "hide" | boolean;
}

export function createPlayerControlsWidget(
  initialConfig: Record<string, any>,
  ctx: WidgetContext
): MountedWidget {
  let config: PlayerControlsWidgetConfig = {
    layout_mode: ["auto", "mini", "single_row", "standard"].includes(
      initialConfig.layout_mode
    )
      ? initialConfig.layout_mode
      : "auto",
    show_seek_bar:
      initialConfig.show_seek_bar !== undefined ? initialConfig.show_seek_bar : "auto",
    show_seek_time:
      initialConfig.show_seek_time !== undefined ? initialConfig.show_seek_time : "auto",
    show_shuffle_repeat:
      initialConfig.show_shuffle_repeat !== undefined
        ? initialConfig.show_shuffle_repeat
        : "auto",
    show_prev:
      initialConfig.show_prev !== undefined ? initialConfig.show_prev : "auto",
    show_volume:
      initialConfig.show_volume !== undefined ? initialConfig.show_volume : "auto",
  };

  const container = document.createElement("div");
  container.className = "KioskPlayerControlsWidget";
  container.style.cssText = `
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: clamp(6px, 6cqh, 18px) clamp(10px, 4cqw, 26px);
    box-sizing: border-box;
    border-radius: inherit;
    color: #ffffff;
    user-select: none;
    gap: clamp(5px, 6cqh, 14px);
  `;

  let latestState: AppStateSnapshot | null = ctx.getLatestState();
  let isSeeking = false;
  let seekRatio = 0;
  let updateTimer: number | null = null;
  let isDestroyed = false;
  let observedW = 0;
  let observedH = 0;

  // DOM Elements
  const seekRow = document.createElement("div");
  seekRow.className = "ControlsSeekRow";
  seekRow.style.cssText = `
    display: flex;
    align-items: center;
    gap: clamp(6px, 2cqw, 12px);
    width: 100%;
    font-size: clamp(0.68rem, min(3cqw, 9cqh), 0.9rem);
    font-variant-numeric: tabular-nums;
    opacity: 0.88;
  `;

  const curTimeEl = document.createElement("span");
  curTimeEl.className = "ControlsCurrentTime";
  curTimeEl.textContent = "0:00";
  curTimeEl.style.cssText = "min-width: 32px; text-align: right;";

  const seekTrack = document.createElement("div");
  seekTrack.className = "ControlsSeekTrack";
  seekTrack.style.cssText = `
    position: relative;
    flex: 1;
    height: clamp(5px, 5cqh, 8px);
    border-radius: 9999px;
    background: rgba(255, 255, 255, 0.16);
    cursor: pointer;
    touch-action: none;
  `;

  const seekFill = document.createElement("div");
  seekFill.className = "ControlsSeekFill";
  seekFill.style.cssText = `
    position: absolute;
    top: 0;
    left: 0;
    height: 100%;
    width: 0%;
    border-radius: 9999px;
    background: #38bdf8;
    pointer-events: none;
  `;
  seekTrack.appendChild(seekFill);

  const seekThumb = document.createElement("div");
  seekThumb.className = "ControlsSeekThumb";
  seekThumb.style.cssText = `
    position: absolute;
    top: 50%;
    left: 0%;
    width: clamp(10px, 10cqh, 14px);
    height: clamp(10px, 10cqh, 14px);
    border-radius: 50%;
    background: #ffffff;
    box-shadow: 0 1px 4px rgba(0,0,0,0.4);
    transform: translate(-50%, -50%);
    pointer-events: none;
    transition: transform 0.1s ease;
  `;
  seekTrack.appendChild(seekThumb);

  const totTimeEl = document.createElement("span");
  totTimeEl.className = "ControlsTotalTime";
  totTimeEl.textContent = "0:00";
  totTimeEl.style.cssText = "min-width: 32px;";

  seekRow.appendChild(curTimeEl);
  seekRow.appendChild(seekTrack);
  seekRow.appendChild(totTimeEl);
  container.appendChild(seekRow);

  // Bottom action bar: Transport & Volume
  const actionRow = document.createElement("div");
  actionRow.className = "ControlsActionRow";
  actionRow.style.cssText = `
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: clamp(6px, 2.5cqw, 16px);
    width: 100%;
  `;

  // Transport button group
  const transportGroup = document.createElement("div");
  transportGroup.className = "ControlsTransportGroup";
  transportGroup.style.cssText = `
    display: flex;
    align-items: center;
    gap: clamp(3px, 1.8cqw, 10px);
    flex-shrink: 0;
  `;

  // Shuffle button
  const shuffleBtn = document.createElement("button");
  shuffleBtn.className = "ControlsBtn ControlsBtn--shuffle";
  shuffleBtn.title = "Shuffle";
  shuffleBtn.style.cssText = createBtnStyle(false);
  shuffleBtn.innerHTML = `
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M16 3h5v5"/><path d="M4 20L21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/>
    </svg>
  `;
  shuffleBtn.addEventListener("click", () => {
    const isShuffle = latestState?.shuffle ?? false;
    ctx.sendCommand({ type: "set_shuffle", enabled: !isShuffle });
  });
  transportGroup.appendChild(shuffleBtn);

  // Prev button
  const prevBtn = document.createElement("button");
  prevBtn.className = "ControlsBtn ControlsBtn--prev";
  prevBtn.title = "Previous Track";
  prevBtn.style.cssText = createBtnStyle(false);
  prevBtn.innerHTML = `
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5"/>
    </svg>
  `;
  prevBtn.addEventListener("click", () => {
    ctx.sendCommand({ type: "skip_prev" });
  });
  transportGroup.appendChild(prevBtn);

  // Play/Pause button (Hero)
  const playBtn = document.createElement("button");
  playBtn.className = "ControlsBtn ControlsBtn--play";
  playBtn.title = "Play / Pause";
  playBtn.style.cssText = `
    width: clamp(32px, min(11cqw, 38cqh), 48px);
    height: clamp(32px, min(11cqw, 38cqh), 48px);
    border-radius: 50%;
    background: #ffffff;
    color: #000000;
    border: none;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.38);
    transition: transform 0.1s ease, background 0.15s ease;
  `;
  playBtn.innerHTML = getPlayIcon(false);
  playBtn.addEventListener("click", () => {
    ctx.sendCommand({ type: "toggle_play" });
  });
  transportGroup.appendChild(playBtn);

  // Next button
  const nextBtn = document.createElement("button");
  nextBtn.className = "ControlsBtn ControlsBtn--next";
  nextBtn.title = "Next Track";
  nextBtn.style.cssText = createBtnStyle(false);
  nextBtn.innerHTML = `
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/>
    </svg>
  `;
  nextBtn.addEventListener("click", () => {
    ctx.sendCommand({ type: "skip_next" });
  });
  transportGroup.appendChild(nextBtn);

  // Repeat button
  const repeatBtn = document.createElement("button");
  repeatBtn.className = "ControlsBtn ControlsBtn--repeat";
  repeatBtn.title = "Repeat";
  repeatBtn.style.cssText = createBtnStyle(false);
  repeatBtn.innerHTML = getRepeatIcon("off");
  repeatBtn.addEventListener("click", () => {
    const cur = latestState?.repeat || "off";
    const nextMode = cur === "off" ? "context" : cur === "context" ? "track" : "off";
    ctx.sendCommand({ type: "set_repeat", mode: nextMode });
  });
  transportGroup.appendChild(repeatBtn);

  actionRow.appendChild(transportGroup);

  // Volume slider group
  const volumeGroup = document.createElement("div");
  volumeGroup.className = "ControlsVolumeGroup";
  volumeGroup.style.cssText = `
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 0 1 130px;
    min-width: 70px;
  `;

  const speakerIcon = document.createElement("div");
  speakerIcon.style.cssText =
    "display: flex; align-items: center; opacity: 0.78; cursor: pointer; flex-shrink: 0;";
  speakerIcon.innerHTML = getVolumeIcon(50);
  volumeGroup.appendChild(speakerIcon);

  const volSlider = document.createElement("input");
  volSlider.type = "range";
  volSlider.min = "0";
  volSlider.max = "100";
  volSlider.value = "50";
  volSlider.style.cssText = `
    flex: 1;
    min-width: 45px;
    height: 4px;
    accent-color: #38bdf8;
    cursor: pointer;
  `;
  let lastMutedVol = 50;
  speakerIcon.addEventListener("click", () => {
    const cur = parseInt(volSlider.value, 10);
    if (cur > 0) {
      lastMutedVol = cur;
      volSlider.value = "0";
      ctx.sendCommand({ type: "set_volume", volume: 0 });
    } else {
      volSlider.value = lastMutedVol.toString();
      ctx.sendCommand({ type: "set_volume", volume: lastMutedVol });
    }
    speakerIcon.innerHTML = getVolumeIcon(parseInt(volSlider.value, 10));
  });

  volSlider.addEventListener("input", () => {
    const v = parseInt(volSlider.value, 10);
    speakerIcon.innerHTML = getVolumeIcon(v);
    ctx.sendCommand({ type: "set_volume", volume: v });
  });
  volumeGroup.appendChild(volSlider);

  actionRow.appendChild(volumeGroup);
  container.appendChild(actionRow);

  function applyResponsiveLayout() {
    const host = container.parentElement || container;
    const cols = parseInt(host.style.getPropertyValue("--widget-cols") || "8", 10) || 8;
    const rows = parseInt(host.style.getPropertyValue("--widget-rows") || "2", 10) || 2;

    let mode = config.layout_mode;
    if (mode === "auto") {
      if ((rows === 1 && cols <= 4) || (observedW > 0 && observedW < 185)) {
        mode = "mini";
      } else if (rows === 1 || (observedH > 0 && observedH < 76)) {
        mode = "single_row";
      } else {
        mode = "standard";
      }
    }

    const resolveTri = (
      val: "auto" | "show" | "hide" | boolean,
      autoDefault: boolean
    ): boolean => {
      if (val === "show" || val === true) return true;
      if (val === "hide" || val === false) return false;
      return autoDefault;
    };

    const showSeekBar = resolveTri(
      config.show_seek_bar,
      mode === "standard" || (mode === "single_row" && cols >= 7)
    );
    const showSeekTime = resolveTri(
      config.show_seek_time,
      showSeekBar && cols >= 5 && (observedW === 0 || observedW >= 220)
    );
    const showShuffleRepeat = resolveTri(
      config.show_shuffle_repeat,
      mode !== "mini" && cols >= 5 && (observedW === 0 || observedW >= 210)
    );
    const showPrev = resolveTri(
      config.show_prev,
      mode !== "mini" || cols >= 3
    );
    const showVolume = resolveTri(
      config.show_volume,
      mode !== "mini" && cols >= 6 && (observedW === 0 || observedW >= 255)
    );

    container.dataset.controlsMode = mode;

    // Layout structure: single_row puts seekRow inside actionRow between transport and volume
    if (mode === "single_row") {
      container.style.flexDirection = "row";
      container.style.alignItems = "center";
      if (seekRow.parentElement !== actionRow) {
        actionRow.insertBefore(seekRow, volumeGroup);
      }
      seekRow.style.flex = "1";
      seekRow.style.width = "auto";
    } else {
      container.style.flexDirection = "column";
      container.style.alignItems = "stretch";
      if (seekRow.parentElement !== container) {
        container.insertBefore(seekRow, actionRow);
      }
      seekRow.style.flex = "0 0 auto";
      seekRow.style.width = "100%";
    }

    seekRow.style.display = showSeekBar ? "flex" : "none";
    curTimeEl.style.display = showSeekTime ? "inline" : "none";
    totTimeEl.style.display = showSeekTime ? "inline" : "none";
    shuffleBtn.style.display = showShuffleRepeat ? "flex" : "none";
    repeatBtn.style.display = showShuffleRepeat ? "flex" : "none";
    prevBtn.style.display = showPrev ? "flex" : "none";
    volumeGroup.style.display = showVolume ? "flex" : "none";

    actionRow.style.justifyContent =
      showVolume || (mode === "single_row" && showSeekBar)
        ? "space-between"
        : "center";
  }

  const resizeObserver =
    typeof ResizeObserver !== "undefined"
      ? new ResizeObserver((entries) => {
          for (const entry of entries) {
            observedW = entry.contentRect.width;
            observedH = entry.contentRect.height;
          }
          applyResponsiveLayout();
        })
      : null;
  resizeObserver?.observe(container);

  // Interactive Seek Logic
  function handleSeekMove(e: PointerEvent) {
    const rect = seekTrack.getBoundingClientRect();
    if (rect.width <= 0) return;
    seekRatio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const pct = (seekRatio * 100).toFixed(2);
    seekFill.style.width = `${pct}%`;
    seekThumb.style.left = `${pct}%`;

    const dur = latestState?.track?.duration_ms || 0;
    curTimeEl.textContent = formatDuration(seekRatio * dur);
  }

  seekTrack.addEventListener("pointerdown", (e) => {
    isSeeking = true;
    seekTrack.setPointerCapture(e.pointerId);
    seekThumb.style.transform = "translate(-50%, -50%) scale(1.3)";
    handleSeekMove(e);
  });

  seekTrack.addEventListener("pointermove", (e) => {
    if (isSeeking) {
      handleSeekMove(e);
    }
  });

  function finishSeek(e: PointerEvent) {
    if (isSeeking) {
      isSeeking = false;
      seekThumb.style.transform = "translate(-50%, -50%) scale(1)";
      const dur = latestState?.track?.duration_ms || 0;
      if (dur > 0) {
        ctx.sendCommand({
          type: "seek",
          position_ms: Math.round(seekRatio * dur),
        });
      }
      try {
        seekTrack.releasePointerCapture(e.pointerId);
      } catch {
        // ignore pointer release
      }
    }
  }

  seekTrack.addEventListener("pointerup", finishSeek);
  seekTrack.addEventListener("pointercancel", finishSeek);

  // Update UI loop
  function updateTick() {
    if (isDestroyed) return;

    const dur = latestState?.track?.duration_ms || 0;
    totTimeEl.textContent = formatDuration(dur);

    if (!isSeeking) {
      const pos = ctx.getInterpolatedPositionMs();
      curTimeEl.textContent = formatDuration(pos);
      const ratio = dur > 0 ? Math.max(0, Math.min(1, pos / dur)) : 0;
      const pct = (ratio * 100).toFixed(2);
      seekFill.style.width = `${pct}%`;
      seekThumb.style.left = `${pct}%`;
    }
  }

  updateTimer = window.setInterval(updateTick, 200);

  function onStateUpdate(state: AppStateSnapshot) {
    latestState = state;
    const isPlaying = state.is_playing;
    playBtn.innerHTML = getPlayIcon(isPlaying);

    // Shuffle state
    const isShuffle = state.shuffle ?? false;
    shuffleBtn.style.color = isShuffle ? "#38bdf8" : "rgba(255, 255, 255, 0.7)";

    // Repeat state
    const repeatMode = state.repeat || "off";
    repeatBtn.innerHTML = getRepeatIcon(repeatMode);
    repeatBtn.style.color = repeatMode !== "off" ? "#38bdf8" : "rgba(255, 255, 255, 0.7)";

    // Volume state
    if (typeof state.volume === "number" && !document.activeElement?.isSameNode(volSlider)) {
      volSlider.value = state.volume.toString();
      speakerIcon.innerHTML = getVolumeIcon(state.volume);
    }

    updateTick();
  }

  function updateConfig(newConfig: Record<string, any>) {
    config = {
      layout_mode: ["auto", "mini", "single_row", "standard"].includes(
        newConfig.layout_mode
      )
        ? newConfig.layout_mode
        : config.layout_mode,
      show_seek_bar:
        newConfig.show_seek_bar !== undefined
          ? newConfig.show_seek_bar
          : config.show_seek_bar,
      show_seek_time:
        newConfig.show_seek_time !== undefined
          ? newConfig.show_seek_time
          : config.show_seek_time,
      show_shuffle_repeat:
        newConfig.show_shuffle_repeat !== undefined
          ? newConfig.show_shuffle_repeat
          : config.show_shuffle_repeat,
      show_prev:
        newConfig.show_prev !== undefined
          ? newConfig.show_prev
          : config.show_prev,
      show_volume:
        newConfig.show_volume !== undefined
          ? newConfig.show_volume
          : config.show_volume,
    };
    applyResponsiveLayout();
  }

  // Apply initial config display
  updateConfig(initialConfig);

  function destroy() {
    isDestroyed = true;
    resizeObserver?.disconnect();
    if (updateTimer) {
      window.clearInterval(updateTimer);
      updateTimer = null;
    }
    container.innerHTML = "";
  }

  function renderSettingsForm(
    currentConfig: Record<string, any>,
    onChange: (newConfig: Record<string, any>) => void
  ): HTMLElement {
    const form = document.createElement("div");
    form.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 14px;
      font-size: 0.9rem;
      color: #e2e8f0;
    `;

    const liveConfig: PlayerControlsWidgetConfig = { ...config, ...currentConfig };

    const modeGroup = document.createElement("div");
    modeGroup.className = "StudioFormGroup";
    modeGroup.innerHTML = `
      <label class="StudioFormLabel">Display Layout Mode</label>
      <select class="StudioFormSelect ControlsModeSelect">
        <option value="auto" ${liveConfig.layout_mode === "auto" ? "selected" : ""}>Auto (Smart Responsive by Size)</option>
        <option value="mini" ${liveConfig.layout_mode === "mini" ? "selected" : ""}>Mini Pill (Play & Next)</option>
        <option value="single_row" ${liveConfig.layout_mode === "single_row" ? "selected" : ""}>Single Horizontal Row</option>
        <option value="standard" ${liveConfig.layout_mode === "standard" ? "selected" : ""}>Standard Two-Row Transport</option>
      </select>
    `;
    const modeSel = modeGroup.querySelector<HTMLSelectElement>(".ControlsModeSelect")!;
    modeSel.addEventListener("change", () => {
      liveConfig.layout_mode = modeSel.value as any;
      onChange({ ...liveConfig });
    });
    form.appendChild(modeGroup);

    const createTriRow = (
      label: string,
      key:
        | "show_seek_bar"
        | "show_seek_time"
        | "show_shuffle_repeat"
        | "show_prev"
        | "show_volume"
    ) => {
      const row = document.createElement("div");
      row.className = "StudioToggleRow";
      const val =
        liveConfig[key] === true
          ? "show"
          : liveConfig[key] === false
          ? "hide"
          : liveConfig[key] || "auto";
      row.innerHTML = `
        <span class="StudioToggleLabel">${label}</span>
        <select class="StudioFormSelect" style="width: 140px; padding: 5px 8px;">
          <option value="auto" ${val === "auto" ? "selected" : ""}>Auto (Smart)</option>
          <option value="show" ${val === "show" ? "selected" : ""}>Always Show</option>
          <option value="hide" ${val === "hide" ? "selected" : ""}>Always Hide</option>
        </select>
      `;
      const sel = row.querySelector("select")!;
      sel.addEventListener("change", () => {
        (liveConfig as any)[key] = sel.value;
        onChange({ ...liveConfig });
      });
      return row;
    };

    form.appendChild(createTriRow("Seek / Progress Bar", "show_seek_bar"));
    form.appendChild(createTriRow("Seek Time Counters", "show_seek_time"));
    form.appendChild(createTriRow("Shuffle & Repeat Buttons", "show_shuffle_repeat"));
    form.appendChild(createTriRow("Previous Track Button", "show_prev"));
    form.appendChild(createTriRow("Volume Slider", "show_volume"));

    return form;
  }

  if (latestState) {
    onStateUpdate(latestState);
  }

  return {
    element: container,
    updateConfig,
    onStateUpdate,
    destroy,
    renderSettingsForm,
  };
}

function createBtnStyle(active: boolean): string {
  return `
    width: 32px;
    height: 32px;
    border-radius: 8px;
    background: transparent;
    color: ${active ? "#38bdf8" : "rgba(255, 255, 255, 0.7)"};
    border: none;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;
  `;
}

function getPlayIcon(isPlaying: boolean): string {
  if (isPlaying) {
    return `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <rect x="6" y="4" width="4" height="16" rx="1"/>
        <rect x="14" y="4" width="4" height="16" rx="1"/>
      </svg>
    `;
  }
  return `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <polygon points="6 3 20 12 6 21 6 3"/>
    </svg>
  `;
}

function getRepeatIcon(mode: string): string {
  if (mode === "track") {
    return `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>
        <text x="11" y="14" font-size="8" font-family="sans-serif" font-weight="bold" fill="currentColor" stroke="none">1</text>
      </svg>
    `;
  }
  return `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>
    </svg>
  `;
}

function getVolumeIcon(vol: number): string {
  if (vol === 0) {
    return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="22" y1="9" x2="16" y2="15"/><line x1="16" y1="9" x2="22" y2="15"/></svg>`;
  }
  if (vol < 50) {
    return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`;
  }
  return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`;
}

function formatDuration(ms: number): string {
  if (!ms || ms <= 0) return "0:00";
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
