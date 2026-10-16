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

/**
 * Self-contained, zero-dependency ISO/IEC 18004 QR Code generator in pure TypeScript.
 * Supports Byte mode with Error Correction Levels M and L across versions 1 through 10.
 */

// GF(256) Math with primitive polynomial 0x11d (285)
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

let val = 1;
for (let i = 0; i < 255; i++) {
  EXP[i] = val;
  EXP[i + 255] = val;
  LOG[val] = i;
  val = (val << 1) ^ (val >= 128 ? 0x11d : 0);
}

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

function rsGeneratorPoly(degree: number): Uint8Array {
  let g = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const factor = EXP[i];
    const next = new Uint8Array(g.length + 1);
    for (let j = 0; j < g.length; j++) {
      next[j] ^= g[j];
      next[j + 1] ^= gfMul(g[j], factor);
    }
    g = next;
  }
  return g;
}

function calculateRsEc(data: Uint8Array, ecCount: number): Uint8Array {
  const g = rsGeneratorPoly(ecCount);
  const remainder = new Uint8Array(ecCount);
  for (let i = 0; i < data.length; i++) {
    const lead = data[i] ^ remainder[0];
    for (let j = 0; j < ecCount - 1; j++) {
      remainder[j] = remainder[j + 1];
    }
    remainder[ecCount - 1] = 0;
    if (lead !== 0) {
      for (let j = 0; j < ecCount; j++) {
        remainder[j] ^= gfMul(g[j + 1], lead);
      }
    }
  }
  return remainder;
}

export type EcLevel = "L" | "M";

interface VersionSpec {
  version: number;
  ecLevel: EcLevel;
  totalCodewords: number;
  dataCodewords: number;
  ecCodewordsPerBlock: number;
  blocks: Array<{ count: number; dataCodewords: number }>;
  remainderBits: number;
  alignmentPatterns: number[];
}

// Table of QR specifications for Versions 1..10 (EC Level M prioritized, fallback to L if needed)
const VERSION_SPECS_M: VersionSpec[] = [
  {
    version: 1,
    ecLevel: "M",
    totalCodewords: 26,
    dataCodewords: 16,
    ecCodewordsPerBlock: 10,
    blocks: [{ count: 1, dataCodewords: 16 }],
    remainderBits: 0,
    alignmentPatterns: [],
  },
  {
    version: 2,
    ecLevel: "M",
    totalCodewords: 44,
    dataCodewords: 28,
    ecCodewordsPerBlock: 16,
    blocks: [{ count: 1, dataCodewords: 28 }],
    remainderBits: 7,
    alignmentPatterns: [6, 18],
  },
  {
    version: 3,
    ecLevel: "M",
    totalCodewords: 70,
    dataCodewords: 44,
    ecCodewordsPerBlock: 26,
    blocks: [{ count: 1, dataCodewords: 44 }],
    remainderBits: 7,
    alignmentPatterns: [6, 22],
  },
  {
    version: 4,
    ecLevel: "M",
    totalCodewords: 100,
    dataCodewords: 64,
    ecCodewordsPerBlock: 18,
    blocks: [{ count: 2, dataCodewords: 32 }],
    remainderBits: 7,
    alignmentPatterns: [6, 26],
  },
  {
    version: 5,
    ecLevel: "M",
    totalCodewords: 134,
    dataCodewords: 86,
    ecCodewordsPerBlock: 24,
    blocks: [{ count: 2, dataCodewords: 43 }],
    remainderBits: 7,
    alignmentPatterns: [6, 30],
  },
  {
    version: 6,
    ecLevel: "M",
    totalCodewords: 172,
    dataCodewords: 108,
    ecCodewordsPerBlock: 16,
    blocks: [{ count: 4, dataCodewords: 27 }],
    remainderBits: 7,
    alignmentPatterns: [6, 34],
  },
  {
    version: 7,
    ecLevel: "M",
    totalCodewords: 196,
    dataCodewords: 124,
    ecCodewordsPerBlock: 18,
    blocks: [
      { count: 2, dataCodewords: 31 },
      { count: 2, dataCodewords: 32 },
    ],
    remainderBits: 0,
    alignmentPatterns: [6, 22, 38],
  },
  {
    version: 8,
    ecLevel: "M",
    totalCodewords: 242,
    dataCodewords: 154,
    ecCodewordsPerBlock: 22,
    blocks: [
      { count: 2, dataCodewords: 38 },
      { count: 2, dataCodewords: 39 },
    ],
    remainderBits: 0,
    alignmentPatterns: [6, 24, 42],
  },
  {
    version: 9,
    ecLevel: "M",
    totalCodewords: 292,
    dataCodewords: 182,
    ecCodewordsPerBlock: 22,
    blocks: [
      { count: 3, dataCodewords: 36 },
      { count: 2, dataCodewords: 37 },
    ],
    remainderBits: 0,
    alignmentPatterns: [6, 26, 46],
  },
  {
    version: 10,
    ecLevel: "M",
    totalCodewords: 346,
    dataCodewords: 216,
    ecCodewordsPerBlock: 26,
    blocks: [
      { count: 4, dataCodewords: 43 },
      { count: 1, dataCodewords: 44 },
    ],
    remainderBits: 0,
    alignmentPatterns: [6, 28, 50],
  },
];

const VERSION_SPECS_L: VersionSpec[] = [
  {
    version: 10,
    ecLevel: "L",
    totalCodewords: 346,
    dataCodewords: 274,
    ecCodewordsPerBlock: 18,
    blocks: [
      { count: 2, dataCodewords: 68 },
      { count: 2, dataCodewords: 69 },
    ],
    remainderBits: 0,
    alignmentPatterns: [6, 28, 50],
  },
];

function selectVersionSpec(byteLength: number): VersionSpec {
  for (const spec of VERSION_SPECS_M) {
    const charCountBits = spec.version < 10 ? 8 : 16;
    const requiredBits = 4 + charCountBits + byteLength * 8;
    if (requiredBits <= spec.dataCodewords * 8) {
      return spec;
    }
  }
  for (const spec of VERSION_SPECS_L) {
    const charCountBits = spec.version < 10 ? 8 : 16;
    const requiredBits = 4 + charCountBits + byteLength * 8;
    if (requiredBits <= spec.dataCodewords * 8) {
      return spec;
    }
  }
  throw new Error(`Text payload (${byteLength} bytes) exceeds QR Version 1..10 capacity`);
}

class BitBuffer {
  private buffer: number[] = [];
  public length = 0;

  put(num: number, length: number): void {
    for (let i = 0; i < length; i++) {
      this.putBit(((num >>> (length - i - 1)) & 1) === 1);
    }
  }

  putBit(bit: boolean): void {
    const bufIndex = Math.floor(this.length / 8);
    if (this.buffer.length <= bufIndex) {
      this.buffer.push(0);
    }
    if (bit) {
      this.buffer[bufIndex] |= 0x80 >>> (this.length % 8);
    }
    this.length++;
  }

  getByte(index: number): number {
    return this.buffer[index] || 0;
  }

  getBytes(): Uint8Array {
    return new Uint8Array(this.buffer);
  }
}

function buildDataCodewords(textBytes: Uint8Array, spec: VersionSpec): Uint8Array {
  const bb = new BitBuffer();
  // Byte mode indicator: 0100
  bb.put(0b0100, 4);

  // Character count indicator
  const charCountBits = spec.version < 10 ? 8 : 16;
  bb.put(textBytes.length, charCountBits);

  // Data bytes
  for (let i = 0; i < textBytes.length; i++) {
    bb.put(textBytes[i], 8);
  }

  // Terminator (up to 4 zeroes)
  const maxBits = spec.dataCodewords * 8;
  const terminatorLen = Math.min(4, maxBits - bb.length);
  if (terminatorLen > 0) {
    bb.put(0, terminatorLen);
  }

  // Pad to byte boundary
  const padBits = (8 - (bb.length % 8)) % 8;
  if (padBits > 0) {
    bb.put(0, padBits);
  }

  // Fill remainder with alternating 0xEC and 0x11
  const padBytes = [0xec, 0x11];
  let padIdx = 0;
  while (bb.length < maxBits) {
    bb.put(padBytes[padIdx % 2], 8);
    padIdx++;
  }

  return bb.getBytes();
}

function interleaveBlocks(dataBytes: Uint8Array, spec: VersionSpec): Uint8Array {
  const blocksData: Uint8Array[] = [];
  const blocksEc: Uint8Array[] = [];
  let offset = 0;

  for (const blockSpec of spec.blocks) {
    for (let i = 0; i < blockSpec.count; i++) {
      const bData = dataBytes.slice(offset, offset + blockSpec.dataCodewords);
      offset += blockSpec.dataCodewords;
      blocksData.push(bData);
      blocksEc.push(calculateRsEc(bData, spec.ecCodewordsPerBlock));
    }
  }

  const result: number[] = [];
  let maxDataLen = 0;
  for (const b of blocksData) {
    maxDataLen = Math.max(maxDataLen, b.length);
  }

  for (let i = 0; i < maxDataLen; i++) {
    for (const b of blocksData) {
      if (i < b.length) {
        result.push(b[i]);
      }
    }
  }

  for (let i = 0; i < spec.ecCodewordsPerBlock; i++) {
    for (const ec of blocksEc) {
      if (i < ec.length) {
        result.push(ec[i]);
      }
    }
  }

  return new Uint8Array(result);
}

// Format info calculation: 5 data bits (2 for EC, 3 for mask) -> 15 bits BCH
const FORMAT_MASK = 0x5412;
const FORMAT_GEN = 0x537;

function getFormatBits(ecLevel: EcLevel, maskPattern: number): number {
  const ecBits = ecLevel === "M" ? 0b00 : 0b01;
  const data = (ecBits << 3) | maskPattern;
  let d = data << 10;
  for (let i = 4; i >= 0; i--) {
    if ((d >>> (i + 10)) & 1) {
      d ^= FORMAT_GEN << i;
    }
  }
  return ((data << 10) | d) ^ FORMAT_MASK;
}

const MASK_PATTERNS = [
  (r: number, c: number) => (r + c) % 2 === 0,
  (r: number, _c: number) => r % 2 === 0,
  (_r: number, c: number) => c % 3 === 0,
  (r: number, c: number) => (r + c) % 3 === 0,
  (r: number, c: number) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r: number, c: number) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r: number, c: number) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r: number, c: number) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function evaluateMaskPenalty(matrix: boolean[][], size: number): number {
  let penalty = 0;

  // Rule 1: Horizontal and vertical 5+ consecutive modules
  for (let r = 0; r < size; r++) {
    let count = 0;
    let last = false;
    for (let c = 0; c < size; c++) {
      const val = matrix[r][c];
      if (c === 0 || val === last) {
        count++;
      } else {
        if (count >= 5) penalty += 3 + (count - 5);
        count = 1;
      }
      last = val;
    }
    if (count >= 5) penalty += 3 + (count - 5);
  }

  for (let c = 0; c < size; c++) {
    let count = 0;
    let last = false;
    for (let r = 0; r < size; r++) {
      const val = matrix[r][c];
      if (r === 0 || val === last) {
        count++;
      } else {
        if (count >= 5) penalty += 3 + (count - 5);
        count = 1;
      }
      last = val;
    }
    if (count >= 5) penalty += 3 + (count - 5);
  }

  // Rule 2: 2x2 blocks of same color
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const val = matrix[r][c];
      if (
        val === matrix[r][c + 1] &&
        val === matrix[r + 1][c] &&
        val === matrix[r + 1][c + 1]
      ) {
        penalty += 3;
      }
    }
  }

  // Rule 3: 1:1:3:1:1 pattern with 4 light modules
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size - 10; c++) {
      // 10111010000 or 00001011101
      const p1 =
        matrix[r][c] &&
        !matrix[r][c + 1] &&
        matrix[r][c + 2] &&
        matrix[r][c + 3] &&
        matrix[r][c + 4] &&
        !matrix[r][c + 5] &&
        matrix[r][c + 6] &&
        !matrix[r][c + 7] &&
        !matrix[r][c + 8] &&
        !matrix[r][c + 9] &&
        !matrix[r][c + 10];
      const p2 =
        !matrix[r][c] &&
        !matrix[r][c + 1] &&
        !matrix[r][c + 2] &&
        !matrix[r][c + 3] &&
        matrix[r][c + 4] &&
        !matrix[r][c + 5] &&
        matrix[r][c + 6] &&
        matrix[r][c + 7] &&
        matrix[r][c + 8] &&
        !matrix[r][c + 9] &&
        matrix[r][c + 10];
      if (p1 || p2) penalty += 40;
    }
  }

  for (let c = 0; c < size; c++) {
    for (let r = 0; r < size - 10; r++) {
      const p1 =
        matrix[r][c] &&
        !matrix[r + 1][c] &&
        matrix[r + 2][c] &&
        matrix[r + 3][c] &&
        matrix[r + 4][c] &&
        !matrix[r + 5][c] &&
        matrix[r + 6][c] &&
        !matrix[r + 7][c] &&
        !matrix[r + 8][c] &&
        !matrix[r + 9][c] &&
        !matrix[r + 10][c];
      const p2 =
        !matrix[r][c] &&
        !matrix[r + 1][c] &&
        !matrix[r + 2][c] &&
        !matrix[r + 3][c] &&
        matrix[r + 4][c] &&
        !matrix[r + 5][c] &&
        matrix[r + 6][c] &&
        matrix[r + 7][c] &&
        matrix[r + 8][c] &&
        !matrix[r + 9][c] &&
        matrix[r + 10][c];
      if (p1 || p2) penalty += 40;
    }
  }

  // Rule 4: Balance of dark/light modules
  let darkCount = 0;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (matrix[r][c]) darkCount++;
    }
  }
  const total = size * size;
  const percent = (darkCount * 100) / total;
  const k = Math.floor(Math.abs(percent - 50) / 5);
  penalty += k * 10;

  return penalty;
}

export function generateQrMatrix(text: string): boolean[][] {
  const encoder = new TextEncoder();
  const textBytes = encoder.encode(text);
  const spec = selectVersionSpec(textBytes.length);
  const size = 17 + 4 * spec.version;

  // matrix[row][col] and reserved[row][col]
  const matrix: boolean[][] = Array.from({ length: size }, () =>
    new Array(size).fill(false)
  );
  const reserved: boolean[][] = Array.from({ length: size }, () =>
    new Array(size).fill(false)
  );

  function setModule(r: number, c: number, value: boolean, isReserved = true) {
    matrix[r][c] = value;
    if (isReserved) reserved[r][c] = true;
  }

  // 1. Finder patterns at 3 corners
  const finders = [
    { r: 0, c: 0 },
    { r: 0, c: size - 7 },
    { r: size - 7, c: 0 },
  ];
  for (const f of finders) {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const nr = f.r + dr;
        const nc = f.c + dc;
        if (nr >= 0 && nr < size && nc >= 0 && nc < size) {
          const isDark =
            dr >= 0 &&
            dr <= 6 &&
            dc >= 0 &&
            dc <= 6 &&
            (dr === 0 ||
              dr === 6 ||
              dc === 0 ||
              dc === 6 ||
              (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4));
          setModule(nr, nc, isDark, true);
        }
      }
    }
  }

  // 2. Alignment patterns
  if (spec.alignmentPatterns.length > 0) {
    const coords = spec.alignmentPatterns;
    for (const r of coords) {
      for (const c of coords) {
        // Skip if overlaps with finders
        if (r <= 8 && c <= 8) continue;
        if (r <= 8 && c >= size - 8) continue;
        if (r >= size - 8 && c <= 8) continue;

        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const isDark =
              Math.max(Math.abs(dr), Math.abs(dc)) === 2 ||
              (dr === 0 && dc === 0);
            setModule(r + dr, c + dc, isDark, true);
          }
        }
      }
    }
  }

  // 3. Timing patterns
  for (let i = 8; i < size - 8; i++) {
    if (!reserved[6][i]) setModule(6, i, i % 2 === 0, true);
    if (!reserved[i][6]) setModule(i, 6, i % 2 === 0, true);
  }

  // 4. Dark module
  setModule(4 * spec.version + 9, 8, true, true);

  // 5. Reserve format info modules
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) {
      reserved[8][i] = true;
      reserved[i][8] = true;
    }
  }
  for (let i = 0; i <= 7; i++) {
    reserved[8][size - 1 - i] = true;
    reserved[size - 1 - i][8] = true;
  }

  // 6. Data codewords placement
  const dataCodewords = buildDataCodewords(textBytes, spec);
  const interleaved = interleaveBlocks(dataCodewords, spec);

  // Convert interleaved bytes into bits
  const bits: boolean[] = [];
  for (let i = 0; i < interleaved.length; i++) {
    const byte = interleaved[i];
    for (let b = 7; b >= 0; b--) {
      bits.push(((byte >>> b) & 1) === 1);
    }
  }
  for (let i = 0; i < spec.remainderBits; i++) {
    bits.push(false);
  }

  let bitIdx = 0;
  let upward = true;
  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right--; // Skip vertical timing column
    const left = right - 1;

    for (let step = 0; step < size; step++) {
      const r = upward ? size - 1 - step : step;
      const cols = [right, left];
      for (const c of cols) {
        if (!reserved[r][c]) {
          const bit = bitIdx < bits.length ? bits[bitIdx++] : false;
          matrix[r][c] = bit;
        }
      }
    }
    upward = !upward;
  }

  // 7. Mask evaluation (test patterns 0..7 and choose best)
  let bestMask = 0;
  let minPenalty = Infinity;
  let bestMatrix: boolean[][] = [];

  for (let m = 0; m < 8; m++) {
    const maskFn = MASK_PATTERNS[m];
    const candidate: boolean[][] = matrix.map((row, r) =>
      row.map((val, c) => {
        if (reserved[r][c]) return val;
        return maskFn(r, c) ? !val : val;
      })
    );

    // Apply format bits to candidate
    const formatBits = getFormatBits(spec.ecLevel, m);
    // Top-left
    for (let i = 0; i <= 5; i++) candidate[8][i] = ((formatBits >>> i) & 1) === 1;
    candidate[8][7] = ((formatBits >>> 6) & 1) === 1;
    candidate[8][8] = ((formatBits >>> 7) & 1) === 1;
    candidate[7][8] = ((formatBits >>> 8) & 1) === 1;
    for (let i = 9; i <= 14; i++) {
      candidate[14 - i][8] = ((formatBits >>> i) & 1) === 1;
    }

    // Split around top-right and bottom-left
    for (let i = 0; i <= 6; i++) {
      candidate[size - 1 - i][8] = ((formatBits >>> i) & 1) === 1;
    }
    for (let i = 7; i <= 14; i++) {
      candidate[8][size - 15 + i] = ((formatBits >>> i) & 1) === 1;
    }

    const penalty = evaluateMaskPenalty(candidate, size);
    if (penalty < minPenalty) {
      minPenalty = penalty;
      bestMask = m;
      bestMatrix = candidate;
    }
  }

  return bestMatrix;
}

/**
 * Formats standard ZXing Wi-Fi QR Code string with required escaping for special characters.
 */
export function formatWifiQrPayload(
  ssid: string,
  password: string,
  encryption: "WPA" | "WEP" | "nopass",
  hidden = false
): string {
  const escapeWifi = (str: string) => str.replace(/([\\;,:"'])/g, "\\$1");
  const enc = encryption === "nopass" ? "nopass" : encryption;
  const pass = encryption === "nopass" ? "" : escapeWifi(password);
  const hiddenFlag = hidden ? "H:true;" : "";
  return `WIFI:T:${enc};S:${escapeWifi(ssid)};P:${pass};${hiddenFlag};`;
}

/**
 * Renders a crisp, high-contrast QR Code SVG with quiet zone.
 */
export function renderQrSvg(text: string, sizePx?: number): string {
  const matrix = generateQrMatrix(text);
  const modCount = matrix.length;
  const quietZone = 4;
  const totalSize = modCount + quietZone * 2;

  let pathD = "";
  for (let r = 0; r < modCount; r++) {
    for (let c = 0; c < modCount; c++) {
      if (matrix[r][c]) {
        pathD += `M${c + quietZone},${r + quietZone}h1v1h-1z `;
      }
    }
  }

  const dimensionAttr = sizePx ? ` width="${sizePx}" height="${sizePx}"` : "";

  return `<svg viewBox="0 0 ${totalSize} ${totalSize}" xmlns="http://www.w3.org/2000/svg"${dimensionAttr} shape-rendering="crispEdges">
  <rect width="${totalSize}" height="${totalSize}" fill="#ffffff" rx="1.5" />
  <path d="${pathD.trim()}" fill="#000000" />
</svg>`;
}
