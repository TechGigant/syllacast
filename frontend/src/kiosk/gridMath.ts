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

export const GRID_COLS = 24;
export const GRID_ROWS = 12;

export interface GridRect {
  x: number; // 1-indexed column (1..24)
  y: number; // 1-indexed row (1..12)
  w: number; // column span (1..24)
  h: number; // row span (1..12)
}

export interface WidgetPlacement extends GridRect {
  id: string;
  minW?: number;
  minH?: number;
}

/**
 * Clamps a grid rectangle so it remains strictly inside the 24x12 bounds
 * and respects minimum width/height constraints.
 */
export function clampWidgetRect(
  rect: GridRect,
  minW = 1,
  minH = 1
): GridRect {
  const safeMinW = Math.max(1, Math.min(minW, GRID_COLS));
  const safeMinH = Math.max(1, Math.min(minH, GRID_ROWS));

  const w = Math.max(safeMinW, Math.min(rect.w, GRID_COLS));
  const h = Math.max(safeMinH, Math.min(rect.h, GRID_ROWS));

  const maxX = GRID_COLS - w + 1;
  const maxY = GRID_ROWS - h + 1;

  const x = Math.max(1, Math.min(rect.x, maxX));
  const y = Math.max(1, Math.min(rect.y, maxY));

  return { x, y, w, h };
}

/**
 * Returns true if two 1-indexed grid rectangles intersect.
 * [x, x + w - 1] x [y, y + h - 1]
 */
export function rectsOverlap(a: GridRect, b: GridRect): boolean {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

/**
 * Scans the 24x12 grid row-by-row (y = 1..12-h+1, x = 1..24-w+1) to find the first
 * non-overlapping slot for a new widget of span w x h.
 * Falls back to center coordinates if the grid is full.
 */
export function findOpenSlot(
  existing: GridRect[],
  w: number,
  h: number
): { x: number; y: number } {
  const clampedW = Math.max(1, Math.min(w, GRID_COLS));
  const clampedH = Math.max(1, Math.min(h, GRID_ROWS));

  const maxX = GRID_COLS - clampedW + 1;
  const maxY = GRID_ROWS - clampedH + 1;

  for (let y = 1; y <= maxY; y++) {
    for (let x = 1; x <= maxX; x++) {
      const candidate: GridRect = { x, y, w: clampedW, h: clampedH };
      const collides = existing.some((item) => rectsOverlap(candidate, item));
      if (!collides) {
        return { x, y };
      }
    }
  }

  // Fallback to center position
  return {
    x: Math.max(1, Math.floor((GRID_COLS - clampedW) / 2) + 1),
    y: Math.max(1, Math.floor((GRID_ROWS - clampedH) / 2) + 1),
  };
}

/**
 * Resolves collisions when moving or resizing a widget.
 * Attempts to nudge collided widgets downward (y = blocker.y + blocker.h)
 * or horizontally to the right if vertical push exceeds GRID_ROWS.
 * If any widget cannot fit without overflowing 24x12, keeps all widgets clamped
 * and marks hasUnresolvedOverlap = true.
 */
export function resolveGridCollisions<T extends GridRect & { id: string }>(
  widgets: T[],
  movedWidget: T
): { widgets: T[]; hasUnresolvedOverlap: boolean } {
  // Deep clone widget list
  const result: T[] = widgets.map((w) =>
    w.id === movedWidget.id
      ? { ...movedWidget, ...clampWidgetRect(movedWidget, (w as any).minW ?? 1, (w as any).minH ?? 1) }
      : { ...w }
  );

  const active = result.find((w) => w.id === movedWidget.id)!;
  let hasUnresolvedOverlap = false;

  // Multi-pass push resolution (up to 12 passes for cascading pushes)
  const maxPasses = 12;
  for (let pass = 0; pass < maxPasses; pass++) {
    let collisionFound = false;

    for (let i = 0; i < result.length; i++) {
      const current = result[i];

      for (let j = 0; j < result.length; j++) {
        if (i === j) continue;
        const other = result[j];

        if (rectsOverlap(current, other)) {
          collisionFound = true;

          // Prefer pushing `other` away if `current` is the active moved widget
          // or has a lower index
          const blocker = current.id === movedWidget.id ? current : (other.id === movedWidget.id ? other : current);
          const target = blocker === current ? other : current;

          // Attempt vertical push down
          const nextY = blocker.y + blocker.h;
          if (nextY + target.h - 1 <= GRID_ROWS) {
            target.y = nextY;
          } else {
            // If downward push overflows, attempt horizontal nudge right
            const nextX = blocker.x + blocker.w;
            if (nextX + target.w - 1 <= GRID_COLS) {
              target.x = nextX;
            } else {
              // Cannot fit non-overlapping within bounds
              hasUnresolvedOverlap = true;
            }
          }
        }
      }
    }

    if (!collisionFound) break;
  }

  // Ensure every widget is clamped inside the 24x12 grid
  for (let i = 0; i < result.length; i++) {
    const clamped = clampWidgetRect(
      result[i],
      (result[i] as any).minW ?? 1,
      (result[i] as any).minH ?? 1
    );
    result[i].x = clamped.x;
    result[i].y = clamped.y;
    result[i].w = clamped.w;
    result[i].h = clamped.h;
  }

  // Final check for any remaining overlap
  for (let i = 0; i < result.length; i++) {
    for (let j = i + 1; j < result.length; j++) {
      if (rectsOverlap(result[i], result[j])) {
        hasUnresolvedOverlap = true;
        break;
      }
    }
    if (hasUnresolvedOverlap) break;
  }

  return { widgets: result, hasUnresolvedOverlap };
}

/**
 * Computes snap guides (grid center col 13 / row 7, or alignment with edges/centers of other widgets).
 */
export function computeSnapGuides(
  activeRect: GridRect,
  otherRects: GridRect[]
): { verticalCols: number[]; horizontalRows: number[] } {
  const verticalSet = new Set<number>();
  const horizontalSet = new Set<number>();

  const activeLeft = activeRect.x;
  const activeRight = activeRect.x + activeRect.w;
  const activeCenterX = activeRect.x + activeRect.w / 2;

  const activeTop = activeRect.y;
  const activeBottom = activeRect.y + activeRect.h;
  const activeCenterY = activeRect.y + activeRect.h / 2;

  // Grid Canvas Centers
  // 24 columns: line 13 is center
  if (
    activeLeft === 13 ||
    activeRight === 13 ||
    Math.abs(activeCenterX - 13) < 0.01
  ) {
    verticalSet.add(13);
  }

  // 12 rows: line 7 is center
  if (
    activeTop === 7 ||
    activeBottom === 7 ||
    Math.abs(activeCenterY - 7) < 0.01
  ) {
    horizontalSet.add(7);
  }

  // Check alignment with other widgets
  for (const other of otherRects) {
    const oLeft = other.x;
    const oRight = other.x + other.w;
    const oCenterX = other.x + other.w / 2;

    const oTop = other.y;
    const oBottom = other.y + other.h;
    const oCenterY = other.y + other.h / 2;

    // Vertical alignment (X)
    if (activeLeft === oLeft || activeRight === oLeft) verticalSet.add(oLeft);
    if (activeLeft === oRight || activeRight === oRight) verticalSet.add(oRight);
    if (Math.abs(activeCenterX - oCenterX) < 0.01) verticalSet.add(oCenterX);

    // Horizontal alignment (Y)
    if (activeTop === oTop || activeBottom === oTop) horizontalSet.add(oTop);
    if (activeTop === oBottom || activeBottom === oBottom) horizontalSet.add(oBottom);
    if (Math.abs(activeCenterY - oCenterY) < 0.01) horizontalSet.add(oCenterY);
  }

  return {
    verticalCols: Array.from(verticalSet).sort((a, b) => a - b),
    horizontalRows: Array.from(horizontalSet).sort((a, b) => a - b),
  };
}

/**
 * Returns true if an event target or the current active element is an input, textarea,
 * select, or contenteditable element, preventing keyboard shortcuts from triggering.
 */
export function isTypingInInput(target: EventTarget | null = null): boolean {
  const el =
    (target && typeof (target as any).tagName === "string"
      ? (target as HTMLElement)
      : null) ??
    (typeof document !== "undefined"
      ? (document.activeElement as HTMLElement | null)
      : null);

  if (!el) return false;

  const tagName = el.tagName?.toUpperCase();
  if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") {
    return true;
  }

  if (el.isContentEditable) {
    return true;
  }

  return false;
}

/**
 * Converts mouse/touch client coordinates relative to container bounding rect
 * to 1-indexed (col, row) coordinates in the 24x12 grid, accounting for inner padding if provided.
 */
export function pointerToGridCoord(
  clientX: number,
  clientY: number,
  containerRect: DOMRect,
  padding: { top?: number; right?: number; bottom?: number; left?: number } = {}
): { col: number; row: number } {
  const padLeft = padding.left ?? 0;
  const padRight = padding.right ?? 0;
  const padTop = padding.top ?? 0;
  const padBottom = padding.bottom ?? 0;

  const innerW = Math.max(1, containerRect.width - padLeft - padRight);
  const innerH = Math.max(1, containerRect.height - padTop - padBottom);

  const relX = clientX - (containerRect.left + padLeft);
  const relY = clientY - (containerRect.top + padTop);

  const colWidth = innerW / GRID_COLS;
  const rowHeight = innerH / GRID_ROWS;

  const col = Math.max(1, Math.min(GRID_COLS, Math.floor(relX / colWidth) + 1));
  const row = Math.max(1, Math.min(GRID_ROWS, Math.floor(relY / rowHeight) + 1));

  return { col, row };
}

export interface AspectRatioPreset {
  id: string;
  label: string;
  shortLabel: string;
  ratio: number | null; // null for "any"
}

export const ASPECT_RATIO_PRESETS: AspectRatioPreset[] = [
  { id: "any", label: "Auto (Match Screen)", shortLabel: "Auto", ratio: null },
  { id: "16:9", label: "16:9 Widescreen (TV / Monitor)", shortLabel: "16:9", ratio: 16 / 9 },
  { id: "16:10", label: "16:10 Monitor / Tablet", shortLabel: "16:10", ratio: 16 / 10 },
  { id: "5:3", label: "5:3 Pi Display (800×480)", shortLabel: "5:3", ratio: 5 / 3 },
  { id: "3:2", label: "3:2 Display", shortLabel: "3:2", ratio: 3 / 2 },
  { id: "4:3", label: "4:3 Classic / iPad", shortLabel: "4:3", ratio: 4 / 3 },
  { id: "21:9", label: "21:9 Ultrawide", shortLabel: "21:9", ratio: 21 / 9 },
  { id: "1:1", label: "1:1 Square", shortLabel: "1:1", ratio: 1 },
  { id: "9:16", label: "9:16 Portrait Kiosk", shortLabel: "9:16", ratio: 9 / 16 },
  { id: "10:16", label: "10:16 Portrait Tablet", shortLabel: "10:16", ratio: 10 / 16 },
];

/**
 * Parses an aspect ratio string like "16:9", "5:3", "21:9", or a numeric ratio into W/H.
 * Returns null for "any", "auto", or invalid inputs.
 */
export function parseAspectRatio(ratioStr?: string | number | null): number | null {
  if (typeof ratioStr === "number") {
    return Number.isFinite(ratioStr) && ratioStr > 0 ? ratioStr : null;
  }
  if (!ratioStr || typeof ratioStr !== "string") return null;
  const trimmed = ratioStr.trim().toLowerCase();
  if (!trimmed || trimmed === "any" || trimmed === "auto") return null;

  const preset = ASPECT_RATIO_PRESETS.find((p) => p.id.toLowerCase() === trimmed);
  if (preset && preset.ratio !== null) {
    return preset.ratio;
  }

  const parts = trimmed.split(/[:/x×]/);
  if (parts.length === 2) {
    const w = parseFloat(parts[0]);
    const h = parseFloat(parts[1]);
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      return w / h;
    }
  }

  const num = parseFloat(trimmed);
  if (Number.isFinite(num) && num > 0) {
    return num;
  }

  return null;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y !== 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

/**
 * Detects the screen's aspect ratio and finds the closest standard display preset.
 */
export function detectScreenAspectRatio(
  width: number,
  height: number
): {
  ratio: number;
  presetId: string;
  closestPreset: string;
  closestLabel: string;
  exactRatioText: string;
} {
  const safeW = Math.max(1, Math.round(width));
  const safeH = Math.max(1, Math.round(height));
  const ratio = safeW / safeH;

  const divisor = gcd(safeW, safeH);
  const simpW = Math.round(safeW / divisor);
  const simpH = Math.round(safeH / divisor);
  const exactRatioText =
    simpW <= 64 && simpH <= 64
      ? `${simpW}:${simpH}`
      : `${ratio.toFixed(2)}:1`;

  let bestPreset = ASPECT_RATIO_PRESETS[1]; // default 16:9
  let bestDist = Infinity;

  for (const preset of ASPECT_RATIO_PRESETS) {
    if (preset.ratio === null) continue;
    const dist = Math.abs(Math.log(ratio / preset.ratio));
    if (dist < bestDist) {
      bestDist = dist;
      bestPreset = preset;
    }
  }

  return {
    ratio,
    presetId: bestPreset.id,
    closestPreset: bestPreset.id,
    closestLabel: bestPreset.shortLabel,
    exactRatioText,
  };
}

/**
 * Finds the profile whose `target_aspect_ratio` is closest to the given screen aspect ratio
 * using symmetric logarithmic ratio distance |ln(screenRatio / profileRatio)|.
 * Supports both `(profiles, activeProfileId, screenRatio, autoSwitch)` and `(profiles, width, height)`.
 */
export function findBestProfileForAspectRatio<
  T extends { id: string; target_aspect_ratio?: string }
>(
  profiles: T[],
  arg2: string | number,
  arg3: number,
  autoSwitch = true
): T | null {
  if (!profiles || profiles.length === 0) return null;

  let activeProfileId: string | null = null;
  let screenRatio = 16 / 9;

  if (typeof arg2 === "string") {
    activeProfileId = arg2;
    screenRatio = arg3 > 0 ? arg3 : 16 / 9;
    if (!autoSwitch) {
      return profiles.find((p) => p.id === activeProfileId) || profiles[0] || null;
    }
  } else {
    const safeW = Math.max(1, arg2);
    const safeH = Math.max(1, arg3);
    screenRatio = safeW / safeH;
  }

  let bestProfile: T | null = null;
  let bestDistance = Infinity;

  for (const profile of profiles) {
    const targetRatio = parseAspectRatio(profile.target_aspect_ratio);
    if (targetRatio === null) continue;

    const distance = Math.abs(Math.log(screenRatio / targetRatio));
    if (distance < bestDistance - 1e-6) {
      bestDistance = distance;
      bestProfile = profile;
    } else if (
      Math.abs(distance - bestDistance) <= 1e-6 &&
      activeProfileId &&
      profile.id === activeProfileId
    ) {
      bestProfile = profile;
    }
  }

  if (!bestProfile && activeProfileId) {
    return profiles.find((p) => p.id === activeProfileId) || profiles[0] || null;
  }

  return bestProfile;
}

/**
 * Computes the letterboxed or pillarboxed pixel dimensions for the Editor Aspect Ratio Preview Stage
 * inside the available viewport. Returns null if targetAspect is "any" / "auto".
 */
export function computePreviewStageDimensions(
  viewportW: number,
  viewportH: number,
  targetAspect?: string | number | null
): {
  width: number;
  height: number;
  widthPx: number;
  heightPx: number;
  ratio: number;
} | null {
  const ratio = parseAspectRatio(targetAspect);
  if (ratio === null) return null;

  // Reserve a comfortable margin in Edit Mode so the preview bezel and bottom dock are clearly visible
  const maxW = Math.max(320, viewportW - 32);
  const maxH = Math.max(240, viewportH - 40);

  let width = maxW;
  let height = width / ratio;

  if (height > maxH) {
    height = maxH;
    width = height * ratio;
  }

  const wPx = Math.round(width);
  const hPx = Math.round(height);

  return {
    width: wPx,
    height: hPx,
    widthPx: wPx,
    heightPx: hPx,
    ratio,
  };
}

