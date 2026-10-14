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

import { getLyricsProviderName } from "../spicy/utils/Lyrics/Applyer/Credits/ApplyProvider.ts";

export interface ContributorInfo {
  username?: string;
  url?: string;
}

export interface KioskFooterController {
  element: HTMLElement;
  updateLyricsSource: (
    source: string | null | undefined,
    uploader?: ContributorInfo | string,
    maker?: ContributorInfo | string
  ) => void;
  setLyricsSourceVisible?: (visible: boolean) => void;
  setSourceLinkVisible: (visible: boolean) => void;
  destroy: () => void;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function isSafeUrl(url?: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url, "http://localhost");
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
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
    align-items: flex-end;
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
    <div class="KioskFooterLeft" style="width: 45vw; max-width: calc(100vw - 320px); min-width: 0; box-sizing: border-box; display: block; white-space: normal; word-break: break-word; overflow-wrap: anywhere; line-height: 1.35;"></div>
    <div class="KioskFooterRight" style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
      <a href="https://github.com/TechGigant/syllacast" target="_blank" rel="noopener noreferrer" style="pointer-events: auto; color: inherit; text-decoration: underline; opacity: 0.85;">
        https://github.com/TechGigant/syllacast
      </a>
    </div>
  `;

  const leftEl = footerEl.querySelector(".KioskFooterLeft") as HTMLElement;
  const rightEl = footerEl.querySelector(".KioskFooterRight") as HTMLElement;

  function updateLyricsSource(
    source: string | null | undefined,
    uploader?: ContributorInfo | string,
    maker?: ContributorInfo | string
  ) {
    if (source === null) {
      leftEl.innerHTML = "";
      return;
    }

    const provider = getLyricsProviderName(source);

    const uploaderObj: ContributorInfo | undefined =
      typeof uploader === "string" ? { username: uploader } : uploader;
    const makerObj: ContributorInfo | undefined =
      typeof maker === "string" ? { username: maker } : maker;

    function renderContributorSpan(rolePrefix: string, c?: ContributorInfo): string {
      if (!c?.username) return "";
      const name = escapeHtml(c.username);
      if (isSafeUrl(c.url)) {
        const safeHref = escapeHtml(c.url!);
        return ` • ${rolePrefix} <a href="${safeHref}" target="_blank" rel="noopener noreferrer" style="pointer-events: auto; color: inherit; text-decoration: underline;">@${name}</a> (<a href="${safeHref}" target="_blank" rel="noopener noreferrer" style="pointer-events: auto; color: inherit; text-decoration: underline;">${safeHref}</a>)`;
      }
      return ` • ${rolePrefix} @${name}`;
    }

    let communityCredits = "";
    if (uploaderObj?.username && makerObj?.username && uploaderObj.username === makerObj.username) {
      communityCredits = renderContributorSpan("Made & uploaded by", uploaderObj);
    } else {
      if (makerObj?.username) {
        communityCredits += renderContributorSpan("Made by", makerObj);
      }
      if (uploaderObj?.username) {
        communityCredits += renderContributorSpan("Uploaded by", uploaderObj);
      }
    }

    const hasContributorUrl =
      (uploaderObj?.url && isSafeUrl(uploaderObj.url)) ||
      (makerObj?.url && isSafeUrl(makerObj.url));

    const providerSafe = escapeHtml(provider);
    let providerHtml = providerSafe;
    if (provider.includes("Spicy Lyrics")) {
      const spicyUrl = "https://spicylyrics.org";
      providerHtml = `<a href="${spicyUrl}" target="_blank" rel="noopener noreferrer" style="pointer-events: auto; color: inherit; text-decoration: underline;">${providerSafe}</a>`;
      if (!hasContributorUrl) {
        providerHtml += ` (<a href="${spicyUrl}" target="_blank" rel="noopener noreferrer" style="pointer-events: auto; color: inherit; text-decoration: underline;">${spicyUrl}</a>)`;
      }
    }

    leftEl.innerHTML = `
      <div class="KioskLyricsContainer" style="width: 100%; white-space: normal; word-break: break-word; overflow-wrap: anywhere; line-height: 1.35;">
        <span class="KioskLyricsProviderText">Lyrics provided by ${providerHtml}</span>
        ${communityCredits}
      </div>
    `;
    leftEl.style.display = "block";
  }

  return {
    element: footerEl,
    updateLyricsSource,
    setLyricsSourceVisible: (_visible: boolean) => {
      // Attribution can be quiet (0.42 opacity) but never absent per upstream terms Section 6.
      // Hiding attribution is deliberately disallowed.
    },
    setSourceLinkVisible: (_visible: boolean) => {
      // Source code link is permanent per AGPL-3.0 network source offer and kiosk requirements.
      // Hiding the source code link is deliberately disallowed.
    },
    destroy: () => footerEl.remove(),
  };
}
