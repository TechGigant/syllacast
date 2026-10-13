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

import { Maid } from "../modules/Maid";
import Logger from "./Logger";
import { onAnimationFrame } from "./AnimationFrameLoop.ts";

const intervalLogger = new Logger("Interval Manager");

class IntervalManager {
  private maid: Maid;
  private callback: () => void;
  private duration: number; // Duration in milliseconds
  private unsubscribeFrame: (() => void) | null;
  private intervalId: ReturnType<typeof setInterval> | null;
  public Running: boolean;
  public Destroyed: boolean;

  constructor(duration: number, callback: () => void) {
    if (Number.isNaN(duration)) {
      throw new Error("Duration cannot be NaN.");
    }

    this.maid = new Maid();
    this.callback = callback;
    this.duration = duration === Infinity ? 0 : duration * 1000; // Convert seconds to milliseconds or set to 0 for immediate execution
    this.unsubscribeFrame = null;
    this.intervalId = null;
    this.Running = false;
    this.Destroyed = false;

    // Registered once here, not per Start(): every Restart() used to add
    // another Stop closure that nothing ever released.
    this.maid.Give(() => this.Stop());
  }

  // Starts the interval, or the per-frame callback when duration is Infinity
  public Start() {
    if (this.Destroyed) {
      intervalLogger.warn("Cannot start; IntervalManager has been destroyed");
      return;
    }

    if (this.Running) {
      intervalLogger.warn("Interval is already running");
      return;
    }

    this.Running = true;

    if (this.duration > 0 && Number.isFinite(this.duration)) {
      this.intervalId = setInterval(() => {
        if (!this.Running || this.Destroyed) return;
        this.callback();
      }, this.duration);
      return;
    }

    // "Every frame" means every frame of the shared, capped loop. These pollers
    // each used to run their own requestAnimationFrame, i.e. on every refresh of
    // the display (240 times a second on some setups) whatever the FPS setting.
    this.unsubscribeFrame = onAnimationFrame(() => {
      if (!this.Running || this.Destroyed) return;
      this.callback();
    });
  }

  // Stops the animation frame loop without destroying the manager
  public Stop() {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.unsubscribeFrame !== null) {
      this.unsubscribeFrame();
      this.unsubscribeFrame = null;
    }
    this.Running = false;
  }

  // Restarts the animation frame loop
  public Restart() {
    if (this.Destroyed) {
      intervalLogger.warn("Cannot restart; IntervalManager has been destroyed");
      return;
    }

    this.Stop();
    this.Start();
  }

  // Fully cleans up the manager and makes it unusable
  public Destroy() {
    if (this.Destroyed) {
      intervalLogger.warn("IntervalManager is already destroyed");
      return;
    }

    this.Stop();
    this.maid.CleanUp();
    this.Destroyed = true;
    this.Running = false;
  }
}

export { IntervalManager };
