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
 * Determines if text is primarily right-to-left.
 * @param text The string to check
 * @returns true if the text is RTL, false if LTR
 */
function isRtl(text: string): boolean {
  // Return false for empty strings
  if (!text || text.length === 0) return false;

  // RTL Unicode ranges for Arabic, Hebrew, Persian, etc.
  const rtlRegex =
    /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB1D-\uFB4F\uFB50-\uFDFF\uFE70-\uFEFF]/;

  // Find the first strongly directional character
  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    // Skip digits, spaces and common punctuation
    if (/[\d\s,.;:?!()[\]{}"'\\/<>@#$%^&*_=+-]/.test(char)) {
      continue;
    }

    // Return true if the character is from RTL scripts
    return rtlRegex.test(char);
  }

  // Default to LTR if no strong directional character is found
  return false;
}

export default isRtl;
