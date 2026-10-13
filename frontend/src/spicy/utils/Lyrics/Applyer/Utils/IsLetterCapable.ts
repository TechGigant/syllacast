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

import { $simpleLyricsMode } from "../../../../utils/stores.ts";

const Simple = (letterLength: number, totalDuration: number) => {
  const minDuration = 1000;

  return totalDuration >= minDuration;
};

const SimpleLyricsModeCapable = (letterLength: number, totalDuration: number) => {
  if (letterLength > 12) {
    return false;
  }

  const minDuration = 1050;
  //const maxDuration = 8550;

  return totalDuration >= minDuration; // && totalDuration <= maxDuration;
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _Complex = (letterLength: number, totalDuration: number) => {
  // Enforce a maximum letter length of 12
  if (letterLength > 12) {
    return false;
  }

  // Calculate the minimum duration based on the letter length
  const minDuration = 1000 + ((letterLength - 1) / 1) * 25; // Increases duration as letter length increases

  // Return whether the letter length and duration meet the criteria
  return totalDuration >= minDuration;
};

export function IsLetterCapable(letterLength: number, totalDuration: number) {
  return $simpleLyricsMode.get()
    ? SimpleLyricsModeCapable(letterLength, totalDuration)
    : Simple(letterLength, totalDuration);
}
