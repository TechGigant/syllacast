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

export interface KioskFooterController {
  element: HTMLElement;
  updateLyricsSource: (source: string | undefined, uploader?: string) => void;
  setLyricsSourceVisible: (visible: boolean) => void;
  setSourceLinkVisible: (visible: boolean) => void;
  destroy: () => void;
}

export function createKioskFooter(): KioskFooterController {
  const footerEl = document.createElement("div");
  footerEl.className = "KioskFooter";
  footerEl.style.cssText = `
    position: fixed;
    bottom: 8px;
    left: 20px;
    right: 20px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    z-index: 990;
    pointer-events: none;
    font-size: 0.75rem;
    color: rgba(255, 255, 255, 0.42);
    user-select: none;
    letter-spacing: 0.02em;
    font-family: inherit;
    transition: opacity 0.3s ease;
  `;

  footerEl.innerHTML = `
    <div class="KioskFooterLeft" style="display: flex; align-items: center; gap: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
      <span class="KioskLyricsProviderText">Lyrics provided by Spicy Lyrics</span>
    </div>
    <div class="KioskFooterRight" style="display: flex; align-items: center; gap: 6px;">
      <a href="https://github.com/TechGigant/syllacast" target="_blank" rel="noopener noreferrer" style="pointer-events: auto; color: inherit; text-decoration: underline; opacity: 0.85;">
        https://github.com/TechGigant/syllacast
      </a>
    </div>
  `;

  const leftEl = footerEl.querySelector(".KioskFooterLeft") as HTMLElement;
  const rightEl = footerEl.querySelector(".KioskFooterRight") as HTMLElement;
  const providerTextEl = footerEl.querySelector(".KioskLyricsProviderText") as HTMLElement;

  function updateLyricsSource(source?: string, uploader?: string) {
    if (!source) {
      providerTextEl.textContent = "Lyrics provided by Spicy Lyrics";
      return;
    }

    let provider = "Spicy Lyrics";
    const src = source.toLowerCase();
    if (src.includes("aml") || src.includes("apple")) {
      provider = "Apple Music via Spicy Lyrics";
    } else if (src.includes("spt") || src.includes("spotify")) {
      provider = "Spotify via Spicy Lyrics";
    }

    let text = `Lyrics provided by ${provider}`;
    if (uploader) {
      text += ` • Synced by ${uploader}`;
    }
    providerTextEl.textContent = text;
  }

  function setLyricsSourceVisible(visible: boolean) {
    leftEl.style.display = visible ? "flex" : "none";
  }

  function setSourceLinkVisible(visible: boolean) {
    rightEl.style.display = visible ? "flex" : "none";
  }

  return {
    element: footerEl,
    updateLyricsSource,
    setLyricsSourceVisible,
    setSourceLinkVisible,
    destroy: () => footerEl.remove(),
  };
}
