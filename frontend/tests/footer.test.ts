import { describe, it, expect, beforeAll } from "vitest";
import { getLyricsProviderName } from "../src/spicy/utils/Lyrics/Applyer/Credits/ApplyProvider.ts";
import { createKioskFooter } from "../src/kiosk/footer.ts";

function createMockElement(tag: string) {
  const el: any = {
    tagName: tag.toUpperCase(),
    className: "",
    style: {},
    _html: "",
    _left: null,
    _right: null,
    remove: () => {},
    querySelector(selector: string) {
      if (selector === ".KioskFooterLeft") return el._left;
      if (selector === ".KioskFooterRight") return el._right;
      return null;
    },
  };
  Object.defineProperty(el, "innerHTML", {
    get() {
      if (el._left || el._right) {
        return `<div class="KioskFooterLeft">${el._left?.innerHTML || ""}</div><div class="KioskFooterRight">${el._right?.innerHTML || ""}</div>`;
      }
      return el._html || "";
    },
    set(val: string) {
      el._html = val;
      if (val.includes("KioskFooterLeft")) {
        el._left = createMockElement("div");
        el._right = createMockElement("div");
        const rightMatch = val.match(/<div class="KioskFooterRight"[^>]*>([\s\S]*?)<\/div>/);
        if (rightMatch && rightMatch[1]) {
          el._right.innerHTML = rightMatch[1].trim();
        }
      }
    },
  });
  return el;
}

beforeAll(() => {
  if (typeof document === "undefined") {
    (globalThis as any).document = {
      createElement: (tag: string) => createMockElement(tag),
    };
  }
});

describe("Lyrics Provider Mapping (Upstream Terms Parity)", () => {
  it("resolves Spicy Lyrics variants", () => {
    expect(getLyricsProviderName("spl")).toBe("Spicy Lyrics");
    expect(getLyricsProviderName("spicy_lyrics")).toBe("Spicy Lyrics");
    expect(getLyricsProviderName("spicylyrics")).toBe("Spicy Lyrics");
  });

  it("resolves Apple Music and Spotify variants", () => {
    expect(getLyricsProviderName("aml")).toBe("Apple Music via Spicy Lyrics");
    expect(getLyricsProviderName("apple_music")).toBe("Apple Music via Spicy Lyrics");
    expect(getLyricsProviderName("spt")).toBe("Spotify via Spicy Lyrics");
    expect(getLyricsProviderName("spotify")).toBe("Spotify via Spicy Lyrics");
  });

  it("returns 'unknown' for missing, empty, or unrecognized sources", () => {
    expect(getLyricsProviderName(undefined)).toBe("unknown");
    expect(getLyricsProviderName("")).toBe("unknown");
    expect(getLyricsProviderName("unknown")).toBe("unknown");
    expect(getLyricsProviderName("third_party_unrecognized")).toBe("unknown");
  });
});

describe("Kiosk Footer Controller", () => {
  it("displays 'unknown' when source is missing or unrecognized", () => {
    const footer = createKioskFooter();
    footer.updateLyricsSource(undefined);
    expect(footer.element.innerHTML).toContain("Lyrics provided by unknown");

    footer.updateLyricsSource("non_existent_source");
    expect(footer.element.innerHTML).toContain("Lyrics provided by unknown");
  });

  it("displays proper provider when source is known with full provider URL in text", () => {
    const footer = createKioskFooter();
    footer.updateLyricsSource("spicy_lyrics");
    expect(footer.element.innerHTML).toContain("Lyrics provided by");
    expect(footer.element.innerHTML).toContain("Spicy Lyrics");
    expect(footer.element.innerHTML).toContain("https://spicylyrics.org");

    footer.updateLyricsSource("aml");
    expect(footer.element.innerHTML).toContain("Apple Music via Spicy Lyrics");
    expect(footer.element.innerHTML).toContain("https://spicylyrics.org");
  });

  it("renders clickable community links using contributor URLs with full link in text", () => {
    const footer = createKioskFooter();
    footer.updateLyricsSource(
      "spicy_lyrics",
      { username: "spikerko", url: "https://spicylyrics.org/uid/123" },
      { username: "gc", url: "https://spicylyrics.org/uid/456" }
    );

    const html = footer.element.innerHTML;
    expect(html).toContain("Lyrics provided by");
    expect(html).toContain("Spicy Lyrics");
    expect(html).toContain("Uploaded by");
    expect(html).toContain('href="https://spicylyrics.org/uid/123"');
    expect(html).toContain("@spikerko");
    expect(html).toContain("https://spicylyrics.org/uid/123");
    expect(html).toContain("Made by");
    expect(html).toContain('href="https://spicylyrics.org/uid/456"');
    expect(html).toContain("@gc");
    expect(html).toContain("https://spicylyrics.org/uid/456");
    expect(html).toContain("pointer-events: auto");
  });

  it("combines credit when uploader and maker are the same with full link in text", () => {
    const footer = createKioskFooter();
    footer.updateLyricsSource(
      "spicy_lyrics",
      { username: "solo_sync", url: "https://spicylyrics.org/uid/999" },
      { username: "solo_sync", url: "https://spicylyrics.org/uid/999" }
    );

    const html = footer.element.innerHTML;
    expect(html).toContain("Made & uploaded by");
    expect(html).toContain("@solo_sync");
    expect(html).toContain("https://spicylyrics.org/uid/999");
  });

  it("does not allow hiding attribution via setLyricsSourceVisible", () => {
    const footer = createKioskFooter();
    footer.updateLyricsSource("spicy_lyrics");
    const leftEl = footer.element.querySelector(".KioskFooterLeft") as HTMLElement;

    footer.setLyricsSourceVisible?.(false);
    expect(leftEl.style.display).not.toBe("none");
  });

  it("does not allow hiding source code link via setSourceLinkVisible", () => {
    const footer = createKioskFooter();
    const rightEl = footer.element.querySelector(".KioskFooterRight") as HTMLElement;

    footer.setSourceLinkVisible(false);
    expect(rightEl.style.display).not.toBe("none");
    expect(footer.element.innerHTML).toContain("https://github.com/TechGigant/syllacast");
  });

  it("clears footer when source is null", () => {
    const footer = createKioskFooter();
    footer.updateLyricsSource("spicy_lyrics");
    const leftEl = footer.element.querySelector(".KioskFooterLeft") as HTMLElement;
    expect(leftEl.innerHTML).not.toBe("");

    footer.updateLyricsSource(null);
    expect(leftEl.innerHTML).toBe("");
  });
});
