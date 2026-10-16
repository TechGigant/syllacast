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
  show_forecast: boolean;
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
    show_forecast: initialConfig.show_forecast !== false,
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
    padding: clamp(10px, min(4.2cqw, 5cqh), 24px) clamp(12px, min(5cqw, 6cqh), 28px);
    box-sizing: border-box;
    border-radius: inherit;
    color: #ffffff;
    user-select: none;
  `;

  let weatherData: WeatherData | null = null;
  let pollInterval: number | null = null;
  let isDestroyed = false;

  const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

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
    } catch (e) {
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

    let forecastHtml = "";
    if (config.show_forecast && weatherData.daily && weatherData.daily.time) {
      const days = weatherData.daily.time.slice(1, 4); // next 3 days
      const codes = weatherData.daily.weather_code.slice(1, 4);
      const maxs = weatherData.daily.temperature_2m_max.slice(1, 4);
      const mins = weatherData.daily.temperature_2m_min.slice(1, 4);

      forecastHtml = `
        <div class="WeatherForecastRow" style="display: flex; justify-content: space-between; gap: clamp(6px, 2.5cqw, 16px); margin-top: auto; padding-top: clamp(6px, 3cqh, 14px); border-top: 1px solid rgba(255, 255, 255, 0.12);">
          ${days
            .map((dateStr, i) => {
              const dayName = new Date(dateStr + "T00:00:00").toLocaleDateString(undefined, {
                weekday: "short",
              });
              const dayInfo = getWeatherInfo(codes[i]);
              return `
                <div style="display: flex; flex-direction: column; align-items: center; gap: clamp(2px, 1.2cqh, 6px); flex: 1;">
                  <span style="font-size: clamp(0.68rem, min(3.4cqw, 5.2cqh), 0.95rem); opacity: 0.7; font-weight: 600;">${dayName}</span>
                  <div style="width: clamp(18px, min(7.5cqw, 11cqh), 34px); height: clamp(18px, min(7.5cqw, 11cqh), 34px); display: flex; align-items: center; justify-content: center;">
                    ${dayInfo.iconSvg}
                  </div>
                  <span style="font-size: clamp(0.72rem, min(3.6cqw, 5.5cqh), 1rem); font-weight: 700;">
                    ${Math.round(maxs[i])}° <span style="opacity: 0.55; font-weight: 500;">${Math.round(mins[i])}°</span>
                  </span>
                </div>
              `;
            })
            .join("")}
        </div>
      `;
    }

    container.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
        <div style="min-width: 0;">
          <div style="font-size: clamp(0.7rem, min(3.8cqw, 6cqh), 1.05rem); font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.68; margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
            ${escapeHtml(config.location_name)}
          </div>
          <div style="font-size: clamp(1.5rem, min(11.5cqw, 22cqh), 3.6rem); font-weight: 800; line-height: 1.05; letter-spacing: -0.03em;">
            ${Math.round(current.temperature_2m)}${tempUnit}
          </div>
          <div style="font-size: clamp(0.78rem, min(4.2cqw, 6.8cqh), 1.15rem); font-weight: 500; opacity: 0.88; margin-top: clamp(2px, 1.2cqh, 6px);">
            ${info.label}
          </div>
        </div>
        <div style="width: clamp(36px, min(17cqw, 26cqh), 78px); height: clamp(36px, min(17cqw, 26cqh), 78px); display: flex; align-items: center; justify-content: center; flex-shrink: 0; filter: drop-shadow(0 4px 12px rgba(0,0,0,0.35));">
          ${info.largeIconSvg}
        </div>
      </div>

      <div style="display: flex; align-items: center; gap: clamp(10px, 4cqw, 20px); font-size: clamp(0.7rem, min(3.6cqw, 5.8cqh), 0.98rem); opacity: 0.78; margin-top: clamp(4px, 1.5cqh, 10px);">
        <span style="display: flex; align-items: center; gap: 5px;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2"/><path d="M9.6 4.6A2 2 0 1 1 11 8H2"/><path d="M12.6 19.4A2 2 0 1 0 14 16H2"/></svg>
          ${Math.round(current.wind_speed_10m)} ${speedUnit}
        </span>
        <span style="display: flex; align-items: center; gap: 5px;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>
          ${Math.round(current.relative_humidity_2m)}%
        </span>
      </div>

      ${forecastHtml}
    `;
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

  function updateConfig(newConfig: Record<string, any>) {
    const latChanged = typeof newConfig.latitude === "number" && newConfig.latitude !== config.latitude;
    const lonChanged = typeof newConfig.longitude === "number" && newConfig.longitude !== config.longitude;
    const unitChanged = newConfig.unit && newConfig.unit !== config.unit;

    config = {
      location_name: newConfig.location_name || config.location_name,
      latitude: typeof newConfig.latitude === "number" ? newConfig.latitude : config.latitude,
      longitude: typeof newConfig.longitude === "number" ? newConfig.longitude : config.longitude,
      unit: newConfig.unit === "fahrenheit" ? "fahrenheit" : "celsius",
      show_forecast: newConfig.show_forecast !== undefined ? Boolean(newConfig.show_forecast) : config.show_forecast,
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

    // Show Forecast Toggle
    const forecastGroup = document.createElement("div");
    forecastGroup.style.cssText = "display: flex; align-items: center; gap: 10px; margin-top: 4px;";
    forecastGroup.innerHTML = `
      <input type="checkbox" id="weather_forecast_chk" ${liveConfig.show_forecast ? "checked" : ""} style="width: 18px; height: 18px; accent-color: #38bdf8; cursor: pointer;" />
      <label for="weather_forecast_chk" style="cursor: pointer; font-size: 0.85rem; color: #e2e8f0;">Show 3-Day Forecast</label>
    `;
    const fChk = forecastGroup.querySelector<HTMLInputElement>("input")!;
    fChk.addEventListener("change", () => {
      liveConfig.show_forecast = fChk.checked;
      onChange({ ...liveConfig });
    });
    form.appendChild(forecastGroup);

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
