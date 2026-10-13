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

export type Job = {
  handler: string;
  args?: any;
};

export type JobResponse = {
  handler: string;
  args?: any;
  result: JobResult;
};

export type JobResult = {
  responseData: any;
  status: number;
  type: string;
};

export interface JobResultGetter {
  get(handler: string): JobResult | undefined;
}

export function SendJob(jobs: Job[], headers?: Record<string, string>): Promise<JobResultGetter>;

export type SlJobConfig = {
  api_url: string;
};

declare module "*sljob.dist.js" {
  const Jobs: any;
  export default Jobs;
}
