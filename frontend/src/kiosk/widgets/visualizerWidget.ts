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
import { SpotifyPlayer } from "../../spicy/components/Global/SpotifyPlayer.ts";
import { LyricsObject } from "../../spicy/utils/Lyrics/lyrics.ts";

export interface VisualizerWidgetConfig {
  style: "bars" | "waves" | "particles";
  bar_count: 16 | 32 | 48 | 64;
  sensitivity: number; // 0.5 to 2.0
  color_mode: "cover_accent" | "white_glass" | "neon_gradient";
  mirror: boolean;
}

interface Particle {
  x: number;
  y: number;
  baseRadius: number;
  vx: number;
  vy: number;
  binIndex: number;
}

export function createVisualizerWidget(
  initialConfig: Record<string, any>,
  ctx: WidgetContext
): MountedWidget {
  let config: VisualizerWidgetConfig = {
    style: ["bars", "waves", "particles"].includes(initialConfig.style)
      ? initialConfig.style
      : "bars",
    bar_count: [16, 32, 48, 64].includes(initialConfig.bar_count)
      ? initialConfig.bar_count
      : 32,
    sensitivity:
      typeof initialConfig.sensitivity === "number"
        ? Math.max(0.5, Math.min(2.0, initialConfig.sensitivity))
        : 1.0,
    color_mode: ["cover_accent", "white_glass", "neon_gradient"].includes(
      initialConfig.color_mode
    )
      ? initialConfig.color_mode
      : "cover_accent",
    mirror: Boolean(initialConfig.mirror),
  };

  const container = document.createElement("div");
  container.className = "KioskVisualizerWidget";
  container.style.cssText = `
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: inherit;
    box-sizing: border-box;
  `;

  const canvas = document.createElement("canvas");
  canvas.style.cssText = `
    width: 100%;
    height: 100%;
    display: block;
  `;
  container.appendChild(canvas);

  const ctx2d = canvas.getContext("2d", { alpha: true });
  if (!ctx2d) {
    return {
      element: container,
      updateConfig: () => {},
      destroy: () => {},
    };
  }

  let animFrameId: number | null = null;
  let isDestroyed = false;
  let width = 0;
  let height = 0;

  // Smoothing & peak-hold buffers for classic MP3 player spectrum ballistics
  let currentBins = new Float32Array(config.bar_count);
  let peakBins = new Float32Array(config.bar_count);
  let peakHoldFrames = new Int16Array(config.bar_count);
  let peakVel = new Float32Array(config.bar_count);
  let particles: Particle[] = [];

  function initParticles(count: number) {
    particles = [];
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + (i % 7) * 0.31;
      const speed = 0.0018 + (i % 5) * 0.0006;
      particles.push({
        x: 0.5 + Math.cos(angle) * (0.08 + (i % 9) * 0.045),
        y: 0.5 + Math.sin(angle) * (0.08 + (i % 9) * 0.045),
        baseRadius: 1.8 + (i % 4) * 0.9,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        binIndex: i % config.bar_count,
      });
    }
  }
  initParticles(56);

  const resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const rect = entry.contentRect;
      width = Math.floor(rect.width);
      height = Math.floor(rect.height);
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
    }
  });
  resizeObserver.observe(container);

  // Accent color extraction helper
  let cachedCoverUrl: string | null = null;
  let cachedAccentColor = { r: 56, g: 189, b: 248 }; // #38bdf8 default cyan

  function updateAccentColor() {
    const latest = ctx.getLatestState();
    const coverUrl = latest?.track?.cover_url || "";
    if (coverUrl === cachedCoverUrl) return;
    cachedCoverUrl = coverUrl;

    try {
      const img = document.querySelector(".NowBar img") as HTMLImageElement;
      if (img && img.complete && img.naturalWidth > 0) {
        const off = document.createElement("canvas");
        off.width = 4;
        off.height = 4;
        const offCtx = off.getContext("2d");
        if (offCtx) {
          offCtx.drawImage(img, 0, 0, 4, 4);
          const data = offCtx.getImageData(0, 0, 4, 4).data;
          let bestR = 56,
            bestG = 189,
            bestB = 248,
            bestScore = -1;
          for (let p = 0; p < data.length; p += 4) {
            const r = data[p],
              g = data[p + 1],
              b = data[p + 2];
            const maxC = Math.max(r, g, b);
            const minC = Math.min(r, g, b);
            const sat = maxC - minC;
            const luma = (r * 299 + g * 587 + b * 114) / 1000;
            const score = sat * 1.6 + (luma > 45 && luma < 235 ? 60 : 0);
            if (score > bestScore && luma > 35) {
              bestScore = score;
              bestR = r;
              bestG = g;
              bestB = b;
            }
          }
          const boost = 235 / Math.max(120, Math.max(bestR, bestG, bestB));
          cachedAccentColor = {
            r: Math.min(255, Math.round(bestR * boost)),
            g: Math.min(255, Math.round(bestG * boost)),
            b: Math.min(255, Math.round(bestB * boost)),
          };
        }
      }
    } catch {
      // CORS or offscreen read failure: keep default
    }
  }

  // Synthesis loop
  function renderFrame(timestamp: number) {
    if (isDestroyed) return;

    if (width <= 0 || height <= 0) {
      animFrameId = requestAnimationFrame(renderFrame);
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    ctx2d.save();
    ctx2d.scale(dpr, dpr);
    ctx2d.clearRect(0, 0, width, height);

    const isPlaying = SpotifyPlayer.IsPlaying || ctx.getLatestState()?.is_playing === true;
    const posMs = ctx.getInterpolatedPositionMs();
    const timeSec = timestamp * 0.001;

    // Check vocal activity from LyricsObject (enhances mid-band when lyrics are present)
    let vocalBoost = 0;
    if (isPlaying) {
      try {
        const syllableLines = LyricsObject?.Types?.Syllable?.Lines;
        if (syllableLines && syllableLines.length > 0) {
          for (let lIdx = 0; lIdx < syllableLines.length; lIdx++) {
            const line = syllableLines[lIdx];
            if (line.Status === "Active" || (posMs >= line.StartTime && posMs <= line.EndTime)) {
              vocalBoost = 0.22;
              const leads = line.Syllables?.Lead;
              if (leads) {
                for (let sIdx = 0; sIdx < leads.length; sIdx++) {
                  const lead = leads[sIdx];
                  if (posMs >= lead.StartTime && posMs <= lead.EndTime) {
                    vocalBoost = 0.38;
                    break;
                  }
                }
              }
              break;
            }
          }
        } else {
          const syncedLines = LyricsObject?.Types?.Line?.Lines;
          if (syncedLines && syncedLines.length > 0) {
            for (let lIdx = 0; lIdx < syncedLines.length; lIdx++) {
              const line = syncedLines[lIdx];
              if (line.Status === "Active" || (posMs >= line.StartTime && posMs <= line.EndTime)) {
                vocalBoost = 0.28;
                break;
              }
            }
          }
        }
      } catch {
        // Fallback gracefully
      }
    }

    // Track tempo & musical groove oscillators
    const track = ctx.getLatestState()?.track;
    const trackSeed = track?.id || track?.title || "kiosk";
    let hash = 0;
    for (let i = 0; i < trackSeed.length; i++) {
      hash = (hash << 5) - hash + trackSeed.charCodeAt(i);
      hash |= 0;
    }
    const bpm = 108 + Math.abs(hash % 24);
    const beatSec = 60 / bpm;
    const songSec = posMs > 0 ? posMs * 0.001 : timeSec;
    const beatPhase = (songSec / beatSec) % 1;
    const barPhase = (songSec / (beatSec * 4)) % 1;

    // Warm musical beat envelopes (never dead-zero between beats)
    const kickBounce = isPlaying
      ? 0.35 + 0.65 * Math.pow(0.5 + 0.5 * Math.cos(beatPhase * Math.PI * 2), 1.8)
      : 0;
    const offbeatGroove = isPlaying
      ? 0.35 + 0.65 * Math.pow(0.5 + 0.5 * Math.sin((beatPhase - 0.25) * Math.PI * 2), 1.6)
      : 0;
    const phraseSwell = isPlaying ? 0.82 + 0.18 * Math.sin(barPhase * Math.PI * 2) : 0;

    const count = config.bar_count;
    if (currentBins.length !== count) {
      currentBins = new Float32Array(count);
      peakBins = new Float32Array(count);
      peakHoldFrames = new Int16Array(count);
      peakVel = new Float32Array(count);
    }

    // Classic MP3 player full-spectrum equalizer synthesis
    for (let i = 0; i < count; i++) {
      const frac = i / (count - 1 || 1);
      let target = 0;

      if (!isPlaying) {
        // Classic paused low idle baseline
        target = 0.05;
      } else {
        // Distinct per-bin irrational oscillator rates so adjacent bars step naturally
        // like real graphic EQ bands without twitching or forming a plain sine wave
        const f1 = 2.2 + ((i * 7 + 3) % 11) * 0.38;
        const f2 = 3.6 + ((i * 13 + 5) % 13) * 0.42;
        const f3 = 5.4 + ((i * 17 + 2) % 9) * 0.48;
        const p1 = i * 1.73 + (hash & 63) * 0.1;
        const p2 = i * 2.91 + ((hash >> 4) & 63) * 0.13;
        const p3 = i * 4.17;

        const osc1 = 0.5 + 0.5 * Math.sin(timeSec * f1 + p1);
        const osc2 = 0.5 + 0.5 * Math.cos(timeSec * f2 + p2);
        const osc3 = 0.5 + 0.5 * Math.sin(timeSec * f3 + p3);
        const bandMod = 0.45 * osc1 + 0.35 * osc2 + 0.2 * osc3;

        // Classic musical spectrum contour across all bands:
        // - Bass (0..0.25): strong warm bounce (0.45..0.96)
        // - Low-Mid & Mid (0.25..0.70): rich melodic body (0.30..0.88), always active even without lyrics
        // - High-Mid & Treble (0.70..1.0): lively presence & air (0.22..0.78)
        const bassEnvelope = Math.exp(-frac * 4.2) * (0.45 + 0.55 * kickBounce);
        const midCenter = Math.exp(-Math.pow((frac - 0.42) / 0.28, 2));
        const midEnvelope =
          midCenter * (0.32 + 0.46 * bandMod + 0.16 * offbeatGroove + vocalBoost * 0.45);
        const highCenter = Math.exp(-Math.pow((frac - 0.78) / 0.24, 2));
        const trebleEnvelope =
          highCenter * (0.24 + 0.48 * (0.5 * osc2 + 0.5 * osc3) + 0.18 * offbeatGroove);

        // Per-band graphic EQ character so adjacent bars have classic stepped heights
        const eqBandCharacter = 0.82 + 0.24 * Math.sin(i * 2.45 + Math.cos(timeSec * 1.4 + i));

        target =
          (bassEnvelope * 0.58 + midEnvelope * 0.72 + trebleEnvelope * 0.68 + 0.12 * bandMod) *
          eqBandCharacter *
          phraseSwell *
          config.sensitivity;

        target = Math.max(0.1, Math.min(0.98, target));
      }

      // Classic Winamp / MP3 player ballistics:
      // - Smooth responsive rise (0.24 lerp)
      // - Steady, weighted linear + soft-exponential falloff (~0.016 per frame) so bars don't snap or jitter
      if (target > currentBins[i]) {
        currentBins[i] += (target - currentBins[i]) * 0.24;
      } else {
        const drop = Math.min(currentBins[i] - target, 0.015 + (currentBins[i] - target) * 0.06);
        currentBins[i] -= drop;
      }

      // Classic Peak-Hold Cap: holds at peak for ~20 frames (~330ms), then glides down gently
      if (currentBins[i] >= peakBins[i]) {
        peakBins[i] = currentBins[i];
        peakHoldFrames[i] = 20;
        peakVel[i] = 0.0015;
      } else if (peakHoldFrames[i] > 0) {
        peakHoldFrames[i]--;
      } else {
        peakVel[i] = Math.min(0.014, peakVel[i] + 0.00045);
        peakBins[i] = Math.max(currentBins[i], peakBins[i] - peakVel[i]);
      }
    }

    if (config.color_mode === "cover_accent") {
      updateAccentColor();
    }

    // Render by chosen style
    if (config.style === "bars") {
      renderBars(ctx2d, width, height, currentBins, peakBins, config, cachedAccentColor);
    } else if (config.style === "waves") {
      renderWaves(
        ctx2d,
        width,
        height,
        currentBins,
        peakBins,
        config,
        cachedAccentColor,
        timeSec,
        kickBounce
      );
    } else if (config.style === "particles") {
      renderParticles(
        ctx2d,
        width,
        height,
        currentBins,
        particles,
        config,
        cachedAccentColor,
        isPlaying ? kickBounce * 0.45 + vocalBoost * 0.35 : 0.05
      );
    }

    ctx2d.restore();
    animFrameId = requestAnimationFrame(renderFrame);
  }

  animFrameId = requestAnimationFrame(renderFrame);

  function updateConfig(newConfig: Record<string, any>) {
    config = {
      style: ["bars", "waves", "particles"].includes(newConfig.style)
        ? newConfig.style
        : config.style,
      bar_count: [16, 32, 48, 64].includes(newConfig.bar_count)
        ? newConfig.bar_count
        : config.bar_count,
      sensitivity:
        typeof newConfig.sensitivity === "number"
          ? Math.max(0.5, Math.min(2.0, newConfig.sensitivity))
          : config.sensitivity,
      color_mode: ["cover_accent", "white_glass", "neon_gradient"].includes(
        newConfig.color_mode
      )
        ? newConfig.color_mode
        : config.color_mode,
      mirror: newConfig.mirror !== undefined ? Boolean(newConfig.mirror) : config.mirror,
    };
    if (particles.length !== 56) {
      initParticles(56);
    }
  }

  function destroy() {
    isDestroyed = true;
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
    resizeObserver.disconnect();
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

    // Style Selector
    const styleGroup = document.createElement("div");
    styleGroup.innerHTML = `
      <label style="display: block; font-weight: 600; margin-bottom: 6px; font-size: 0.85rem; color: #94a3b8;">Visualizer Style</label>
      <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;">
        ${["bars", "waves", "particles"]
          .map(
            (s) => `
          <button type="button" data-style="${s}" class="StyleBtn" style="padding: 8px; border-radius: 8px; border: 1px solid ${
              liveConfig.style === s ? "#38bdf8" : "rgba(255,255,255,0.12)"
            }; background: ${
              liveConfig.style === s ? "rgba(56, 189, 248, 0.2)" : "rgba(255,255,255,0.06)"
            }; color: #fff; cursor: pointer; text-transform: capitalize; font-weight: 600;">
            ${s}
          </button>
        `
          )
          .join("")}
      </div>
    `;
    styleGroup.querySelectorAll<HTMLButtonElement>(".StyleBtn").forEach((btn) => {
      btn.addEventListener("click", () => {
        liveConfig.style = btn.dataset.style as any;
        styleGroup.querySelectorAll<HTMLButtonElement>(".StyleBtn").forEach((b) => {
          const active = b === btn;
          b.style.borderColor = active ? "#38bdf8" : "rgba(255,255,255,0.12)";
          b.style.background = active ? "rgba(56, 189, 248, 0.2)" : "rgba(255,255,255,0.06)";
        });
        onChange({ ...liveConfig });
      });
    });
    form.appendChild(styleGroup);

    // Bar Count (16, 32, 48, 64)
    const countGroup = document.createElement("div");
    countGroup.innerHTML = `
      <label style="display: block; font-weight: 600; margin-bottom: 6px; font-size: 0.85rem; color: #94a3b8;">Bar / Resolution Count</label>
      <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px;">
        ${[16, 32, 48, 64]
          .map(
            (c) => `
          <button type="button" data-count="${c}" class="CountBtn" style="padding: 8px; border-radius: 8px; border: 1px solid ${
              liveConfig.bar_count === c ? "#38bdf8" : "rgba(255,255,255,0.12)"
            }; background: ${
              liveConfig.bar_count === c ? "rgba(56, 189, 248, 0.2)" : "rgba(255,255,255,0.06)"
            }; color: #fff; cursor: pointer; font-weight: 600;">
            ${c}
          </button>
        `
          )
          .join("")}
      </div>
    `;
    countGroup.querySelectorAll<HTMLButtonElement>(".CountBtn").forEach((btn) => {
      btn.addEventListener("click", () => {
        liveConfig.bar_count = parseInt(btn.dataset.count!, 10) as any;
        countGroup.querySelectorAll<HTMLButtonElement>(".CountBtn").forEach((b) => {
          const active = b === btn;
          b.style.borderColor = active ? "#38bdf8" : "rgba(255,255,255,0.12)";
          b.style.background = active ? "rgba(56, 189, 248, 0.2)" : "rgba(255,255,255,0.06)";
        });
        onChange({ ...liveConfig });
      });
    });
    form.appendChild(countGroup);

    // Sensitivity Slider
    const sensGroup = document.createElement("div");
    const currentSens = typeof liveConfig.sensitivity === "number" ? liveConfig.sensitivity : 1.0;
    sensGroup.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
        <label style="font-weight: 600; font-size: 0.85rem; color: #94a3b8;">Sensitivity</label>
        <span class="SensValueBadge" style="font-size: 0.8rem; font-weight: 600; color: #38bdf8;">${currentSens.toFixed(2)}x</span>
      </div>
      <input type="range" min="0.5" max="2.0" step="0.1" value="${currentSens}" style="width: 100%; accent-color: #38bdf8; cursor: pointer;" />
    `;
    const sensRange = sensGroup.querySelector("input")!;
    const sensBadge = sensGroup.querySelector(".SensValueBadge")!;
    sensRange.addEventListener("input", () => {
      const s = parseFloat(sensRange.value);
      sensBadge.textContent = `${s.toFixed(2)}x`;
      liveConfig.sensitivity = s;
      onChange({ ...liveConfig });
    });
    form.appendChild(sensGroup);

    // Color Mode
    const colorGroup = document.createElement("div");
    colorGroup.innerHTML = `
      <label style="display: block; font-weight: 600; margin-bottom: 6px; font-size: 0.85rem; color: #94a3b8;">Color Palette</label>
      <select class="sl-select" style="width: 100%; box-sizing: border-box; padding: 8px 12px; border-radius: 8px; background: rgba(255, 255, 255, 0.07); border: 1px solid rgba(255, 255, 255, 0.15); color: #fff; outline: none; cursor: pointer;">
        <option value="cover_accent" ${liveConfig.color_mode === "cover_accent" ? "selected" : ""}>Album Art Accent</option>
        <option value="white_glass" ${liveConfig.color_mode === "white_glass" ? "selected" : ""}>Frosted White Glass</option>
        <option value="neon_gradient" ${liveConfig.color_mode === "neon_gradient" ? "selected" : ""}>Neon Cyberpunk Gradient</option>
      </select>
    `;
    const colorSelect = colorGroup.querySelector("select")!;
    colorSelect.addEventListener("change", () => {
      liveConfig.color_mode = colorSelect.value as any;
      onChange({ ...liveConfig });
    });
    form.appendChild(colorGroup);

    // Mirror Toggle
    const mirrorGroup = document.createElement("div");
    mirrorGroup.style.cssText = "display: flex; align-items: center; gap: 10px; margin-top: 4px;";
    mirrorGroup.innerHTML = `
      <input type="checkbox" id="vis_mirror_chk" ${liveConfig.mirror ? "checked" : ""} style="width: 18px; height: 18px; accent-color: #38bdf8; cursor: pointer;" />
      <label for="vis_mirror_chk" style="cursor: pointer; font-size: 0.85rem; color: #e2e8f0;">Symmetrical Center Mirror</label>
    `;
    const mirrorChk = mirrorGroup.querySelector("input")!;
    mirrorChk.addEventListener("change", () => {
      liveConfig.mirror = mirrorChk.checked;
      onChange({ ...liveConfig });
    });
    form.appendChild(mirrorGroup);

    return form;
  }

  return {
    element: container,
    updateConfig,
    destroy,
    renderSettingsForm,
  };
}

function getStyleGradient(
  ctx: CanvasRenderingContext2D,
  height: number,
  mode: VisualizerWidgetConfig["color_mode"],
  accent: { r: number; g: number; b: number }
): CanvasGradient {
  const grad = ctx.createLinearGradient(0, height, 0, 0);
  if (mode === "cover_accent") {
    grad.addColorStop(0, `rgba(${accent.r}, ${accent.g}, ${accent.b}, 0.65)`);
    grad.addColorStop(0.6, `rgba(${accent.r}, ${accent.g}, ${accent.b}, 0.95)`);
    grad.addColorStop(
      1,
      `rgba(${Math.min(255, accent.r + 95)}, ${Math.min(255, accent.g + 95)}, ${Math.min(255, accent.b + 95)}, 1.0)`
    );
  } else if (mode === "white_glass") {
    grad.addColorStop(0, "rgba(255, 255, 255, 0.5)");
    grad.addColorStop(0.6, "rgba(255, 255, 255, 0.88)");
    grad.addColorStop(1, "rgba(255, 255, 255, 1.0)");
  } else {
    // neon_gradient
    grad.addColorStop(0, "rgba(6, 182, 212, 0.7)");
    grad.addColorStop(0.5, "rgba(168, 85, 247, 0.92)");
    grad.addColorStop(1, "rgba(244, 63, 94, 1.0)");
  }
  return grad;
}

function getPeakCapColor(
  mode: VisualizerWidgetConfig["color_mode"],
  accent: { r: number; g: number; b: number }
): string {
  if (mode === "neon_gradient") return "#f43f5e";
  if (mode === "white_glass") return "#ffffff";
  return `rgb(${Math.min(255, accent.r + 110)}, ${Math.min(255, accent.g + 110)}, ${Math.min(255, accent.b + 110)})`;
}

function renderBars(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  bins: Float32Array,
  peaks: Float32Array,
  config: VisualizerWidgetConfig,
  accent: { r: number; g: number; b: number }
) {
  const count = bins.length;
  const padX = Math.max(6, Math.min(12, Math.floor(width * 0.035)));
  const padY = Math.max(5, Math.min(10, Math.floor(height * 0.08)));
  const availW = Math.max(10, width - padX * 2);
  const availH = Math.max(10, height - padY * 2);
  const barGap = Math.max(1.5, Math.min(4, Math.floor(availW / (count * 4.2))));
  const barWidth = Math.max(2, (availW - barGap * (count - 1)) / count);
  const fillStyle = getStyleGradient(ctx, height, config.color_mode, accent);
  const capColor = getPeakCapColor(config.color_mode, accent);

  // Classic LED segmentation: fine 2.5px blocks in compact 1-row widgets, 3.5px in taller widgets
  const useSegments = availH >= 28 && !config.mirror;
  const segHeight = availH < 64 ? 2.5 : 3.5;
  const segGap = availH < 64 ? 1 : 1.5;
  const segStep = segHeight + segGap;

  for (let i = 0; i < count; i++) {
    const x = Math.round(padX + i * (barWidth + barGap));
    const bw = Math.max(2, Math.round(barWidth));
    const val = bins[i];
    const peakVal = peaks[i];

    if (config.mirror) {
      const halfBarH = Math.max(2, Math.round((val * availH) / 2));
      const centerY = Math.round(height / 2);
      ctx.fillStyle = fillStyle;
      ctx.fillRect(x, centerY - halfBarH, bw, halfBarH * 2);

      const halfPeakH = Math.max(halfBarH + 2, Math.round((peakVal * availH) / 2));
      ctx.fillStyle = capColor;
      ctx.fillRect(x, Math.max(padY, centerY - halfPeakH - 2), bw, 2);
      ctx.fillRect(x, Math.min(height - padY - 2, centerY + halfPeakH), bw, 2);
    } else {
      const bottomY = height - padY;
      const barH = Math.max(segHeight, val * availH);

      ctx.fillStyle = fillStyle;
      if (useSegments) {
        const numSegs = Math.max(1, Math.floor(barH / segStep));
        for (let s = 0; s < numSegs; s++) {
          const sy = Math.round(bottomY - (s + 1) * segStep + segGap);
          ctx.fillRect(x, sy, bw, Math.ceil(segHeight));
        }
        // Snap peak cap to LED segment grid right above the top segment
        const peakSegs = Math.max(numSegs, Math.floor((peakVal * availH) / segStep));
        const capY = Math.max(padY, Math.round(bottomY - (peakSegs + 1) * segStep + segGap));
        ctx.fillStyle = capColor;
        ctx.fillRect(x, capY, bw, Math.max(2, Math.floor(segHeight * 0.75)));
      } else {
        const topY = Math.round(bottomY - barH);
        ctx.fillRect(x, topY, bw, Math.round(barH));
        const peakH = Math.max(barH, Math.round(peakVal * availH));
        const capY = Math.max(padY, Math.round(bottomY - peakH - 3));
        ctx.fillStyle = capColor;
        ctx.fillRect(x, capY, bw, 2);
      }
    }
  }
}

function renderWaves(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  bins: Float32Array,
  peaks: Float32Array,
  config: VisualizerWidgetConfig,
  accent: { r: number; g: number; b: number },
  timeSec: number,
  kickEnv: number
) {
  const count = bins.length;
  const fillStyle = getStyleGradient(ctx, height, config.color_mode, accent);
  const capColor = getPeakCapColor(config.color_mode, accent);
  const baseY = config.mirror ? height / 2 : height - Math.max(6, Math.floor(height * 0.1));
  const maxAmp = config.mirror ? height * 0.44 : height * 0.8;

  // 1. Secondary crisp peak-envelope silhouette behind primary spectrum ridge
  ctx.beginPath();
  ctx.moveTo(0, baseY);
  for (let i = 0; i < count; i++) {
    const x = (i / (count - 1)) * width;
    const h = peaks[i] * maxAmp;
    ctx.lineTo(x, baseY - h);
  }
  ctx.lineTo(width, baseY);
  ctx.closePath();
  ctx.fillStyle = fillStyle;
  ctx.globalAlpha = 0.2;
  ctx.fill();

  // 2. Primary angular spectrum ridge (sharp vertices, no mushy quadratic curve smoothing)
  const subSteps = 2;
  const totalPts = (count - 1) * subSteps + 1;
  ctx.beginPath();
  ctx.moveTo(0, baseY);

  for (let p = 0; p < totalPts; p++) {
    const exactIdx = p / subSteps;
    const i0 = Math.floor(exactIdx);
    const i1 = Math.min(count - 1, i0 + 1);
    const t = exactIdx - i0;
    const x = (p / (totalPts - 1)) * width;
    const baseVal = bins[i0] * (1 - t) + bins[i1] * t;
    // High-frequency crisp harmonic tooth on sub-steps
    const jag =
      p % 2 === 1
        ? (0.82 + 0.34 * Math.sin(timeSec * 28 + p * 2.7)) * (1 + kickEnv * 0.25)
        : 1.0;
    const h = Math.min(maxAmp, Math.max(2, baseVal * maxAmp * jag));
    ctx.lineTo(x, baseY - h);
  }

  ctx.lineTo(width, baseY);

  if (config.mirror) {
    for (let p = totalPts - 1; p >= 0; p--) {
      const exactIdx = p / subSteps;
      const i0 = Math.floor(exactIdx);
      const i1 = Math.min(count - 1, i0 + 1);
      const t = exactIdx - i0;
      const x = (p / (totalPts - 1)) * width;
      const baseVal = bins[i0] * (1 - t) + bins[i1] * t;
      const jag = p % 2 === 1 ? 0.85 : 1.0;
      const h = Math.min(maxAmp, Math.max(2, baseVal * maxAmp * jag));
      ctx.lineTo(x, baseY + h);
    }
  }

  ctx.closePath();
  ctx.fillStyle = fillStyle;
  ctx.globalAlpha = 0.55;
  ctx.fill();

  // Sharp high-contrast top edge line
  ctx.globalAlpha = 1.0;
  ctx.lineWidth = 2;
  ctx.lineJoin = "miter";
  ctx.strokeStyle = capColor;
  ctx.stroke();
}

function renderParticles(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  bins: Float32Array,
  particles: Particle[],
  config: VisualizerWidgetConfig,
  accent: { r: number; g: number; b: number },
  overallEnergy: number
) {
  const colorStr =
    config.color_mode === "white_glass"
      ? "255, 255, 255"
      : config.color_mode === "neon_gradient"
      ? "244, 63, 94"
      : `${accent.r}, ${accent.g}, ${accent.b}`;

  const cx = width / 2;
  const cy = height / 2;
  const speedMult = 0.6 + overallEnergy * 5.5;

  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    const binVal = bins[p.binIndex % bins.length] || 0.1;

    // Radial warp burst from center driven by beat + bin energy
    const prevX = p.x * width;
    const prevY = p.y * height;

    p.x += p.vx * speedMult * (0.7 + binVal * 1.8);
    p.y += p.vy * speedMult * (0.7 + binVal * 1.8);

    if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) {
      const angle = (i / particles.length) * Math.PI * 2 + overallEnergy * 2.1;
      const speed = 0.0028 + (i % 5) * 0.001;
      p.x = 0.5 + Math.cos(angle) * 0.04;
      p.y = 0.5 + Math.sin(angle) * 0.04;
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed;
      continue;
    }

    const px = p.x * width;
    const py = p.y * height;
    const alpha = Math.min(1.0, 0.35 + binVal * 0.65);

    // Draw sharp velocity streak
    const streakdx = (px - cx) * (0.06 + binVal * 0.16);
    const streakdy = (py - cy) * (0.06 + binVal * 0.16);
    ctx.beginPath();
    ctx.moveTo(px - streakdx, py - streakdy);
    ctx.lineTo(px, py);
    ctx.strokeStyle = `rgba(${colorStr}, ${alpha * 0.85})`;
    ctx.lineWidth = Math.max(1.2, p.baseRadius * 0.75);
    ctx.stroke();

    // Draw crisp diamond spark head (not a soft circle)
    const r = Math.max(1.8, p.baseRadius * (0.8 + binVal * 1.4));
    ctx.beginPath();
    ctx.moveTo(px, py - r);
    ctx.lineTo(px + r, py);
    ctx.lineTo(px, py + r);
    ctx.lineTo(px - r, py);
    ctx.closePath();
    ctx.fillStyle = binVal > 0.65 ? "#ffffff" : `rgba(${colorStr}, ${alpha})`;
    ctx.fill();

    // Keep unused vars clean
    void prevX;
    void prevY;
  }
}

