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

import Global from "../../../components/Global/Global.ts";
import { PageContainer } from "../../../components/Pages/PageView.ts";
import { HideLyricsSkeleton } from "../LyricsSkeleton.ts";

const EventPrefix = "lyrics:";

const EmitNotApplyed = () => {
  Global.Event.evoke(`${EventPrefix}not-apply`, null);
};


const EmitApply = (Type: string, Content: any) => {
  PageContainer?.querySelector(
    ".LyricsContainer .LyricsContent"
  )?.classList.remove("HiddenTransitioned");
  HideLyricsSkeleton();
  Global.Event.evoke(`${EventPrefix}apply`, { Type, Content });
};

export { EmitApply, EmitNotApplyed };
