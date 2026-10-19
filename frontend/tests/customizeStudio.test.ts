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
  parseAspectRatio,
  detectScreenAspectRatio,
  findBestProfileForAspectRatio,
  computePreviewStageDimensions,
} from "../src/kiosk/gridMath.ts";
import { sanitizeIframeUrl, createIframeWidget } from "../src/kiosk/widgets/iframeWidget.ts";
import {
  generateQrMatrix,
  formatWifiQrPayload,
  renderQrSvg,
} from "../src/kiosk/widgets/qrEncoder.ts";
import { createQueueWidget } from "../src/kiosk/widgets/queueWidget.ts";
import { createNoteWidget } from "../src/kiosk/widgets/noteWidget.ts";
import {
  DEFAULT_LAYOUT_PROFILES,
  classifyWidgetDimensions,
  type LayoutProfile,
} from "../src/kiosk/widgets/types.ts";
import { createCustomizeStudio } from "../src/kiosk/customizeStudio.ts";
import { createKioskFooter } from "../src/kiosk/footer.ts";
import { createKioskClock } from "../src/kiosk/clock.ts";
import { createKioskUpNext } from "../src/kiosk/upNext.ts";

describe("24x12 Grid Math, Aspect Ratio Engine & Nearest-Match Profile Selection", () => {
  it("clamps widget coordinates and enforces minimum spans within 24x12 bounds", () => {
    const clamped1 = clampWidgetRect({ x: -3, y: 0, w: 1, h: 1 }, 5, 4);
    expect(clamped1).toEqual({ x: 1, y: 1, w: 5, h: 4 });

    const clamped2 = clampWidgetRect({ x: 22, y: 10, w: 8, h: 5 }, 3, 2);
    expect(clamped2.w).toBe(8);
    expect(clamped2.h).toBe(5);
    expect(clamped2.x + clamped2.w - 1).toBeLessThanOrEqual(GRID_COLS);
    expect(clamped2.y + clamped2.h - 1).toBeLessThanOrEqual(GRID_ROWS);
    expect(clamped2).toEqual({ x: 17, y: 8, w: 8, h: 5 });
  });

  it("accurately detects overlapping 1-indexed grid rectangles", () => {
    const a = { x: 2, y: 2, w: 9, h: 9 };
    const b = { x: 11, y: 2, w: 13, h: 10 };
    const c = { x: 10, y: 5, w: 4, h: 4 };

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

  it("resolves grid collisions when explicitly called", () => {
    const widgets = [
      { id: "w1", x: 1, y: 1, w: 6, h: 4 },
      { id: "w2", x: 1, y: 5, w: 6, h: 4 },
    ];
    const result = resolveGridCollisions(widgets, { id: "w1", x: 1, y: 4, w: 6, h: 4 });
    expect(result.hasUnresolvedOverlap).toBe(false);

    const w1After = result.widgets.find((w) => w.id === "w1")!;
    const w2After = result.widgets.find((w) => w.id === "w2")!;
    expect(rectsOverlap(w1After, w2After)).toBe(false);
    expect(w2After.y + w2After.h - 1).toBeLessThanOrEqual(GRID_ROWS);
  });

  it("computes vertical and horizontal snap alignment guides", () => {
    const other = [{ x: 2, y: 2, w: 8, h: 4 }];
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

  it("detects common screen aspect ratios including 16:9, 5:3 (Pi 800x480), and 9:16 portrait", () => {
    expect(parseAspectRatio("16:9")).toBeCloseTo(16 / 9, 4);
    expect(parseAspectRatio("5:3")).toBeCloseTo(5 / 3, 4);
    expect(parseAspectRatio("any")).toBeNull();

    const fhd = detectScreenAspectRatio(1920, 1080);
    expect(fhd.presetId).toBe("16:9");

    const piTouch = detectScreenAspectRatio(800, 480);
    expect(piTouch.presetId).toBe("5:3");

    const portrait = detectScreenAspectRatio(1080, 1920);
    expect(portrait.presetId).toBe("9:16");
  });

  it("selects the profile with the nearest aspect ratio when no exact match exists", () => {
    const profiles: LayoutProfile[] = [
      { id: "default", name: "Default", target_aspect_ratio: "any", widgets: [] },
      { id: "tv_16_9", name: "TV 16:9", target_aspect_ratio: "16:9", widgets: [] },
      { id: "pi_5_3", name: "Pi 5:3", target_aspect_ratio: "5:3", widgets: [] },
      { id: "portrait", name: "Portrait 9:16", target_aspect_ratio: "9:16", widgets: [] },
    ];

    // On an 800x480 (1.6667) screen, pi_5_3 is an exact match
    const matchPi = findBestProfileForAspectRatio(profiles, "default", 800 / 480, true);
    expect(matchPi?.id).toBe("pi_5_3");

    // On a 1280x800 (16:10 = 1.60) screen, 5:3 (1.667) is closer than 16:9 (1.778)
    const match1610 = findBestProfileForAspectRatio(profiles, "default", 1280 / 800, true);
    expect(match1610?.id).toBe("pi_5_3");

    // On a 2560x1080 (21:9 = 2.37) ultrawide screen, 16:9 (1.778) is the closest landscape profile
    const matchUltrawide = findBestProfileForAspectRatio(profiles, "default", 2560 / 1080, true);
    expect(matchUltrawide?.id).toBe("tv_16_9");

    // When autoSwitch is disabled, always returns activeProfileId
    const disabledMatch = findBestProfileForAspectRatio(profiles, "default", 800 / 480, false);
    expect(disabledMatch?.id).toBe("default");
  });

  it("computes letterboxed or pillarboxed preview stage dimensions inside viewport", () => {
    // Previewing 5:3 inside 1920x1080 viewport -> pillarboxed (height constrained)
    const stage = computePreviewStageDimensions(1920, 1080, 5 / 3);
    expect(stage.widthPx / stage.heightPx).toBeCloseTo(5 / 3, 2);
    expect(stage.widthPx).toBeLessThanOrEqual(1920);
    expect(stage.heightPx).toBeLessThanOrEqual(1080);
  });
});

describe("Smart Responsive Widget Classification & Core Widgets", () => {
  it("classifies widget dimensions into compact, wide, tall, or standard tiers", () => {
    const tiny = classifyWidgetDimensions(2, 1, 120, 54);
    expect(tiny.sizeTier).toBe("tiny");
    expect(tiny.isCompactWidth).toBe(true);
    expect(tiny.isCompactHeight).toBe(true);

    const wide = classifyWidgetDimensions(10, 2, 640, 110);
    expect(wide.isWide).toBe(true);

    const tall = classifyWidgetDimensions(3, 9, 180, 540);
    expect(tall.isTall).toBe(true);
  });

  it("adapts Clock and UpNext layouts and settings dynamically", () => {
    const clock = createKioskClock({
      layout_mode: "expanded",
      show_seconds: "show",
      show_date: "show",
      use_24h: true,
      alignment: "center",
    });
    expect(clock.element.dataset.clockAlign).toBe("center");
    expect(clock.element.classList.contains("KioskClock--mode-expanded")).toBe(true);
    expect(clock.element.querySelector(".KioskClockDate")).not.toBeNull();
    clock.destroy();

    const upNext = createKioskUpNext({
      layout_mode: "multi_track",
      alignment: "stretch",
    });
    upNext.update([
      { title: "Track 1", artist: "Artist 1", cover_url: "https://example.com/1.jpg" },
      { title: "Track 2", artist: "Artist 2", cover_url: "https://example.com/2.jpg" },
    ]);
    expect(upNext.element.dataset.upnextAlign).toBe("stretch");
    expect(upNext.element.textContent).toContain("Track 1");
    expect(upNext.element.textContent).toContain("Track 2");
    upNext.destroy();
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

describe("Interactive Customize Studio, Free Overlapping, Lyrics Bleed & Undo/Redo", () => {
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

  it("mounts profiles, applies full-height lyrics bleed, supports keyboard nudging & undo/redo without pushing other widgets, and preserves KioskFooter", () => {
    const appRoot = document.getElementById("app")!;
    const footer = createKioskFooter();
    appRoot.appendChild(footer.element);

    const clock = createKioskClock();
    const upNext = createKioskUpNext();
    appRoot.appendChild(clock.element);
    appRoot.appendChild(upNext.element);

    const savedPayloads: any[] = [];
    const studio = createCustomizeStudio({
      clockElement: clock.element,
      upNextElement: upNext.element,
      clockController: clock,
      upNextController: upNext,
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
      active_profile_id: "default",
      layout_profiles: JSON.parse(JSON.stringify(DEFAULT_LAYOUT_PROFILES)),
    });

    const page = document.getElementById("SpicyLyricsPage")!;
    const lyricsEl = page.querySelector<HTMLElement>(".LyricsContainer")!;
    expect(page.classList.contains("GridLayoutActive")).toBe(true);

    // Default profile has full_height_bleed: true and h: 12 on lyrics-1
    expect(lyricsEl.classList.contains("LyricsContainer--bleed-vertical")).toBe(true);
    expect(lyricsEl.style.gridRow).toBe("1 / span 12");

    // Enter Edit Mode
    studio.enterEditMode();
    expect(studio.isEditMode()).toBe(true);
    expect(page.classList.contains("EditModeActive")).toBe(true);
    expect(document.querySelector(".CustomizeDock")).not.toBeNull();

    // Select clock-1 (starts at x: 1) and nudge it 11 cells right onto Lyrics (x: 12) via keyboard ArrowRight
    studio.selectWidget("clock-1");
    expect(studio.getSelectedWidgetId()).toBe("clock-1");

    for (let i = 0; i < 11; i++) {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    }

    const activeProfile = studio.getActiveProfile();
    const clockInst = activeProfile.widgets.find((w) => w.id === "clock-1")!;
    const lyricsInst = activeProfile.widgets.find((w) => w.id === "lyrics-1")!;

    // Clock moved to x: 12 (overlapping Lyrics at x: 12..23, y: 1..12), and Lyrics was NOT pushed!
    expect(clockInst.x).toBe(12);
    expect(clockInst.y).toBe(1);
    expect(lyricsInst.x).toBe(12);
    expect(lyricsInst.y).toBe(1);
    expect(lyricsInst.w).toBe(12);
    expect(lyricsInst.h).toBe(12);

    // Test Undo / Redo
    expect(studio.undo()).toBe(true);
    expect(activeProfile.widgets.find((w) => w.id === "clock-1")!.x).toBe(11);
    expect(studio.redo()).toBe(true);
    expect(activeProfile.widgets.find((w) => w.id === "clock-1")!.x).toBe(12);

    // Regression test: Verify UpNext preserves its .WidgetEditOverlay, .WidgetEditShield, and .WidgetResizeHandle
    // even after live queue updates fire during Edit Mode, and can be moved and configured via settings modal
    upNext.update([
      { title: "Next Song", artist: "Next Artist", cover_url: "https://example.com/c.jpg" },
    ]);
    expect(upNext.element.querySelector(".WidgetEditOverlay")).not.toBeNull();
    expect(upNext.element.querySelector(".WidgetEditShield")).not.toBeNull();
    expect(upNext.element.querySelectorAll(".WidgetResizeHandle").length).toBe(8);

    // Select up_next-1 and nudge it up 1 cell
    studio.selectWidget("up_next-1");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" }));
    expect(activeProfile.widgets.find((w) => w.id === "up_next-1")!.y).toBe(11);

    // Open UpNext settings modal via its ⚙ button
    const upNextSettingsBtn = upNext.element.querySelector<HTMLElement>(
      ".WidgetEditBtn--settings"
    )!;
    expect(upNextSettingsBtn).not.toBeNull();
    upNextSettingsBtn.click();
    expect(document.querySelector(".WidgetSettingsModalBackdrop")).not.toBeNull();
    expect(document.querySelector(".UpNextModeSelect")).not.toBeNull();

    // Save & Exit
    studio.exitEditMode(true);
    expect(studio.isEditMode()).toBe(false);
    expect(page.classList.contains("EditModeActive")).toBe(false);
    expect(savedPayloads.length).toBe(1);

    // Verify AGPL KioskFooter is still in the DOM and completely untouched
    expect(document.querySelector(".KioskFooter")).not.toBeNull();
    clock.destroy();
    upNext.destroy();
  });
});
