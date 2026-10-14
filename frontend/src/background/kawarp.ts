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

import Kawarp, { type KawarpOptions } from "@kawarp/core";

export class DynamicBackgroundController {
  private canvas: HTMLCanvasElement;
  private kawarp: Kawarp | null = null;
  private currentCoverUrl: string | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const options: KawarpOptions = {
      warpIntensity: 1.0,
      blurPasses: 8,
      animationSpeed: 0.1,
      saturation: 1.4,
      dithering: 0.008,
      transitionDuration: 800,
      scale: 1,
    };
    try {
      this.kawarp = new Kawarp(this.canvas, options);
      this.kawarp.start();
    } catch (e) {
      console.warn("Failed to initialize Kawarp WebGL fluid background:", e);
    }
  }

  async setCoverUrl(url: string | null) {
    if (!this.kawarp || !url || url === this.currentCoverUrl) return;
    this.currentCoverUrl = url;

    try {
      // Use CORS proxy or direct image load
      await this.kawarp.loadImage(url);
    } catch (e) {
      console.warn("Could not load cover into Kawarp:", e);
    }
  }

  start() {
    if (this.kawarp) {
      this.kawarp.start();
    }
  }

  stop() {
    if (this.kawarp) {
      this.kawarp.stop();
    }
  }

  dispose() {
    if (this.kawarp) {
      this.kawarp.dispose();
      this.kawarp = null;
    }
  }

  setSpeed(isPlaying: boolean) {
    if (!this.kawarp) return;
    this.kawarp.setOptions({
      animationSpeed: isPlaying ? 0.35 : 0.05,
    });
  }

  renderFrame() {
    if (this.kawarp) {
      this.kawarp.renderFrame();
    }
  }
}
