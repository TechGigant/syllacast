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

export interface ClockWidgetConfig {
  layout_mode: "auto" | "minimal" | "standard" | "expanded";
  show_seconds: "auto" | "show" | "hide" | boolean;
  show_date: "auto" | "show" | "hide" | boolean;
  use_24h: boolean;
  alignment: "stretch" | "left" | "center" | "right";
}

export interface KioskClockController {
  element: HTMLElement;
  start: () => void;
  destroy: () => void;
  updateConfig: (newConfig: Record<string, any>) => void;
  renderSettingsForm: (
    currentConfig: Record<string, any>,
    onChange: (newConfig: Record<string, any>) => void
  ) => HTMLElement;
}

export function createKioskClock(
  initialConfig: Record<string, any> = {}
): KioskClockController {
  let config: ClockWidgetConfig = {
    layout_mode: ["auto", "minimal", "standard", "expanded"].includes(
      initialConfig.layout_mode
    )
      ? initialConfig.layout_mode
      : "auto",
    show_seconds:
      initialConfig.show_seconds !== undefined
        ? initialConfig.show_seconds
        : "auto",
    show_date:
      initialConfig.show_date !== undefined ? initialConfig.show_date : "auto",
    use_24h: initialConfig.use_24h !== false,
    alignment: ["stretch", "left", "center", "right"].includes(
      initialConfig.alignment
    )
      ? initialConfig.alignment
      : "stretch",
  };

  const clockEl = document.createElement("div");
  clockEl.className = "KioskClock sl-glass--liquid";
  clockEl.style.cssText = `
    position: absolute;
    top: 24px;
    left: 28px;
    z-index: 1000;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    padding: 6px 16px;
    border-radius: 9999px;
    font-size: 1.05rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.03em;
    color: #ffffff;
    user-select: none;
    pointer-events: none;
    backdrop-filter: blur(22px) saturate(160%) brightness(1.08);
    -webkit-backdrop-filter: blur(22px) saturate(160%) brightness(1.08);
    background: rgba(255, 255, 255, 0.14);
    border: 1px solid rgba(255, 255, 255, 0.22);
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.22), inset 0 1px 0 rgba(255, 255, 255, 0.32);
    overflow: hidden;
  `;

  const textSpan = document.createElement("span");
  textSpan.className = "KioskClockText";
  textSpan.style.cssText = "line-height: 1.1; white-space: nowrap; font-weight: 700;";
  clockEl.appendChild(textSpan);

  const dateSpan = document.createElement("span");
  dateSpan.className = "KioskClockDate";
  dateSpan.style.cssText = `
    font-size: 0.68em;
    font-weight: 600;
    opacity: 0.8;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    white-space: nowrap;
    line-height: 1.1;
    display: none;
  `;
  clockEl.appendChild(dateSpan);

  let timerId: number | null = null;
  let observedW = 0;

  function resolveEffectiveFlags(): { showSeconds: boolean; showDate: boolean } {
    const cols = parseInt(clockEl.style.getPropertyValue("--widget-cols") || "3", 10) || 3;
    const rows = parseInt(clockEl.style.getPropertyValue("--widget-rows") || "1", 10) || 1;

    let effectiveMode = config.layout_mode;
    if (effectiveMode === "auto") {
      if (cols <= 2 || (observedW > 0 && observedW < 110)) {
        effectiveMode = "minimal";
      } else if (rows >= 2 && cols >= 4) {
        effectiveMode = "expanded";
      } else {
        effectiveMode = "standard";
      }
    }

    let showSeconds = effectiveMode !== "minimal";
    if (config.show_seconds === "show" || config.show_seconds === true) {
      showSeconds = true;
    } else if (config.show_seconds === "hide" || config.show_seconds === false) {
      showSeconds = false;
    }

    let showDate = effectiveMode === "expanded";
    if (config.show_date === "show" || config.show_date === true) {
      showDate = true;
    } else if (config.show_date === "hide" || config.show_date === false) {
      showDate = false;
    }

    clockEl.dataset.clockMode = effectiveMode;
    clockEl.dataset.clockAlign = config.alignment;
    clockEl.classList.toggle("KioskClock--mode-expanded", effectiveMode === "expanded");
    clockEl.classList.toggle("KioskClock--has-date", showDate);

    return { showSeconds, showDate };
  }

  function update() {
    const now = new Date();
    const { showSeconds, showDate } = resolveEffectiveFlags();

    let hoursNum = now.getHours();
    let suffix = "";
    if (!config.use_24h) {
      suffix = hoursNum >= 12 ? " PM" : " AM";
      hoursNum = hoursNum % 12 || 12;
    }

    const hours = config.use_24h
      ? hoursNum.toString().padStart(2, "0")
      : hoursNum.toString();
    const minutes = now.getMinutes().toString().padStart(2, "0");
    const seconds = now.getSeconds().toString().padStart(2, "0");

    textSpan.textContent = showSeconds
      ? `${hours}:${minutes}:${seconds}${suffix}`
      : `${hours}:${minutes}${suffix}`;

    if (showDate) {
      dateSpan.textContent = now.toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
      dateSpan.style.display = "block";
    } else {
      dateSpan.style.display = "none";
    }
  }

  const resizeObserver =
    typeof ResizeObserver !== "undefined"
      ? new ResizeObserver((entries) => {
          for (const entry of entries) {
            const w = entry.contentRect.width;
            if (Math.abs(w - observedW) < 2) return;
            observedW = w;
          }
          update();
        })
      : null;
  resizeObserver?.observe(clockEl);

  update();

  function updateConfig(newConfig: Record<string, any>) {
    config = {
      layout_mode: ["auto", "minimal", "standard", "expanded"].includes(
        newConfig.layout_mode
      )
        ? newConfig.layout_mode
        : config.layout_mode,
      show_seconds:
        newConfig.show_seconds !== undefined
          ? newConfig.show_seconds
          : config.show_seconds,
      show_date:
        newConfig.show_date !== undefined
          ? newConfig.show_date
          : config.show_date,
      use_24h:
        newConfig.use_24h !== undefined
          ? Boolean(newConfig.use_24h)
          : config.use_24h,
      alignment: ["stretch", "left", "center", "right"].includes(
        newConfig.alignment
      )
        ? newConfig.alignment
        : config.alignment,
    };
    update();
  }

  function renderSettingsForm(
    currentConfig: Record<string, any>,
    onChange: (newConfig: Record<string, any>) => void
  ): HTMLElement {
    const form = document.createElement("div");
    form.style.cssText =
      "display: flex; flex-direction: column; gap: 14px; font-size: 0.88rem; color: #e2e8f0;";

    const live: ClockWidgetConfig = { ...config, ...currentConfig };

    // 1. Display Layout Mode
    const modeGroup = document.createElement("div");
    modeGroup.className = "StudioFormGroup";
    modeGroup.innerHTML = `
      <label class="StudioFormLabel">Display Layout Mode</label>
      <select class="StudioFormSelect ClockModeSelect">
        <option value="auto" ${live.layout_mode === "auto" ? "selected" : ""}>Auto (Smart Responsive by Size)</option>
        <option value="minimal" ${live.layout_mode === "minimal" ? "selected" : ""}>Minimal (HH:MM)</option>
        <option value="standard" ${live.layout_mode === "standard" ? "selected" : ""}>Standard (HH:MM:SS)</option>
        <option value="expanded" ${live.layout_mode === "expanded" ? "selected" : ""}>Expanded (Time + Weekday & Date)</option>
      </select>
    `;
    const modeSelect = modeGroup.querySelector<HTMLSelectElement>(".ClockModeSelect")!;
    modeSelect.addEventListener("change", () => {
      live.layout_mode = modeSelect.value as any;
      onChange({ ...live });
    });
    form.appendChild(modeGroup);

    // 2. Cell Alignment
    const alignGroup = document.createElement("div");
    alignGroup.className = "StudioFormGroup";
    alignGroup.innerHTML = `
      <label class="StudioFormLabel">Cell Alignment</label>
      <select class="StudioFormSelect ClockAlignSelect">
        <option value="stretch" ${live.alignment === "stretch" ? "selected" : ""}>Stretch to Fill Grid Box (Recommended)</option>
        <option value="left" ${live.alignment === "left" ? "selected" : ""}>Compact Pill — Align Left</option>
        <option value="center" ${live.alignment === "center" ? "selected" : ""}>Compact Pill — Align Center</option>
        <option value="right" ${live.alignment === "right" ? "selected" : ""}>Compact Pill — Align Right</option>
      </select>
    `;
    const alignSelect = alignGroup.querySelector<HTMLSelectElement>(".ClockAlignSelect")!;
    alignSelect.addEventListener("change", () => {
      live.alignment = alignSelect.value as any;
      onChange({ ...live });
    });
    form.appendChild(alignGroup);

    // 3. Individual Element Visibility Overrides
    const elemHeader = document.createElement("div");
    elemHeader.className = "StudioFormLabel";
    elemHeader.textContent = "Element Visibility";
    form.appendChild(elemHeader);

    const createTriStateRow = (
      label: string,
      key: "show_seconds" | "show_date"
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

    form.appendChild(createTriStateRow("Seconds (:SS)", "show_seconds"));
    form.appendChild(createTriStateRow("Weekday & Date", "show_date"));

    // 4. 24-Hour Time Toggle
    const formatRow = document.createElement("div");
    formatRow.className = "StudioToggleRow";
    formatRow.innerHTML = `
      <span class="StudioToggleLabel">24-Hour Clock Format</span>
      <label class="StudioSwitch">
        <input type="checkbox" ${live.use_24h ? "checked" : ""} />
        <span class="StudioSlider"></span>
      </label>
    `;
    const formatInput = formatRow.querySelector("input")!;
    formatInput.addEventListener("change", () => {
      live.use_24h = formatInput.checked;
      onChange({ ...live });
    });
    form.appendChild(formatRow);

    return form;
  }

  return {
    element: clockEl,
    start: () => {
      if (timerId === null) {
        timerId = window.setInterval(update, 1000);
      }
    },
    destroy: () => {
      if (timerId !== null) {
        clearInterval(timerId);
        timerId = null;
      }
      resizeObserver?.disconnect();
      clockEl.remove();
    },
    updateConfig,
    renderSettingsForm,
  };
}
