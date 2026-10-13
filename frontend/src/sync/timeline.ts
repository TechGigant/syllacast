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

import { ClockSync } from "./clock";

export interface PositionAnchor {
  position_ms: number;
  timestamp_ms: number;
  speed: number;
}

export class PlaybackTimeline {
  private anchor: PositionAnchor | null = null;
  private clockSync: ClockSync;
  private manualCalibrationMs: number = 0;

  constructor(clockSync: ClockSync) {
    this.clockSync = clockSync;
    const stored = localStorage.getItem("syllacast_calibration_ms");
    if (stored) {
      this.manualCalibrationMs = parseFloat(stored) || 0;
    }
  }

  setAnchor(anchor: PositionAnchor | null | undefined) {
    if (!anchor) return;
    this.anchor = {
      position_ms: Number(anchor.position_ms) || 0,
      timestamp_ms: Number(anchor.timestamp_ms) || Date.now(),
      speed: typeof anchor.speed === "number" ? anchor.speed : 1.0,
    };
  }

  setCalibrationMs(ms: number) {
    this.manualCalibrationMs = ms;
    localStorage.setItem("syllacast_calibration_ms", ms.toString());
  }

  getCalibrationMs(): number {
    return this.manualCalibrationMs;
  }

  getInterpolatedPositionMs(): number {
    if (!this.anchor) return 0;

    const estimatedServerEpoch = this.clockSync.getEstimatedServerEpoch();
    const elapsedSinceAnchor = (estimatedServerEpoch - this.anchor.timestamp_ms) * this.anchor.speed;

    const songPosition = this.anchor.position_ms + elapsedSinceAnchor;
    return Math.max(0, songPosition + this.manualCalibrationMs);
  }

  getRawPositionMs(): number {
    if (!this.anchor) return 0;
    const estimatedServerEpoch = this.clockSync.getEstimatedServerEpoch();
    return Math.max(0, this.anchor.position_ms + (estimatedServerEpoch - this.anchor.timestamp_ms) * this.anchor.speed);
  }

  isAdvancing(): boolean {
    return this.anchor ? this.anchor.speed > 0 : false;
  }
}
