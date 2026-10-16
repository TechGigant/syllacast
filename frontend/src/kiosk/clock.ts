/*
 * Syllacast - Standalone Spotify Lyrics Kiosk
 * Copyright (C) 2026 TechGigant
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

export function createKioskClock(): { element: HTMLElement; start: () => void; destroy: () => void } {
  const clockEl = document.createElement("div");
  clockEl.className = "KioskClock sl-glass--liquid";
  clockEl.style.cssText = `
    position: absolute;
    top: 24px;
    left: 28px;
    z-index: 1000;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 16px;
    border-radius: 9999px;
    font-size: 0.95rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.05em;
    color: #ffffff;
    user-select: none;
    pointer-events: none;
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.12);
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25);
  `;

  const textSpan = document.createElement("span");
  textSpan.className = "KioskClockText";
  clockEl.appendChild(textSpan);

  let timerId: number | null = null;

  function update() {
    const now = new Date();
    const hours = now.getHours().toString().padStart(2, "0");
    const minutes = now.getMinutes().toString().padStart(2, "0");
    const seconds = now.getSeconds().toString().padStart(2, "0");
    textSpan.textContent = `${hours}:${minutes}:${seconds}`;
  }

  update();

  return {
    element: clockEl,
    start: () => {
      if (timerId === null) {
        timerId = window.setInterval(update, 1000);
      }
    },
    destroy: () => {
      if (timerId !== null) {
        clearInterval(timerId);
        timerId = null;
      }
      clockEl.remove();
    },
  };
}
