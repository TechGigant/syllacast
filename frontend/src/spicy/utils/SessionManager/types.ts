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

export interface SessionState {
  tk: string | null;
  createdAt: number;
  lastPingAt: number;
}

export interface OpResult {
  data: any;
  httpStatus: number;
  format: "text" | "json";
}

/**
 * A `type` rather than an `interface` on purpose: only type aliases satisfy the
 * `Record<string, unknown>` constraint on `GetInstantStore`, which persists this.
 */
export type PingConfigData = {
  pingIntervalMs: number;
  minPingIntervalMs: number;
  sessionTtlSeconds: number;
  refreshAtTtlFraction: number;
};

export const SessionStatus = {
  OK: 200,
  UNAUTHORIZED: 401,
  SESSION_DEAD: 403,
  THROTTLED: 429,
  SERVER_ERROR: 500,
  UPSTREAM_ERROR: 502,
} as const;
