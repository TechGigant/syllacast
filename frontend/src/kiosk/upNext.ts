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

import type { QueueItemDto } from "../bridge/spotifyPlayer.ts";

export interface UpNextWidgetConfig {
  layout_mode: "auto" | "compact" | "standard" | "multi_track";
  show_cover: "auto" | "show" | "hide" | boolean;
  show_header: "auto" | "show" | "hide" | boolean;
  show_artist: "auto" | "show" | "hide" | boolean;
  alignment: "stretch" | "left" | "center" | "right";
}

export interface KioskUpNextController {
  element: HTMLElement;
  update: (queue: QueueItemDto[] | undefined) => void;
  destroy: () => void;
  updateConfig: (newConfig: Record<string, any>) => void;
  renderSettingsForm: (
    currentConfig: Record<string, any>,
    onChange: (newConfig: Record<string, any>) => void
  ) => HTMLElement;
}

export function createKioskUpNext(
  initialConfig: Record<string, any> = {}
): KioskUpNextController {
  let config: UpNextWidgetConfig = {
    layout_mode: ["auto", "compact", "standard", "multi_track"].includes(
      initialConfig.layout_mode
    )
      ? initialConfig.layout_mode
      : "auto",
    show_cover:
      initialConfig.show_cover !== undefined
        ? initialConfig.show_cover
        : "auto",
    show_header:
      initialConfig.show_header !== undefined
        ? initialConfig.show_header
        : "auto",
    show_artist:
      initialConfig.show_artist !== undefined
        ? initialConfig.show_artist
        : "auto",
    alignment: ["stretch", "left", "center", "right"].includes(
      initialConfig.alignment
    )
      ? initialConfig.alignment
      : "stretch",
  };

  const cardEl = document.createElement("div");
  cardEl.className = "KioskUpNext sl-glass--liquid";
  cardEl.style.cssText = `
    position: absolute;
    bottom: 34px;
    right: 28px;
    z-index: 1000;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 8px;
    padding: 8px 14px 8px 10px;
    border-radius: 14px;
    backdrop-filter: blur(22px) saturate(160%) brightness(1.08);
    -webkit-backdrop-filter: blur(22px) saturate(160%) brightness(1.08);
    background: rgba(255, 255, 255, 0.14);
    border: 1px solid rgba(255, 255, 255, 0.22);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.32);
    color: #ffffff;
    user-select: none;
    max-width: 280px;
    opacity: 0;
    transform: translateY(12px);
    pointer-events: none;
    transition: opacity 0.4s ease, transform 0.4s ease;
    overflow: hidden;
  `;

  // Dedicated inner content container so re-rendering NEVER wipes out
  // .WidgetEditOverlay, .WidgetEditShield, or .WidgetResizeHandle attached to cardEl!
  const contentEl = document.createElement("div");
  contentEl.className = "KioskUpNextContent";
  contentEl.style.cssText = `
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 8px;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
  `;
  cardEl.appendChild(contentEl);

  let latestQueue: QueueItemDto[] | undefined = undefined;
  let observedW = 0;
  let observedH = 0;

  function resolveEffectiveLayout() {
    const rows =
      parseInt(
        cardEl.dataset.gridH ||
          cardEl.style.getPropertyValue("--widget-rows") ||
          "1",
        10
      ) || 1;

    let effectiveMode = config.layout_mode;
    if (effectiveMode === "auto") {
      if (rows >= 3 || observedH >= 150) {
        effectiveMode = "multi_track";
      } else {
        effectiveMode = "standard";
      }
    }

    let showCover = effectiveMode !== "compact";
    if (config.show_cover === "show" || config.show_cover === true)
      showCover = true;
    if (config.show_cover === "hide" || config.show_cover === false)
      showCover = false;

    let showHeader = effectiveMode !== "compact";
    if (config.show_header === "show" || config.show_header === true)
      showHeader = true;
    if (config.show_header === "hide" || config.show_header === false)
      showHeader = false;

    let showArtist = true;
    if (config.show_artist === "show" || config.show_artist === true)
      showArtist = true;
    if (config.show_artist === "hide" || config.show_artist === false)
      showArtist = false;

    const maxTracks =
      effectiveMode === "multi_track"
        ? Math.max(2, Math.min(5, rows >= 4 ? 4 : 3))
        : 1;

    cardEl.dataset.upnextMode = effectiveMode;
    cardEl.dataset.upnextAlign = config.alignment;
    cardEl.classList.toggle(
      "KioskUpNext--mode-multi_track",
      effectiveMode === "multi_track"
    );

    return { effectiveMode, showCover, showHeader, showArtist, maxTracks };
  }

  function render() {
    const { effectiveMode, showCover, showHeader, showArtist, maxTracks } =
      resolveEffectiveLayout();

    const hasRealQueue =
      Boolean(latestQueue && latestQueue.length > 0 && latestQueue[0]?.title);

    if (!hasRealQueue) {
      const placeholderCount = effectiveMode === "multi_track" ? Math.min(3, maxTracks) : 1;
      let rowsHtml = "";
      for (let i = 0; i < placeholderCount; i++) {
        rowsHtml += `
          <div style="display: flex; align-items: center; gap: 12px; min-width: 0; width: 100%; opacity: ${i === 0 ? 1 : 0.65};">
            ${
              showCover
                ? `<div class="${i === 0 ? "KioskUpNextThumb" : ""}" style="width: 44px; height: 44px; border-radius: 8px; background: rgba(255,255,255,0.12); display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: rgba(255,255,255,0.5);">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
                  </div>`
                : ""
            }
            <div style="display: flex; flex-direction: column; overflow: hidden; min-width: 0; flex: 1;">
              ${
                showHeader && placeholderCount === 1 && i === 0
                  ? `<span class="KioskUpNextHeader" style="font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.62; margin-bottom: 2px;">Up Next</span>`
                  : ""
              }
              <span class="${i === 0 ? "KioskUpNextTitle" : ""}" style="font-size: 0.85rem; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${
                i === 0 ? "No upcoming tracks" : `Upcoming Track ${i + 1}`
              }</span>
              ${
                showArtist
                  ? `<span class="${i === 0 ? "KioskUpNextArtist" : ""}" style="font-size: 0.75rem; font-weight: 600; opacity: 0.72; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${
                      i === 0 ? "Queue is empty" : "Artist Preview"
                    }</span>`
                  : ""
              }
            </div>
          </div>
        `;
      }
      contentEl.innerHTML = `
        ${
          showHeader && placeholderCount > 1
            ? `<div class="KioskUpNextHeader" style="font-size: 0.68rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.62; flex-shrink: 0;">Up Next</div>`
            : ""
        }
        ${rowsHtml}
      `;
      cardEl.style.opacity = "0";
      cardEl.style.transform = "translateY(12px)";
      cardEl.style.pointerEvents = "none";
      return;
    }

    const items = latestQueue!.slice(0, maxTracks);
    contentEl.innerHTML = "";

    if (showHeader && items.length > 1) {
      const topLabel = document.createElement("div");
      topLabel.className = "KioskUpNextHeader";
      topLabel.style.cssText =
        "font-size: 0.68rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.62; flex-shrink: 0;";
      topLabel.textContent = `Up Next · ${latestQueue!.length}`;
      contentEl.appendChild(topLabel);
    }

    items.forEach((item, idx) => {
      const row = document.createElement("div");
      row.style.cssText = `
        display: flex;
        align-items: center;
        gap: 12px;
        min-width: 0;
        width: 100%;
      `;

      const thumb = document.createElement("img");
      if (idx === 0) thumb.className = "KioskUpNextThumb";
      thumb.alt = "";
      thumb.style.cssText = `
        width: 44px;
        height: 44px;
        border-radius: 8px;
        object-fit: cover;
        background: rgba(255,255,255,0.08);
        flex-shrink: 0;
      `;
      if (showCover && item.cover_url) {
        thumb.src = item.cover_url;
        thumb.style.display = "block";
      } else {
        thumb.style.display = "none";
      }
      row.appendChild(thumb);

      const textCol = document.createElement("div");
      textCol.style.cssText =
        "display: flex; flex-direction: column; overflow: hidden; min-width: 0; flex: 1;";

      if (showHeader && items.length === 1 && idx === 0) {
        const headerSpan = document.createElement("span");
        headerSpan.className = "KioskUpNextHeader";
        headerSpan.style.cssText =
          "font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.62; margin-bottom: 2px;";
        headerSpan.textContent = "Up Next";
        textCol.appendChild(headerSpan);
      }

      const titleSpan = document.createElement("span");
      if (idx === 0) titleSpan.className = "KioskUpNextTitle";
      titleSpan.style.cssText =
        "font-size: 0.85rem; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;";
      titleSpan.textContent = item.title;
      textCol.appendChild(titleSpan);

      if (showArtist) {
        const artistSpan = document.createElement("span");
        if (idx === 0) artistSpan.className = "KioskUpNextArtist";
        artistSpan.style.cssText =
          "font-size: 0.75rem; font-weight: 600; opacity: 0.72; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;";
        artistSpan.textContent = item.artist || "";
        textCol.appendChild(artistSpan);
      }

      row.appendChild(textCol);
      contentEl.appendChild(row);
    });

    cardEl.style.opacity = "1";
    cardEl.style.transform = "translateY(0)";
    cardEl.style.pointerEvents = "auto";
  }

  function update(queue: QueueItemDto[] | undefined) {
    latestQueue = queue;
    render();
  }

  const resizeObserver =
    typeof ResizeObserver !== "undefined"
      ? new ResizeObserver((entries) => {
          for (const entry of entries) {
            const w = entry.contentRect.width;
            const h = entry.contentRect.height;
            if (Math.abs(w - observedW) < 1 && Math.abs(h - observedH) < 1) {
              return;
            }
            observedW = w;
            observedH = h;
          }
          render();
        })
      : null;
  resizeObserver?.observe(cardEl);

  update(undefined);

  function updateConfig(newConfig: Record<string, any>) {
    config = {
      layout_mode: ["auto", "compact", "standard", "multi_track"].includes(
        newConfig.layout_mode
      )
        ? newConfig.layout_mode
        : config.layout_mode,
      show_cover:
        newConfig.show_cover !== undefined
          ? newConfig.show_cover
          : config.show_cover,
      show_header:
        newConfig.show_header !== undefined
          ? newConfig.show_header
          : config.show_header,
      show_artist:
        newConfig.show_artist !== undefined
          ? newConfig.show_artist
          : config.show_artist,
      alignment: ["stretch", "left", "center", "right"].includes(
        newConfig.alignment
      )
        ? newConfig.alignment
        : config.alignment,
    };
    render();
  }

  function renderSettingsForm(
    currentConfig: Record<string, any>,
    onChange: (newConfig: Record<string, any>) => void
  ): HTMLElement {
    const form = document.createElement("div");
    form.style.cssText =
      "display: flex; flex-direction: column; gap: 14px; font-size: 0.88rem; color: #e2e8f0;";

    const live: UpNextWidgetConfig = { ...config, ...currentConfig };

    const modeGroup = document.createElement("div");
    modeGroup.className = "StudioFormGroup";
    modeGroup.innerHTML = `
      <label class="StudioFormLabel">Display Layout Mode</label>
      <select class="StudioFormSelect UpNextModeSelect">
        <option value="auto" ${live.layout_mode === "auto" ? "selected" : ""}>Auto (Smart Responsive by Size)</option>
        <option value="compact" ${live.layout_mode === "compact" ? "selected" : ""}>Compact Pill (Title & Artist only)</option>
        <option value="standard" ${live.layout_mode === "standard" ? "selected" : ""}>Standard (Single Track + Cover)</option>
        <option value="multi_track" ${live.layout_mode === "multi_track" ? "selected" : ""}>Expanded Multi-Track Preview</option>
      </select>
    `;
    const modeSelect =
      modeGroup.querySelector<HTMLSelectElement>(".UpNextModeSelect")!;
    modeSelect.addEventListener("change", () => {
      live.layout_mode = modeSelect.value as any;
      onChange({ ...live });
    });
    form.appendChild(modeGroup);

    const alignGroup = document.createElement("div");
    alignGroup.className = "StudioFormGroup";
    alignGroup.innerHTML = `
      <label class="StudioFormLabel">Cell Alignment</label>
      <select class="StudioFormSelect UpNextAlignSelect">
        <option value="stretch" ${live.alignment === "stretch" ? "selected" : ""}>Stretch to Fill Grid Box (Recommended)</option>
        <option value="left" ${live.alignment === "left" ? "selected" : ""}>Compact Card — Align Left</option>
        <option value="center" ${live.alignment === "center" ? "selected" : ""}>Compact Card — Align Center</option>
        <option value="right" ${live.alignment === "right" ? "selected" : ""}>Compact Card — Align Right</option>
      </select>
    `;
    const alignSelect =
      alignGroup.querySelector<HTMLSelectElement>(".UpNextAlignSelect")!;
    alignSelect.addEventListener("change", () => {
      live.alignment = alignSelect.value as any;
      onChange({ ...live });
    });
    form.appendChild(alignGroup);

    const createTriStateRow = (
      label: string,
      key: "show_cover" | "show_header" | "show_artist"
    ) => {
      const row = document.createElement("div");
      row.className = "StudioToggleRow";
      const val =
        live[key] === true
          ? "show"
          : live[key] === false
          ? "hide"
          : live[key] || "auto";
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
        (live as any)[key] = sel.value;
        onChange({ ...live });
      });
      return row;
    };

    form.appendChild(createTriStateRow("Album Cover Art", "show_cover"));
    form.appendChild(createTriStateRow("'Up Next' Label", "show_header"));
    form.appendChild(createTriStateRow("Artist Name", "show_artist"));

    return form;
  }

  return {
    element: cardEl,
    update,
    destroy: () => {
      resizeObserver?.disconnect();
      cardEl.remove();
    },
    updateConfig,
    renderSettingsForm,
  };
}
