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
 * Transfer an element to a target container at a specified index
 * @param element - The element to transfer
 * @param targetContainer - The container to transfer the element to
 * @param index - The index at which to insert the element (-1 to append at the end)
 */
export default function TransferElement(
  element: HTMLElement,
  targetContainer: HTMLElement,
  index = -1
): void {
  if (!element || !targetContainer) {
    console.error("Both element and target container must be provided.");
    return;
  }

  try {
    // If index is out of bounds, append the element at the end
    if (index < 0 || index >= targetContainer.children.length) {
      targetContainer.appendChild(element);
    } else {
      // Insert before the element at the specified index
      targetContainer.insertBefore(element, targetContainer.children[index]);
    }
  } catch (error) {
    console.error("Error transferring element:", error);
  }
}
