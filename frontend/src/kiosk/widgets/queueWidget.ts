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
import type { ElementVisibility, MountedWidget, WidgetContext } from "./types.ts";
import { classifyWidgetDimensions } from "./types.ts";

export interface QueueWidgetConfig {
  mode: "tabs" | "upcoming_only" | "history_only" | "split";
  max_items: number; // 3 to 15 (default 8)
  show_header: ElementVisibility | boolean;
  show_covers: ElementVisibility | boolean;
  show_duration: ElementVisibility | boolean;
  click_to_play: boolean;
}

interface ExtendedQueueItem {
  title: string;
  artist: string;
  cover_url?: string;
  uri?: string;
  duration_ms?: number;
}

function normalizeVisibility(
  val: unknown,
  fallback: ElementVisibility = "auto"
): ElementVisibility {
  if (val === true || val === "show") return "show";
  if (val === false || val === "hide") return "hide";
  if (val === "auto") return "auto";
  return fallback;
}

export function createQueueWidget(
  initialConfig: Record<string, any>,
  ctx: WidgetContext
): MountedWidget {
  let config: QueueWidgetConfig = {
    mode: ["tabs", "upcoming_only", "history_only", "split"].includes(
      initialConfig.mode
    )
      ? initialConfig.mode
      : "tabs",
    max_items:
      typeof initialConfig.max_items === "number"
        ? Math.max(3, Math.min(15, initialConfig.max_items))
        : 8,
    show_header: normalizeVisibility(initialConfig.show_header, "auto"),
    show_covers: normalizeVisibility(initialConfig.show_covers, "auto"),
    show_duration: normalizeVisibility(initialConfig.show_duration, "auto"),
    click_to_play: initialConfig.click_to_play !== false,
  };

  const container = document.createElement("div");
  container.className = "KioskQueueWidget";
  container.style.cssText = `
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    padding: clamp(6px, min(3cqw, 3.5cqh), 20px) clamp(8px, min(3.5cqw, 4cqh), 22px);
    box-sizing: border-box;
    border-radius: inherit;
    color: #ffffff;
    user-select: none;
  `;

  let activeTab: "upcoming" | "history" = "upcoming";
  let latestState: AppStateSnapshot | null = ctx.getLatestState();

  function getEffectiveDims() {
    const parent = container.parentElement;
    const gridW = Number(parent?.dataset.gridW || container.dataset.gridW || 7);
    const gridH = Number(parent?.dataset.gridH || container.dataset.gridH || 6);
    const rect = container.getBoundingClientRect();
    const widthPx = rect.width > 0 ? rect.width : gridW * 64;
    const heightPx = rect.height > 0 ? rect.height : gridH * 64;
    return classifyWidgetDimensions(gridW, gridH, widthPx, heightPx);
  }

  function resolveLayout(): {
    showHeader: boolean;
    showCovers: boolean;
    showDuration: boolean;
    compactRow: boolean;
  } {
    const dims = getEffectiveDims();
    const resolveFlag = (
      vis: ElementVisibility | boolean,
      autoDefault: boolean
    ): boolean => {
      const norm = normalizeVisibility(vis, "auto");
      if (norm === "show") return true;
      if (norm === "hide") return false;
      return autoDefault;
    };

    return {
      showHeader: resolveFlag(config.show_header, dims.rows >= 3),
      showCovers: resolveFlag(config.show_covers, dims.cols >= 4),
      showDuration: resolveFlag(config.show_duration, dims.cols >= 5),
      compactRow: dims.rows <= 3 || dims.heightPx < 180,
    };
  }

  function renderView() {
    container.innerHTML = "";

    const layout = resolveLayout();
    const upcoming: ExtendedQueueItem[] = (latestState?.queue_upcoming || []) as any[];
    const history: ExtendedQueueItem[] = ((latestState as any)?.queue_history || []) as any[];

    // Header / Tabs
    if (layout.showHeader) {
      const headerEl = document.createElement("div");
      headerEl.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: clamp(4px, 1.8cqh, 12px);
        flex-shrink: 0;
      `;

      if (config.mode === "tabs") {
        headerEl.innerHTML = `
          <div style="display: flex; gap: 5px; background: rgba(255, 255, 255, 0.06); padding: 3px; border-radius: 9px;">
            <button type="button" class="QueueTabBtn" data-tab="upcoming" style="padding: clamp(3px, 0.8cqh, 6px) clamp(8px, 2.4cqw, 14px); border-radius: 7px; border: none; font-size: clamp(0.7rem, min(3.2cqw, 3.6cqh), 0.9rem); font-weight: 600; cursor: pointer; background: ${
              activeTab === "upcoming" ? "#38bdf8" : "transparent"
            }; color: ${activeTab === "upcoming" ? "#000" : "rgba(255,255,255,0.72)"};">
              Up Next (${upcoming.length})
            </button>
            <button type="button" class="QueueTabBtn" data-tab="history" style="padding: clamp(3px, 0.8cqh, 6px) clamp(8px, 2.4cqw, 14px); border-radius: 7px; border: none; font-size: clamp(0.7rem, min(3.2cqw, 3.6cqh), 0.9rem); font-weight: 600; cursor: pointer; background: ${
              activeTab === "history" ? "#38bdf8" : "transparent"
            }; color: ${activeTab === "history" ? "#000" : "rgba(255,255,255,0.72)"};">
              History (${history.length})
            </button>
          </div>
        `;
        headerEl.querySelectorAll<HTMLButtonElement>(".QueueTabBtn").forEach((btn) => {
          btn.addEventListener("click", () => {
            activeTab = btn.dataset.tab as any;
            renderView();
          });
        });
      } else if (config.mode === "upcoming_only") {
        headerEl.innerHTML = `
          <div style="font-size: clamp(0.72rem, min(3.4cqw, 3.8cqh), 0.95rem); font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.72;">
            Up Next · ${upcoming.length}
          </div>
        `;
      } else if (config.mode === "history_only") {
        headerEl.innerHTML = `
          <div style="font-size: clamp(0.72rem, min(3.4cqw, 3.8cqh), 0.95rem); font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.72;">
            Recently Played · ${history.length}
          </div>
        `;
      } else {
        headerEl.innerHTML = `
          <div style="font-size: clamp(0.72rem, min(3.4cqw, 3.8cqh), 0.95rem); font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.72;">
            Queue &amp; History
          </div>
        `;
      }

      container.appendChild(headerEl);
    }

    // List Container
    const listScroll = document.createElement("div");
    listScroll.className = "QueueListScroll";
    listScroll.style.cssText = `
      flex: 1;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: ${layout.compactRow ? "4px" : "clamp(5px, 1.5cqh, 9px)"};
      padding-right: 4px;
    `;

    if (config.mode === "split") {
      renderSection(listScroll, "Up Next", upcoming.slice(0, config.max_items), layout);
      renderSection(listScroll, "Recently Played", history.slice(0, config.max_items), layout);
    } else if (
      config.mode === "upcoming_only" ||
      (config.mode === "tabs" && activeTab === "upcoming")
    ) {
      renderItems(
        listScroll,
        upcoming.slice(0, config.max_items),
        "No upcoming songs in queue",
        layout
      );
    } else {
      renderItems(
        listScroll,
        history.slice(0, config.max_items),
        "No playback history yet",
        layout
      );
    }

    container.appendChild(listScroll);
  }

  function renderSection(
    parent: HTMLElement,
    title: string,
    items: ExtendedQueueItem[],
    layout: ReturnType<typeof resolveLayout>
  ) {
    const secHeader = document.createElement("div");
    secHeader.style.cssText = `
      font-size: clamp(0.66rem, min(3cqw, 3.2cqh), 0.85rem);
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      opacity: 0.58;
      margin-top: 6px;
      margin-bottom: 2px;
    `;
    secHeader.textContent = `${title} (${items.length})`;
    parent.appendChild(secHeader);
    renderItems(parent, items, `No ${title.toLowerCase()}`, layout);
  }

  function renderItems(
    parent: HTMLElement,
    items: ExtendedQueueItem[],
    emptyMsg: string,
    layout: ReturnType<typeof resolveLayout>
  ) {
    if (!items || items.length === 0) {
      const emptyEl = document.createElement("div");
      emptyEl.style.cssText = `
        padding: 12px 0;
        text-align: center;
        font-size: clamp(0.72rem, min(3.4cqw, 3.8cqh), 0.92rem);
        opacity: 0.5;
        font-style: italic;
      `;
      emptyEl.textContent = emptyMsg;
      parent.appendChild(emptyEl);
      return;
    }

    for (const item of items) {
      const row = document.createElement("div");
      const canClick = Boolean(config.click_to_play && item.uri);

      row.className = "QueueItemRow";
      row.style.cssText = `
        display: flex;
        align-items: center;
        gap: clamp(6px, 2.4cqw, 12px);
        padding: ${layout.compactRow ? "4px 8px" : "clamp(4px, 1.4cqh, 9px) clamp(8px, 2.2cqw, 12px)"};
        border-radius: 9px;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.05);
        transition: background 0.15s ease, transform 0.12s ease;
        flex-shrink: 0;
        ${canClick ? "cursor: pointer;" : ""}
      `;

      if (canClick) {
        row.addEventListener("mouseenter", () => {
          row.style.background = "rgba(255, 255, 255, 0.11)";
        });
        row.addEventListener("mouseleave", () => {
          row.style.background = "rgba(255, 255, 255, 0.04)";
        });
        row.addEventListener("click", () => {
          if (item.uri) {
            ctx.sendCommand({ type: "play", uri: item.uri });
          }
        });
      }

      if (layout.showCovers) {
        const coverEl = document.createElement("img");
        coverEl.className = "QueueItemCover";
        coverEl.style.cssText = `
          width: ${layout.compactRow ? "26px" : "clamp(28px, min(9.5cqw, 10cqh), 44px)"};
          height: ${layout.compactRow ? "26px" : "clamp(28px, min(9.5cqw, 10cqh), 44px)"};
          border-radius: 6px;
          object-fit: cover;
          background: rgba(255, 255, 255, 0.06);
          flex-shrink: 0;
        `;
        coverEl.src = item.cover_url || "";
        coverEl.alt = "";
        row.appendChild(coverEl);
      }

      const textCol = document.createElement("div");
      textCol.style.cssText = `
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 1px;
      `;
      textCol.innerHTML = `
        <span style="font-size: clamp(0.74rem, min(3.5cqw, 3.8cqh), 0.98rem); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
          ${escapeHtml(item.title || "Unknown Track")}
        </span>
        <span style="font-size: clamp(0.65rem, min(3cqw, 3.2cqh), 0.84rem); opacity: 0.68; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
          ${escapeHtml(item.artist || "")}
        </span>
      `;
      row.appendChild(textCol);

      if (layout.showDuration && item.duration_ms && item.duration_ms > 0) {
        const durEl = document.createElement("span");
        durEl.style.cssText = `
          font-size: 0.72rem;
          opacity: 0.6;
          font-variant-numeric: tabular-nums;
          flex-shrink: 0;
        `;
        durEl.textContent = formatDuration(item.duration_ms);
        row.appendChild(durEl);
      }

      parent.appendChild(row);
    }
  }

  let resizeObserver: ResizeObserver | null = null;
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => {
      renderView();
    });
    resizeObserver.observe(container);
  }

  function updateConfig(newConfig: Record<string, any>) {
    config = {
      mode: ["tabs", "upcoming_only", "history_only", "split"].includes(
        newConfig.mode
      )
        ? newConfig.mode
        : config.mode,
      max_items:
        typeof newConfig.max_items === "number"
          ? Math.max(3, Math.min(15, newConfig.max_items))
          : config.max_items,
      show_header:
        newConfig.show_header !== undefined
          ? normalizeVisibility(newConfig.show_header, "auto")
          : config.show_header,
      show_covers:
        newConfig.show_covers !== undefined
          ? normalizeVisibility(newConfig.show_covers, "auto")
          : config.show_covers,
      show_duration:
        newConfig.show_duration !== undefined
          ? normalizeVisibility(newConfig.show_duration, "auto")
          : config.show_duration,
      click_to_play:
        newConfig.click_to_play !== undefined
          ? Boolean(newConfig.click_to_play)
          : config.click_to_play,
    };
    renderView();
  }

  function onStateUpdate(state: AppStateSnapshot) {
    latestState = state;
    renderView();
  }

  function destroy() {
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
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

    const liveConfig: QueueWidgetConfig = {
      ...config,
      ...currentConfig,
      show_header: normalizeVisibility(
        currentConfig.show_header ?? config.show_header,
        "auto"
      ),
      show_covers: normalizeVisibility(
        currentConfig.show_covers ?? config.show_covers,
        "auto"
      ),
      show_duration: normalizeVisibility(
        currentConfig.show_duration ?? config.show_duration,
        "auto"
      ),
    };

    // Mode Selector
    const modeGroup = document.createElement("div");
    modeGroup.innerHTML = `
      <label style="display: block; font-weight: 600; margin-bottom: 6px; font-size: 0.85rem; color: #94a3b8;">Queue View Mode</label>
      <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px;">
        ${[
          { id: "tabs", label: "Tabs" },
          { id: "split", label: "Split Sections" },
          { id: "upcoming_only", label: "Upcoming Only" },
          { id: "history_only", label: "History Only" },
        ]
          .map(
            (m) => `
          <button type="button" data-mode="${m.id}" class="QueueModeBtn" style="padding: 8px; border-radius: 8px; border: 1px solid ${
              liveConfig.mode === m.id ? "#38bdf8" : "rgba(255,255,255,0.12)"
            }; background: ${
              liveConfig.mode === m.id ? "rgba(56, 189, 248, 0.2)" : "rgba(255,255,255,0.06)"
            }; color: #fff; cursor: pointer; font-weight: 600;">
            ${m.label}
          </button>
        `
          )
          .join("")}
      </div>
    `;
    modeGroup.querySelectorAll<HTMLButtonElement>(".QueueModeBtn").forEach((btn) => {
      btn.addEventListener("click", () => {
        liveConfig.mode = btn.dataset.mode as any;
        modeGroup.querySelectorAll<HTMLButtonElement>(".QueueModeBtn").forEach((b) => {
          const active = b === btn;
          b.style.borderColor = active ? "#38bdf8" : "rgba(255,255,255,0.12)";
          b.style.background = active ? "rgba(56, 189, 248, 0.2)" : "rgba(255,255,255,0.06)";
        });
        onChange({ ...liveConfig });
      });
    });
    form.appendChild(modeGroup);

    // Max Items Slider
    const maxGroup = document.createElement("div");
    const currentMax = typeof liveConfig.max_items === "number" ? liveConfig.max_items : 8;
    maxGroup.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
        <label style="font-weight: 600; font-size: 0.85rem; color: #94a3b8;">Max Items</label>
        <span class="MaxItemsBadge" style="font-size: 0.8rem; font-weight: 600; color: #38bdf8;">${currentMax}</span>
      </div>
      <input type="range" min="3" max="15" step="1" value="${currentMax}" style="width: 100%; accent-color: #38bdf8; cursor: pointer;" />
    `;
    const maxRange = maxGroup.querySelector("input")!;
    const maxBadge = maxGroup.querySelector(".MaxItemsBadge")!;
    maxRange.addEventListener("input", () => {
      const val = parseInt(maxRange.value, 10);
      maxBadge.textContent = val.toString();
      liveConfig.max_items = val;
      onChange({ ...liveConfig });
    });
    form.appendChild(maxGroup);

    function addVisibilitySelect(
      label: string,
      key: "show_header" | "show_covers" | "show_duration"
    ) {
      const row = document.createElement("div");
      row.style.cssText = "display: flex; align-items: center; justify-content: space-between; gap: 10px;";
      const curVal = normalizeVisibility(liveConfig[key], "auto");
      row.innerHTML = `
        <span style="font-size: 0.84rem; color: #cbd5e1;">${label}</span>
        <select style="padding: 5px 8px; border-radius: 6px; background: rgba(15, 23, 42, 0.75); border: 1px solid rgba(255, 255, 255, 0.15); color: #fff; font-size: 0.82rem;">
          <option value="auto" ${curVal === "auto" ? "selected" : ""}>Auto (Smart)</option>
          <option value="show" ${curVal === "show" ? "selected" : ""}>Always Show</option>
          <option value="hide" ${curVal === "hide" ? "selected" : ""}>Always Hide</option>
        </select>
      `;
      const sel = row.querySelector("select")!;
      sel.addEventListener("change", () => {
        (liveConfig as any)[key] = sel.value as ElementVisibility;
        onChange({ ...liveConfig });
      });
      form.appendChild(row);
    }

    addVisibilitySelect("Header / Tab Bar", "show_header");
    addVisibilitySelect("Album Cover Thumbnails", "show_covers");
    addVisibilitySelect("Track Duration", "show_duration");

    // Click to Play Toggle
    const clickGroup = document.createElement("div");
    clickGroup.style.cssText = "display: flex; align-items: center; gap: 10px;";
    clickGroup.innerHTML = `
      <input type="checkbox" id="queue_click_chk" ${liveConfig.click_to_play ? "checked" : ""} style="width: 18px; height: 18px; accent-color: #38bdf8; cursor: pointer;" />
      <label for="queue_click_chk" style="cursor: pointer; font-size: 0.85rem; color: #e2e8f0;">Click Item to Play Immediately</label>
    `;
    const clkChk = clickGroup.querySelector<HTMLInputElement>("input")!;
    clkChk.addEventListener("change", () => {
      liveConfig.click_to_play = clkChk.checked;
      onChange({ ...liveConfig });
    });
    form.appendChild(clickGroup);

    return form;
  }

  // Initial render
  renderView();

  return {
    element: container,
    updateConfig,
    onStateUpdate,
    destroy,
    renderSettingsForm,
  };
}

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
