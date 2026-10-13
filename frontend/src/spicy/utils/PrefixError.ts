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

interface PrefixErrorConfig {
  name: string;
  prefix: string;
  suffix?: string;
}

export default class PrefixError {
  private name: string;
  private prefix: string;
  private suffix?: string;

  constructor(config: PrefixErrorConfig) {
    this.name = config.name;
    this.prefix = config.prefix;
    this.suffix = config.suffix;
  }

  public Create() {
    const name = this.name;
    const prefix = this.prefix;
    const suffix = this.suffix;

    return class extends Error {
      constructor(message: string) {
        super(`${prefix}${message}${suffix ? ` ${suffix}` : ""}`);
        this.name = name;
      }
    };
  }
}
