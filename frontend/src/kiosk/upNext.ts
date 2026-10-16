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

import type { QueueItemDto } from "../bridge/spotifyPlayer.ts";

export function createKioskUpNext(): { element: HTMLElement; update: (queue: QueueItemDto[] | undefined) => void; destroy: () => void } {
  const cardEl = document.createElement("div");
  cardEl.className = "KioskUpNext sl-glass--liquid";
  cardEl.style.cssText = `
    position: absolute;
    bottom: 34px;
    right: 28px;
    z-index: 1000;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 14px 8px 10px;
    border-radius: 14px;
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.12);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
    color: #ffffff;
    user-select: none;
    max-width: 280px;
    opacity: 0;
    transform: translateY(12px);
    pointer-events: none;
    transition: opacity 0.4s ease, transform 0.4s ease;
  `;

  cardEl.innerHTML = `
    <img class="KioskUpNextThumb" src="" alt="" style="width: 44px; height: 44px; border-radius: 8px; object-fit: cover; background: rgba(255,255,255,0.05); flex-shrink: 0;" />
    <div style="display: flex; flex-direction: column; overflow: hidden; min-width: 0;">
      <span style="font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.55; margin-bottom: 2px;">Up Next</span>
      <span class="KioskUpNextTitle" style="font-size: 0.85rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;"></span>
      <span class="KioskUpNextArtist" style="font-size: 0.75rem; opacity: 0.7; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;"></span>
    </div>
  `;

  const thumbEl = cardEl.querySelector(".KioskUpNextThumb") as HTMLImageElement;
  const titleEl = cardEl.querySelector(".KioskUpNextTitle") as HTMLElement;
  const artistEl = cardEl.querySelector(".KioskUpNextArtist") as HTMLElement;

  function update(queue: QueueItemDto[] | undefined) {
    if (!queue || queue.length === 0 || !queue[0]?.title) {
      titleEl.textContent = "No upcoming tracks";
      artistEl.textContent = "Queue is empty";
      thumbEl.style.display = "none";
      cardEl.style.opacity = "0";
      cardEl.style.transform = "translateY(12px)";
      cardEl.style.pointerEvents = "none";
      return;
    }

    const nextItem = queue[0];
    titleEl.textContent = nextItem.title;
    artistEl.textContent = nextItem.artist || "";
    if (nextItem.cover_url) {
      thumbEl.src = nextItem.cover_url;
      thumbEl.style.display = "block";
    } else {
      thumbEl.style.display = "none";
    }

    cardEl.style.opacity = "1";
    cardEl.style.transform = "translateY(0)";
    cardEl.style.pointerEvents = "auto";
  }

  update(undefined);

  return {
    element: cardEl,
    update,
    destroy: () => cardEl.remove(),
  };
}
