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

const IdleLyricsScale = 0.95;
const IdleEmphasisLyricsScale = 0.95;
const timeOffset = 0;
const DurationTimeOffset = 0;
const BlurMultiplier = 1.25;

// Adjust blur levels in low-quality mode for better performance
const WordBlurs = {
  Emphasis: {
    min: 4,
    max: 14,
    LowQualityMode: {
      min: 1, // Lowered from 2 for better performance
      max: 3, // Lowered from 6
    },
  },
  min: 3,
  max: 9,
  LowQualityMode: {
    min: 2, // Lowered from 4
    max: 6, // Lowered from 8
  },
};

export {
  IdleLyricsScale,
  IdleEmphasisLyricsScale,
  timeOffset,
  DurationTimeOffset,
  BlurMultiplier,
  WordBlurs,
};
