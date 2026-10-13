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

import type { Brand } from "../types/Brand.d.ts";

const packagesUrl = "https://pkgs.spikerko.org";

// deno-lint-ignore no-explicit-any
export type Package = Brand<any, "Package">;

export type PackageUrl = Brand<string, "PackageUrl">;

const packages = new Map<PackageUrl, Package>();
const currentlyLoadingPackages = new Set<PackageUrl>();

export type PackageFileType = "js" | "ts" | "wasm" | "mjs";

const BuildImportUrl = (
  name: string,
  version: string,
  fileType: PackageFileType = "js"
): PackageUrl => {
  return `${packagesUrl}/${name}/${name}@${version}.${fileType}` as PackageUrl;
};

const LoadPackage = async (importUrl: PackageUrl): Promise<Package | Error | undefined> => {
  try {
    if (packages.has(importUrl)) return undefined;
    currentlyLoadingPackages.add(importUrl);
    const pkg = await import(importUrl);
    if (pkg === undefined) return undefined;
    packages.set(importUrl, pkg);
    currentlyLoadingPackages.delete(importUrl);
    return pkg as Package;
  } catch (error: any) {
    throw new Error(`SpicyLyrics [LoadPackage] ${error?.message ?? "An Error Occured"}`);
  }
};

export const RetrievePackage = async (
  name: string,
  version: string,
  fileType: PackageFileType = "js"
): Promise<Package | Error | undefined> => {
  try {
    const importUrl = BuildImportUrl(name, version, fileType);
    if (packages.has(importUrl)) {
      return packages.get(importUrl) as Package;
    }
    const pkg = await LoadPackage(importUrl);
    if (pkg === undefined) return undefined;
    return pkg as Package;
  } catch (error: any) {
    throw new Error(`SpicyLyrics [RetrievePackage] ${error?.message ?? "An Error Occured"}`);
  }
};
