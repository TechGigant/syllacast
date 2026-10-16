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

import type { MountedWidget, WidgetContext } from "./types.ts";

export interface IframeWidgetConfig {
  url: string;
  title: string;
  zoom: number; // 0.5 to 2.0 (default 1.0)
  refresh_interval_sec: number; // 0 = off, or >= 15
  allow_interaction: boolean; // default true
}

/**
 * Validates and sanitizes iframe URLs. Only http: and https: protocols are permitted.
 * Blocks dangerous schemes like javascript:, data:, file:, vbscript:.
 */
export function sanitizeIframeUrl(rawUrl: string): string | null {
  if (!rawUrl || typeof rawUrl !== "string") return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.href;
    }
    return null;
  } catch {
    return null;
  }
}

export function createIframeWidget(
  initialConfig: Record<string, any>,
  _ctx: WidgetContext
): MountedWidget {
  let config: IframeWidgetConfig = {
    url: initialConfig.url || "",
    title: initialConfig.title || "Web Embed",
    zoom: typeof initialConfig.zoom === "number" ? Math.max(0.5, Math.min(2.0, initialConfig.zoom)) : 1.0,
    refresh_interval_sec: typeof initialConfig.refresh_interval_sec === "number" ? initialConfig.refresh_interval_sec : 0,
    allow_interaction: initialConfig.allow_interaction !== false,
  };

  const container = document.createElement("div");
  container.className = "KioskIframeWidget";
  container.style.cssText = `
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    border-radius: inherit;
  `;

  // Shield to absorb pointer events during editing / dragging
  const shield = document.createElement("div");
  shield.className = "WidgetEditShield";
  shield.style.cssText = `
    position: absolute;
    inset: 0;
    z-index: 10;
    display: none;
    background: transparent;
  `;
  container.appendChild(shield);

  const contentArea = document.createElement("div");
  contentArea.className = "KioskIframeContentArea";
  contentArea.style.cssText = `
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
  `;
  container.appendChild(contentArea);

  let refreshTimer: number | null = null;

  function renderView() {
    contentArea.innerHTML = "";
    if (refreshTimer) {
      window.clearInterval(refreshTimer);
      refreshTimer = null;
    }

    const validUrl = sanitizeIframeUrl(config.url);

    if (!validUrl) {
      // Placeholder state
      const placeholder = document.createElement("div");
      placeholder.className = "KioskIframePlaceholder";
      placeholder.style.cssText = `
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-align: center;
        gap: 12px;
        padding: 20px;
        color: rgba(255, 255, 255, 0.7);
        user-select: none;
      `;
      placeholder.innerHTML = `
        <div style="width: 44px; height: 44px; border-radius: 12px; background: rgba(255, 255, 255, 0.08); display: flex; align-items: center; justify-content: center; color: #38bdf8;">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect width="20" height="15" x="2" y="3" rx="2"/><polyline points="2 9 22 9"/><circle cx="5" cy="6" r="1"/><circle cx="8" cy="6" r="1"/>
          </svg>
        </div>
        <div style="font-weight: 600; font-size: 0.95rem; color: #ffffff;">${escapeHtml(config.title || "Web Embed")}</div>
        <div style="font-size: 0.8rem; max-width: 220px; line-height: 1.4; opacity: 0.75;">
          No URL configured. Click <strong style="color: #38bdf8;">⚙</strong> in Edit Mode to set an iframe URL.
        </div>
      `;
      contentArea.appendChild(placeholder);
      return;
    }

    // Active iframe state
    const iframe = document.createElement("iframe");
    iframe.src = validUrl;
    iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-popups");
    iframe.setAttribute("referrerpolicy", "no-referrer");

    const zoom = config.zoom || 1.0;
    const inversePct = (100 / zoom).toFixed(4);

    iframe.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: ${inversePct}%;
      height: ${inversePct}%;
      transform: scale(${zoom});
      transform-origin: 0 0;
      border: none;
      pointer-events: ${config.allow_interaction ? "auto" : "none"};
      background: transparent;
    `;

    contentArea.appendChild(iframe);

    // Auto-refresh interval (>= 15s)
    if (config.refresh_interval_sec && config.refresh_interval_sec >= 15) {
      refreshTimer = window.setInterval(() => {
        try {
          iframe.src = validUrl;
        } catch {
          // Ignore reload error
        }
      }, config.refresh_interval_sec * 1000);
    }
  }

  function updateConfig(newConfig: Record<string, any>) {
    config = {
      url: newConfig.url !== undefined ? newConfig.url : config.url,
      title: newConfig.title !== undefined ? newConfig.title : config.title,
      zoom: typeof newConfig.zoom === "number" ? Math.max(0.5, Math.min(2.0, newConfig.zoom)) : config.zoom,
      refresh_interval_sec: typeof newConfig.refresh_interval_sec === "number" ? newConfig.refresh_interval_sec : config.refresh_interval_sec,
      allow_interaction: newConfig.allow_interaction !== undefined ? Boolean(newConfig.allow_interaction) : config.allow_interaction,
    };
    renderView();
  }

  function destroy() {
    if (refreshTimer) {
      window.clearInterval(refreshTimer);
      refreshTimer = null;
    }
    contentArea.innerHTML = "";
  }

  function renderSettingsForm(
    currentConfig: Record<string, any>,
    onChange: (newConfig: Record<string, any>) => void
  ): HTMLElement {
    const form = document.createElement("div");
    form.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 16px;
      font-size: 0.9rem;
      color: #e2e8f0;
    `;

    const liveConfig = { ...config, ...currentConfig };

    // Title Field
    const titleGroup = document.createElement("div");
    titleGroup.innerHTML = `
      <label style="display: block; font-weight: 600; margin-bottom: 6px; font-size: 0.85rem; color: #94a3b8;">Widget Title</label>
      <input type="text" class="sl-input" value="${escapeHtml(liveConfig.title || "")}" style="width: 100%; box-sizing: border-box; padding: 8px 12px; border-radius: 8px; background: rgba(255, 255, 255, 0.07); border: 1px solid rgba(255, 255, 255, 0.15); color: #fff; outline: none;" placeholder="Web Embed" />
    `;
    const titleInput = titleGroup.querySelector("input")!;
    titleInput.addEventListener("input", () => {
      liveConfig.title = titleInput.value;
      onChange({ ...liveConfig });
    });
    form.appendChild(titleGroup);

    // URL Field
    const urlGroup = document.createElement("div");
    urlGroup.innerHTML = `
      <label style="display: block; font-weight: 600; margin-bottom: 6px; font-size: 0.85rem; color: #94a3b8;">Embed URL (HTTP/HTTPS only)</label>
      <input type="url" class="sl-input" value="${escapeHtml(liveConfig.url || "")}" style="width: 100%; box-sizing: border-box; padding: 8px 12px; border-radius: 8px; background: rgba(255, 255, 255, 0.07); border: 1px solid rgba(255, 255, 255, 0.15); color: #fff; outline: none;" placeholder="https://example.com/dashboard" />
    `;
    const urlInput = urlGroup.querySelector("input")!;
    urlInput.addEventListener("input", () => {
      liveConfig.url = urlInput.value;
      onChange({ ...liveConfig });
    });
    form.appendChild(urlGroup);

    // Zoom Field
    const zoomGroup = document.createElement("div");
    const currentZoom = typeof liveConfig.zoom === "number" ? liveConfig.zoom : 1.0;
    zoomGroup.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
        <label style="font-weight: 600; font-size: 0.85rem; color: #94a3b8;">Content Zoom</label>
        <span class="ZoomValueBadge" style="font-size: 0.8rem; font-weight: 600; color: #38bdf8;">${currentZoom.toFixed(2)}x</span>
      </div>
      <input type="range" min="0.5" max="2.0" step="0.05" value="${currentZoom}" style="width: 100%; accent-color: #38bdf8; cursor: pointer;" />
    `;
    const zoomRange = zoomGroup.querySelector("input")!;
    const zoomBadge = zoomGroup.querySelector(".ZoomValueBadge")!;
    zoomRange.addEventListener("input", () => {
      const z = parseFloat(zoomRange.value);
      zoomBadge.textContent = `${z.toFixed(2)}x`;
      liveConfig.zoom = z;
      onChange({ ...liveConfig });
    });
    form.appendChild(zoomGroup);

    // Refresh Interval Field
    const refreshGroup = document.createElement("div");
    const curInterval = liveConfig.refresh_interval_sec || 0;
    refreshGroup.innerHTML = `
      <label style="display: block; font-weight: 600; margin-bottom: 6px; font-size: 0.85rem; color: #94a3b8;">Auto-Refresh Interval (Seconds, 0 = off, min 15)</label>
      <input type="number" min="0" step="15" value="${curInterval}" style="width: 100%; box-sizing: border-box; padding: 8px 12px; border-radius: 8px; background: rgba(255, 255, 255, 0.07); border: 1px solid rgba(255, 255, 255, 0.15); color: #fff; outline: none;" placeholder="0" />
    `;
    const refreshInput = refreshGroup.querySelector("input")!;
    refreshInput.addEventListener("input", () => {
      const val = parseInt(refreshInput.value, 10) || 0;
      liveConfig.refresh_interval_sec = val < 15 ? 0 : val;
      onChange({ ...liveConfig });
    });
    form.appendChild(refreshGroup);

    // Allow Interaction Toggle
    const toggleGroup = document.createElement("div");
    toggleGroup.style.cssText = "display: flex; align-items: center; gap: 10px; margin-top: 4px;";
    toggleGroup.innerHTML = `
      <input type="checkbox" id="iframe_interaction_chk" ${liveConfig.allow_interaction ? "checked" : ""} style="width: 18px; height: 18px; accent-color: #38bdf8; cursor: pointer;" />
      <label for="iframe_interaction_chk" style="cursor: pointer; font-size: 0.85rem; color: #e2e8f0;">Allow Touch & Pointer Interaction</label>
    `;
    const chk = toggleGroup.querySelector("input")!;
    chk.addEventListener("change", () => {
      liveConfig.allow_interaction = chk.checked;
      onChange({ ...liveConfig });
    });
    form.appendChild(toggleGroup);

    return form;
  }

  // Initial render
  renderView();

  return {
    element: container,
    updateConfig,
    destroy,
    renderSettingsForm,
  };
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
