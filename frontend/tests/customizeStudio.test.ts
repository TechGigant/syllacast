/*
 * Syllacast - Standalone Spotify Lyrics Kiosk
 * Copyright (C) 2026 TechGigant
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import "./testSetup.ts";
import "../src/bridge/spicetifyShim";
import { describe, it, expect, beforeEach } from "vitest";
import {
  GRID_COLS,
  GRID_ROWS,
  clampWidgetRect,
  rectsOverlap,
  findOpenSlot,
  resolveGridCollisions,
  computeSnapGuides,
  isTypingInInput,
} from "../src/kiosk/gridMath.ts";
import { sanitizeIframeUrl, createIframeWidget } from "../src/kiosk/widgets/iframeWidget.ts";
import {
  generateQrMatrix,
  formatWifiQrPayload,
  renderQrSvg,
} from "../src/kiosk/widgets/qrEncoder.ts";
import { createQueueWidget } from "../src/kiosk/widgets/queueWidget.ts";
import { createNoteWidget } from "../src/kiosk/widgets/noteWidget.ts";
import { DEFAULT_LAYOUT_PROFILES } from "../src/kiosk/widgets/types.ts";
import { createCustomizeStudio } from "../src/kiosk/customizeStudio.ts";
import { createKioskFooter } from "../src/kiosk/footer.ts";

describe("24x12 Grid Math & Collision Engine", () => {
  it("clamps widget coordinates and enforces minimum spans within 24x12 bounds", () => {
    // Below minimum span and negative coordinates
    const clamped1 = clampWidgetRect({ x: -3, y: 0, w: 1, h: 1 }, 5, 4);
    expect(clamped1).toEqual({ x: 1, y: 1, w: 5, h: 4 });

    // Overflowing right/bottom edge
    const clamped2 = clampWidgetRect({ x: 22, y: 10, w: 8, h: 5 }, 3, 2);
    expect(clamped2.w).toBe(8);
    expect(clamped2.h).toBe(5);
    expect(clamped2.x + clamped2.w - 1).toBeLessThanOrEqual(GRID_COLS);
    expect(clamped2.y + clamped2.h - 1).toBeLessThanOrEqual(GRID_ROWS);
    expect(clamped2).toEqual({ x: 17, y: 8, w: 8, h: 5 });
  });

  it("accurately detects overlapping 1-indexed grid rectangles", () => {
    const a = { x: 2, y: 2, w: 9, h: 9 }; // cols 2..10, rows 2..10
    const b = { x: 11, y: 2, w: 13, h: 10 }; // cols 11..23, rows 2..11
    const c = { x: 10, y: 5, w: 4, h: 4 }; // overlaps col 10 of a and cols 11..13 of b

    expect(rectsOverlap(a, b)).toBe(false);
    expect(rectsOverlap(a, c)).toBe(true);
    expect(rectsOverlap(b, c)).toBe(true);
  });

  it("finds the first non-overlapping slot on the 24x12 grid", () => {
    const existing = [{ x: 1, y: 1, w: 10, h: 12 }];
    const slot = findOpenSlot(existing, 6, 4);
    expect(slot).toEqual({ x: 11, y: 1 });
    expect(rectsOverlap(existing[0], { ...slot, w: 6, h: 4 })).toBe(false);
  });

  it("resolves grid collisions by pushing collided widgets into open space within bounds", () => {
    const widgets = [
      { id: "w1", x: 1, y: 1, w: 6, h: 4 },
      { id: "w2", x: 1, y: 5, w: 6, h: 4 },
    ];
    // Move w1 onto w2 (y: 4)
    const result = resolveGridCollisions(widgets, { id: "w1", x: 1, y: 4, w: 6, h: 4 });
    expect(result.hasUnresolvedOverlap).toBe(false);

    const w1After = result.widgets.find((w) => w.id === "w1")!;
    const w2After = result.widgets.find((w) => w.id === "w2")!;
    expect(rectsOverlap(w1After, w2After)).toBe(false);
    expect(w2After.y + w2After.h - 1).toBeLessThanOrEqual(GRID_ROWS);
  });

  it("computes vertical and horizontal snap alignment guides", () => {
    const other = [{ x: 2, y: 2, w: 8, h: 4 }];
    // Align left edge at x = 2
    const guides = computeSnapGuides({ x: 2, y: 7, w: 6, h: 3 }, other);
    expect(guides.verticalCols).toContain(2);
  });

  it("guards keyboard shortcuts when typing in form inputs", () => {
    const input = document.createElement("input");
    const textarea = document.createElement("textarea");
    const div = document.createElement("div");

    expect(isTypingInInput(input)).toBe(true);
    expect(isTypingInInput(textarea)).toBe(true);
    expect(isTypingInInput(div)).toBe(false);
  });
});

describe("Iframe URL Sanitization & Security", () => {
  it("allows valid http and https URLs and rejects XSS/dangerous schemes", () => {
    expect(sanitizeIframeUrl("https://homeassistant.local:8123/lovelace")).toBe(
      "https://homeassistant.local:8123/lovelace"
    );
    expect(sanitizeIframeUrl("http://192.168.1.50:3000/d/123")).toBe(
      "http://192.168.1.50:3000/d/123"
    );
    expect(sanitizeIframeUrl("javascript:alert(1)")).toBeNull();
    expect(sanitizeIframeUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(sanitizeIframeUrl("file:///etc/passwd")).toBeNull();
    expect(sanitizeIframeUrl("vbscript:msgbox(1)")).toBeNull();
    expect(sanitizeIframeUrl("")).toBeNull();
  });

  it("renders a placeholder card when URL is empty or invalid and an iframe with EditShield when valid", () => {
    const ctx = {
      getInterpolatedPositionMs: () => 0,
      sendCommand: () => {},
      getLatestState: () => null,
    };

    const widget = createIframeWidget({ url: "javascript:alert(1)", title: "Untrusted" }, ctx);
    expect(widget.element.querySelector("iframe")).toBeNull();
    expect(widget.element.querySelector(".KioskIframePlaceholder")).not.toBeNull();
    expect(widget.element.querySelector(".WidgetEditShield")).not.toBeNull();

    widget.updateConfig({ url: "https://example.com/status", zoom: 1.25 });
    const iframe = widget.element.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute("sandbox")).toContain("allow-scripts");
    expect(iframe?.style.transform).toContain("scale(1.25)");
    widget.destroy();
  });
});

describe("Offline Pure-TS QR Code Generator & Guest Note Widget", () => {
  it("formats Wi-Fi QR strings with ZXing escaping and generates valid square QR matrices & SVGs", () => {
    const payload = formatWifiQrPayload("My;Home:Net", "Pass\\123,4", "WPA", true);
    expect(payload).toBe("WIFI:T:WPA;S:My\\;Home\\:Net;P:Pass\\\\123\\,4;H:true;;");

    const matrix = generateQrMatrix(payload);
    expect(matrix.length).toBeGreaterThanOrEqual(21);
    expect(matrix.length).toBe(matrix[0].length);

    // Top-left 7x7 finder pattern corners must be dark
    expect(matrix[0][0]).toBe(true);
    expect(matrix[0][6]).toBe(true);
    expect(matrix[6][0]).toBe(true);
    expect(matrix[3][3]).toBe(true);

    const svg = renderQrSvg(payload, 180);
    expect(svg).toContain("<svg");
    expect(svg).toContain("<path");
  });

  it("escapes HTML in Guest Note widget while rendering Wi-Fi QR mode offline", () => {
    const ctx = {
      getInterpolatedPositionMs: () => 0,
      sendCommand: () => {},
      getLatestState: () => null,
    };

    const note = createNoteWidget(
      {
        mode: "note",
        title: "Welcome <script>alert(1)</script>",
        body_text: "Hello **Guest**!",
      },
      ctx
    );
    expect(note.element.innerHTML).not.toContain("<script>");
    expect(note.element.innerHTML).toContain("<strong>Guest</strong>");

    note.updateConfig({
      mode: "wifi_qr",
      title: "Guest Wi-Fi",
      wifi_ssid: "SyllacastLAN",
      wifi_password: "secretpassword",
      wifi_encryption: "WPA",
    });
    expect(note.element.querySelector("svg")).not.toBeNull();
    note.destroy();
  });
});

describe("Extended Queue & History Widget", () => {
  it("renders upcoming and history tracks and sends play command on click", () => {
    const sentCommands: Record<string, any>[] = [];
    const mockState: any = {
      is_playing: true,
      status: "playing",
      queue_upcoming: [
        {
          title: "Upcoming Song",
          artist: "Future Artist",
          uri: "spotify:track:upcoming123",
          duration_ms: 215000,
        },
      ],
      queue_history: [
        {
          title: "Previous Song",
          artist: "Past Artist",
          uri: "spotify:track:history456",
          duration_ms: 180000,
        },
      ],
    };

    const queueWidget = createQueueWidget(
      { mode: "split", max_items: 5, show_covers: true, click_to_play: true },
      {
        getInterpolatedPositionMs: () => 0,
        sendCommand: (cmd) => sentCommands.push(cmd),
        getLatestState: () => mockState,
      }
    );

    expect(queueWidget.element.textContent).toContain("Upcoming Song");
    expect(queueWidget.element.textContent).toContain("Previous Song");
    expect(queueWidget.element.textContent).toContain("3:35");

    const rows = queueWidget.element.querySelectorAll<HTMLElement>(".QueueItemRow");
    expect(rows.length).toBe(2);
    rows[0].click();
    expect(sentCommands).toEqual([{ type: "play", uri: "spotify:track:upcoming123" }]);
    queueWidget.destroy();
  });
});

describe("Interactive Customize Studio & AGPL Footer Preservation", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="app">
        <div id="SpicyLyricsPage">
          <div class="ContentBox">
            <div class="NowBar"></div>
            <div class="LyricsContainer"><div class="LyricsContent"></div></div>
            <div class="ViewControls"></div>
          </div>
        </div>
      </div>
    `;
  });

  it("mounts profiles, toggles Edit Mode, reverts on cancel, and preserves KioskFooter", () => {
    const appRoot = document.getElementById("app")!;
    const footer = createKioskFooter();
    appRoot.appendChild(footer.element);

    const savedPayloads: any[] = [];
    const studio = createCustomizeStudio({
      saveSettings: (s) => {
        savedPayloads.push(s);
      },
    });

    studio.applySettings({
      show_controls_buttons: true,
      startup_mode: "standard",
      nowbar_open: true,
      nowbar_side: "left",
      clock_enabled: true,
      up_next_enabled: true,
      calibration_offset_ms: 0,
      dynamic_bg_mode: "dynamic",
      active_profile_id: "living_room_tv",
      layout_profiles: JSON.parse(JSON.stringify(DEFAULT_LAYOUT_PROFILES)),
    });

    const page = document.getElementById("SpicyLyricsPage")!;
    expect(page.classList.contains("GridLayoutActive")).toBe(true);

    // Living Room Hub profile has visualizer, weather, extended_queue, and note widgets
    expect(page.querySelector('[data-widget-type="visualizer"]')).not.toBeNull();
    expect(page.querySelector('[data-widget-type="weather"]')).not.toBeNull();
    expect(page.querySelector('[data-widget-type="extended_queue"]')).not.toBeNull();
    expect(page.querySelector('[data-widget-type="note"]')).not.toBeNull();

    // Enter Edit Mode
    studio.enterEditMode();
    expect(studio.isEditMode()).toBe(true);
    expect(page.classList.contains("EditModeActive")).toBe(true);
    expect(document.querySelector(".CustomizeDock")).not.toBeNull();

    // Save & Exit
    studio.exitEditMode(true);
    expect(studio.isEditMode()).toBe(false);
    expect(page.classList.contains("EditModeActive")).toBe(false);
    expect(savedPayloads.length).toBe(1);
    expect(savedPayloads[0].active_profile_id).toBe("living_room_tv");

    // Verify AGPL KioskFooter is still in the DOM and completely untouched
    expect(document.querySelector(".KioskFooter")).not.toBeNull();
  });
});
