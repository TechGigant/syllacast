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

export interface WeatherWidgetConfig {
  location_name: string;
  latitude: number;
  longitude: number;
  unit: "celsius" | "fahrenheit";
  layout_mode: "auto" | "mini_badge" | "compact" | "wide_split" | "standard";
  show_location: "auto" | "show" | "hide" | boolean;
  show_condition: "auto" | "show" | "hide" | boolean;
  show_wind_humidity: "auto" | "show" | "hide" | boolean;
  show_forecast: "auto" | "show" | "hide" | boolean;
}

interface WeatherData {
  current: {
    temperature_2m: number;
    relative_humidity_2m: number;
    weather_code: number;
    wind_speed_10m: number;
  };
  daily?: {
    time: string[];
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
  };
}

export function createWeatherWidget(
  initialConfig: Record<string, any>,
  _ctx: WidgetContext
): MountedWidget {
  let config: WeatherWidgetConfig = {
    location_name: initialConfig.location_name || "Berlin",
    latitude: typeof initialConfig.latitude === "number" ? initialConfig.latitude : 52.52,
    longitude: typeof initialConfig.longitude === "number" ? initialConfig.longitude : 13.41,
    unit: initialConfig.unit === "fahrenheit" ? "fahrenheit" : "celsius",
    layout_mode: ["auto", "mini_badge", "compact", "wide_split", "standard"].includes(
      initialConfig.layout_mode
    )
      ? initialConfig.layout_mode
      : "auto",
    show_location:
      initialConfig.show_location !== undefined ? initialConfig.show_location : "auto",
    show_condition:
      initialConfig.show_condition !== undefined ? initialConfig.show_condition : "auto",
    show_wind_humidity:
      initialConfig.show_wind_humidity !== undefined
        ? initialConfig.show_wind_humidity
        : "auto",
    show_forecast:
      initialConfig.show_forecast !== undefined ? initialConfig.show_forecast : true,
  };

  const container = document.createElement("div");
  container.className = "KioskWeatherWidget";
  container.style.cssText = `
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: clamp(8px, min(4cqw, 4.5cqh), 22px) clamp(10px, min(4.8cqw, 5.5cqh), 26px);
    box-sizing: border-box;
    border-radius: inherit;
    color: #ffffff;
    user-select: none;
  `;

  let weatherData: WeatherData | null = null;
  let pollInterval: number | null = null;
  let isDestroyed = false;
  let observedW = 0;
  let observedH = 0;

  const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

  function getGridSpans(): { cols: number; rows: number } {
    const host = container.parentElement || container;
    const cols = parseInt(host.style.getPropertyValue("--widget-cols") || "5", 10) || 5;
    const rows = parseInt(host.style.getPropertyValue("--widget-rows") || "3", 10) || 3;
    return { cols, rows };
  }

  function resolveEffectiveLayout() {
    const { cols, rows } = getGridSpans();
    let mode = config.layout_mode;

    if (mode === "auto") {
      if (rows === 1 || (cols <= 3 && rows <= 2) || (observedH > 0 && observedH < 88)) {
        mode = "mini_badge";
      } else if (
        (cols >= 6 && rows <= 2) ||
        (observedW > 0 && observedH > 0 && observedW / observedH >= 2.1 && observedH < 175)
      ) {
        mode = "wide_split";
      } else if (rows <= 2 || (observedH > 0 && observedH < 155)) {
        mode = "compact";
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

    const showLocation = resolveTri(config.show_location, mode !== "mini_badge" || cols >= 3);
    const showCondition = resolveTri(config.show_condition, mode !== "mini_badge");
    const showWindHumidity = resolveTri(
      config.show_wind_humidity,
      mode === "standard" || mode === "wide_split"
    );
    const showForecast = resolveTri(
      config.show_forecast,
      mode === "standard" || mode === "wide_split"
    );

    container.dataset.weatherMode = mode;
    return { mode, showLocation, showCondition, showWindHumidity, showForecast };
  }

  function getCacheKey(): string {
    return `syllacast_weather_${config.latitude.toFixed(2)}_${config.longitude.toFixed(2)}_${config.unit}`;
  }

  function loadCachedData(): boolean {
    try {
      const raw = localStorage.getItem(getCacheKey());
      if (raw) {
        const cached = JSON.parse(raw);
        if (cached && cached.timestamp && Date.now() - cached.timestamp < CACHE_TTL_MS) {
          weatherData = cached.data;
          renderView();
          return true;
        }
      }
    } catch {
      // Ignore cache parse error
    }
    return false;
  }

  async function fetchWeather() {
    if (isDestroyed) return;
    const isFahr = config.unit === "fahrenheit";
    const tempUnitParam = isFahr ? "&temperature_unit=fahrenheit&wind_speed_unit=mph" : "";
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${config.latitude}&longitude=${config.longitude}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto${tempUnitParam}`;

    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Weather fetch HTTP ${res.status}`);
      const data = await res.json();
      if (!isDestroyed && data.current) {
        weatherData = data;
        try {
          localStorage.setItem(
            getCacheKey(),
            JSON.stringify({ timestamp: Date.now(), data })
          );
        } catch {
          // Ignore localStorage quota
        }
        renderView();
      }
    } catch {
      if (!weatherData) {
        renderError();
      }
    }
  }

  function renderView() {
    if (!weatherData || !weatherData.current) {
      renderLoading();
      return;
    }

    const current = weatherData.current;
    const info = getWeatherInfo(current.weather_code);
    const tempUnit = config.unit === "fahrenheit" ? "°F" : "°C";
    const speedUnit = config.unit === "fahrenheit" ? "mph" : "km/h";
    const { mode, showLocation, showCondition, showWindHumidity, showForecast } =
      resolveEffectiveLayout();

    if (mode === "mini_badge") {
      container.style.flexDirection = "row";
      container.style.alignItems = "center";
      container.style.justifyContent = "center";
      container.style.gap = "10px";
      container.innerHTML = `
        <div style="width: clamp(24px, min(18cqw, 55cqh), 42px); height: clamp(24px, min(18cqw, 55cqh), 42px); display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
          ${info.largeIconSvg}
        </div>
        <div style="display: flex; flex-direction: column; min-width: 0;">
          <div style="font-size: clamp(1rem, min(14cqw, 40cqh), 1.85rem); font-weight: 800; line-height: 1.05;">
            ${Math.round(current.temperature_2m)}${tempUnit}
          </div>
          ${
            showLocation
              ? `<div style="font-size: clamp(0.62rem, min(7cqw, 18cqh), 0.82rem); font-weight: 600; opacity: 0.7; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(
                  config.location_name
                )}</div>`
              : ""
          }
        </div>
      `;
      return;
    }

    let forecastHtml = "";
    if (showForecast && weatherData.daily && weatherData.daily.time) {
      const days = weatherData.daily.time.slice(1, 4);
      const codes = weatherData.daily.weather_code.slice(1, 4);
      const maxs = weatherData.daily.temperature_2m_max.slice(1, 4);
      const mins = weatherData.daily.temperature_2m_min.slice(1, 4);

      const isSplit = mode === "wide_split";
      forecastHtml = `
        <div class="WeatherForecastRow" style="display: flex; justify-content: space-between; align-items: center; gap: clamp(6px, 2cqw, 14px); ${
          isSplit
            ? "flex: 1.15; padding-left: clamp(10px, 3cqw, 20px); border-left: 1px solid rgba(255, 255, 255, 0.12); height: 100%;"
            : "margin-top: auto; padding-top: clamp(6px, 2.8cqh, 14px); border-top: 1px solid rgba(255, 255, 255, 0.12);"
        }">
          ${days
            .map((dateStr, i) => {
              const dayName = new Date(dateStr + "T00:00:00").toLocaleDateString(undefined, {
                weekday: "short",
              });
              const dayInfo = getWeatherInfo(codes[i]);
              return `
                <div style="display: flex; flex-direction: column; align-items: center; gap: clamp(2px, 1.2cqh, 6px); flex: 1;">
                  <span style="font-size: clamp(0.66rem, min(3.2cqw, 5cqh), 0.92rem); opacity: 0.7; font-weight: 600;">${dayName}</span>
                  <div style="width: clamp(18px, min(7cqw, 11cqh), 32px); height: clamp(18px, min(7cqw, 11cqh), 32px); display: flex; align-items: center; justify-content: center;">
                    ${dayInfo.iconSvg}
                  </div>
                  <span style="font-size: clamp(0.7rem, min(3.4cqw, 5.2cqh), 0.96rem); font-weight: 700;">
                    ${Math.round(maxs[i])}° <span style="opacity: 0.55; font-weight: 500;">${Math.round(mins[i])}°</span>
                  </span>
                </div>
              `;
            })
            .join("")}
        </div>
      `;
    }

    const windHumidityHtml = showWindHumidity
      ? `
      <div class="WeatherDetailsRow" style="display: flex; align-items: center; gap: clamp(8px, 3.5cqw, 18px); font-size: clamp(0.68rem, min(3.4cqw, 5.5cqh), 0.95rem); opacity: 0.78; margin-top: clamp(3px, 1.4cqh, 8px);">
        <span style="display: flex; align-items: center; gap: 4px;">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2"/><path d="M9.6 4.6A2 2 0 1 1 11 8H2"/><path d="M12.6 19.4A2 2 0 1 0 14 16H2"/></svg>
          ${Math.round(current.wind_speed_10m)} ${speedUnit}
        </span>
        <span style="display: flex; align-items: center; gap: 4px;">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>
          ${Math.round(current.relative_humidity_2m)}%
        </span>
      </div>`
      : "";

    const primaryBlockHtml = `
      <div style="display: flex; flex-direction: column; justify-content: center; flex: 1; min-width: 0;">
        <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
          <div style="min-width: 0;">
            ${
              showLocation
                ? `<div style="font-size: clamp(0.68rem, min(3.6cqw, 5.8cqh), 1.02rem); font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.68; margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                    ${escapeHtml(config.location_name)}
                  </div>`
                : ""
            }
            <div style="font-size: clamp(1.35rem, min(11cqw, 22cqh), 3.4rem); font-weight: 800; line-height: 1.05; letter-spacing: -0.03em;">
              ${Math.round(current.temperature_2m)}${tempUnit}
            </div>
            ${
              showCondition
                ? `<div style="font-size: clamp(0.75rem, min(4cqw, 6.5cqh), 1.1rem); font-weight: 500; opacity: 0.88; margin-top: 2px;">
                    ${info.label}
                  </div>`
                : ""
            }
          </div>
          <div style="width: clamp(32px, min(16cqw, 26cqh), 72px); height: clamp(32px, min(16cqw, 26cqh), 72px); display: flex; align-items: center; justify-content: center; flex-shrink: 0; filter: drop-shadow(0 4px 12px rgba(0,0,0,0.35));">
            ${info.largeIconSvg}
          </div>
        </div>
        ${windHumidityHtml}
      </div>
    `;

    if (mode === "wide_split") {
      container.style.flexDirection = "row";
      container.style.alignItems = "center";
      container.style.justifyContent = "space-between";
      container.style.gap = "14px";
      container.innerHTML = `${primaryBlockHtml}${forecastHtml}`;
    } else {
      container.style.flexDirection = "column";
      container.style.alignItems = "stretch";
      container.style.justifyContent = "space-between";
      container.style.gap = "4px";
      container.innerHTML = `${primaryBlockHtml}${forecastHtml}`;
    }
  }

  function renderLoading() {
    container.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 8px; opacity: 0.7;">
        <div style="width: 24px; height: 24px; border: 2px solid rgba(255,255,255,0.2); border-top-color: #38bdf8; border-radius: 50%; animation: spin 1s linear infinite;"></div>
        <span style="font-size: 0.8rem;">Loading weather...</span>
      </div>
    `;
  }

  function renderError() {
    container.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 6px; text-align: center; color: rgba(255, 255, 255, 0.7);">
        <div style="font-size: 0.85rem; font-weight: 600; color: #f87171;">Weather Unavailable</div>
        <div style="font-size: 0.75rem; opacity: 0.7;">Check coordinates in widget settings</div>
      </div>
    `;
  }

  const resizeObserver =
    typeof ResizeObserver !== "undefined"
      ? new ResizeObserver((entries) => {
          for (const entry of entries) {
            observedW = entry.contentRect.width;
            observedH = entry.contentRect.height;
          }
          if (weatherData) renderView();
        })
      : null;
  resizeObserver?.observe(container);

  function updateConfig(newConfig: Record<string, any>) {
    const latChanged = typeof newConfig.latitude === "number" && newConfig.latitude !== config.latitude;
    const lonChanged = typeof newConfig.longitude === "number" && newConfig.longitude !== config.longitude;
    const unitChanged = newConfig.unit && newConfig.unit !== config.unit;

    config = {
      location_name: newConfig.location_name || config.location_name,
      latitude: typeof newConfig.latitude === "number" ? newConfig.latitude : config.latitude,
      longitude: typeof newConfig.longitude === "number" ? newConfig.longitude : config.longitude,
      unit: newConfig.unit === "fahrenheit" ? "fahrenheit" : "celsius",
      layout_mode: ["auto", "mini_badge", "compact", "wide_split", "standard"].includes(
        newConfig.layout_mode
      )
        ? newConfig.layout_mode
        : config.layout_mode,
      show_location:
        newConfig.show_location !== undefined
          ? newConfig.show_location
          : config.show_location,
      show_condition:
        newConfig.show_condition !== undefined
          ? newConfig.show_condition
          : config.show_condition,
      show_wind_humidity:
        newConfig.show_wind_humidity !== undefined
          ? newConfig.show_wind_humidity
          : config.show_wind_humidity,
      show_forecast:
        newConfig.show_forecast !== undefined
          ? newConfig.show_forecast
          : config.show_forecast,
    };

    if (latChanged || lonChanged || unitChanged) {
      weatherData = null;
      if (!loadCachedData()) {
        fetchWeather();
      }
    } else {
      renderView();
    }
  }

  function destroy() {
    isDestroyed = true;
    resizeObserver?.disconnect();
    if (pollInterval) {
      window.clearInterval(pollInterval);
      pollInterval = null;
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
      gap: 16px;
      font-size: 0.9rem;
      color: #e2e8f0;
    `;

    const liveConfig = { ...config, ...currentConfig };

    // City Search Field + Live Geocoding
    const searchGroup = document.createElement("div");
    searchGroup.innerHTML = `
      <label style="display: block; font-weight: 600; margin-bottom: 6px; font-size: 0.85rem; color: #94a3b8;">Search City / Location</label>
      <div style="display: flex; gap: 8px;">
        <input type="text" class="CitySearchInput" placeholder="e.g. New York, London, Tokyo" style="flex: 1; padding: 8px 12px; border-radius: 8px; background: rgba(255, 255, 255, 0.07); border: 1px solid rgba(255, 255, 255, 0.15); color: #fff; outline: none;" />
        <button type="button" class="CitySearchBtn" style="padding: 8px 14px; border-radius: 8px; background: #38bdf8; color: #000; font-weight: 600; border: none; cursor: pointer;">Search</button>
      </div>
      <div class="CitySearchResults" style="display: flex; flex-direction: column; gap: 4px; margin-top: 8px; max-height: 120px; overflow-y: auto;"></div>
    `;

    const searchInput = searchGroup.querySelector<HTMLInputElement>(".CitySearchInput")!;
    const searchBtn = searchGroup.querySelector<HTMLButtonElement>(".CitySearchBtn")!;
    const searchResults = searchGroup.querySelector<HTMLDivElement>(".CitySearchResults")!;

    async function performSearch() {
      const q = searchInput.value.trim();
      if (!q) return;
      searchResults.innerHTML = `<span style="font-size: 0.8rem; opacity: 0.6;">Searching...</span>`;

      try {
        const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5`);
        if (!res.ok) throw new Error();
        const data = await res.json();
        searchResults.innerHTML = "";

        if (!data.results || data.results.length === 0) {
          searchResults.innerHTML = `<span style="font-size: 0.8rem; opacity: 0.6;">No locations found.</span>`;
          return;
        }

        for (const loc of data.results) {
          const locBtn = document.createElement("button");
          locBtn.type = "button";
          locBtn.style.cssText = `
            text-align: left;
            padding: 6px 10px;
            border-radius: 6px;
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.08);
            color: #fff;
            cursor: pointer;
            font-size: 0.8rem;
          `;
          const details = [loc.admin1, loc.country].filter(Boolean).join(", ");
          locBtn.innerHTML = `<strong>${escapeHtml(loc.name)}</strong> <span style="opacity: 0.65; font-size: 0.75rem;">(${escapeHtml(details)})</span>`;
          locBtn.addEventListener("click", () => {
            liveConfig.location_name = loc.name;
            liveConfig.latitude = parseFloat(loc.latitude.toFixed(4));
            liveConfig.longitude = parseFloat(loc.longitude.toFixed(4));

            nameInput.value = liveConfig.location_name;
            latInput.value = liveConfig.latitude.toString();
            lonInput.value = liveConfig.longitude.toString();
            searchResults.innerHTML = "";
            onChange({ ...liveConfig });
          });
          searchResults.appendChild(locBtn);
        }
      } catch {
        searchResults.innerHTML = `<span style="font-size: 0.8rem; color: #f87171;">Search request failed.</span>`;
      }
    }

    searchBtn.addEventListener("click", performSearch);
    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        performSearch();
      }
    });
    form.appendChild(searchGroup);

    // Location Name Field
    const nameGroup = document.createElement("div");
    nameGroup.innerHTML = `
      <label style="display: block; font-weight: 600; margin-bottom: 6px; font-size: 0.85rem; color: #94a3b8;">Display Name</label>
      <input type="text" class="LocationNameInput" value="${escapeHtml(liveConfig.location_name)}" style="width: 100%; box-sizing: border-box; padding: 8px 12px; border-radius: 8px; background: rgba(255, 255, 255, 0.07); border: 1px solid rgba(255, 255, 255, 0.15); color: #fff; outline: none;" />
    `;
    const nameInput = nameGroup.querySelector<HTMLInputElement>(".LocationNameInput")!;
    nameInput.addEventListener("input", () => {
      liveConfig.location_name = nameInput.value;
      onChange({ ...liveConfig });
    });
    form.appendChild(nameGroup);

    // Coordinates (Lat & Lon)
    const coordsGroup = document.createElement("div");
    coordsGroup.style.cssText = "display: grid; grid-template-columns: 1fr 1fr; gap: 10px;";
    coordsGroup.innerHTML = `
      <div>
        <label style="display: block; font-weight: 600; margin-bottom: 6px; font-size: 0.85rem; color: #94a3b8;">Latitude</label>
        <input type="number" step="0.0001" class="LatInput" value="${liveConfig.latitude}" style="width: 100%; box-sizing: border-box; padding: 8px 12px; border-radius: 8px; background: rgba(255, 255, 255, 0.07); border: 1px solid rgba(255, 255, 255, 0.15); color: #fff; outline: none;" />
      </div>
      <div>
        <label style="display: block; font-weight: 600; margin-bottom: 6px; font-size: 0.85rem; color: #94a3b8;">Longitude</label>
        <input type="number" step="0.0001" class="LonInput" value="${liveConfig.longitude}" style="width: 100%; box-sizing: border-box; padding: 8px 12px; border-radius: 8px; background: rgba(255, 255, 255, 0.07); border: 1px solid rgba(255, 255, 255, 0.15); color: #fff; outline: none;" />
      </div>
    `;
    const latInput = coordsGroup.querySelector<HTMLInputElement>(".LatInput")!;
    const lonInput = coordsGroup.querySelector<HTMLInputElement>(".LonInput")!;
    latInput.addEventListener("input", () => {
      liveConfig.latitude = parseFloat(latInput.value) || 0;
      onChange({ ...liveConfig });
    });
    lonInput.addEventListener("input", () => {
      liveConfig.longitude = parseFloat(lonInput.value) || 0;
      onChange({ ...liveConfig });
    });
    form.appendChild(coordsGroup);

    // Temperature Unit (Celsius vs Fahrenheit)
    const unitGroup = document.createElement("div");
    unitGroup.innerHTML = `
      <label style="display: block; font-weight: 600; margin-bottom: 6px; font-size: 0.85rem; color: #94a3b8;">Temperature Unit</label>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
        <button type="button" data-unit="celsius" class="UnitBtn" style="padding: 8px; border-radius: 8px; border: 1px solid ${
          liveConfig.unit === "celsius" ? "#38bdf8" : "rgba(255,255,255,0.12)"
        }; background: ${
          liveConfig.unit === "celsius" ? "rgba(56, 189, 248, 0.2)" : "rgba(255,255,255,0.06)"
        }; color: #fff; cursor: pointer; font-weight: 600;">Celsius (°C)</button>
        <button type="button" data-unit="fahrenheit" class="UnitBtn" style="padding: 8px; border-radius: 8px; border: 1px solid ${
          liveConfig.unit === "fahrenheit" ? "#38bdf8" : "rgba(255,255,255,0.12)"
        }; background: ${
          liveConfig.unit === "fahrenheit" ? "rgba(56, 189, 248, 0.2)" : "rgba(255,255,255,0.06)"
        }; color: #fff; cursor: pointer; font-weight: 600;">Fahrenheit (°F)</button>
      </div>
    `;
    unitGroup.querySelectorAll<HTMLButtonElement>(".UnitBtn").forEach((btn) => {
      btn.addEventListener("click", () => {
        liveConfig.unit = btn.dataset.unit as any;
        unitGroup.querySelectorAll<HTMLButtonElement>(".UnitBtn").forEach((b) => {
          const active = b === btn;
          b.style.borderColor = active ? "#38bdf8" : "rgba(255,255,255,0.12)";
          b.style.background = active ? "rgba(56, 189, 248, 0.2)" : "rgba(255,255,255,0.06)";
        });
        onChange({ ...liveConfig });
      });
    });
    form.appendChild(unitGroup);

    // Display Layout Mode
    const modeGroup = document.createElement("div");
    modeGroup.innerHTML = `
      <label style="display: block; font-weight: 600; margin-bottom: 6px; font-size: 0.85rem; color: #94a3b8;">Display Layout Mode</label>
      <select class="StudioFormSelect WeatherLayoutSelect" style="width: 100%;">
        <option value="auto" ${liveConfig.layout_mode === "auto" ? "selected" : ""}>Auto (Smart Responsive by Size)</option>
        <option value="mini_badge" ${liveConfig.layout_mode === "mini_badge" ? "selected" : ""}>Mini Badge (Icon & Temp)</option>
        <option value="compact" ${liveConfig.layout_mode === "compact" ? "selected" : ""}>Compact Card (Current Weather)</option>
        <option value="wide_split" ${liveConfig.layout_mode === "wide_split" ? "selected" : ""}>Wide Split (Side-by-Side Forecast)</option>
        <option value="standard" ${liveConfig.layout_mode === "standard" ? "selected" : ""}>Full Card (Current + Details + Forecast)</option>
      </select>
    `;
    const modeSel = modeGroup.querySelector<HTMLSelectElement>(".WeatherLayoutSelect")!;
    modeSel.addEventListener("change", () => {
      liveConfig.layout_mode = modeSel.value as any;
      onChange({ ...liveConfig });
    });
    form.appendChild(modeGroup);

    // Individual Element Visibility Overrides
    const createTriRow = (
      label: string,
      key: "show_location" | "show_condition" | "show_wind_humidity" | "show_forecast"
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

    form.appendChild(createTriRow("Location Name", "show_location"));
    form.appendChild(createTriRow("Weather Condition Text", "show_condition"));
    form.appendChild(createTriRow("Wind Speed & Humidity", "show_wind_humidity"));
    form.appendChild(createTriRow("3-Day Forecast", "show_forecast"));

    return form;
  }

  // Initial load
  if (!loadCachedData()) {
    fetchWeather();
  }

  // Periodic refresh every 30 minutes
  pollInterval = window.setInterval(fetchWeather, CACHE_TTL_MS);

  return {
    element: container,
    updateConfig,
    destroy,
    renderSettingsForm,
  };
}

function getWeatherInfo(code: number): { label: string; iconSvg: string; largeIconSvg: string } {
  // Clear sky
  if (code === 0) {
    const icon = `<svg viewBox="0 0 24 24" fill="none" stroke="#facc15" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="100%" height="100%"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`;
    return { label: "Clear Sky", iconSvg: icon, largeIconSvg: icon };
  }

  // Mainly clear / partly cloudy
  if (code === 1 || code === 2) {
    const icon = `<svg viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="100%" height="100%"><path d="M12 2v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="M20 12h2"/><path d="m19.07 4.93-1.41 1.41"/><path d="M15.947 12.65a4 4 0 0 0-5.925-4.128"/><path d="M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z"/></svg>`;
    return { label: "Partly Cloudy", iconSvg: icon, largeIconSvg: icon };
  }

  // Overcast
  if (code === 3) {
    const icon = `<svg viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="100%" height="100%"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg>`;
    return { label: "Overcast", iconSvg: icon, largeIconSvg: icon };
  }

  // Fog
  if (code === 45 || code === 48) {
    const icon = `<svg viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="100%" height="100%"><line x1="4" y1="8" x2="20" y2="8"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="5" y1="16" x2="19" y2="16"/><line x1="7" y1="20" x2="17" y2="20"/></svg>`;
    return { label: "Foggy", iconSvg: icon, largeIconSvg: icon };
  }

  // Drizzle / Rain
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) {
    const isHeavy = code === 65 || code === 82;
    const icon = `<svg viewBox="0 0 24 24" fill="none" stroke="#60a5fa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="100%" height="100%"><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="M16 14v6"/><path d="M8 14v6"/><path d="M12 16v6"/></svg>`;
    return { label: isHeavy ? "Heavy Rain" : "Rain", iconSvg: icon, largeIconSvg: icon };
  }

  // Snow
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) {
    const icon = `<svg viewBox="0 0 24 24" fill="none" stroke="#e0f2fe" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="100%" height="100%"><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="m8 15 2 2m0-2-2 2"/><path d="m14 15 2 2m0-2-2 2"/></svg>`;
    return { label: "Snow", iconSvg: icon, largeIconSvg: icon };
  }

  // Thunderstorm
  if (code >= 95) {
    const icon = `<svg viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="100%" height="100%"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/><polygon points="13 13 9 19 14 19 11 23 16 17 12 17 14 13"/></svg>`;
    return { label: "Thunderstorm", iconSvg: icon, largeIconSvg: icon };
  }

  // Default fallback
  const fallback = `<svg viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="100%" height="100%"><circle cx="12" cy="12" r="10"/></svg>`;
  return { label: "Weather", iconSvg: fallback, largeIconSvg: fallback };
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
