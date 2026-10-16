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

  // Smoothing buffers for spectrum bins
  let currentBins = new Float32Array(config.bar_count);
  let particles: Particle[] = [];

  function initParticles(count: number) {
    particles = [];
    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random(),
        y: Math.random(),
        baseRadius: 2 + Math.random() * 3,
        vx: (Math.random() - 0.5) * 0.002,
        vy: (Math.random() - 0.5) * 0.002,
        binIndex: Math.floor(Math.random() * config.bar_count),
      });
    }
  }
  initParticles(45);

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
        off.width = 1;
        off.height = 1;
        const offCtx = off.getContext("2d");
        if (offCtx) {
          offCtx.drawImage(img, 0, 0, 1, 1);
          const pixel = offCtx.getImageData(0, 0, 1, 1).data;
          // Ensure color is not too dark
          const brightness = (pixel[0] * 299 + pixel[1] * 587 + pixel[2] * 114) / 1000;
          if (brightness > 30) {
            cachedAccentColor = { r: pixel[0], g: pixel[1], b: pixel[2] };
          }
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

    // Check vocal activity from LyricsObject
    let vocalBoost = 0;
    if (isPlaying) {
      try {
        const syllableLines = LyricsObject?.Types?.Syllable?.Lines;
        if (syllableLines && syllableLines.length > 0) {
          for (const line of syllableLines) {
            if (line.Status === "Active" || (posMs >= line.StartTime && posMs <= line.EndTime)) {
              vocalBoost = 0.45;
              const leads = line.Syllables?.Lead;
              if (leads) {
                for (const lead of leads) {
                  if (posMs >= lead.StartTime && posMs <= lead.EndTime) {
                    vocalBoost = 0.85;
                    break;
                  }
                  if (Math.abs(posMs - lead.StartTime) < 140) {
                    vocalBoost = 1.0;
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
            for (const line of syncedLines) {
              if (line.Status === "Active" || (posMs >= line.StartTime && posMs <= line.EndTime)) {
                vocalBoost = 0.6;
                break;
              }
            }
          }
        }
      } catch {
        // Fallback gracefully
      }
    }

    // Track tempo / oscillators
    const track = ctx.getLatestState()?.track;
    const trackSeed = track?.id || track?.title || "kiosk";
    let hash = 0;
    for (let i = 0; i < trackSeed.length; i++) {
      hash = (hash << 5) - hash + trackSeed.charCodeAt(i);
      hash |= 0;
    }
    const bpm = 100 + Math.abs(hash % 35);
    const beatPeriod = (60 / bpm) * 1000;
    const beatPhase = (posMs % beatPeriod) / beatPeriod;
    const beatPulse = isPlaying ? Math.exp(-beatPhase * 4.5) : 0;

    const count = config.bar_count;
    if (currentBins.length !== count) {
      currentBins = new Float32Array(count);
    }

    // Compute target spectrum
    for (let i = 0; i < count; i++) {
      const frac = i / (count - 1 || 1);
      let target = 0;

      if (!isPlaying) {
        // Serene breathing idle mode
        target = 0.05 + 0.04 * Math.sin(timeSec * 1.8 + i * 0.25);
      } else {
        // Bass range
        const isBass = frac < 0.25;
        const bassVal = isBass ? beatPulse * (1 - frac / 0.25) * 0.9 : 0;

        // Vocal / mid range
        const isMid = frac >= 0.2 && frac <= 0.7;
        const midVal = isMid ? vocalBoost * (1 - Math.abs(frac - 0.45) / 0.25) : 0;

        // Treble shimmer
        const isTreble = frac > 0.65;
        const trebleVal = isTreble
          ? 0.2 * Math.sin(timeSec * 12 + i * 2.3) * (0.5 + beatPulse * 0.5)
          : 0;

        // Harmonic oscillation
        const harmonic =
          0.15 * Math.sin(timeSec * (2 + frac * 6) + i * 0.5) +
          0.1 * Math.cos(timeSec * 4 + i);

        target = (bassVal + midVal + trebleVal + harmonic + 0.08) * config.sensitivity;
        target = Math.max(0.04, Math.min(1.0, target));
      }

      // Smooth attack and release
      const factor = target > currentBins[i] ? 0.35 : 0.16;
      currentBins[i] += (target - currentBins[i]) * factor;
    }

    if (config.color_mode === "cover_accent") {
      updateAccentColor();
    }

    // Render by chosen style
    if (config.style === "bars") {
      renderBars(ctx2d, width, height, currentBins, config, cachedAccentColor);
    } else if (config.style === "waves") {
      renderWaves(ctx2d, width, height, currentBins, config, cachedAccentColor, timeSec);
    } else if (config.style === "particles") {
      renderParticles(
        ctx2d,
        width,
        height,
        currentBins,
        particles,
        config,
        cachedAccentColor,
        isPlaying ? beatPulse + vocalBoost : 0.1
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
    if (particles.length !== 45) {
      initParticles(45);
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
    grad.addColorStop(0, `rgba(${accent.r}, ${accent.g}, ${accent.b}, 0.2)`);
    grad.addColorStop(0.7, `rgba(${accent.r}, ${accent.g}, ${accent.b}, 0.85)`);
    grad.addColorStop(1, `rgba(${Math.min(255, accent.r + 60)}, ${Math.min(255, accent.g + 60)}, ${Math.min(255, accent.b + 60)}, 1.0)`);
  } else if (mode === "white_glass") {
    grad.addColorStop(0, "rgba(255, 255, 255, 0.15)");
    grad.addColorStop(0.6, "rgba(255, 255, 255, 0.65)");
    grad.addColorStop(1, "rgba(255, 255, 255, 0.95)");
  } else {
    // neon_gradient
    grad.addColorStop(0, "rgba(6, 182, 212, 0.3)");
    grad.addColorStop(0.5, "rgba(168, 85, 247, 0.85)");
    grad.addColorStop(1, "rgba(244, 63, 94, 1.0)");
  }
  return grad;
}

function renderBars(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  bins: Float32Array,
  config: VisualizerWidgetConfig,
  accent: { r: number; g: number; b: number }
) {
  const count = bins.length;
  const padding = 12;
  const availW = width - padding * 2;
  const barGap = Math.max(2, Math.floor(availW / (count * 4)));
  const barWidth = Math.max(2, (availW - barGap * (count - 1)) / count);
  const fillStyle = getStyleGradient(ctx, height, config.color_mode, accent);

  ctx.fillStyle = fillStyle;

  for (let i = 0; i < count; i++) {
    const x = padding + i * (barWidth + barGap);
    const val = bins[i];

    if (config.mirror) {
      const halfBarH = Math.max(2, (val * (height - 24)) / 2);
      const centerY = height / 2;
      const top = centerY - halfBarH;
      const h = halfBarH * 2;
      drawRoundedRect(ctx, x, top, barWidth, h, barWidth / 2);
    } else {
      const barH = Math.max(3, val * (height - 24));
      const y = height - 12 - barH;
      drawRoundedRect(ctx, x, y, barWidth, barH, barWidth / 2);
    }
  }
}

function renderWaves(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  bins: Float32Array,
  config: VisualizerWidgetConfig,
  accent: { r: number; g: number; b: number },
  timeSec: number
) {
  const count = bins.length;
  const fillStyle = getStyleGradient(ctx, height, config.color_mode, accent);
  const centerY = config.mirror ? height / 2 : height - 14;

  ctx.beginPath();
  ctx.moveTo(0, centerY);

  for (let i = 0; i < count; i++) {
    const x = (i / (count - 1)) * width;
    const waveSin = Math.sin(timeSec * 3 + i * 0.4) * 4;
    const h = bins[i] * (height * 0.65) + waveSin;
    const y = centerY - h;

    if (i === 0) {
      ctx.lineTo(x, y);
    } else {
      const prevX = ((i - 1) / (count - 1)) * width;
      const prevWaveSin = Math.sin(timeSec * 3 + (i - 1) * 0.4) * 4;
      const prevY = centerY - (bins[i - 1] * (height * 0.65) + prevWaveSin);
      const cx = (prevX + x) / 2;
      ctx.quadraticCurveTo(prevX, prevY, cx, (prevY + y) / 2);
    }
  }

  ctx.lineTo(width, centerY);

  if (config.mirror) {
    // Draw mirrored lower wave
    for (let i = count - 1; i >= 0; i--) {
      const x = (i / (count - 1)) * width;
      const waveSin = Math.sin(timeSec * 3 + i * 0.4) * 4;
      const h = bins[i] * (height * 0.65) + waveSin;
      const y = centerY + h;
      ctx.lineTo(x, y);
    }
  }

  ctx.closePath();
  ctx.fillStyle = fillStyle;
  ctx.globalAlpha = 0.55;
  ctx.fill();

  // Glow stroke on top edge
  ctx.globalAlpha = 1.0;
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = fillStyle;
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
      ? "168, 85, 247"
      : `${accent.r}, ${accent.g}, ${accent.b}`;

  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    p.x += p.vx * (1 + overallEnergy * 2);
    p.y += p.vy * (1 + overallEnergy * 2);

    if (p.x < 0) p.x = 1;
    if (p.x > 1) p.x = 0;
    if (p.y < 0) p.y = 1;
    if (p.y > 1) p.y = 0;

    const binVal = bins[p.binIndex % bins.length] || 0.1;
    const px = p.x * width;
    const py = p.y * height;
    const r = p.baseRadius * (1 + binVal * 1.8);
    const alpha = Math.min(1.0, 0.25 + binVal * 0.7);

    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${colorStr}, ${alpha})`;
    ctx.fill();

    // Subtle connection lines between near neighbors
    for (let j = i + 1; j < particles.length; j++) {
      const p2 = particles[j];
      const dx = (p.x - p2.x) * width;
      const dy = (p.y - p2.y) * height;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 65) {
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(p2.x * width, p2.y * height);
        ctx.strokeStyle = `rgba(${colorStr}, ${(1 - dist / 65) * 0.25 * alpha})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  }
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
  ctx.fill();
}
