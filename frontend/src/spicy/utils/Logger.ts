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

import { ProjectName } from "../project/config.ts";
import { Maid } from "../modules/Maid.ts";
import { $developerMode } from "./stores.ts";

class Logger {
  private maid: Maid;

  public isEnabled = false;
  public prefix: string;

  constructor(prefix?: string) {
    this.maid = new Maid();
    this.prefix = `[${ProjectName}]${prefix ? ` (${prefix})` : ""}`;
    this.isEnabled = $developerMode.get();

    this.maid.Give(
      $developerMode.subscribe((v) => {
        this.isEnabled = v;
      })
    )
  }

  private getPrefixArgs(): [string, string] {
    return [`%c${this.prefix}`, "color: #c9c9c9;"];
  }

  info(...args: unknown[]) {
    if (this.maid.IsDestroyed() || !this.isEnabled) return;
    const [prefix, style] = this.getPrefixArgs();
    console.info(prefix, style, ...args);
  }

  warn(...args: unknown[]) {
    // Warnings always reach the console — they surface real runtime issues
    // that users (and bug reports) need to see regardless of developer mode.
    if (this.maid.IsDestroyed()) return;
    const [prefix, style] = this.getPrefixArgs();
    console.warn(prefix, style, ...args);
  }

  error(...args: unknown[]) {
    // Errors always reach the console, regardless of developer mode.
    if (this.maid.IsDestroyed()) return;
    const [prefix, style] = this.getPrefixArgs();
    console.error(prefix, style, ...args);
  }

  debug(...args: unknown[]) {
    if (this.maid.IsDestroyed() || !this.isEnabled) return;
    const [prefix, style] = this.getPrefixArgs();
    console.debug(prefix, style, ...args);
  }

  destroy() {
    if (this.maid.IsDestroyed()) return;
    this.maid.Destroy();
  }
}

export default Logger;
