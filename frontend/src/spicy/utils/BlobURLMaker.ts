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

const BlobURLCache = new Map<string, { blobUrl: string; expiresAt: number }>();

export default async function BlobURLMaker(url: string): Promise<string | null> {
  if (!url) throw new Error("SpicyLyrics: BlobURLMaker: url Missing");
  const existingBlobURL = BlobURLCache.get(url);
  if (existingBlobURL) {
    const expiresAt = existingBlobURL.expiresAt;
    if (expiresAt < Date.now()) {
      BlobURLCache.delete(url);
    }
    return existingBlobURL.blobUrl;
  }
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }

    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);

    const expiresAt = Date.now() + 1000 * 60 * 60;
    BlobURLCache.set(url, {
      blobUrl,
      expiresAt,
    });
    return blobUrl;
  } catch (error) {
    console.error("Error fetching and converting to blob URL:", error);
    throw error;
  }
}
