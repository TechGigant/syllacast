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

export interface ClockSample {
  offsetMs: number;
  rttMs: number;
}

export class ClockSync {
  private samples: ClockSample[] = [];
  private currentOffsetMs: number = 0;
  private ws: WebSocket | null = null;
  private pingIntervalId: number | null = null;

  constructor() {}

  attach(ws: WebSocket) {
    this.ws = ws;
    this.startPings();
  }

  detach() {
    if (this.pingIntervalId) {
      clearInterval(this.pingIntervalId);
      this.pingIntervalId = null;
    }
    this.ws = null;
  }

  private startPings() {
    this.sendPing();
    // Rapid pings at startup to converge fast, then steady every 3 seconds
    let count = 0;
    const initialTimer = setInterval(() => {
      this.sendPing();
      count++;
      if (count > 8) {
        clearInterval(initialTimer);
        this.pingIntervalId = window.setInterval(() => this.sendPing(), 3000);
      }
    }, 400);
  }

  sendPing() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const t1 = performance.now();
    this.ws.send(JSON.stringify({ type: "ping", t1 }));
  }

  handlePong(t1: number, t2: number, t3: number) {
    const t4 = performance.now();
    const rtt = (t4 - t1) - (t3 - t2);
    // offset maps browser performance.now() to Server Unix epoch
    // estimated_server_time = performance.now() + offset
    const offset = ((t2 - t1) + (t3 - t4)) / 2;

    this.samples.push({ offsetMs: offset, rttMs: rtt });
    if (this.samples.length > 20) {
      this.samples.shift();
    }

    // Sort by lowest RTT to reject Wi-Fi spikes and queuing delays
    const sorted = [...this.samples].sort((a, b) => a.rttMs - b.rttMs);
    const bestSamples = sorted.slice(0, Math.max(3, Math.floor(sorted.length * 0.4)));

    const avgOffset = bestSamples.reduce((sum, s) => sum + s.offsetMs, 0) / bestSamples.length;

    // Smooth offset with exponential moving average if we already have one
    if (this.currentOffsetMs === 0) {
      this.currentOffsetMs = avgOffset;
    } else {
      this.currentOffsetMs = this.currentOffsetMs * 0.8 + avgOffset * 0.2;
    }
  }

  getEstimatedServerEpoch(): number {
    return performance.now() + this.currentOffsetMs;
  }

  getDiagnostics() {
    const latestRtt = this.samples.length > 0 ? this.samples[this.samples.length - 1].rttMs : 0;
    return {
      offsetMs: this.currentOffsetMs,
      rttMs: latestRtt,
      sampleCount: this.samples.length,
    };
  }
}
