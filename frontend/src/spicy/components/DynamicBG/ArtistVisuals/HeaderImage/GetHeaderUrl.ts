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

import { SpotifyPlayer } from "../../../Global/SpotifyPlayer.ts";

export default function GetHeaderUrl(data: any) {
  if (!data) return SpotifyPlayer.GetCover("xlarge") ?? undefined;

  const HeaderImage = typeof data === "object" ? data[0]?.url : JSON.parse(data)[0]?.url;

  if (!HeaderImage) return SpotifyPlayer.GetCover("xlarge") ?? undefined;

  const imageId = HeaderImage.substring(HeaderImage.lastIndexOf("/") + 1);
  return `spotify:image:${imageId}`;
}
