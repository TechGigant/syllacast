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
import { formatWifiQrPayload, renderQrSvg } from "./qrEncoder.ts";

export interface NoteWidgetConfig {
  mode: "note" | "wifi_qr" | "url_qr";
  title: string;
  body_text: string;
  text_align: "left" | "center" | "right";
  wifi_ssid: string;
  wifi_password: string;
  wifi_encryption: "WPA" | "WEP" | "nopass";
  wifi_hidden: boolean;
  show_password_text: boolean;
  qr_url: string;
}

export function createNoteWidget(
  initialConfig: Record<string, any>,
  _ctx: WidgetContext
): MountedWidget {
  let config: NoteWidgetConfig = {
    mode: ["note", "wifi_qr", "url_qr"].includes(initialConfig.mode)
      ? initialConfig.mode
      : "note",
    title: initialConfig.title !== undefined ? initialConfig.title : "Welcome",
    body_text:
      initialConfig.body_text !== undefined
        ? initialConfig.body_text
        : "Enjoy the music!",
    text_align: ["left", "center", "right"].includes(initialConfig.text_align)
      ? initialConfig.text_align
      : "center",
    wifi_ssid: initialConfig.wifi_ssid || "",
    wifi_password: initialConfig.wifi_password || "",
    wifi_encryption: ["WPA", "WEP", "nopass"].includes(
      initialConfig.wifi_encryption
    )
      ? initialConfig.wifi_encryption
      : "WPA",
    wifi_hidden: Boolean(initialConfig.wifi_hidden),
    show_password_text: initialConfig.show_password_text !== false,
    qr_url: initialConfig.qr_url || "",
  };

  const container = document.createElement("div");
  container.className = "KioskNoteWidget";
  container.style.cssText = `
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: clamp(10px, min(4cqw, 5cqh), 24px);
    box-sizing: border-box;
    border-radius: inherit;
    color: #ffffff;
    user-select: none;
  `;

  function renderView() {
    container.innerHTML = "";

    if (config.mode === "wifi_qr") {
      renderWifiMode();
    } else if (config.mode === "url_qr") {
      renderUrlMode();
    } else {
      renderNoteMode();
    }
  }

  function renderNoteMode() {
    container.style.textAlign = config.text_align;
    container.style.justifyContent = "center";

    const titleHtml = config.title
      ? `<div style="font-size: clamp(0.95rem, min(6cqw, 11cqh), 1.85rem); font-weight: 800; letter-spacing: -0.01em; margin-bottom: clamp(4px, 2.5cqh, 12px); color: #ffffff;">${escapeHtml(
          config.title
        )}</div>`
      : "";

    const bodyHtml = config.body_text
      ? `<div style="font-size: clamp(0.8rem, min(4.5cqw, 8.5cqh), 1.35rem); line-height: 1.45; opacity: 0.88; max-width: 92%;">${renderSafeMarkdown(
          config.body_text
        )}</div>`
      : "";

    container.innerHTML = `
      <div style="display: flex; flex-direction: column; width: 100%; align-items: ${
        config.text_align === "left"
          ? "flex-start"
          : config.text_align === "right"
          ? "flex-end"
          : "center"
      };">
        ${titleHtml}
        ${bodyHtml}
      </div>
    `;
  }

  function renderWifiMode() {
    container.style.textAlign = "center";
    container.style.justifyContent = "center";

    if (!config.wifi_ssid.trim()) {
      container.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; gap: clamp(6px, 2.5cqh, 12px); opacity: 0.78;">
          <svg style="width: clamp(24px, min(12cqw, 16cqh), 44px); height: clamp(24px, min(12cqw, 16cqh), 44px);" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/>
          </svg>
          <div style="font-weight: 700; font-size: clamp(0.85rem, min(5cqw, 8cqh), 1.25rem);">Guest Wi-Fi</div>
          <div style="font-size: clamp(0.72rem, min(3.8cqw, 6cqh), 0.95rem); opacity: 0.8; max-width: 90%;">Open widget settings (⚙) to enter Wi-Fi network name &amp; password</div>
        </div>
      `;
      return;
    }

    const payload = formatWifiQrPayload(
      config.wifi_ssid,
      config.wifi_password,
      config.wifi_encryption,
      config.wifi_hidden
    );

    let qrSvg = "";
    try {
      qrSvg = renderQrSvg(payload);
    } catch {
      qrSvg = `<div style="color: #f87171; font-size: 0.8rem;">QR encoding error</div>`;
    }

    container.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: clamp(4px, 2.2cqh, 12px); width: 100%; height: 100%;">
        ${
          config.title
            ? `<div style="font-size: clamp(0.82rem, min(5cqw, 8cqh), 1.35rem); font-weight: 700; color: #ffffff; line-height: 1.15;">${escapeHtml(
                config.title
              )}</div>`
            : ""
        }
        <div style="width: clamp(58px, min(54cqw, 52cqh), 240px); height: clamp(58px, min(54cqw, 52cqh), 240px); border-radius: clamp(8px, 3cqw, 16px); overflow: hidden; box-shadow: 0 6px 20px rgba(0,0,0,0.4); flex-shrink: 0; background: #ffffff; padding: clamp(3px, 1.2cqw, 8px); box-sizing: border-box;">
          ${qrSvg}
        </div>
        <div style="display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 0; max-width: 100%;">
          <span style="font-size: clamp(0.75rem, min(4.4cqw, 7cqh), 1.15rem); font-weight: 700; color: #38bdf8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%;">${escapeHtml(
            config.wifi_ssid
          )}</span>
          ${
            config.show_password_text && config.wifi_password
              ? `<span style="font-size: clamp(0.66rem, min(3.6cqw, 5.8cqh), 0.95rem); opacity: 0.78; font-family: monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%;">Pass: ${escapeHtml(
                  config.wifi_password
                )}</span>`
              : ""
          }
        </div>
      </div>
    `;
  }

  function renderUrlMode() {
    container.style.textAlign = "center";
    container.style.justifyContent = "center";

    if (!config.qr_url.trim()) {
      container.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; gap: clamp(6px, 2.5cqh, 12px); opacity: 0.78;">
          <svg style="width: clamp(24px, min(12cqw, 16cqh), 44px); height: clamp(24px, min(12cqw, 16cqh), 44px);" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
          </svg>
          <div style="font-weight: 700; font-size: clamp(0.85rem, min(5cqw, 8cqh), 1.25rem);">QR Link</div>
          <div style="font-size: clamp(0.72rem, min(3.8cqw, 6cqh), 0.95rem); opacity: 0.8; max-width: 90%;">Open widget settings (⚙) to enter target URL</div>
        </div>
      `;
      return;
    }

    let qrSvg = "";
    try {
      qrSvg = renderQrSvg(config.qr_url);
    } catch {
      qrSvg = `<div style="color: #f87171; font-size: 0.8rem;">QR encoding error</div>`;
    }

    container.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: clamp(4px, 2.2cqh, 12px); width: 100%; height: 100%;">
        ${
          config.title
            ? `<div style="font-size: clamp(0.82rem, min(5cqw, 8cqh), 1.35rem); font-weight: 700; color: #ffffff; line-height: 1.15;">${escapeHtml(
                config.title
              )}</div>`
            : ""
        }
        <div style="width: clamp(58px, min(54cqw, 52cqh), 240px); height: clamp(58px, min(54cqw, 52cqh), 240px); border-radius: clamp(8px, 3cqw, 16px); overflow: hidden; box-shadow: 0 6px 20px rgba(0,0,0,0.4); flex-shrink: 0; background: #ffffff; padding: clamp(3px, 1.2cqw, 8px); box-sizing: border-box;">
          ${qrSvg}
        </div>
        <div style="font-size: clamp(0.68rem, min(3.8cqw, 6cqh), 0.95rem); opacity: 0.78; max-width: 92%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
          ${escapeHtml(config.qr_url)}
        </div>
      </div>
    `;
  }

  function updateConfig(newConfig: Record<string, any>) {
    config = {
      mode: ["note", "wifi_qr", "url_qr"].includes(newConfig.mode)
        ? newConfig.mode
        : config.mode,
      title: newConfig.title !== undefined ? newConfig.title : config.title,
      body_text:
        newConfig.body_text !== undefined ? newConfig.body_text : config.body_text,
      text_align: ["left", "center", "right"].includes(newConfig.text_align)
        ? newConfig.text_align
        : config.text_align,
      wifi_ssid: newConfig.wifi_ssid !== undefined ? newConfig.wifi_ssid : config.wifi_ssid,
      wifi_password:
        newConfig.wifi_password !== undefined
          ? newConfig.wifi_password
          : config.wifi_password,
      wifi_encryption: ["WPA", "WEP", "nopass"].includes(
        newConfig.wifi_encryption
      )
        ? newConfig.wifi_encryption
        : config.wifi_encryption,
      wifi_hidden:
        newConfig.wifi_hidden !== undefined
          ? Boolean(newConfig.wifi_hidden)
          : config.wifi_hidden,
      show_password_text:
        newConfig.show_password_text !== undefined
          ? Boolean(newConfig.show_password_text)
          : config.show_password_text,
      qr_url: newConfig.qr_url !== undefined ? newConfig.qr_url : config.qr_url,
    };
    renderView();
  }

  function destroy() {
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
      gap: 16px;
      font-size: 0.9rem;
      color: #e2e8f0;
    `;

    const liveConfig = { ...config, ...currentConfig };

    // Mode Selector
    const modeGroup = document.createElement("div");
    modeGroup.innerHTML = `
      <label style="display: block; font-weight: 600; margin-bottom: 6px; font-size: 0.85rem; color: #94a3b8;">Card Mode</label>
      <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;">
        ${[
          { id: "note", label: "Note" },
          { id: "wifi_qr", label: "Guest Wi-Fi" },
          { id: "url_qr", label: "URL Link" },
        ]
          .map(
            (m) => `
          <button type="button" data-mode="${m.id}" class="NoteModeBtn" style="padding: 8px; border-radius: 8px; border: 1px solid ${
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
    form.appendChild(modeGroup);

    // Dynamic field container
    const dynamicContainer = document.createElement("div");
    dynamicContainer.style.cssText = "display: flex; flex-direction: column; gap: 14px;";
    form.appendChild(dynamicContainer);

    function buildFields() {
      dynamicContainer.innerHTML = "";

      // Title (common)
      const titleGroup = document.createElement("div");
      titleGroup.innerHTML = `
        <label style="display: block; font-weight: 600; margin-bottom: 6px; font-size: 0.85rem; color: #94a3b8;">Title</label>
        <input type="text" class="NoteTitleInput" value="${escapeHtml(
          liveConfig.title
        )}" style="width: 100%; box-sizing: border-box; padding: 8px 12px; border-radius: 8px; background: rgba(255, 255, 255, 0.07); border: 1px solid rgba(255, 255, 255, 0.15); color: #fff; outline: none;" placeholder="Title..." />
      `;
      const titleInput = titleGroup.querySelector<HTMLInputElement>(".NoteTitleInput")!;
      titleInput.addEventListener("input", () => {
        liveConfig.title = titleInput.value;
        onChange({ ...liveConfig });
      });
      dynamicContainer.appendChild(titleGroup);

      if (liveConfig.mode === "note") {
        // Body text textarea
        const bodyGroup = document.createElement("div");
        bodyGroup.innerHTML = `
          <label style="display: block; font-weight: 600; margin-bottom: 6px; font-size: 0.85rem; color: #94a3b8;">Message (supports **bold** and *italic*)</label>
          <textarea class="NoteBodyInput" rows="4" style="width: 100%; box-sizing: border-box; padding: 8px 12px; border-radius: 8px; background: rgba(255, 255, 255, 0.07); border: 1px solid rgba(255, 255, 255, 0.15); color: #fff; outline: none; resize: vertical;">${escapeHtml(
            liveConfig.body_text
          )}</textarea>
        `;
        const bodyInput = bodyGroup.querySelector<HTMLTextAreaElement>(".NoteBodyInput")!;
        bodyInput.addEventListener("input", () => {
          liveConfig.body_text = bodyInput.value;
          onChange({ ...liveConfig });
        });
        dynamicContainer.appendChild(bodyGroup);

        // Alignment buttons
        const alignGroup = document.createElement("div");
        alignGroup.innerHTML = `
          <label style="display: block; font-weight: 600; margin-bottom: 6px; font-size: 0.85rem; color: #94a3b8;">Text Alignment</label>
          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;">
            ${["left", "center", "right"]
              .map(
                (a) => `
              <button type="button" data-align="${a}" class="AlignBtn" style="padding: 6px; border-radius: 6px; border: 1px solid ${
                  liveConfig.text_align === a ? "#38bdf8" : "rgba(255,255,255,0.12)"
                }; background: ${
                  liveConfig.text_align === a ? "rgba(56, 189, 248, 0.2)" : "rgba(255,255,255,0.06)"
                }; color: #fff; cursor: pointer; text-transform: capitalize;">
                ${a}
              </button>
            `
              )
              .join("")}
          </div>
        `;
        alignGroup.querySelectorAll<HTMLButtonElement>(".AlignBtn").forEach((btn) => {
          btn.addEventListener("click", () => {
            liveConfig.text_align = btn.dataset.align as any;
            alignGroup.querySelectorAll<HTMLButtonElement>(".AlignBtn").forEach((b) => {
              const active = b === btn;
              b.style.borderColor = active ? "#38bdf8" : "rgba(255,255,255,0.12)";
              b.style.background = active ? "rgba(56, 189, 248, 0.2)" : "rgba(255,255,255,0.06)";
            });
            onChange({ ...liveConfig });
          });
        });
        dynamicContainer.appendChild(alignGroup);
      } else if (liveConfig.mode === "wifi_qr") {
        // Wi-Fi SSID
        const ssidGroup = document.createElement("div");
        ssidGroup.innerHTML = `
          <label style="display: block; font-weight: 600; margin-bottom: 6px; font-size: 0.85rem; color: #94a3b8;">Wi-Fi Network Name (SSID)</label>
          <input type="text" class="SsidInput" value="${escapeHtml(
            liveConfig.wifi_ssid
          )}" style="width: 100%; box-sizing: border-box; padding: 8px 12px; border-radius: 8px; background: rgba(255, 255, 255, 0.07); border: 1px solid rgba(255, 255, 255, 0.15); color: #fff; outline: none;" placeholder="MyGuestWiFi" />
        `;
        const ssidInput = ssidGroup.querySelector<HTMLInputElement>(".SsidInput")!;
        ssidInput.addEventListener("input", () => {
          liveConfig.wifi_ssid = ssidInput.value;
          onChange({ ...liveConfig });
        });
        dynamicContainer.appendChild(ssidGroup);

        // Wi-Fi Password
        const passGroup = document.createElement("div");
        passGroup.innerHTML = `
          <label style="display: block; font-weight: 600; margin-bottom: 6px; font-size: 0.85rem; color: #94a3b8;">Password</label>
          <input type="text" class="PassInput" value="${escapeHtml(
            liveConfig.wifi_password
          )}" style="width: 100%; box-sizing: border-box; padding: 8px 12px; border-radius: 8px; background: rgba(255, 255, 255, 0.07); border: 1px solid rgba(255, 255, 255, 0.15); color: #fff; outline: none;" placeholder="Wi-Fi Password" />
        `;
        const passInput = passGroup.querySelector<HTMLInputElement>(".PassInput")!;
        passInput.addEventListener("input", () => {
          liveConfig.wifi_password = passInput.value;
          onChange({ ...liveConfig });
        });
        dynamicContainer.appendChild(passGroup);

        // Encryption Dropdown
        const encGroup = document.createElement("div");
        encGroup.innerHTML = `
          <label style="display: block; font-weight: 600; margin-bottom: 6px; font-size: 0.85rem; color: #94a3b8;">Security Type</label>
          <select class="EncSelect" style="width: 100%; box-sizing: border-box; padding: 8px 12px; border-radius: 8px; background: rgba(255, 255, 255, 0.07); border: 1px solid rgba(255, 255, 255, 0.15); color: #fff; outline: none; cursor: pointer;">
            <option value="WPA" ${liveConfig.wifi_encryption === "WPA" ? "selected" : ""}>WPA / WPA2 / WPA3</option>
            <option value="WEP" ${liveConfig.wifi_encryption === "WEP" ? "selected" : ""}>WEP</option>
            <option value="nopass" ${liveConfig.wifi_encryption === "nopass" ? "selected" : ""}>No Password (Open)</option>
          </select>
        `;
        const encSelect = encGroup.querySelector<HTMLSelectElement>(".EncSelect")!;
        encSelect.addEventListener("change", () => {
          liveConfig.wifi_encryption = encSelect.value as any;
          onChange({ ...liveConfig });
        });
        dynamicContainer.appendChild(encGroup);

        // Checkbox toggles: Show Password & Hidden
        const togglesGroup = document.createElement("div");
        togglesGroup.style.cssText = "display: flex; flex-direction: column; gap: 8px; margin-top: 4px;";
        togglesGroup.innerHTML = `
          <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; font-size: 0.85rem;">
            <input type="checkbox" id="show_pass_chk" ${liveConfig.show_password_text ? "checked" : ""} style="width: 18px; height: 18px; accent-color: #38bdf8;" />
            Show Password in Plaintext Below QR
          </label>
          <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; font-size: 0.85rem;">
            <input type="checkbox" id="hidden_ssid_chk" ${liveConfig.wifi_hidden ? "checked" : ""} style="width: 18px; height: 18px; accent-color: #38bdf8;" />
            Hidden Network (SSID Not Broadcasting)
          </label>
        `;
        const spChk = togglesGroup.querySelector<HTMLInputElement>("#show_pass_chk")!;
        const hdChk = togglesGroup.querySelector<HTMLInputElement>("#hidden_ssid_chk")!;
        spChk.addEventListener("change", () => {
          liveConfig.show_password_text = spChk.checked;
          onChange({ ...liveConfig });
        });
        hdChk.addEventListener("change", () => {
          liveConfig.wifi_hidden = hdChk.checked;
          onChange({ ...liveConfig });
        });
        dynamicContainer.appendChild(togglesGroup);
      } else {
        // url_qr
        const urlGroup = document.createElement("div");
        urlGroup.innerHTML = `
          <label style="display: block; font-weight: 600; margin-bottom: 6px; font-size: 0.85rem; color: #94a3b8;">Target URL (e.g. Spotify playlist, menu, link)</label>
          <input type="url" class="UrlInput" value="${escapeHtml(
            liveConfig.qr_url
          )}" style="width: 100%; box-sizing: border-box; padding: 8px 12px; border-radius: 8px; background: rgba(255, 255, 255, 0.07); border: 1px solid rgba(255, 255, 255, 0.15); color: #fff; outline: none;" placeholder="https://example.com" />
        `;
        const urlInput = urlGroup.querySelector<HTMLInputElement>(".UrlInput")!;
        urlInput.addEventListener("input", () => {
          liveConfig.qr_url = urlInput.value;
          onChange({ ...liveConfig });
        });
        dynamicContainer.appendChild(urlGroup);
      }
    }

    modeGroup.querySelectorAll<HTMLButtonElement>(".NoteModeBtn").forEach((btn) => {
      btn.addEventListener("click", () => {
        liveConfig.mode = btn.dataset.mode as any;
        modeGroup.querySelectorAll<HTMLButtonElement>(".NoteModeBtn").forEach((b) => {
          const active = b === btn;
          b.style.borderColor = active ? "#38bdf8" : "rgba(255,255,255,0.12)";
          b.style.background = active ? "rgba(56, 189, 248, 0.2)" : "rgba(255,255,255,0.06)";
        });
        buildFields();
        onChange({ ...liveConfig });
      });
    });

    buildFields();
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

function renderSafeMarkdown(text: string): string {
  if (!text) return "";
  let escaped = escapeHtml(text);
  // **bold**
  escaped = escaped.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  // *italic*
  escaped = escaped.replace(/\*(.*?)\*/g, "<em>$1</em>");
  // Line breaks
  escaped = escaped.replace(/\r\n|\n|\r/g, "<br/>");
  return escaped;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
