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

/**
 * Darkens a hex color by a specified percentage
 * @param color - Hex color string (e.g., "#FFFFFF")
 * @param percent - Percentage to darken (0-100)
 * @returns Darkened hex color string
 */
export function darkenColor(color: string, percent: number): string {
  // Validate input
  if (!color.startsWith("#") || (color.length !== 7 && color.length !== 4)) {
    console.warn("Invalid color format. Expected #RRGGBB or #RGB");
    return color;
  }

  // Parse RGB values
  let R = parseInt(color.substring(1, 3), 16);
  let G = parseInt(color.substring(3, 5), 16);
  let B = parseInt(color.substring(5, 7), 16);

  // Apply darkening
  R = Math.max(0, Math.floor(R * (1 - percent / 100)));
  G = Math.max(0, Math.floor(G * (1 - percent / 100)));
  B = Math.max(0, Math.floor(B * (1 - percent / 100)));

  // Convert back to hex
  return `#${((1 << 24) + (R << 16) + (G << 8) + B).toString(16).slice(1)}`;
}
