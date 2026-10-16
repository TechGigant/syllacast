// Minimal browser DOM environment for Node.js vitest runner
if (typeof globalThis.window === "undefined") {
  const listeners: Record<string, Function[]> = {};
  (globalThis as any).window = {
    addEventListener: (event: string, cb: Function) => {
      listeners[event] = listeners[event] || [];
      listeners[event].push(cb);
    },
    removeEventListener: (event: string, cb: Function) => {
      if (listeners[event]) {
        listeners[event] = listeners[event].filter(fn => fn !== cb);
      }
    },
    matchMedia: () => ({ matches: false }),
    _spicy_lyrics: {},
  };
}

if (typeof globalThis.document === "undefined") {
  (globalThis as any).document = {
    documentElement: {
      style: {
        setProperty: () => {},
      },
    },
    createElement: () => ({
      classList: { add: () => {}, remove: () => {}, contains: () => false },
      style: {
        setProperty: () => {},
      },
      appendChild: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
    querySelector: () => null,
  };
}

if (typeof globalThis.ResizeObserver === "undefined") {
  (globalThis as any).ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
}

if (typeof globalThis.MutationObserver === "undefined") {
  (globalThis as any).MutationObserver = class {
    observe() {}
    disconnect() {}
  };
}

if (typeof globalThis.requestAnimationFrame === "undefined") {
  (globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) =>
    setTimeout(() => cb(Date.now()), 16) as unknown as number;
  (globalThis as any).cancelAnimationFrame = (id: number) => clearTimeout(id);
}
