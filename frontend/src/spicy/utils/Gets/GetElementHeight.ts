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

export function GetElementHeight(element: HTMLElement): number {
  // Get the computed styles for the ::before pseudo-element
  const beforeStyles = getComputedStyle(element, "::before");
  const afterStyles = getComputedStyle(element, "::after");

  // Parse the height values to numbers
  const beforeHeight = parseInt(beforeStyles.height) || 0;
  const afterHeight = parseInt(afterStyles.height) || 0;

  return element.offsetHeight + beforeHeight + afterHeight;
}
