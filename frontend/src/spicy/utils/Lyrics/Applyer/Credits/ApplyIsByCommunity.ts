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

import { createTooltip } from "../../../tooltip.ts";
import { IsPIP } from "../../../../components/Utils/PopupLyrics.ts";

let isByCommunityAbortController: AbortController | null = null;
let madeTippys = new Set<any>();

export function CleanUpIsByCommunity() {
  if (isByCommunityAbortController) {
    isByCommunityAbortController.abort();
    isByCommunityAbortController = null;
  }

  madeTippys.forEach((tippy) => {
    if (tippy && typeof tippy.destroy === "function") {
      tippy.destroy();
    }
  });
  madeTippys.clear();
}

function openProfile(targetUrl: string | undefined) {
  if (!targetUrl) return;
  try {
    const parsed = new URL(targetUrl, window.location.href);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      globalThis.open?.(parsed.href, "_blank", "noopener,noreferrer");
    }
  } catch {
    // ignore malformed URLs
  }
}

export function ApplyIsByCommunity(data: any, LyricsContainer: HTMLElement): void {
  if (!data?.source || !LyricsContainer) return;
  const src = (data.source || "").toLowerCase().trim();
  if (src !== "spl" && src !== "spicy_lyrics" && src !== "spicylyrics") return;

  // Clean up any previous listeners before adding new ones
  if (isByCommunityAbortController) {
    isByCommunityAbortController.abort();
  }

  if (madeTippys.size > 0) {
    madeTippys.forEach((tippy) => {
      if (tippy && typeof tippy.destroy === "function") {
        tippy.destroy();
      }
    });
    madeTippys.clear();
  }

  isByCommunityAbortController = new AbortController();
  const { signal } = isByCommunityAbortController;

  const songInfoElement = document.createElement("div");
  songInfoElement.classList.add("SongInfo");

  const makerUsername =
    data.UploadAttribution?.Maker?.username ?? data.TTMLUploadMetadata?.Maker?.username;
  const makerAvatar =
    data.UploadAttribution?.Maker?.avatar ?? data.TTMLUploadMetadata?.Maker?.avatar;
  const makerId =
    data.UploadAttribution?.Maker?.id ?? data.TTMLUploadMetadata?.Maker?.id;
  const makerUrl =
    data.UploadAttribution?.Maker?.url ??
    data.TTMLUploadMetadata?.Maker?.url ??
    (makerId ? `https://spicylyrics.org/uid/${encodeURIComponent(makerId)}` : undefined);

  const uploaderUsername =
    data.UploadAttribution?.Uploader?.username ?? data.TTMLUploadMetadata?.Uploader?.username;
  const uploaderAvatar =
    data.UploadAttribution?.Uploader?.avatar ?? data.TTMLUploadMetadata?.Uploader?.avatar;
  const uploaderId =
    data.UploadAttribution?.Uploader?.id ?? data.TTMLUploadMetadata?.Uploader?.id;
  const uploaderUrl =
    data.UploadAttribution?.Uploader?.url ??
    data.TTMLUploadMetadata?.Uploader?.url ??
    (uploaderId ? `https://spicylyrics.org/uid/${encodeURIComponent(uploaderId)}` : undefined);

  // Don't render empty community section if no creator or uploader is known
  if (!makerUsername && !uploaderUsername) return;

  // Static copy – safe to set as text
  const providedByCommunitySpan = document.createElement("span");
  providedByCommunitySpan.style.opacity = "0.5";
  providedByCommunitySpan.textContent =
    "These lyrics have been provided by our community";
  songInfoElement.appendChild(providedByCommunitySpan);

  // Helper for creating a profile section (Maker / Uploader) safely
  const createProfileSection = (
    type: "Maker" | "Uploader",
    labelText: string,
    username: string,
    avatarUrl?: string
  ) => {
    const wrapperSpan = document.createElement("span");
    wrapperSpan.classList.add(type);

    const innerSpan = document.createElement("span");

    const labelSpan = document.createElement("span");
    labelSpan.style.opacity = "0.5";
    labelSpan.textContent = `${labelText} `;

    const profileSectionSpan = document.createElement("span");
    profileSectionSpan.classList.add("song-info-profile-section");

    // "@username"
    const atText = document.createTextNode("@");
    profileSectionSpan.appendChild(atText);

    const usernameSpan = document.createElement("span");
    usernameSpan.textContent = username;
    profileSectionSpan.appendChild(usernameSpan);

    // Optional avatar image
    if (avatarUrl) {
      const avatarWrapper = document.createElement("span");
      const img = document.createElement("img");
      img.src = avatarUrl;
      img.alt = `${username}'s avatar`;
      img.onerror = () => {
        img.style.display = "none";
      };
      avatarWrapper.appendChild(img);
      profileSectionSpan.appendChild(avatarWrapper);
    }

    innerSpan.appendChild(labelSpan);
    innerSpan.appendChild(profileSectionSpan);
    wrapperSpan.appendChild(innerSpan);

    songInfoElement.appendChild(wrapperSpan);
  };

  if (makerUsername) {
    createProfileSection("Maker", "Made by", makerUsername, makerAvatar);
  }

  if (uploaderUsername) {
    const labelText = makerUsername ? "Uploaded by" : "Made by";
    createProfileSection("Uploader", labelText, uploaderUsername, uploaderAvatar);
  }
  LyricsContainer.appendChild(songInfoElement);

  const uploaderSpan = songInfoElement.querySelector(".Uploader .song-info-profile-section") as HTMLElement | null;
  if (uploaderSpan && uploaderUrl) {
    uploaderSpan.style.cursor = "pointer";
    if (!IsPIP) {
      madeTippys.add(
        createTooltip(uploaderSpan, {
          ...Spicetify.TippyProps,
          content: `View Profile`,
        })
      );
    }
    uploaderSpan.addEventListener(
      "click",
      () => {
        openProfile(uploaderUrl);
        if (IsPIP) {
          globalThis.focus();
        }
      },
      { signal }
    );
  }

  const makerSpan = songInfoElement.querySelector(".Maker .song-info-profile-section") as HTMLElement | null;
  if (makerSpan && makerUrl) {
    makerSpan.style.cursor = "pointer";
    if (!IsPIP) {
      madeTippys.add(
        createTooltip(makerSpan, {
          ...Spicetify.TippyProps,
          content: `View Profile`,
        })
      );
    }
    makerSpan.addEventListener(
      "click",
      () => {
        openProfile(makerUrl);
        if (IsPIP) {
          globalThis.focus();
        }
      },
      { signal }
    );
  }
}
