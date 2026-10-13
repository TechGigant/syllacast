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

import SimpleBar from "simplebar";
import { IntervalManager } from "../../IntervalManager.ts";
import {
  IsMouseInLyricsPage,
  LyricsPageMouseEnter,
  LyricsPageMouseLeave,
  SetIsMouseInLyricsPage,
} from "../Page/IsHovering.ts";
import { PageContainer } from "../../../components/Pages/PageView.ts";

export let ScrollSimplebar: any | null = null;

const ElementEventQuery = ".ContentBox .LyricsContainer";

export function MountScrollSimplebar() {
  if (!PageContainer) {
    console.warn("Cannot mount ScrollSimplebar: PageContainer not found");
    return;
  }
  const LyricsContainer = PageContainer.querySelector<HTMLElement>(
    ".LyricsContainer .LyricsContent"
  );

  if (!LyricsContainer) {
    console.warn("Cannot mount ScrollSimplebar: LyricsContainer not found");
    return;
  }

  ScrollSimplebar = new SimpleBar(LyricsContainer, { autoHide: false });

  PageContainer
    .querySelector<HTMLElement>(ElementEventQuery)
    ?.addEventListener("mouseenter", LyricsPageMouseEnter);
  PageContainer
    .querySelector<HTMLElement>(ElementEventQuery)
    ?.addEventListener("mouseleave", LyricsPageMouseLeave);
}

export function ClearScrollSimplebar() {
  ScrollSimplebar?.unMount();
  ScrollSimplebar = null;
  SetIsMouseInLyricsPage(false);
  if (PageContainer) {
    PageContainer
      .querySelector<HTMLElement>(ElementEventQuery)
      ?.removeEventListener("mouseenter", LyricsPageMouseEnter);
    PageContainer
      .querySelector<HTMLElement>(ElementEventQuery)
      ?.removeEventListener("mouseleave", LyricsPageMouseLeave);
  }
}

export function RecalculateScrollSimplebar() {
  ScrollSimplebar?.recalculate();
}

new IntervalManager(Infinity, () => {
  if (!PageContainer) return;
  const LyricsContainer = PageContainer.querySelector<HTMLElement>(
    ".LyricsContainer .LyricsContent"
  );
  if (!LyricsContainer || !ScrollSimplebar) return;
  const hide = !IsMouseInLyricsPage && !ScrollSimplebar.isDragging;
  // Unguarded add/remove would queue a MutationObserver record every frame.
  if (LyricsContainer.classList.contains("hide-scrollbar") !== hide) {
    LyricsContainer.classList.toggle("hide-scrollbar", hide);
  }
}).Start();
