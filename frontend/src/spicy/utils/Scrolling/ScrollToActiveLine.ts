/*
 * Syllacast - Standalone Spotify Lyrics Kiosk
 * Portions derived from Spicy Lyrics (https://github.com/Spikerko/spicy-lyrics)
 *
 * Copyright (C) 2026 Spikerko
 * Copyright (C) 2026 TechGigant
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import {
  $currentLyricsType,
  $lyricsContainerExists,
  $scrollLeadEnabled,
  $scrollLeadMs,
  $smoothScrolling,
} from "../../utils/stores.ts";
import Global from "../../components/Global/Global.ts";
import { SpotifyPlayer } from "../../components/Global/SpotifyPlayer.ts";
import { PageContainer } from "../../components/Pages/PageView.ts";
import { IsCompactMode } from "../../components/Utils/CompactMode.ts";
import { IsPIP } from "../../components/Utils/PopupLyrics.ts";
import {
  type LyricsLine,
  LyricsObject,
  type LyricsSyllable,
  type LyricsType,
} from "../Lyrics/lyrics.ts";
import { ScrollIntoCenterViewCSS } from "../ScrollIntoView/Center.ts";
import { ScrollIntoTopViewCSS } from "../ScrollIntoView/Top.ts";
import {
  getLyricsVirtualizer,
  getLyricsVirtualizerTargetScrollTop,
  isVirtualizerProgrammaticScrolling,
  scrollLyricsToIndex,
} from "../Lyrics/LyricsVirtualizer.ts";

// Define intersection types that include _LineIndex
type LyricsLineWithIndex = LyricsLine & { _LineIndex: number };
type LyricsSyllableWithIndex = LyricsSyllable & { _LineIndex: number };
type EnhancedLyricsItem = LyricsLineWithIndex | LyricsSyllableWithIndex;

// Define proper types for variables
let lastLine: HTMLElement | null = null;
let isUserScrolling = false;
let userScrolledStatic = false;
let isProgrammaticScrolling = false;
let lastUserScrollTime = 0;
let lastPosition: number = 0;
const USER_SCROLL_COOLDOWN = 750; // 0.75 second cooldown
// const POSITION_THRESHOLD = 500; // 500ms threshold for start/end detection

// Force scroll queue mechanism
let forceScrollQueued = false;
let smoothForceScrollQueued = false;

// --- Module variables for event listeners and cleanup ---
let currentSimpleBarInstance: any | null = null;
let currentScrollElement: HTMLElement | null = null;
let currentIntentRoot: HTMLElement | null = null;
let wheelHandler: (() => void) | null = null;
let touchMoveHandler: (() => void) | null = null;
let touchStartHandler: (() => void) | null = null;
let scrollHandler: (() => void) | null = null;
let pointerDownHandler: (() => void) | null = null;
let keyDownHandler: ((e: KeyboardEvent) => void) | null = null;

const wasDrasticPositionChange = (lastPosition: number, newPosition: number) => {
  const positionChange = Math.abs(newPosition - lastPosition);
  return positionChange > 1000;
};

// Add focus event listener to reset state when window is focused
window.addEventListener("focus", ResetLastLine);
// Add resize event listener to reset state when window is resized
window.addEventListener("resize", ResetLastLine);

// Create ResizeObserver to monitor LyricsContent container dimensions
const lyricsContentObserver = new ResizeObserver(() => {
  ResetLastLine();
});

// Function to setup the observer
function setupLyricsContentObserver() {
  const lyricsContent = PageContainer?.querySelector(".LyricsContainer .LyricsContent");
  if (lyricsContent) {
    // Ensure we don't observe multiple times if called again
    lyricsContentObserver.disconnect();
    lyricsContentObserver.observe(lyricsContent);
  }
}

function handleUserScroll(ScrollSimplebar: any | null) {
  // Allow null
  if (!ScrollSimplebar) return; // Add null check
  if (!isUserScrolling) {
    isUserScrolling = true;
    // Add HideLineBlur class when user starts scrolling
    const lyricsContent = PageContainer?.querySelector(
      ".LyricsContainer .LyricsContent"
    );
    if (lyricsContent) {
      lyricsContent.classList.add("HideLineBlur");
    } else {
      // --- NEW: Add warning if element not found ---
      console.warn(
        "SpicyLyrics: Could not find .LyricsContent in handleUserScroll to add HideLineBlur."
      );
      // --- END NEW ---
    }
  }
  lastUserScrollTime = performance.now();
}

function markUserScroll() {
  handleUserScroll(currentSimpleBarInstance);
  if ($currentLyricsType.get() === "Static") {
    userScrolledStatic = true;
  }
}

// Initialization function for scroll events and observers
export function InitializeScrollEvents(ScrollSimplebar: any) {
  if (!$lyricsContainerExists.get()) return;
  CleanupScrollEvents();

  currentSimpleBarInstance = ScrollSimplebar;
  const scrollElement = ScrollSimplebar?.getScrollElement() as HTMLElement | undefined;
  if (!scrollElement) return;

  currentScrollElement = scrollElement;
  currentIntentRoot = scrollElement.closest<HTMLElement>("[data-simplebar]") ?? scrollElement;

  wheelHandler = () => markUserScroll();
  touchMoveHandler = () => markUserScroll();
  touchStartHandler = () => markUserScroll();
  pointerDownHandler = () => markUserScroll();
  keyDownHandler = (e: KeyboardEvent) => {
    if (
      ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", "Space"].includes(e.code) ||
      ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(e.key)
    ) {
      markUserScroll();
    }
  };
  scrollHandler = () => {
    if (isProgrammaticScrolling || isVirtualizerProgrammaticScrolling()) {
      return;
    }
    markUserScroll();
  };

  // Setup the observer
  setupLyricsContentObserver();

  // Add event listeners
  scrollElement.addEventListener("wheel", wheelHandler, { passive: true });
  scrollElement.addEventListener("touchmove", touchMoveHandler, { passive: true });
  scrollElement.addEventListener("touchstart", touchStartHandler, { passive: true });
  scrollElement.addEventListener("scroll", scrollHandler, { passive: true });
  scrollElement.addEventListener("keydown", keyDownHandler, { passive: true });
  currentIntentRoot.addEventListener("pointerdown", pointerDownHandler, { passive: true });
}

/**
 * How far ahead — counted in real lyric lines, background lines excluded — we
 * look when deciding whether the highest active line may keep the anchor.
 * Bump to 3 to let long lines hold the anchor for longer.
 */
const PIN_LOOKAHEAD = 2;

/** Only Syllable lines carry BGLine; line-synced lyrics have no background lines. */
const IsBGLine = (line: LyricsLine | LyricsSyllable): boolean =>
  (line as LyricsSyllable).BGLine === true;

/** Background lines belong to the lead line above them, and are never a scroll target. */
const ResolveToLeadIndex = (Lines: LyricsLine[] | LyricsSyllable[], index: number): number => {
  let i = index;
  while (i > 0 && IsBGLine(Lines[i])) i--;
  return i;
};

/** When the lead line at `leadIdx` and its background lines have all finished. */
const GetGroupEndTime = (Lines: LyricsLine[] | LyricsSyllable[], leadIdx: number): number => {
  let end = Lines[leadIdx].EndTime;
  for (let i = leadIdx + 1; i < Lines.length && IsBGLine(Lines[i]); i++) {
    if (Lines[i].EndTime > end) end = Lines[i].EndTime;
  }
  return end;
};

/** The PIN_LOOKAHEAD-th non-background line after `leadIdx`, or null past the end. */
const GetLookaheadLine = (Lines: LyricsLine[] | LyricsSyllable[], leadIdx: number) => {
  let remaining = PIN_LOOKAHEAD;
  for (let i = leadIdx + 1; i < Lines.length; i++) {
    if (IsBGLine(Lines[i])) continue;
    if (--remaining === 0) return Lines[i];
  }
  return null;
};

const GetScrollLine = (Lines: LyricsLine[] | LyricsSyllable[], ProcessedPosition: number) => {
  if ($currentLyricsType.get() === "Static" || $currentLyricsType.get() === "None" || !Lines)
    return;
  // 1) gather the indices of all active lines. This runs every animation frame,
  // so we keep indices rather than materialising a copy of each active line.
  const activeIndices: number[] = [];
  for (let i = 0; i < Lines.length; i++) {
    const line = Lines[i];
    if (
      typeof line.StartTime === "number" &&
      typeof line.EndTime === "number" &&
      line.StartTime <= ProcessedPosition &&
      line.EndTime >= ProcessedPosition
    ) {
      activeIndices.push(i);
    }
  }

  if (activeIndices.length === 0) return null;

  const enhance = (index: number) =>
    ({ ...Lines[index], _LineIndex: index }) as EnhancedLyricsItem;

  // 2) collapse the active lines onto their lead groups. A background line that
  // still has another active group below it is only the tail of a line we have
  // already moved past — a sustained "oooh" outliving its own lead — so it is
  // dropped rather than dragging the anchor back up. A background line with
  // nothing active below it is kept: it may be leading into its own line, which
  // starts later than the background vocal does.
  let frontLead = -1;
  for (const index of activeIndices) {
    const lead = ResolveToLeadIndex(Lines, index);
    if (lead > frontLead) frontLead = lead;
  }

  // Ascending and deduplicated — ResolveToLeadIndex is monotonic over
  // activeIndices, so only the previous entry needs checking.
  const activeLeads: number[] = [];
  for (const index of activeIndices) {
    const lead = ResolveToLeadIndex(Lines, index);
    if (IsBGLine(Lines[index]) && lead < frontLead) continue;
    if (activeLeads[activeLeads.length - 1] !== lead) activeLeads.push(lead);
  }

  // The highest active line keeps the anchor as long as it (and its background
  // lines) finish before the line PIN_LOOKAHEAD real lines further down starts.
  const anchorIdx = activeLeads[0];
  const lookahead = GetLookaheadLine(Lines, anchorIdx);
  if (lookahead === null || GetGroupEndTime(Lines, anchorIdx) <= lookahead.StartTime) {
    return enhance(anchorIdx);
  }

  // Anchor refused — fall back to the original heuristic: contiguous or off by
  // only 1 → the first active line, a bigger gap → the last.
  const firstIdx = activeLeads[0];
  const lastIdx = activeLeads[activeLeads.length - 1];
  return enhance(lastIdx - firstIdx <= 1 ? firstIdx : lastIdx);
};

// Gap above the active line in "Top" scrolling. A resized popup can leave only
// a sliver of lyrics, where a fixed 50px pushed the line into the bottom fade,
// so in PiP it shrinks with the viewport, staying just inside the mask's top
// fade, which scales too (.spicy-pip-wrapper in Lyrics/main.css).
const GetTopScrollOffset = (container: HTMLElement) =>
  IsPIP ? Math.min(50, Math.round(container.clientHeight * 0.2)) : 85;

const ScrollTo = (
  container: HTMLElement,
  element: HTMLElement,
  instantScroll: boolean = false,
  type: "Center" | "Top" = "Center",
  lineIndex?: number
) => {
  isProgrammaticScrolling = true;
  try {
    if (lineIndex !== undefined && getLyricsVirtualizer()) {
      // instantScroll is effectively always true in the virtualizer path
      // (we set scrollTop directly), but passing the flag keeps the intent
      // explicit and allows a future smooth-scroll path if needed.
      scrollLyricsToIndex(
        lineIndex,
        type === "Top" ? "start" : "center",
        instantScroll,
        type === "Top" ? -GetTopScrollOffset(container) : 30
      );
      return;
    }
    if (type === "Center") {
      ScrollIntoCenterViewCSS(container, element, -30, instantScroll);
    } else if (type === "Top") {
      ScrollIntoTopViewCSS(container, element, GetTopScrollOffset(container), instantScroll);
    }
  } finally {
    requestAnimationFrame(() => {
      setTimeout(() => {
        isProgrammaticScrolling = false;
      }, 50);
    });
  }
};

export function isStaticNearAutoPosition(
  container: HTMLElement,
  targetIndex: number,
  totalLines: number,
  Lines?: LyricsLine[]
): boolean {
  if (!container || totalLines <= 0) return false;

  const scrollType = GetScrollType();
  const align = scrollType === "Top" ? "start" : "center";
  const padding = scrollType === "Top" ? -GetTopScrollOffset(container) : 30;

  const currentScrollTop = container.scrollTop;
  const viewportHeight = container.clientHeight || 500;
  // Tolerance: roughly 25% of viewport height (around 2-3 lines, min 120px, max 220px)
  const tolerance = Math.max(120, Math.min(220, viewportHeight * 0.25));

  // 1. Try Virtualizer precise target scroll top
  const targetScrollTop = getLyricsVirtualizerTargetScrollTop(targetIndex, align, padding);
  if (targetScrollTop !== null) {
    const diff = Math.abs(currentScrollTop - targetScrollTop);
    if (diff <= tolerance) {
      return true;
    }
    // Also check if target item is within the virtualizer's mounted/visible window
    const v = getLyricsVirtualizer();
    if (v) {
      const virtualItems = v.getVirtualItems();
      if (virtualItems.length > 0) {
        const firstIndex = virtualItems[0].index;
        const lastIndex = virtualItems[virtualItems.length - 1].index;
        if (targetIndex >= firstIndex && targetIndex <= lastIndex) {
          if (diff <= tolerance * 1.5) {
            return true;
          }
        }
      }
    }
    return false;
  }

  // 2. Fallback: DOM offsetTop check if element exists
  const targetElem = Lines?.[targetIndex]?.HTMLElement;
  if (targetElem && typeof targetElem.offsetTop === "number" && targetElem.offsetTop > 0) {
    const elemTop = targetElem.offsetTop;
    const expectedScrollTop =
      scrollType === "Top"
        ? elemTop - GetTopScrollOffset(container)
        : elemTop - (viewportHeight - targetElem.offsetHeight) / 2 + 30;
    const diff = Math.abs(currentScrollTop - Math.max(0, expectedScrollTop));
    return diff <= tolerance;
  }

  // 3. Fallback: Proportional scroll height estimate
  const maxScroll = Math.max(0, container.scrollHeight - viewportHeight);
  if (maxScroll > 0) {
    const expectedRatio = targetIndex / Math.max(1, totalLines - 1);
    const expectedScroll = expectedRatio * maxScroll;
    return Math.abs(currentScrollTop - expectedScroll) <= tolerance;
  }

  return true;
}

let scrolledToLastLine = false;
let scrolledToFirstLine = false;

// Throttle layout-dependent viewport checks to avoid forced sync layouts on every tick
const VIEWPORT_CHECK_INTERVAL = 350; // milliseconds
let lastViewportCheckTime = 0;
let lastViewportLine: HTMLElement | null = null;
let lastViewportContainer: HTMLElement | null = null;
let lastIsLineInViewport = false;

const GetScrollType = (): "Center" | "Top" => {
  return IsCompactMode() ? "Top" : "Center";
};

const policyEventPreset = "policy:";

let allowForceScrolling = true;

export const SetForceScrollingPolicy = (value: boolean) => {
  allowForceScrolling = value; // true = allow force scrolling, false = disallow force scrolling
  Global.Event.evoke(`${policyEventPreset}force-scrolling`, value);
};
export const GetForceScrollingPolicy = () => {
  return allowForceScrolling;
};

export function ScrollToActiveLine(ScrollSimplebar: any) {
  if ($currentLyricsType.get() === "None") return;
  if (!$lyricsContainerExists.get()) return;

  if ($currentLyricsType.get() === "Static") {
    const Lines = LyricsObject.Types["Static"]?.Lines as LyricsLine[];
    if (!Lines || Lines.length === 0) return;
    const container = ScrollSimplebar?.getScrollElement() as HTMLElement;
    if (!container) return;

    const Position = SpotifyPlayer.GetPosition();
    const Duration = SpotifyPlayer.GetDuration() || 180000;
    const progress = Math.min(Math.max(Position / Duration, 0), 1);
    const targetIndex = Math.min(Math.floor(progress * Lines.length), Lines.length - 1);

    const now = performance.now();
    const timeSinceLastScroll = now - lastUserScrollTime;

    // Detect actual playback seek (jump backward or forward > 3s)
    const isSeek =
      lastPosition !== 0 &&
      (Position < lastPosition - 1000 || Position > lastPosition + 3000);

    if (forceScrollQueued || lastLine == null || isSeek) {
      forceScrollQueued = false;
      userScrolledStatic = false;
      lastPosition = Position;
      const targetLine = Lines[targetIndex];
      lastLine = targetLine?.HTMLElement ?? null;
      ScrollTo(container, targetLine?.HTMLElement ?? null, true, GetScrollType(), targetIndex);
      return;
    }

    lastPosition = Position;

    // Check if SimpleBar scrollbar thumb is currently being dragged
    if (Boolean(ScrollSimplebar?.isDragging)) {
      userScrolledStatic = true;
      isUserScrolling = true;
      lastUserScrollTime = now;
      return;
    }

    if (timeSinceLastScroll > USER_SCROLL_COOLDOWN && isUserScrolling) {
      isUserScrolling = false;
    }

    // If the user manually scrolled:
    if (userScrolledStatic) {
      if (isUserScrolling || timeSinceLastScroll <= USER_SCROLL_COOLDOWN) {
        return;
      }

      // Check if user scrolled back near where auto scrolling would be
      if (isStaticNearAutoPosition(container, targetIndex, Lines.length, Lines)) {
        userScrolledStatic = false;
        const lyricsContent = PageContainer?.querySelector(".LyricsContainer .LyricsContent");
        lyricsContent?.classList.remove("HideLineBlur");

        const targetLine = Lines[targetIndex];
        const LineElem = targetLine?.HTMLElement;
        lastLine = LineElem ?? null;
        ScrollTo(container, LineElem ?? null, false, GetScrollType(), targetIndex);
      }
      return;
    }

    // Auto-scroll when user has not manually scrolled away
    if (timeSinceLastScroll > USER_SCROLL_COOLDOWN && !isUserScrolling) {
      const targetLine = Lines[targetIndex];
      const LineElem = targetLine?.HTMLElement;
      if (lastLine !== LineElem) {
        lastLine = LineElem ?? null;
        ScrollTo(container, LineElem ?? null, false, GetScrollType(), targetIndex);
      }
    }
    return;
  }

  const currentType = $currentLyricsType.get() as LyricsType;
  const Lines = LyricsObject.Types[currentType]?.Lines as LyricsLine[] | LyricsSyllable[];
  if (!Lines) return;

  // Check if a force scroll was queued
  const isForceScrollQueued = forceScrollQueued;
  const isSmoothForceScrollQueued = smoothForceScrollQueued;

  //if (Spicetify.Platform.History.location.pathname === "/SpicyLyrics") {
  const Position = SpotifyPlayer.GetPosition();
  // Early scroll: pick the scroll target as if the clock were this far ahead, so
  // the list starts moving before the line lights up instead of snapping to it
  // the moment it does. Only the target changes — line states (Status) still
  // follow the real position.
  const PositionOffset = $scrollLeadEnabled.get() ? Math.max(0, $scrollLeadMs.get()) : 0;
  const ProcessedPosition = Position + PositionOffset;
  const currentLine = GetScrollLine(Lines, ProcessedPosition) as EnhancedLyricsItem | null;

  let notSungCount = 0;
  let activeCount = 0;
  let sungCount = 0;
  for (let i = 0; i < Lines.length; i++) {
    const status = Lines[i].Status;
    if (status === "NotSung") notSungCount++;
    else if (status === "Active") activeCount++;
    else if (status === "Sung") sungCount++;
  }
  const allLinesNotSung = notSungCount === Lines.length;
  const oneActiveNoSung = activeCount === 1 && sungCount === 0;
  const allLinesSung = sungCount === Lines.length;
  const shouldForceScroll = isForceScrollQueued || lastLine == null;

  if (
    shouldForceScroll ||
    (!SpotifyPlayer.IsPlaying && lastPosition !== Position) ||
    (lastPosition !== 0 && wasDrasticPositionChange(lastPosition ?? 0, Position))
  ) {
    if (!allowForceScrolling) return;
    const container = ScrollSimplebar?.getScrollElement() as HTMLElement;
    if (!container) return;
    isUserScrolling = false;
    const targetIndex = allLinesSung ? Lines.length - 1 : (currentLine?._LineIndex ?? 0);
    const scrollToLine = allLinesSung
      ? Lines[Lines.length - 1]?.HTMLElement
      : (currentLine?.HTMLElement ?? Lines[0]?.HTMLElement);
    if (!scrollToLine && !getLyricsVirtualizer()) return;
    lastLine = scrollToLine ?? null;
    ScrollTo(
      container,
      scrollToLine ?? null,
      shouldForceScroll || (lastPosition !== 0 && wasDrasticPositionChange(lastPosition ?? 0, Position)),
      GetScrollType(),
      targetIndex
    );
    if (forceScrollQueued) {
      forceScrollQueued = false; // Reset the queue after using it
    }
    lastPosition = Position;
    return;
  }

  lastPosition = Position;

  if (isSmoothForceScrollQueued) {
    if (!allowForceScrolling) return;
    const container = ScrollSimplebar?.getScrollElement() as HTMLElement;
    if (!container) return;
    isUserScrolling = false;
    const scrollToLine = allLinesSung
      ? Lines[Lines.length - 1]?.HTMLElement
      : currentLine?.HTMLElement;
    if (!scrollToLine) return;
    lastLine = scrollToLine;
    const smoothScrollLineIndex = allLinesSung ? Lines.length - 1 : currentLine?._LineIndex;
    ScrollTo(container, scrollToLine, false, GetScrollType(), smoothScrollLineIndex);
    if (smoothForceScrollQueued) {
      smoothForceScrollQueued = false; // Reset the queue after using it
    }
    return;
  }

  if (!Lines) return;

  // --- NEW: Check conditions to scroll to top ---

  if (allLinesNotSung || oneActiveNoSung || (Lines[0]?.StartTime !== undefined && Position <= Lines[0].StartTime)) {
    if (!scrolledToFirstLine) {
      QueueSmoothForceScroll();
      scrolledToFirstLine = true;
    }
  } else {
    scrolledToFirstLine = false;
  }
  // --- END NEW ---

  // Check if all lines are sung

  if (allLinesSung) {
    /* const container = ScrollSimplebar?.getScrollElement() as HTMLElement;
            if (container) {
                const timeSinceLastScroll = performance.now() - lastUserScrollTime;

                // Only auto-scroll if user hasn't scrolled recently
                if (timeSinceLastScroll > USER_SCROLL_COOLDOWN && !isUserScrolling) {
                    isUserScrolling = false;
                    // Remove HideLineBlur class when auto-scroll resumes
                    const lyricsContent = PageContainer?.querySelector(".LyricsContainer .LyricsContent");
                    if (lyricsContent) {
                        lyricsContent.classList.remove("HideLineBlur");
                    }
                    // Get the last line element to scroll to
                    const lastLineElement = Lines[Lines.length - 1].HTMLElement as HTMLElement;
                    ScrollIntoCenterViewCSS(container, lastLineElement, true);
                }
                return;
            } */
    if (scrolledToLastLine) return;
    QueueSmoothForceScroll();
    scrolledToLastLine = true;
  }

  // Handle start of track
  //if (Position <= POSITION_THRESHOLD) {
  /* const container = ScrollSimplebar?.getScrollElement() as HTMLElement;
            if (container) {
                // Use smooth scrolling to top
                container.scrollTop = 0;
                return;
            } */
  /* QueueForceScroll();
        } */

  // Handle end of track
  /* if (ProcessedPosition >= TrackDuration - POSITION_THRESHOLD) {
            /* const container = ScrollSimplebar?.getScrollElement() as HTMLElement;
            if (container) {
                // Use smooth scrolling to bottom
                container.scrollTop = container.scrollHeight;
                return;
            } 
            QueueForceScroll();
        } */

  Continue(currentLine);

  function Continue(currentLine: EnhancedLyricsItem | null) {
    if (currentLine) {
      const LineElem = currentLine?.HTMLElement as HTMLElement;
      if (!LineElem) return;
      const container = ScrollSimplebar?.getScrollElement() as HTMLElement;
      if (!container) return;
      const now = performance.now();
      const timeSinceLastScroll = now - lastUserScrollTime;

      const hasVirtualizer = getLyricsVirtualizer() !== null;

      // Throttled layout read for viewport visibility. Under the virtualizer
      // isConnected alone decides (below), so skip the forced layout.
      const shouldRecalculateViewport =
        !hasVirtualizer &&
        (now - lastViewportCheckTime > VIEWPORT_CHECK_INTERVAL ||
          lastViewportLine !== LineElem ||
          lastViewportContainer !== container);

      if (shouldRecalculateViewport) {
        // Check if the line is at least 5px visible within the scroll container
        const elementOffsetTop = LineElem.offsetTop;
        const elementBottom = elementOffsetTop + LineElem.clientHeight;
        const viewportTop = container.scrollTop;
        const viewportBottom = viewportTop + container.clientHeight;

        const visibleTop = Math.max(elementOffsetTop, viewportTop);
        const visibleBottom = Math.min(elementBottom, viewportBottom);
        const visibleHeight = Math.max(0, visibleBottom - visibleTop);

        // Consider the line "in viewport" if at least 5px is visible
        lastIsLineInViewport = visibleHeight >= 5;
        lastViewportCheckTime = now;
        lastViewportLine = LineElem;
        lastViewportContainer = container;
      }

      // When virtualizer is active, detached (off-screen) elements have offsetTop=0,
      // making the standard viewport check unreliable. If the virtualizer is present,
      // once user scroll cooldown has expired, we can always scroll to the target index.
      const isLineInViewport = hasVirtualizer ? true : lastIsLineInViewport;

      const isSameLine = lastLine === LineElem;

      /*
                for (let i = 0; i < Lines.length; i++) {
                    const line = Lines[i];
                    if (line.HTMLElement) {
                        const container = ScrollSimplebar?.getScrollElement() as HTMLElement;
                        if (!container) return;
                        const LineElem = line.HTMLElement;
                        const lineRect = LineElem.getBoundingClientRect();
                        const containerRect = container.getBoundingClientRect();
                        const isLineInViewport = lineRect.top >= containerRect.top && lineRect.bottom <= containerRect.bottom;

                        if (!isLineInViewport) {
                            if (!LineElem.classList.contains("NotInViewport")) LineElem.classList.add("NotInViewport")
                        } else {
                            if (LineElem.classList.contains("NotInViewport")) LineElem.classList.remove("NotInViewport")
                        }
                    }
                } */

      // If this is the first line (no previous line), force scroll without checks
      /* if (!shouldForceScroll) {
                    isUserScrolling = false;
                    lastLine = LineElem;
                    ScrollIntoCenterViewCSS(container, LineElem, true);
                    return;
                } */

      // Only auto-scroll if BOTH conditions are met:
      // 1. User hasn't scrolled in the last second (cooldown passed)
      // 2. AND the active line is in viewport
      if (timeSinceLastScroll > USER_SCROLL_COOLDOWN && isLineInViewport) {
        // --- REVISED LOGIC for resuming auto-scroll ---
        //const wasUserScrolling = isUserScrolling; // Capture state before changing
        isUserScrolling = false;
        // Remove HideLineBlur class ONLY if we were user scrolling
        //if (wasUserScrolling) {
        const lyricsContent = PageContainer?.querySelector(
          ".LyricsContainer .LyricsContent"
        );
        if (lyricsContent) {
          if (lyricsContent.classList.contains("HideLineBlur")) {
            lyricsContent.classList.remove("HideLineBlur");
          }
        } else {
          console.warn(
            "SpicyLyrics: Could not find .LyricsContent in ScrollToActiveLine to remove HideLineBlur."
          );
        }
        //}
        // Scroll if the line is different from the last auto-scrolled line
        if (!isSameLine) {
          lastLine = LineElem;
          const Scroll = () => {
            ScrollTo(container, LineElem, false, GetScrollType(), currentLine._LineIndex);
            scrolledToLastLine = false;
            scrolledToFirstLine = false;
          };
          // Leaving a "•••" interlude: normally wait for it to collapse first.
          // With Smooth Scrolling the rows glide as it collapses, so scrolling at
          // the same moment makes the two read as one motion instead of two.
          if (
            !$smoothScrolling.get() &&
            Lines[currentLine._LineIndex - 1] &&
            Lines[currentLine._LineIndex - 1].DotLine === true
          ) {
            // Skip if a song change, seek or reset moved on in the meantime —
            // the captured index would scroll the new lyrics to a stale line.
            setTimeout(() => {
              if (lastLine === LineElem) Scroll();
            }, 240);
          } else {
            Scroll();
          }
        }
        // --- END REVISED LOGIC ---
      }
    }
  }
  //}
}

// Function to queue a force scroll for the next frame
export function QueueForceScroll() {
  forceScrollQueued = true;
  userScrolledStatic = false;
}

export function QueueSmoothForceScroll() {
  smoothForceScrollQueued = true;
}

export function ResetLastLine() {
  lastLine = null;
  lastViewportLine = null;
  lastViewportContainer = null;
  lastIsLineInViewport = false;
  lastViewportCheckTime = 0;
  isUserScrolling = false;
  userScrolledStatic = false;
  lastUserScrollTime = 0;
  lastPosition = 0;
  forceScrollQueued = false;
  smoothForceScrollQueued = false;
  scrolledToLastLine = false;
  scrolledToFirstLine = false;
}

// Cleanup Function
export function CleanupScrollEvents() {
  if (currentScrollElement) {
    if (wheelHandler) currentScrollElement.removeEventListener("wheel", wheelHandler);
    if (touchMoveHandler) currentScrollElement.removeEventListener("touchmove", touchMoveHandler);
    if (touchStartHandler) currentScrollElement.removeEventListener("touchstart", touchStartHandler);
    if (scrollHandler) currentScrollElement.removeEventListener("scroll", scrollHandler);
    if (keyDownHandler) currentScrollElement.removeEventListener("keydown", keyDownHandler);
  }
  if (currentIntentRoot && pointerDownHandler) {
    currentIntentRoot.removeEventListener("pointerdown", pointerDownHandler);
  }

  // Disconnect observer
  lyricsContentObserver?.disconnect();

  // Reset module variables
  currentSimpleBarInstance = null;
  currentScrollElement = null;
  currentIntentRoot = null;
  wheelHandler = null;
  touchMoveHandler = null;
  touchStartHandler = null;
  scrollHandler = null;
  pointerDownHandler = null;
  keyDownHandler = null;
  forceScrollQueued = false;
  smoothForceScrollQueued = false;
  scrolledToLastLine = false;
  scrolledToFirstLine = false;
  userScrolledStatic = false;
}

export const getUserScrolledStatic = () => userScrolledStatic;
export const setUserScrolledStatic = (val: boolean) => {
  userScrolledStatic = val;
};
