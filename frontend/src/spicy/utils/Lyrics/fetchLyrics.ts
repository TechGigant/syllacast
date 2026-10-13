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

import { $currentLyricsData, $currentLyricsType, $currentlyFetching } from "../stores.ts";
import PageView, { PageContainer } from "../../components/Pages/PageView.ts";

export type FetchLyricsResult = [object | string, number, string?] | null;

let currentLyricsPayload: any = null;
let currentLyricsUri: string | null = null;

export function setLyricsPayload(payload: any, uri: string | null) {
  currentLyricsPayload = payload;
  currentLyricsUri = uri;
}

export function setRomanizationClass(hasTransliterations: boolean | undefined): void {
  if (hasTransliterations) {
    PageContainer?.classList.add("Lyrics_RomanizationAvailable");
  } else {
    PageContainer?.classList.remove("Lyrics_RomanizationAvailable");
  }
}

export function presentLyrics(lyricsData: any): void {
  setRomanizationClass(lyricsData?.HasTransliterations);
  HideLoaderContainer();
  $currentLyricsType.set(lyricsData.Type || "Syllable");
  PageContainer?.querySelector<HTMLElement>(".ContentBox")?.classList.remove("LyricsHidden");
  PageContainer?.querySelector(".ContentBox .LyricsContainer")?.classList.remove("Hidden");
  PageView.AppendViewControls(true);
  $currentlyFetching.set(false);
}

export function ShowLoaderContainer(_uri?: string): void {
  const loaderContainer = PageContainer?.querySelector<HTMLElement>(".loaderContainer");
  if (loaderContainer) {
    loaderContainer.style.display = "flex";
  }
}

export function HideLoaderContainer(): void {
  const loaderContainer = PageContainer?.querySelector<HTMLElement>(".loaderContainer");
  if (loaderContainer) {
    loaderContainer.style.display = "none";
  }
}

export function ClearLyricsPageContainer(): void {
  const container = PageContainer?.querySelector<HTMLElement>(".LyricsContainer .LyricsContent");
  if (container) {
    container.innerHTML = "";
  }
}

export function ShowQueueLoader(): void {
  ShowLoaderContainer();
}

export default async function fetchLyrics(uri?: string): Promise<FetchLyricsResult> {
  const targetUri = uri || currentLyricsUri || "";
  if (!currentLyricsPayload) {
    $currentlyFetching.set(false);
    return ["NO_LYRICS", 404, targetUri];
  }

  const payloadWithUri = { ...currentLyricsPayload, uri: targetUri };
  $currentLyricsData.set(JSON.stringify(payloadWithUri));
  presentLyrics(payloadWithUri);
  return [payloadWithUri, 200, targetUri];
}
