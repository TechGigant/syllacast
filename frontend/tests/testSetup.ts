// Minimal browser DOM environment for Node.js vitest runner

function matchesSelector(el: any, selector: string): boolean {
  if (!el || !el.tagName) return false;
  const trimmed = selector.trim();
  if (!trimmed) return false;

  // Handle descendant selectors: "a b"
  if (trimmed.includes(" ")) {
    const parts = trimmed.split(/\s+/);
    const last = parts[parts.length - 1];
    if (!matchesSelector(el, last)) return false;
    let curr = el.parentElement;
    for (let i = parts.length - 2; i >= 0; i--) {
      while (curr && !matchesSelector(curr, parts[i])) {
        curr = curr.parentElement;
      }
      if (!curr) return false;
      curr = curr.parentElement;
    }
    return true;
  }

  // Attribute selector: [data-widget-type="..."]
  const attrMatch = trimmed.match(/^\[([a-zA-Z0-9_-]+)="([^"]*)"\]$/);
  if (attrMatch) {
    const [, attrName, attrVal] = attrMatch;
    if (attrName.startsWith("data-")) {
      const camel = attrName
        .slice(5)
        .replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      return el.dataset?.[camel] === attrVal || el.getAttribute?.(attrName) === attrVal;
    }
    return el.getAttribute?.(attrName) === attrVal;
  }

  // ID selector: #id
  if (trimmed.startsWith("#")) {
    return el.id === trimmed.slice(1);
  }

  // Class selector(s): .cls1.cls2
  if (trimmed.startsWith(".")) {
    const classes = trimmed.slice(1).split(".");
    return classes.every((c) => el.classList?.contains(c));
  }

  // Tag selector: iframe, svg, input, etc.
  return el.tagName.toLowerCase() === trimmed.toLowerCase();
}

export function createTestElement(tag: string): any {
  const classes = new Set<string>();
  const attrs = new Map<string, string>();
  const listeners: Record<string, Function[]> = {};
  let rawHtml = "";
  let rawText = "";

  const styleObj: any = {
    transform: "",
    display: "",
    gridColumn: "",
    gridRow: "",
    setProperty(k: string, v: string) {
      this[k] = v;
    },
  };
  let rawCssText = "";
  Object.defineProperty(styleObj, "cssText", {
    get() {
      return rawCssText;
    },
    set(val: string) {
      rawCssText = String(val || "");
      for (const decl of rawCssText.split(";")) {
        const colonIdx = decl.indexOf(":");
        if (colonIdx !== -1) {
          const prop = decl
            .slice(0, colonIdx)
            .trim()
            .replace(/-([a-z])/g, (_, c) => c.toUpperCase());
          const value = decl.slice(colonIdx + 1).trim();
          if (prop) styleObj[prop] = value;
        }
      }
    },
  });

  const el: any = {
    tagName: tag.toUpperCase(),
    id: "",
    dataset: {},
    children: [] as any[],
    parentElement: null as any,
    isContentEditable: false,
    style: styleObj,
    classList: {
      add(...tokens: string[]) {
        tokens.forEach((t) => t && classes.add(t));
      },
      remove(...tokens: string[]) {
        tokens.forEach((t) => classes.delete(t));
      },
      contains(token: string) {
        return classes.has(token);
      },
      toggle(token: string, force?: boolean) {
        const shouldHave = force !== undefined ? force : !classes.has(token);
        if (shouldHave) classes.add(token);
        else classes.delete(token);
        return shouldHave;
      },
    },
    setAttribute(name: string, val: string) {
      attrs.set(name, val);
      if (name === "id") el.id = val;
      if (name === "class") {
        classes.clear();
        val.split(/\s+/).forEach((t) => t && classes.add(t));
      }
      if (name.startsWith("data-")) {
        const camel = name
          .slice(5)
          .replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        el.dataset[camel] = val;
      }
    },
    getAttribute(name: string) {
      return attrs.get(name) ?? null;
    },
    appendChild(child: any) {
      if (!child) return child;
      if (child.parentElement) {
        child.remove();
      }
      child.parentElement = el;
      el.children.push(child);
      return child;
    },
    remove() {
      if (el.parentElement) {
        const idx = el.parentElement.children.indexOf(el);
        if (idx !== -1) el.parentElement.children.splice(idx, 1);
        el.parentElement = null;
      }
    },
    addEventListener(event: string, cb: Function) {
      listeners[event] = listeners[event] || [];
      listeners[event].push(cb);
    },
    removeEventListener(event: string, cb: Function) {
      if (listeners[event]) {
        listeners[event] = listeners[event].filter((fn) => fn !== cb);
      }
    },
    click() {
      const cbs = listeners["click"] || [];
      const evt = {
        type: "click",
        target: el,
        stopPropagation: () => {},
        preventDefault: () => {},
      };
      cbs.forEach((cb) => cb(evt));
    },
    getContext() {
      return null;
    },
    querySelector(selector: string): any {
      return el.querySelectorAll(selector)[0] ?? null;
    },
    querySelectorAll(selector: string): any[] {
      const results: any[] = [];
      function walk(node: any) {
        for (const child of node.children || []) {
          if (matchesSelector(child, selector)) {
            results.push(child);
          }
          walk(child);
        }
      }
      walk(el);
      return results;
    },
  };

  Object.defineProperty(el, "className", {
    get() {
      return Array.from(classes).join(" ");
    },
    set(val: string) {
      classes.clear();
      String(val || "")
        .split(/\s+/)
        .forEach((t) => t && classes.add(t));
    },
  });

  Object.defineProperty(el, "innerHTML", {
    get() {
      if (el.children.length > 0) {
        return (
          rawHtml +
          el.children
            .map(
              (c: any) =>
                `<${c.tagName.toLowerCase()} class="${c.className}" id="${c.id}">${c.innerHTML}</${c.tagName.toLowerCase()}>`
            )
            .join("")
        );
      }
      return rawHtml;
    },
    set(val: string) {
      rawHtml = String(val || "");
      rawText = rawHtml.replace(/<[^>]*>/g, " ");
      el.children = [];
      const stack: any[] = [el];
      const voidTags = new Set(["img", "input", "br", "hr", "meta", "link", "circle", "line", "polyline", "rect", "path"]);
      const tokenRegex = /<\/?([a-zA-Z0-9]+)\b([^>]*?)(\/?)>/g;
      let match: RegExpExecArray | null;
      while ((match = tokenRegex.exec(rawHtml)) !== null) {
        const full = match[0];
        const tagName = match[1].toLowerCase();
        const attrStr = match[2] || "";
        const selfClose = match[3] === "/" || voidTags.has(tagName);
        if (full.startsWith("</")) {
          if (stack.length > 1) stack.pop();
        } else {
          const parent = stack[stack.length - 1];
          const child = createTestElement(tagName);
          const idM = attrStr.match(/\bid="([^"]*)"/);
          if (idM) child.id = idM[1];
          const clsM = attrStr.match(/\bclass="([^"]*)"/);
          if (clsM) child.className = clsM[1];
          parent.appendChild(child);
          if (!selfClose) {
            stack.push(child);
          }
        }
      }
    },
  });

  Object.defineProperty(el, "textContent", {
    get() {
      const childText = (el.children || []).map((c: any) => c.textContent).join(" ");
      return [rawText, childText].filter(Boolean).join(" ").trim();
    },
    set(val: string) {
      rawText = String(val ?? "");
      rawHtml = rawText
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      el.children = [];
    },
  });

  return el;
}

if (typeof globalThis.window === "undefined") {
  const listeners: Record<string, Function[]> = {};
  (globalThis as any).window = {
    location: {
      protocol: "http:",
      host: "localhost:8080",
      pathname: "/",
      search: "",
    },
    history: {
      replaceState: () => {},
    },
    setInterval: globalThis.setInterval.bind(globalThis),
    clearInterval: globalThis.clearInterval.bind(globalThis),
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    confirm: () => true,
    alert: () => {},
    addEventListener: (event: string, cb: Function) => {
      listeners[event] = listeners[event] || [];
      listeners[event].push(cb);
    },
    removeEventListener: (event: string, cb: Function) => {
      if (listeners[event]) {
        listeners[event] = listeners[event].filter((fn) => fn !== cb);
      }
    },
    matchMedia: () => ({ matches: false }),
    _spicy_lyrics: {},
  };
}

if (typeof globalThis.document === "undefined") {
  const body = createTestElement("body");
  const docEl = createTestElement("html");
  docEl.appendChild(body);

  (globalThis as any).document = {
    documentElement: docEl,
    body,
    activeElement: null,
    createElement: (tag: string) => createTestElement(tag),
    getElementById: (id: string) => body.querySelector(`#${id}`),
    querySelector: (sel: string) => body.querySelector(sel),
    querySelectorAll: (sel: string) => body.querySelectorAll(sel),
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
