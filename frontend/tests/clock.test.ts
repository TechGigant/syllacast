import "../src/bridge/spicetifyShim";
import { describe, it, expect } from "vitest";
import { ClockSync } from "../src/sync/clock";

describe("ClockSync", () => {
  it("calculates estimated server epoch and diagnostics correctly", () => {
    const clock = new ClockSync();
    const t1 = performance.now() - 20;
    // Server processed with 0ms internal delta
    const serverTime = 1700000000000;
    clock.handlePong(t1, serverTime, serverTime);

    const diag = clock.getDiagnostics();
    expect(diag.rttMs).toBeCloseTo(20, 0);
    expect(diag.sampleCount).toBe(1);
    expect(typeof diag.offsetMs).toBe("number");
  });
});
