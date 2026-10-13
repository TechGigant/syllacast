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

import { $staticBackgroundMode } from "../../../../utils/stores.ts";
import { SpotifyPlayer } from "../../../Global/SpotifyPlayer.ts";
import ArtistVisuals from "../Main.ts";
import GetHeaderUrl from "./GetHeaderUrl.ts";

// Track ongoing fetches
const isFetching = new Map();

export default async function ApplyContent(
  ArtistId: string,
  TrackId: string
): Promise<string | undefined> {
  if (!TrackId) throw new Error("Invalid Song Id");
  if ($staticBackgroundMode.get() === "coverArt")
    return SpotifyPlayer.GetCover("xlarge") ?? undefined;
  if (!ArtistId) throw new Error("Invalid Song Artist");
  if (!TrackId || !ArtistId) throw new Error("Invalid URIs");
  const Cached: any = await ArtistVisuals.CacheStore.GetItem(ArtistId);

  if (Cached) {
    if (Cached.Result) {
      return GetHeaderUrl(Cached.Result);
    }
  }

  return Continue();

  async function Continue() {
    // Check if we're already fetching this track
    if (isFetching.has(ArtistId)) {
      return isFetching.get(ArtistId);
    }

    // Create the fetch promise
    const fetchPromise = (async () => {
      try {
        const response = await Spicetify.GraphQL.Request(
          Spicetify.GraphQL.Definitions.queryNpvArtist,
          {
            artistUri: `spotify:artist:${ArtistId}`,
            trackUri: `spotify:track:${TrackId}`,
            enableRelatedVideos: false,
            enableRelatedAudioTracks: false,
          }
        );
        if (!response.errors) {
          const res = response?.data?.artistUnion?.headerImage?.data?.sources;
          await ArtistVisuals.CacheStore.SetItem(ArtistId, {
            Result: res ?? "",
          });
          return GetHeaderUrl(res ?? "");
        } else {
          throw new Error(`Failed to fetch visuals: ${status}`);
        }
      } finally {
        // Clean up the map entry when done
        isFetching.delete(ArtistId);
      }
    })();

    // Store the promise
    isFetching.set(ArtistId, fetchPromise);

    return fetchPromise;
  }
}
