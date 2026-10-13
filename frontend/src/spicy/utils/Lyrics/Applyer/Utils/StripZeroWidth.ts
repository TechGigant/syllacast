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

// Zero-width characters that carry no visual meaning but still occupy a
// character slot — they break letter-by-letter emphasis (empty <span>s with
// their own slice of the word's duration) and add invisible cursor stops.
//
// U+200B ZERO WIDTH SPACE, U+200E/U+200F LTR/RTL MARK, U+2060 WORD JOINER,
// U+FEFF ZERO WIDTH NO-BREAK SPACE (BOM).
//
// ZWNJ (U+200C) and ZWJ (U+200D) are deliberately left in: they are
// meaningful in Arabic/Persian/Indic scripts and in emoji sequences.
//
// This is render-only. The parsed/cached lyrics keep their original text so
// nothing downstream (hashing, transliteration, upload) sees a mutated string.
const ZeroWidthRegex = /[\u200B\u200E\u200F\u2060\uFEFF]/g;

export function StripZeroWidth(text: string): string {
  return text.replace(ZeroWidthRegex, "");
}

export default StripZeroWidth;
