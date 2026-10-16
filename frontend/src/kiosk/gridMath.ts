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
 * to 1-indexed (col, row) coordinates in the 24x12 grid.
 */
export function pointerToGridCoord(
  clientX: number,
  clientY: number,
  containerRect: DOMRect
): { col: number; row: number } {
  const relX = clientX - containerRect.left;
  const relY = clientY - containerRect.top;

  const colWidth = containerRect.width / GRID_COLS;
  const rowHeight = containerRect.height / GRID_ROWS;

  const col = Math.max(1, Math.min(GRID_COLS, Math.floor(relX / colWidth) + 1));
  const row = Math.max(1, Math.min(GRID_ROWS, Math.floor(relY / rowHeight) + 1));

  return { col, row };
}
