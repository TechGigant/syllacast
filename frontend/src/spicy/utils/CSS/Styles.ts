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

// Define a type for CSS style properties
export interface StyleProperties {
  [key: string]: string;
}

export function applyStyles(element: HTMLElement, styles: StyleProperties): void {
  if (element) {
    Object.entries(styles).forEach(([key, value]) => {
      element.style[key as any] = value;
    });
  } else {
    console.warn("Element not found");
  }
}

export function removeAllStyles(element: HTMLElement): void {
  if (element) {
    // Reset all inline styles
    element.removeAttribute("style");
  } else {
    console.warn("Element not found");
  }
}
