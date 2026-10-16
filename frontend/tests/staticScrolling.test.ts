import "./testSetup.ts";
import "../src/bridge/spicetifyShim";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  isStaticNearAutoPosition,
  getUserScrolledStatic,
  setUserScrolledStatic,
  ResetLastLine,
  QueueForceScroll,
  CleanupScrollEvents,
  ScrollToActiveLine,
} from "../src/spicy/utils/Scrolling/ScrollToActiveLine.ts";
import { $currentLyricsType, $lyricsContainerExists } from "../src/spicy/utils/stores.ts";
import { LyricsObject } from "../src/spicy/utils/Lyrics/lyrics.ts";
import { SpotifyPlayer } from "../src/spicy/components/Global/SpotifyPlayer.ts";
import * as virtualizerModule from "../src/spicy/utils/Lyrics/LyricsVirtualizer.ts";

describe("Unsynced (Static) Lyrics Scrolling & Snap-Back", () => {
  beforeEach(() => {
    ResetLastLine();
    CleanupScrollEvents();
    $lyricsContainerExists.set(true);
    $currentLyricsType.set("Static");
  });

  afterEach(() => {
    ResetLastLine();
    CleanupScrollEvents();
    vi.restoreAllMocks();
  });

  describe("isStaticNearAutoPosition", () => {
    it("returns false for invalid container or empty lines", () => {
      expect(isStaticNearAutoPosition(null as any, 0, 0)).toBe(false);
      expect(isStaticNearAutoPosition({} as any, 0, 0)).toBe(false);
    });

    it("evaluates proximity correctly via proportional fallback", () => {
      // Mock container without virtualizer or DOM offsets
      const container: any = {
        scrollTop: 800,
        scrollHeight: 2000,
        clientHeight: 500,
      };

      const totalLines = 20;
      // targetIndex 10 is midpoint: expectedScroll ≈ (10/19) * 1500 ≈ 789px
      // tolerance is max(120, min(220, 500 * 0.25)) = 125px

      // Near: scrollTop = 800 vs expected ~789 (diff ~11px <= 125px)
      expect(isStaticNearAutoPosition(container, 10, totalLines)).toBe(true);

      // Far down: scrollTop = 1400 (user scrolled to end)
      container.scrollTop = 1400;
      expect(isStaticNearAutoPosition(container, 10, totalLines)).toBe(false);

      // Far up: scrollTop = 100 (user scrolled to start)
      container.scrollTop = 100;
      expect(isStaticNearAutoPosition(container, 10, totalLines)).toBe(false);

      // Near when targetIndex changes to line 2 (near top)
      // expectedScroll ≈ (2/19) * 1500 ≈ 158px
      expect(isStaticNearAutoPosition(container, 2, totalLines)).toBe(true);
    });

    it("evaluates proximity correctly via DOM offsetTop fallback", () => {
      const container: any = {
        scrollTop: 600,
        clientHeight: 600,
        scrollHeight: 3000,
      };

      const mockLines: any[] = [
        { HTMLElement: { offsetTop: 100, offsetHeight: 40, clientHeight: 40 } },
        { HTMLElement: { offsetTop: 500, offsetHeight: 40, clientHeight: 40 } },
        { HTMLElement: { offsetTop: 900, offsetHeight: 40, clientHeight: 40 } },
        { HTMLElement: { offsetTop: 1800, offsetHeight: 40, clientHeight: 40 } },
      ];

      // Tolerance: max(120, min(220, 600 * 0.25)) = 150px
      // Center view: expectedScrollTop = offsetTop - (600 - 40)/2 + 30 = offsetTop - 280 + 30 = offsetTop - 250
      // For index 2 (offsetTop 900): expectedScroll = 900 - 250 = 650px.
      // Current scrollTop = 600px -> diff = 50px <= 150px -> true
      expect(isStaticNearAutoPosition(container, 2, mockLines.length, mockLines)).toBe(true);

      // For index 3 (offsetTop 1800): expectedScroll = 1800 - 250 = 1550px.
      // Current scrollTop = 600px -> diff = 950px > 150px -> false
      expect(isStaticNearAutoPosition(container, 3, mockLines.length, mockLines)).toBe(false);

      // If user scrolls to 1500px, now index 3 is near
      container.scrollTop = 1500;
      expect(isStaticNearAutoPosition(container, 3, mockLines.length, mockLines)).toBe(true);
      expect(isStaticNearAutoPosition(container, 2, mockLines.length, mockLines)).toBe(false);
    });

    it("evaluates proximity correctly using virtualizer target offset", () => {
      const container: any = {
        scrollTop: 700,
        clientHeight: 600,
        scrollHeight: 3000,
      };

      // Mock virtualizer target scroll top
      vi.spyOn(virtualizerModule, "getLyricsVirtualizerTargetScrollTop").mockImplementation((idx) => {
        if (idx === 5) return 750;
        if (idx === 15) return 1800;
        return null;
      });

      // Index 5: target 750 vs current 700 (diff 50px <= tolerance 150px)
      expect(isStaticNearAutoPosition(container, 5, 20)).toBe(true);

      // Index 15: target 1800 vs current 700 (diff 1100px > tolerance 150px)
      expect(isStaticNearAutoPosition(container, 15, 20)).toBe(false);
    });
  });

  describe("userScrolledStatic lifecycle", () => {
    it("tracks user manual scroll flag and resets on song/playback events", () => {
      expect(getUserScrolledStatic()).toBe(false);

      setUserScrolledStatic(true);
      expect(getUserScrolledStatic()).toBe(true);

      ResetLastLine();
      expect(getUserScrolledStatic()).toBe(false);

      setUserScrolledStatic(true);
      expect(getUserScrolledStatic()).toBe(true);

      QueueForceScroll();
      expect(getUserScrolledStatic()).toBe(false);

      setUserScrolledStatic(true);
      CleanupScrollEvents();
      expect(getUserScrolledStatic()).toBe(false);
    });
  });

  describe("ScrollToActiveLine with user manual scrolling", () => {
    it("respects manual scrolling and only snaps back when near auto position", () => {
      let mockTime = 1000;
      vi.spyOn(performance, "now").mockImplementation(() => mockTime);

      const container: any = {
        scrollTop: 200,
        scrollHeight: 2000,
        clientHeight: 500,
        classList: {
          add: vi.fn(),
          remove: vi.fn(),
          contains: vi.fn().mockReturnValue(false),
        },
      };

      const mockSimplebar = {
        getScrollElement: () => container,
        isDragging: false,
      };

      const lines = Array.from({ length: 20 }, (_, i) => ({
        Text: `Line ${i + 1}`,
        HTMLElement: {
          offsetTop: i * 80 + 50,
          offsetHeight: 40,
          clientHeight: 40,
        },
      }));

      LyricsObject.Types.Static = {
        Lines: lines as any,
      };

      vi.spyOn(SpotifyPlayer, "GetPosition").mockReturnValue(90000); // 50% through 180s song
      vi.spyOn(SpotifyPlayer, "GetDuration").mockReturnValue(180000);

      // Initial tick at mockTime 1000: auto-scrolls to midpoint (targetIndex 10 target 650px)
      ScrollToActiveLine(mockSimplebar);
      expect(getUserScrolledStatic()).toBe(false);
      expect(container.scrollTop).toBe(650);

      // Simulate user manual scroll away to line 18 (far down)
      // Advance time by 800ms (> USER_SCROLL_COOLDOWN)
      mockTime += 800;
      setUserScrolledStatic(true);
      container.scrollTop = 1400; // far from midpoint targetIndex 10 (~650px)

      // Call ScrollToActiveLine: since userScrolledStatic is true and position is far,
      // it must NOT force the scroll back!
      ScrollToActiveLine(mockSimplebar);
      expect(getUserScrolledStatic()).toBe(true);
      expect(container.scrollTop).toBe(1400);

      // Advance time another 800ms
      mockTime += 800;
      // User scrolls back near the auto position (line 10 target ~650px)
      container.scrollTop = 630;

      // Next tick: since user put it back near the auto position, it must snap back and resume!
      ScrollToActiveLine(mockSimplebar);
      expect(getUserScrolledStatic()).toBe(false);
      expect(container.scrollTop).toBe(650);
    });

    it("resets manual scroll pause when track is seeked drastically", () => {
      let mockTime = 1000;
      vi.spyOn(performance, "now").mockImplementation(() => mockTime);

      const container: any = {
        scrollTop: 200,
        scrollHeight: 2000,
        clientHeight: 500,
        classList: {
          add: vi.fn(),
          remove: vi.fn(),
          contains: vi.fn().mockReturnValue(false),
        },
      };

      const mockSimplebar = {
        getScrollElement: () => container,
        isDragging: false,
      };

      const lines = Array.from({ length: 20 }, (_, i) => ({
        Text: `Line ${i + 1}`,
        HTMLElement: {
          offsetTop: i * 80 + 50,
          offsetHeight: 40,
          clientHeight: 40,
        },
      }));

      LyricsObject.Types.Static = {
        Lines: lines as any,
      };

      const positionSpy = vi.spyOn(SpotifyPlayer, "GetPosition").mockReturnValue(30000); // 30s
      vi.spyOn(SpotifyPlayer, "GetDuration").mockReturnValue(180000);

      ScrollToActiveLine(mockSimplebar);

      // User scrolls away and pauses
      mockTime += 800;
      setUserScrolledStatic(true);
      container.scrollTop = 1200;

      // Player jumps from 30s to 120s (seek > 3000ms jump)
      positionSpy.mockReturnValue(120000);

      ScrollToActiveLine(mockSimplebar);
      // Seeking resets userScrolledStatic and jumps to new position
      expect(getUserScrolledStatic()).toBe(false);
      // line index for 120000 / 180000 * 20 = floor(13.33) = line 13
      // offsetTop = 13 * 80 + 50 = 1090. expected scrollTop = 1090 - 200 + 0 = 890
      expect(container.scrollTop).toBe(890);
    });

    it("detects scrollbar dragging via simplebar.isDragging", () => {
      const container: any = {
        scrollTop: 200,
        scrollHeight: 2000,
        clientHeight: 500,
        classList: {
          add: vi.fn(),
          remove: vi.fn(),
          contains: vi.fn().mockReturnValue(false),
        },
      };

      const mockSimplebar = {
        getScrollElement: () => container,
        isDragging: true, // User is holding/dragging the scrollbar thumb
      };

      const lines = Array.from({ length: 10 }, (_, i) => ({
        Text: `Line ${i + 1}`,
        HTMLElement: {
          offsetTop: i * 80 + 50,
          offsetHeight: 40,
          clientHeight: 40,
        },
      }));

      LyricsObject.Types.Static = {
        Lines: lines as any,
      };

      vi.spyOn(SpotifyPlayer, "GetPosition").mockReturnValue(30000);
      vi.spyOn(SpotifyPlayer, "GetDuration").mockReturnValue(180000);

      // Initial tick to mount / initialize lastLine
      ScrollToActiveLine(mockSimplebar);
      expect(getUserScrolledStatic()).toBe(false);

      // User now drags the scrollbar thumb
      mockSimplebar.isDragging = true;
      ScrollToActiveLine(mockSimplebar);

      expect(getUserScrolledStatic()).toBe(true);
    });
  });
});
