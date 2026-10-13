import "../src/bridge/spicetifyShim";
import { describe, it, expect } from "vitest";
import { Spring } from "../src/spicy/modules/Spring";
import { IsLetterCapable } from "../src/spicy/utils/Lyrics/Applyer/Utils/IsLetterCapable";

describe("Spring Physics", () => {
  it("converges toward goal position", () => {
    const spring = new Spring(0, 2.0, 1.0, 100);
    let pos = 0;
    for (let i = 0; i < 120; i++) {
      pos = spring.Step(1 / 60);
    }
    expect(pos).toBeGreaterThan(99.0);
    expect(pos).toBeLessThanOrEqual(100.1);
    expect(spring.CanSleep()).toBe(true);
  });
});

describe("Syllable Letter Capability", () => {
  it("determines capability correctly based on duration and letter length", () => {
    expect(IsLetterCapable(2, 600)).toBe(false); // < 1000ms
    expect(IsLetterCapable(4, 500)).toBe(false); // < 1000ms
    expect(IsLetterCapable(5, 1200)).toBe(true); // >= 1000ms
  });
});
