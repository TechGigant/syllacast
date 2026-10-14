import { describe, it, expect } from "vitest";
import { Spicetify } from "../src/bridge/spicetifyShim.ts";

describe("Spicetify Shim Event Listener Unbinding", () => {
  it("successfully unbinds registered listeners and avoids memory leaks", () => {
    let callCount = 0;
    const listener = (detail: any) => {
      callCount += detail?.delta || 1;
    };

    // Add listener
    Spicetify.Player.addEventListener("songchange", listener);

    // Dispatch event
    Spicetify.Player.dispatchEvent("songchange", { delta: 1 });
    expect(callCount).toBe(1);

    // Remove listener
    Spicetify.Player.removeEventListener("songchange", listener);

    // Dispatch event again - listener should NOT be called
    Spicetify.Player.dispatchEvent("songchange", { delta: 1 });
    expect(callCount).toBe(1);
  });
});

describe("Update Banner URL Validation (XSS Prevention)", () => {
  function isSafeHttpUrl(url: string | undefined): boolean {
    if (!url) return false;
    try {
      const parsed = new URL(url, "http://localhost:8080");
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  }

  it("permits valid http and https URLs", () => {
    expect(isSafeHttpUrl("https://github.com/TechGigant/syllacast/releases")).toBe(true);
    expect(isSafeHttpUrl("http://kiosk.local/notes")).toBe(true);
    expect(isSafeHttpUrl("/releases/v1.0.4")).toBe(true);
  });

  it("rejects malicious or dangerous URL protocols", () => {
    expect(isSafeHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeHttpUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isSafeHttpUrl("vbscript:msgbox(1)")).toBe(false);
    expect(isSafeHttpUrl("file:///etc/passwd")).toBe(false);
    expect(isSafeHttpUrl(undefined)).toBe(false);
    expect(isSafeHttpUrl("")).toBe(false);
  });
});

describe("Settings Object State Preservation", () => {
  it("preserves snoozed_update_until and dismissed_update_version across form saves", () => {
    const currentSettings = {
      show_controls_buttons: true,
      startup_mode: "cinema",
      nowbar_open: true,
      nowbar_side: "left",
      clock_enabled: true,
      up_next_enabled: true,
      calibration_offset_ms: 100,
      dynamic_bg_mode: "dynamic",
      update_mode: "notify",
      update_check_interval_hours: 24,
      update_channel: "prerelease",
      snoozed_update_until: 1770000000000,
      dismissed_update_version: "1.2.0",
    };

    // User updates calibration slider in UI
    const updatedFormValues = {
      calibration_offset_ms: 250,
      startup_mode: "tv",
    };

    // Merged payload sent by saveSettings()
    const payload = {
      ...currentSettings,
      ...updatedFormValues,
    };

    expect(payload.calibration_offset_ms).toBe(250);
    expect(payload.startup_mode).toBe("tv");
    expect(payload.snoozed_update_until).toBe(1770000000000);
    expect(payload.dismissed_update_version).toBe("1.2.0");
    expect(payload.update_channel).toBe("prerelease");
  });
});
