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

import Platform from "./Platform.ts";

export const SpotifyFetch = (url: string): Promise<Response> => {
	return (
		Platform.GetSpotifyAccessToken()
		.then(
			accessToken => fetch(
				url,
				{
					headers: {
						"Accept": "application/json",
						"Authorization": `Bearer ${accessToken}`,
						"Spotify-App-Version": Spicetify.Platform.version,
						"App-Platform": Spicetify.Platform.PlatformData.app_platform
					}
				}
			)
		)
	)
}
