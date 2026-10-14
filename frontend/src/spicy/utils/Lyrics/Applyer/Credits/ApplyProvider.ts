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

export const ProviderMap = {
    "spt": "Spotify via Spicy Lyrics",
    "spotify": "Spotify via Spicy Lyrics",
    "aml": "Apple Music via Spicy Lyrics",
    "apple_music": "Apple Music via Spicy Lyrics",
    "spl": "Spicy Lyrics",
    "spicy_lyrics": "Spicy Lyrics",
    "spicylyrics": "Spicy Lyrics",
    "ldb": "Local DB",
    "local_db": "Local DB",
} as const;

export function getLyricsProviderName(source: string | undefined): string {
  if (!source) return "unknown";
  const src = source.toLowerCase().trim();
  if (src in ProviderMap) {
    return ProviderMap[src as keyof typeof ProviderMap];
  }
  if (src.includes("aml") || src.includes("apple")) {
    return "Apple Music via Spicy Lyrics";
  }
  if (src.includes("spt") || src.includes("spotify")) {
    return "Spotify via Spicy Lyrics";
  }
  if (src.includes("spl") || src.includes("spicy")) {
    return "Spicy Lyrics";
  }
  return "unknown";
}

export function ApplyLyricsProvider(_data: any, _LyricsContainer: HTMLElement): void {
  // Syllacast kiosk displays persistent lyrics source attribution in the bottom footer.
  // We do not append a duplicate element at the bottom of the lyrics container.
  return;
}
