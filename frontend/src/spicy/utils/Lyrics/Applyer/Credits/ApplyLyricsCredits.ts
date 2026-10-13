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

interface LyricsData {
  SongWriters?: string[];
  Type?: string;
  Content?: any;
  classes?: string;
  styles?: Record<string, string>;
}

export function ApplyLyricsCredits(data: LyricsData, LyricsContainer: HTMLElement): void {
  if (!data?.SongWriters || !LyricsContainer) return;

  const CreditsElement = document.createElement("div");
  CreditsElement.classList.add("Credits");

  const SongWriters = data.SongWriters.join(", ");
  CreditsElement.textContent = `Written by: ${SongWriters}`;
  LyricsContainer.appendChild(CreditsElement);
}
