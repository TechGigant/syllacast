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

import type { AppStateSnapshot } from "../bridge/spotifyPlayer.ts";
import type {
  WidgetType,
  WidgetInstance,
  LayoutProfile,
  WidgetMetadata,
  WidgetContext,
  MountedWidget,
} from "./widgets/types.ts";
import {
  WIDGET_METADATA_CATALOG,
  DEFAULT_LAYOUT_PROFILES,
} from "./widgets/types.ts";

import { createIframeWidget } from "./widgets/iframeWidget.ts";
import { createVisualizerWidget } from "./widgets/visualizerWidget.ts";
import { createWeatherWidget } from "./widgets/weatherWidget.ts";
import { createQueueWidget } from "./widgets/queueWidget.ts";
import { createNoteWidget } from "./widgets/noteWidget.ts";
import { createPlayerControlsWidget } from "./widgets/playerControlsWidget.ts";

import {
  GRID_COLS,
  GRID_ROWS,
  clampWidgetRect,
  rectsOverlap,
  findOpenSlot,
  resolveGridCollisions,
  computeSnapGuides,
  isTypingInInput,
  pointerToGridCoord,
} from "./gridMath.ts";

import { triggerRemeasureLV } from "../spicy/utils/Lyrics/LyricsVirtualizer.ts";
import { ResetLastLine } from "../spicy/utils/Scrolling/ScrollToActiveLine.ts";
import { ScrollSimplebar } from "../spicy/utils/Scrolling/Simplebar/ScrollSimplebar.ts";

export interface KioskSettings {
  show_controls_buttons: boolean;
  startup_mode: string;
  nowbar_open: boolean;
  nowbar_side: string;
  clock_enabled: boolean;
  up_next_enabled: boolean;
  calibration_offset_ms: number;
  dynamic_bg_mode: string;
  update_mode?: string;
  update_channel?: string;
  update_check_interval_hours?: number;
  active_profile_id?: string;
  layout_profiles?: LayoutProfile[];
  [key: string]: any;
}

export interface CustomizeStudioOptions {
  contentBox?: HTMLElement | null;
  nowBarElement?: HTMLElement | null;
  lyricsContainerElement?: HTMLElement | null;
  clockElement?: HTMLElement | null;
  upNextElement?: HTMLElement | null;
  saveSettings?: (settings: KioskSettings) => Promise<void> | void;
  getInterpolatedPositionMs?: () => number;
  sendCommand?: (cmd: Record<string, any>) => void;
  getLatestState?: () => AppStateSnapshot | null;
  onProfileChange?: (profileId: string) => void;
}

export interface CustomizeStudioAPI {
  applySettings: (settings: KioskSettings) => void;
  onStateUpdate: (state: AppStateSnapshot) => void;
  enterEditMode: () => void;
  exitEditMode: (save?: boolean) => void;
  isEditMode: () => boolean;
}

/**
 * Creates the interactive layout customization studio and grid layout manager.
 */
export function createCustomizeStudio(
  options: CustomizeStudioOptions = {}
): CustomizeStudioAPI {
  let inEditMode = false;
  let showGridBackdrop = true;

  let currentSettings: KioskSettings | null = null;
  let layoutProfiles: LayoutProfile[] = JSON.parse(
    JSON.stringify(DEFAULT_LAYOUT_PROFILES)
  );
  let activeProfileId = "default";
  let currentProfile: LayoutProfile = layoutProfiles[0];

  let snapshotBeforeEdit: string | null = null;
  let snapshotSettingsBeforeEdit: string | null = null;

  let latestState: AppStateSnapshot | null = null;

  // Track mounted dynamic widgets (player_controls, visualizer, weather, queue, iframe, note)
  const dynamicWidgets = new Map<
    string,
    { mounted: MountedWidget; element: HTMLElement; instance: WidgetInstance }
  >();

  // DOM lookup helpers
  function getContentBox(): HTMLElement {
    return (
      options.contentBox ||
      document.querySelector<HTMLElement>("#SpicyLyricsPage .ContentBox") ||
      document.querySelector<HTMLElement>(".ContentBox") ||
      document.body
    );
  }

  function getPageRoot(): HTMLElement {
    return (
      document.getElementById("SpicyLyricsPage") ||
      document.querySelector<HTMLElement>("#SpicyLyricsPage") ||
      document.body
    );
  }

  function getNowBar(): HTMLElement | null {
    return (
      options.nowBarElement ||
      getContentBox().querySelector<HTMLElement>(".NowBar")
    );
  }

  function getLyricsContainer(): HTMLElement | null {
    return (
      options.lyricsContainerElement ||
      getContentBox().querySelector<HTMLElement>(".LyricsContainer")
    );
  }

  function getClockElement(): HTMLElement | null {
    return (
      options.clockElement ||
      document.querySelector<HTMLElement>(".KioskClock")
    );
  }

  function getUpNextElement(): HTMLElement | null {
    return (
      options.upNextElement ||
      document.querySelector<HTMLElement>(".KioskUpNext")
    );
  }

  // Widget Context
  const widgetCtx: WidgetContext = {
    getInterpolatedPositionMs: () => options.getInterpolatedPositionMs?.() ?? 0,
    sendCommand: (cmd) => options.sendCommand?.(cmd),
    getLatestState: () => options.getLatestState?.() ?? latestState,
  };

  // --------------------------------------------------------------------------
  // LyricsContainer ResizeObserver
  // --------------------------------------------------------------------------
  let lyricsRemeasureRaf: number | null = null;
  const lyricsObserver =
    typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => {
          if (lyricsRemeasureRaf !== null) {
            cancelAnimationFrame(lyricsRemeasureRaf);
          }
          lyricsRemeasureRaf = requestAnimationFrame(() => {
            lyricsRemeasureRaf = null;
            try {
              ScrollSimplebar?.recalculate();
            } catch {}
            try {
              triggerRemeasureLV();
            } catch {}
            try {
              ResetLastLine();
            } catch {}
          });
        })
      : null;

  const initialLyricsEl = getLyricsContainer();
  if (initialLyricsEl && lyricsObserver) {
    lyricsObserver.observe(initialLyricsEl);
  }

  // --------------------------------------------------------------------------
  // Dynamic Widget Factory
  // --------------------------------------------------------------------------
  function instantiateDynamicWidget(
    type: WidgetType,
    config: Record<string, any>
  ): MountedWidget {
    switch (type) {
      case "player_controls":
        return createPlayerControlsWidget(config, widgetCtx);
      case "visualizer":
        return createVisualizerWidget(config, widgetCtx);
      case "weather":
        return createWeatherWidget(config, widgetCtx);
      case "extended_queue":
        return createQueueWidget(config, widgetCtx);
      case "iframe":
        return createIframeWidget(config, widgetCtx);
      case "note":
        return createNoteWidget(config, widgetCtx);
      default:
        return {
          element: document.createElement("div"),
          updateConfig: () => {},
          destroy: () => {},
        };
    }
  }

  // --------------------------------------------------------------------------
  // Layout Application & Grid Positioning
  // --------------------------------------------------------------------------
  function applyWidgetLayout(el: HTMLElement, instance: WidgetInstance) {
    el.style.gridColumn = `${instance.x} / span ${instance.w}`;
    el.style.gridRow = `${instance.y} / span ${instance.h}`;
    el.style.setProperty("--widget-cols", String(instance.w));
    el.style.setProperty("--widget-rows", String(instance.h));
    el.style.display = "flex";
    el.dataset.widgetId = instance.id;
    el.dataset.widgetType = instance.widget_type;
    el.classList.add("KioskGridWidget");
    el.classList.remove("KioskWidget--hidden");

    if (instance.widget_type === "nowbar") {
      const centerWhenNoLyrics = instance.config?.center_when_no_lyrics !== false;
      el.classList.toggle("NowBar--keep-position", !centerWhenNoLyrics);
    }

    if (instance.show_glass) {
      el.classList.add("KioskGridWidget--glass");
    } else {
      el.classList.remove("KioskGridWidget--glass");
    }
  }

  function renderGridWidgets() {
    const pageRoot = getPageRoot();
    const contentBox = getContentBox();

    // Ensure CSS Grid is active
    pageRoot.classList.add("GridLayoutActive");

    if (!currentProfile || !currentProfile.widgets) return;

    const activeWidgetIds = new Set(currentProfile.widgets.map((w) => w.id));

    // Remove obsolete dynamic widgets
    for (const [id, item] of dynamicWidgets.entries()) {
      if (!activeWidgetIds.has(id)) {
        item.mounted.destroy();
        item.element.remove();
        dynamicWidgets.delete(id);
      }
    }

    // Render / update each widget in current profile
    for (const instance of currentProfile.widgets) {
      if (instance.widget_type === "nowbar") {
        const el = getNowBar();
        if (el) {
          applyWidgetLayout(el, instance);
          if (inEditMode) mountWidgetEditChrome(el, instance);
        }
      } else if (instance.widget_type === "lyrics") {
        const el = getLyricsContainer();
        if (el) {
          applyWidgetLayout(el, instance);
          if (inEditMode) mountWidgetEditChrome(el, instance);
        }
      } else if (instance.widget_type === "clock") {
        const el = getClockElement();
        if (el) {
          if (el.parentElement !== contentBox) {
            contentBox.appendChild(el);
          }
          applyWidgetLayout(el, instance);
          if (inEditMode) mountWidgetEditChrome(el, instance);
        }
      } else if (instance.widget_type === "up_next") {
        const el = getUpNextElement();
        if (el) {
          if (el.parentElement !== contentBox) {
            contentBox.appendChild(el);
          }
          applyWidgetLayout(el, instance);
          if (inEditMode) mountWidgetEditChrome(el, instance);
        }
      } else {
        // Dynamic widgets
        if (dynamicWidgets.has(instance.id)) {
          const item = dynamicWidgets.get(instance.id)!;
          item.instance = instance;
          applyWidgetLayout(item.element, instance);
          item.mounted.updateConfig(instance.config);
          if (inEditMode) mountWidgetEditChrome(item.element, instance);
        } else {
          const wrapperEl = document.createElement("div");
          applyWidgetLayout(wrapperEl, instance);
          const mounted = instantiateDynamicWidget(
            instance.widget_type,
            instance.config
          );
          wrapperEl.appendChild(mounted.element);
          contentBox.appendChild(wrapperEl);
          dynamicWidgets.set(instance.id, {
            mounted,
            element: wrapperEl,
            instance,
          });
          if (inEditMode) mountWidgetEditChrome(wrapperEl, instance);
        }
      }
    }

    // Hide singleton core widgets not present in current profile
    if (!currentProfile.widgets.some((w) => w.widget_type === "nowbar")) {
      getNowBar()?.classList.add("KioskWidget--hidden");
    }
    if (!currentProfile.widgets.some((w) => w.widget_type === "lyrics")) {
      getLyricsContainer()?.classList.add("KioskWidget--hidden");
    }
    if (!currentProfile.widgets.some((w) => w.widget_type === "clock")) {
      getClockElement()?.classList.add("KioskWidget--hidden");
    }
    if (!currentProfile.widgets.some((w) => w.widget_type === "up_next")) {
      getUpNextElement()?.classList.add("KioskWidget--hidden");
    }
  }

  // --------------------------------------------------------------------------
  // Edit Mode Overlays, Drag & Resize Chrome
  // --------------------------------------------------------------------------
  let backdropEl: HTMLElement | null = null;
  let ghostEl: HTMLElement | null = null;
  let dockEl: HTMLElement | null = null;
  let catalogEl: HTMLElement | null = null;
  let modalBackdropEl: HTMLElement | null = null;
  let snapGuidesEl: HTMLElement | null = null;

  function mountStudioOverlays() {
    const contentBox = getContentBox();

    // 1. Grid Backdrop Overlay
    if (!backdropEl) {
      backdropEl = document.createElement("div");
      backdropEl.className =
        "GridBackdropOverlay" +
        (showGridBackdrop ? "" : " GridBackdropOverlay--hidden");
      for (let i = 0; i < GRID_COLS * GRID_ROWS; i++) {
        const cell = document.createElement("div");
        cell.className = "GridBackdropCell";
        backdropEl.appendChild(cell);
      }
      contentBox.appendChild(backdropEl);
    }

    // 2. Ghost Drop Preview
    if (!ghostEl) {
      ghostEl = document.createElement("div");
      ghostEl.className = "GridGhostPreview";
      ghostEl.style.display = "none";
      contentBox.appendChild(ghostEl);
    }

    // 3. Snap Guides Container
    if (!snapGuidesEl) {
      snapGuidesEl = document.createElement("div");
      snapGuidesEl.className = "GridSnapGuidesContainer";
      contentBox.appendChild(snapGuidesEl);
    }

    // 4. Floating Studio Dock
    if (!dockEl) {
      dockEl = createDockBar();
      document.body.appendChild(dockEl);
    }
  }

  function unmountStudioOverlays() {
    backdropEl?.remove();
    backdropEl = null;

    ghostEl?.remove();
    ghostEl = null;

    snapGuidesEl?.remove();
    snapGuidesEl = null;

    dockEl?.remove();
    dockEl = null;

    closeCatalogDrawer();
    closeModal();
  }

  function updateSnapGuides(verticalCols: number[], horizontalRows: number[]) {
    if (!snapGuidesEl) return;
    snapGuidesEl.innerHTML = "";
    const box = getContentBox();
    const width = box.clientWidth - 40; // minus 20px padding left/right
    const height = box.clientHeight - 54; // minus 16px top, 38px bottom

    for (const col of verticalCols) {
      const guide = document.createElement("div");
      guide.className = "GridSnapGuide--vertical";
      const pct = ((col - 1) / GRID_COLS) * width + 20;
      guide.style.left = `${pct}px`;
      snapGuidesEl.appendChild(guide);
    }

    for (const row of horizontalRows) {
      const guide = document.createElement("div");
      guide.className = "GridSnapGuide--horizontal";
      const pct = ((row - 1) / GRID_ROWS) * height + 16;
      guide.style.top = `${pct}px`;
      snapGuidesEl.appendChild(guide);
    }
  }

  function clearSnapGuides() {
    if (snapGuidesEl) {
      snapGuidesEl.innerHTML = "";
    }
  }

  // --------------------------------------------------------------------------
  // Widget Edit Chrome (Header Bar + 8 Resize Handles + Drag Shield)
  // --------------------------------------------------------------------------
  function mountWidgetEditChrome(
    widgetEl: HTMLElement,
    instance: WidgetInstance
  ) {
    // Remove existing chrome if any
    widgetEl.querySelector(".WidgetEditOverlay")?.remove();
    widgetEl.querySelector(".WidgetEditShield")?.remove();
    widgetEl.querySelectorAll(".WidgetResizeHandle").forEach((h) => h.remove());

    const meta = WIDGET_METADATA_CATALOG[instance.widget_type];

    // Header Bar
    const header = document.createElement("div");
    header.className = "WidgetEditOverlay";

    const left = document.createElement("div");
    left.className = "WidgetEditHeaderLeft";
    left.innerHTML = `
      <span class="WidgetEditGrip">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
          <circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/>
          <circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/>
          <circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/>
        </svg>
      </span>
      <span class="WidgetEditTitle">${meta?.title || instance.widget_type}</span>
      <span class="WidgetSpanBadge">${instance.w}×${instance.h}</span>
    `;

    const actions = document.createElement("div");
    actions.className = "WidgetEditActions";

    // ⚙ Settings Button
    const settingsBtn = document.createElement("button");
    settingsBtn.className = "WidgetEditBtn WidgetEditBtn--settings";
    settingsBtn.title = "Settings";
    settingsBtn.innerHTML = `⚙`;
    settingsBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openWidgetSettingsModal(instance);
    });
    actions.appendChild(settingsBtn);

    // ⧉ Duplicate Button (only for multi-instance widgets)
    if (!meta?.singleton) {
      const dupBtn = document.createElement("button");
      dupBtn.className = "WidgetEditBtn WidgetEditBtn--duplicate";
      dupBtn.title = "Duplicate";
      dupBtn.innerHTML = `⧉`;
      dupBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        duplicateWidget(instance);
      });
      actions.appendChild(dupBtn);
    }

    // ✕ Delete Button
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "WidgetEditBtn WidgetEditBtn--delete";
    deleteBtn.title = "Delete";
    deleteBtn.innerHTML = `✕`;
    deleteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteWidget(instance);
    });
    actions.appendChild(deleteBtn);

    header.appendChild(left);
    header.appendChild(actions);
    widgetEl.appendChild(header);

    // Transparent Drag Shield
    const shield = document.createElement("div");
    shield.className = "WidgetEditShield";
    widgetEl.appendChild(shield);

    // 8-Direction Resize Handles
    const handles = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
    for (const dir of handles) {
      const handle = document.createElement("div");
      handle.className = `WidgetResizeHandle WidgetResizeHandle--${dir}`;
      handle.dataset.direction = dir;
      widgetEl.appendChild(handle);
      attachResizeListeners(handle, widgetEl, instance, dir);
    }

    // Attach Drag Listeners
    attachDragListeners(left, widgetEl, instance);
    attachDragListeners(shield, widgetEl, instance);
  }

  function unmountAllWidgetEditChrome() {
    const contentBox = getContentBox();
    contentBox.querySelectorAll(".WidgetEditOverlay").forEach((el) => el.remove());
    contentBox.querySelectorAll(".WidgetEditShield").forEach((el) => el.remove());
    contentBox
      .querySelectorAll(".WidgetResizeHandle")
      .forEach((el) => el.remove());
    contentBox
      .querySelectorAll(".KioskGridWidget--active")
      .forEach((el) => el.classList.remove("KioskGridWidget--active"));
  }

  // --------------------------------------------------------------------------
  // Drag & Drop Handling
  // --------------------------------------------------------------------------
  function attachDragListeners(
    dragTrigger: HTMLElement,
    widgetEl: HTMLElement,
    instance: WidgetInstance
  ) {
    dragTrigger.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const contentBox = getContentBox();
      const containerRect = contentBox.getBoundingClientRect();

      widgetEl.classList.add("KioskGridWidget--active", "KioskGridWidget--dragging");

      const startCoord = pointerToGridCoord(e.clientX, e.clientY, containerRect);
      const offsetCol = startCoord.col - instance.x;
      const offsetRow = startCoord.row - instance.y;

      const meta = WIDGET_METADATA_CATALOG[instance.widget_type];
      const minW = meta?.minW ?? 1;
      const minH = meta?.minH ?? 1;

      let currentTarget = { x: instance.x, y: instance.y, w: instance.w, h: instance.h };

      function onPointerMove(moveEvent: PointerEvent) {
        moveEvent.preventDefault();
        const coord = pointerToGridCoord(moveEvent.clientX, moveEvent.clientY, containerRect);
        const rawTarget = {
          x: coord.col - offsetCol,
          y: coord.row - offsetRow,
          w: instance.w,
          h: instance.h,
        };

        currentTarget = clampWidgetRect(rawTarget, minW, minH);

        // Collision check
        const others = currentProfile.widgets.filter((w) => w.id !== instance.id);
        const { hasUnresolvedOverlap } = resolveGridCollisions(
          currentProfile.widgets,
          { ...instance, ...currentTarget }
        );

        // Ghost Preview
        if (ghostEl) {
          ghostEl.style.gridColumn = `${currentTarget.x} / span ${currentTarget.w}`;
          ghostEl.style.gridRow = `${currentTarget.y} / span ${currentTarget.h}`;
          ghostEl.classList.toggle("GridGhostPreview--overlap", hasUnresolvedOverlap);
          ghostEl.style.display = "block";
        }

        // Snap Guides
        const { verticalCols, horizontalRows } = computeSnapGuides(
          currentTarget,
          others
        );
        updateSnapGuides(verticalCols, horizontalRows);
      }

      function onPointerUp() {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);

        widgetEl.classList.remove("KioskGridWidget--dragging");

        // Apply new position
        const others = currentProfile.widgets.filter((w) => w.id !== instance.id);
        const resolution = resolveGridCollisions(
          currentProfile.widgets,
          { ...instance, ...currentTarget }
        );

        if (!resolution.hasUnresolvedOverlap) {
          // If collision resolution succeeded cleanly, update all shifted widgets
          for (const resolved of resolution.widgets) {
            const original = currentProfile.widgets.find((w) => w.id === resolved.id);
            if (original) {
              original.x = resolved.x;
              original.y = resolved.y;
              original.w = resolved.w;
              original.h = resolved.h;
            }
          }
        } else {
          // Place active widget at target, keep others clamped
          instance.x = currentTarget.x;
          instance.y = currentTarget.y;
        }

        if (ghostEl) ghostEl.style.display = "none";
        clearSnapGuides();

        renderGridWidgets();
      }

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
    });
  }

  // --------------------------------------------------------------------------
  // 8-Direction Resize Handling
  // --------------------------------------------------------------------------
  function attachResizeListeners(
    handle: HTMLElement,
    widgetEl: HTMLElement,
    instance: WidgetInstance,
    direction: string
  ) {
    handle.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const contentBox = getContentBox();
      const containerRect = contentBox.getBoundingClientRect();

      widgetEl.classList.add("KioskGridWidget--active");

      const startX = instance.x;
      const startY = instance.y;
      const startW = instance.w;
      const startH = instance.h;
      const startRight = startX + startW - 1;
      const startBottom = startY + startH - 1;

      const meta = WIDGET_METADATA_CATALOG[instance.widget_type];
      const minW = meta?.minW ?? 1;
      const minH = meta?.minH ?? 1;

      let currentTarget = { x: startX, y: startY, w: startW, h: startH };

      function onPointerMove(moveEvent: PointerEvent) {
        moveEvent.preventDefault();
        const coord = pointerToGridCoord(moveEvent.clientX, moveEvent.clientY, containerRect);

        let newX = startX;
        let newY = startY;
        let newW = startW;
        let newH = startH;

        if (direction.includes("e")) {
          newW = Math.max(minW, Math.min(GRID_COLS - startX + 1, coord.col - startX + 1));
        }
        if (direction.includes("s")) {
          newH = Math.max(minH, Math.min(GRID_ROWS - startY + 1, coord.row - startY + 1));
        }
        if (direction.includes("w")) {
          const maxLeft = startRight - minW + 1;
          newX = Math.max(1, Math.min(maxLeft, coord.col));
          newW = startRight - newX + 1;
        }
        if (direction.includes("n")) {
          const maxTop = startBottom - minH + 1;
          newY = Math.max(1, Math.min(maxTop, coord.row));
          newH = startBottom - newY + 1;
        }

        currentTarget = clampWidgetRect(
          { x: newX, y: newY, w: newW, h: newH },
          minW,
          minH
        );

        if (ghostEl) {
          ghostEl.style.gridColumn = `${currentTarget.x} / span ${currentTarget.w}`;
          ghostEl.style.gridRow = `${currentTarget.y} / span ${currentTarget.h}`;
          ghostEl.classList.remove("GridGhostPreview--overlap");
          ghostEl.style.display = "block";
        }

        const others = currentProfile.widgets.filter((w) => w.id !== instance.id);
        const { verticalCols, horizontalRows } = computeSnapGuides(
          currentTarget,
          others
        );
        updateSnapGuides(verticalCols, horizontalRows);
      }

      function onPointerUp() {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);

        instance.x = currentTarget.x;
        instance.y = currentTarget.y;
        instance.w = currentTarget.w;
        instance.h = currentTarget.h;

        if (ghostEl) ghostEl.style.display = "none";
        clearSnapGuides();

        renderGridWidgets();
      }

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
    });
  }

  // --------------------------------------------------------------------------
  // Widget CRUD Operations
  // --------------------------------------------------------------------------
  function duplicateWidget(source: WidgetInstance) {
    const meta = WIDGET_METADATA_CATALOG[source.widget_type];
    if (meta?.singleton) return;

    const slot = findOpenSlot(currentProfile.widgets, source.w, source.h);
    const newId = `${source.widget_type}-${Date.now().toString(36)}`;

    const newInstance: WidgetInstance = {
      id: newId,
      widget_type: source.widget_type,
      x: slot.x,
      y: slot.y,
      w: source.w,
      h: source.h,
      show_glass: source.show_glass,
      config: JSON.parse(JSON.stringify(source.config)),
    };

    currentProfile.widgets.push(newInstance);
    renderGridWidgets();
  }

  function deleteWidget(instance: WidgetInstance) {
    const idx = currentProfile.widgets.findIndex((w) => w.id === instance.id);
    if (idx !== -1) {
      currentProfile.widgets.splice(idx, 1);
      renderGridWidgets();
    }
  }

  function addWidgetFromCatalog(type: WidgetType) {
    const meta = WIDGET_METADATA_CATALOG[type];
    if (!meta) return;

    if (
      meta.singleton &&
      currentProfile.widgets.some((w) => w.widget_type === type)
    ) {
      return;
    }

    const slot = findOpenSlot(currentProfile.widgets, meta.defaultW, meta.defaultH);
    const newId = `${type}-${Date.now().toString(36)}`;

    const newInstance: WidgetInstance = {
      id: newId,
      widget_type: type,
      x: slot.x,
      y: slot.y,
      w: meta.defaultW,
      h: meta.defaultH,
      show_glass: meta.defaultShowGlass,
      config: JSON.parse(JSON.stringify(meta.defaultConfig)),
    };

    currentProfile.widgets.push(newInstance);
    renderGridWidgets();
    closeCatalogDrawer();
  }

  // --------------------------------------------------------------------------
  // Floating Studio Dock Bar
  // --------------------------------------------------------------------------
  function createDockBar(): HTMLElement {
    const dock = document.createElement("div");
    dock.className = "CustomizeDock";

    // Group 1: + Add Widget
    const grp1 = document.createElement("div");
    grp1.className = "CustomizeDockGroup";

    const addBtn = document.createElement("button");
    addBtn.className = "CustomizeDockBtn CustomizeDockBtn--primary";
    addBtn.innerHTML = `<span>+</span> Add Widget`;
    addBtn.addEventListener("click", () => toggleCatalogDrawer());
    grp1.appendChild(addBtn);

    // Divider
    const div1 = document.createElement("div");
    div1.className = "CustomizeDockDivider";

    // Group 2: Profile Selector & Management
    const grp2 = document.createElement("div");
    grp2.className = "CustomizeDockGroup";

    const select = document.createElement("select");
    select.className = "CustomizeProfileSelect";
    renderProfileSelectOptions(select);
    select.addEventListener("change", () => {
      switchProfile(select.value);
    });
    grp2.appendChild(select);

    const newProfileBtn = document.createElement("button");
    newProfileBtn.className = "CustomizeDockBtn";
    newProfileBtn.title = "New Profile";
    newProfileBtn.innerHTML = `+ New`;
    newProfileBtn.addEventListener("click", () => openNewProfileModal());
    grp2.appendChild(newProfileBtn);

    const deleteProfileBtn = document.createElement("button");
    deleteProfileBtn.className = "CustomizeDockBtn CustomizeDockBtn--danger";
    deleteProfileBtn.title = "Delete Profile";
    deleteProfileBtn.innerHTML = `🗑`;
    deleteProfileBtn.addEventListener("click", () => deleteCurrentProfile());
    grp2.appendChild(deleteProfileBtn);

    // Divider
    const div2 = document.createElement("div");
    div2.className = "CustomizeDockDivider";

    // Group 3: Grid toggle & Reset
    const grp3 = document.createElement("div");
    grp3.className = "CustomizeDockGroup";

    const gridBtn = document.createElement("button");
    gridBtn.className =
      "CustomizeDockBtn" + (showGridBackdrop ? " CustomizeDockBtn--active" : "");
    gridBtn.innerHTML = `# Grid`;
    gridBtn.addEventListener("click", () => {
      showGridBackdrop = !showGridBackdrop;
      gridBtn.classList.toggle("CustomizeDockBtn--active", showGridBackdrop);
      backdropEl?.classList.toggle(
        "GridBackdropOverlay--hidden",
        !showGridBackdrop
      );
    });
    grp3.appendChild(gridBtn);

    const resetBtn = document.createElement("button");
    resetBtn.className = "CustomizeDockBtn";
    resetBtn.title = "Reset Profile to Default";
    resetBtn.innerHTML = `↺ Reset`;
    resetBtn.addEventListener("click", () => resetCurrentProfile());
    grp3.appendChild(resetBtn);

    // Divider
    const div3 = document.createElement("div");
    div3.className = "CustomizeDockDivider";

    // Group 4: Save & Exit / Cancel
    const grp4 = document.createElement("div");
    grp4.className = "CustomizeDockGroup";

    const saveBtn = document.createElement("button");
    saveBtn.className = "CustomizeDockBtn CustomizeDockBtn--primary";
    saveBtn.innerHTML = `✓ Save & Exit`;
    saveBtn.addEventListener("click", () => exitEditMode(true));
    grp4.appendChild(saveBtn);

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "CustomizeDockBtn";
    cancelBtn.innerHTML = `✕ Cancel`;
    cancelBtn.addEventListener("click", () => exitEditMode(false));
    grp4.appendChild(cancelBtn);

    dock.appendChild(grp1);
    dock.appendChild(div1);
    dock.appendChild(grp2);
    dock.appendChild(div2);
    dock.appendChild(grp3);
    dock.appendChild(div3);
    dock.appendChild(grp4);

    return dock;
  }

  function renderProfileSelectOptions(selectEl: HTMLSelectElement) {
    selectEl.innerHTML = "";
    for (const p of layoutProfiles) {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name;
      opt.selected = p.id === activeProfileId;
      selectEl.appendChild(opt);
    }
  }

  function switchProfile(profileId: string) {
    const target = layoutProfiles.find((p) => p.id === profileId);
    if (!target) return;

    activeProfileId = target.id;
    currentProfile = target;

    options.onProfileChange?.(activeProfileId);
    renderGridWidgets();

    // Persist active profile change
    persistSettings();
  }

  function resetCurrentProfile() {
    const defaultMatch =
      DEFAULT_LAYOUT_PROFILES.find((p) => p.id === currentProfile.id) ||
      DEFAULT_LAYOUT_PROFILES[0];

    const confirmed = window.confirm(
      `Reset profile "${currentProfile.name}" back to factory layout?`
    );
    if (!confirmed) return;

    currentProfile.widgets = JSON.parse(JSON.stringify(defaultMatch.widgets));
    renderGridWidgets();
  }

  function deleteCurrentProfile() {
    if (currentProfile.id === "default") {
      window.alert("Cannot delete the factory Default profile.");
      return;
    }

    const confirmed = window.confirm(
      `Delete profile "${currentProfile.name}"?`
    );
    if (!confirmed) return;

    const idx = layoutProfiles.findIndex((p) => p.id === currentProfile.id);
    if (idx !== -1) {
      layoutProfiles.splice(idx, 1);
    }

    switchProfile("default");

    // Update profile select in dock
    const select = dockEl?.querySelector<HTMLSelectElement>(
      ".CustomizeProfileSelect"
    );
    if (select) renderProfileSelectOptions(select);
  }

  // --------------------------------------------------------------------------
  // Widget Catalog Drawer
  // --------------------------------------------------------------------------
  function toggleCatalogDrawer() {
    if (catalogEl) {
      closeCatalogDrawer();
    } else {
      openCatalogDrawer();
    }
  }

  function openCatalogDrawer() {
    if (catalogEl) catalogEl.remove();

    catalogEl = document.createElement("div");
    catalogEl.className = "WidgetCatalogDrawer";

    const header = document.createElement("div");
    header.className = "WidgetCatalogHeader";
    header.innerHTML = `
      <h3>Add Widget to Layout</h3>
      <button class="WidgetCatalogCloseBtn">✕</button>
    `;
    header
      .querySelector(".WidgetCatalogCloseBtn")
      ?.addEventListener("click", () => closeCatalogDrawer());

    const grid = document.createElement("div");
    grid.className = "WidgetCatalogGrid";

    const allTypes = Object.keys(WIDGET_METADATA_CATALOG) as WidgetType[];
    for (const type of allTypes) {
      const meta = WIDGET_METADATA_CATALOG[type];
      const isAlreadyAdded =
        meta.singleton &&
        currentProfile.widgets.some((w) => w.widget_type === type);

      const card = document.createElement("div");
      card.className = "WidgetCatalogCard";

      card.innerHTML = `
        <div class="WidgetCatalogCardTop">
          <div class="WidgetCatalogIcon">${meta.iconSvg}</div>
          <div class="WidgetCatalogInfo">
            <div class="WidgetCatalogTitle">${meta.title}</div>
            <div class="WidgetCatalogDesc">${meta.description}</div>
          </div>
        </div>
        <div class="WidgetCatalogCardBottom">
          <span class="WidgetCatalogSpanInfo">${meta.defaultW}×${meta.defaultH} cells</span>
          <button class="WidgetCatalogAddBtn" ${
            isAlreadyAdded ? "disabled" : ""
          }>
            ${isAlreadyAdded ? "Added" : "+ Add"}
          </button>
        </div>
      `;

      if (!isAlreadyAdded) {
        card
          .querySelector(".WidgetCatalogAddBtn")
          ?.addEventListener("click", () => {
            addWidgetFromCatalog(type);
          });
      }

      grid.appendChild(card);
    }

    catalogEl.appendChild(header);
    catalogEl.appendChild(grid);
    document.body.appendChild(catalogEl);
  }

  function closeCatalogDrawer() {
    catalogEl?.remove();
    catalogEl = null;
  }

  // --------------------------------------------------------------------------
  // Settings & New Profile Modals
  // --------------------------------------------------------------------------
  function openWidgetSettingsModal(instance: WidgetInstance) {
    closeModal();

    const meta = WIDGET_METADATA_CATALOG[instance.widget_type];

    modalBackdropEl = document.createElement("div");
    modalBackdropEl.className = "WidgetSettingsModalBackdrop";

    const card = document.createElement("div");
    card.className = "WidgetSettingsCard";

    const header = document.createElement("div");
    header.className = "WidgetSettingsModalHeader";
    header.innerHTML = `
      <h3>
        <span style="display: flex; align-items: center; width: 20px; height: 20px;">
          ${meta?.iconSvg || ""}
        </span>
        ${meta?.title || instance.widget_type} Settings
      </h3>
      <button class="WidgetCatalogCloseBtn">✕</button>
    `;
    header
      .querySelector(".WidgetCatalogCloseBtn")
      ?.addEventListener("click", () => closeModal());

    const body = document.createElement("div");
    body.className = "WidgetSettingsModalBody";

    // Coordinates info
    const infoRow = document.createElement("div");
    infoRow.style.cssText =
      "font-size: 11px; color: #94a3b8; padding-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.08);";
    infoRow.textContent = `Grid Position: (${instance.x}, ${instance.y}) · Span: ${instance.w} cols × ${instance.h} rows`;
    body.appendChild(infoRow);

    // Glass Card Frame toggle
    const glassRow = document.createElement("div");
    glassRow.className = "StudioToggleRow";
    glassRow.innerHTML = `
      <div>
        <div class="StudioToggleLabel">Frosted Glass Card Frame</div>
        <div style="font-size: 11px; color: #94a3b8;">Render liquid glass background and card border</div>
      </div>
      <label class="StudioSwitch">
        <input type="checkbox" ${instance.show_glass ? "checked" : ""}>
        <span class="StudioSlider"></span>
      </label>
    `;
    const glassInput = glassRow.querySelector("input")!;
    glassInput.addEventListener("change", () => {
      instance.show_glass = glassInput.checked;
      renderGridWidgets();
    });
    body.appendChild(glassRow);

    if (instance.widget_type === "nowbar") {
      const centerWhenNoLyrics = instance.config?.center_when_no_lyrics !== false;
      const centerRow = document.createElement("div");
      centerRow.className = "StudioToggleRow";
      centerRow.innerHTML = `
        <div>
          <div class="StudioToggleLabel">Center When No Lyrics</div>
          <div style="font-size: 11px; color: #94a3b8;">Move album art into the middle of the screen when a song has no lyrics</div>
        </div>
        <label class="StudioSwitch">
          <input type="checkbox" ${centerWhenNoLyrics ? "checked" : ""}>
          <span class="StudioSlider"></span>
        </label>
      `;
      const centerInput = centerRow.querySelector("input")!;
      centerInput.addEventListener("change", () => {
        instance.config = {
          ...instance.config,
          center_when_no_lyrics: centerInput.checked,
        };
        renderGridWidgets();
      });
      body.appendChild(centerRow);
    }

    // Widget-specific settings form
    const dynamicItem = dynamicWidgets.get(instance.id);
    if (dynamicItem?.mounted.renderSettingsForm) {
      const widgetForm = dynamicItem.mounted.renderSettingsForm(
        instance.config,
        (newConfig) => {
          Object.assign(instance.config, newConfig);
          dynamicItem.mounted.updateConfig(instance.config);
        }
      );
      body.appendChild(widgetForm);
    }

    const footer = document.createElement("div");
    footer.className = "WidgetSettingsModalFooter";

    const doneBtn = document.createElement("button");
    doneBtn.className = "CustomizeDockBtn CustomizeDockBtn--primary";
    doneBtn.textContent = "Done";
    doneBtn.addEventListener("click", () => closeModal());
    footer.appendChild(doneBtn);

    card.appendChild(header);
    card.appendChild(body);
    card.appendChild(footer);
    modalBackdropEl.appendChild(card);

    modalBackdropEl.addEventListener("click", (e) => {
      if (e.target === modalBackdropEl) closeModal();
    });

    document.body.appendChild(modalBackdropEl);
  }

  function openNewProfileModal() {
    closeModal();

    modalBackdropEl = document.createElement("div");
    modalBackdropEl.className = "WidgetSettingsModalBackdrop";

    const card = document.createElement("div");
    card.className = "WidgetSettingsCard";

    const header = document.createElement("div");
    header.className = "WidgetSettingsModalHeader";
    header.innerHTML = `
      <h3>Create New Profile</h3>
      <button class="WidgetCatalogCloseBtn">✕</button>
    `;
    header
      .querySelector(".WidgetCatalogCloseBtn")
      ?.addEventListener("click", () => closeModal());

    const body = document.createElement("div");
    body.className = "WidgetSettingsModalBody";

    const formGroup = document.createElement("div");
    formGroup.className = "StudioFormGroup";
    formGroup.innerHTML = `
      <label class="StudioFormLabel">Profile Name</label>
      <input type="text" class="StudioFormInput" placeholder="e.g. Living Room TV, Party Mode..." />
    `;
    body.appendChild(formGroup);

    const input = formGroup.querySelector("input")!;
    setTimeout(() => input.focus(), 50);

    const footer = document.createElement("div");
    footer.className = "WidgetSettingsModalFooter";

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "CustomizeDockBtn";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => closeModal());

    const createBtn = document.createElement("button");
    createBtn.className = "CustomizeDockBtn CustomizeDockBtn--primary";
    createBtn.textContent = "Create Profile";
    createBtn.addEventListener("click", () => {
      const name = input.value.trim() || `Profile ${layoutProfiles.length + 1}`;
      const newId = `profile-${Date.now().toString(36)}`;

      const newProfile: LayoutProfile = {
        id: newId,
        name,
        widgets: JSON.parse(JSON.stringify(currentProfile.widgets)),
      };

      layoutProfiles.push(newProfile);
      closeModal();
      switchProfile(newId);

      const select = dockEl?.querySelector<HTMLSelectElement>(
        ".CustomizeProfileSelect"
      );
      if (select) renderProfileSelectOptions(select);
    });

    footer.appendChild(cancelBtn);
    footer.appendChild(createBtn);

    card.appendChild(header);
    card.appendChild(body);
    card.appendChild(footer);
    modalBackdropEl.appendChild(card);

    modalBackdropEl.addEventListener("click", (e) => {
      if (e.target === modalBackdropEl) closeModal();
    });

    document.body.appendChild(modalBackdropEl);
  }

  function closeModal() {
    modalBackdropEl?.remove();
    modalBackdropEl = null;
  }

  // --------------------------------------------------------------------------
  // Persistence & Settings Synchronization
  // --------------------------------------------------------------------------
  function persistSettings(): void {
    if (!currentSettings) return;

    // Sync legacy booleans with active profile
    const clockActive = currentProfile.widgets.some((w) => w.widget_type === "clock");
    const upNextActive = currentProfile.widgets.some((w) => w.widget_type === "up_next");
    const nowbarActive = currentProfile.widgets.some((w) => w.widget_type === "nowbar");

    const updatedSettings: KioskSettings = {
      ...currentSettings,
      clock_enabled: clockActive,
      up_next_enabled: upNextActive,
      nowbar_open: nowbarActive,
      active_profile_id: activeProfileId,
      layout_profiles: layoutProfiles,
    };

    currentSettings = updatedSettings;

    if (options.saveSettings) {
      void options.saveSettings(updatedSettings);
    } else {
      // Default fallback: POST to /api/settings
      fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatedSettings),
      }).catch((err) => console.error("Failed to save layout settings:", err));
    }
  }

  // --------------------------------------------------------------------------
  // Public Studio API
  // --------------------------------------------------------------------------
  function enterEditMode(): void {
    if (inEditMode) return;
    inEditMode = true;

    snapshotBeforeEdit = JSON.stringify(currentProfile);
    snapshotSettingsBeforeEdit = currentSettings
      ? JSON.stringify(currentSettings)
      : null;

    getPageRoot().classList.add("EditModeActive");

    mountStudioOverlays();
    renderGridWidgets();
  }

  function exitEditMode(save = true): void {
    if (!inEditMode) return;

    closeCatalogDrawer();
    closeModal();

    if (!save && snapshotBeforeEdit) {
      // Revert to snapshot
      currentProfile = JSON.parse(snapshotBeforeEdit);
      const idx = layoutProfiles.findIndex((p) => p.id === currentProfile.id);
      if (idx !== -1) {
        layoutProfiles[idx] = currentProfile;
      }
      if (snapshotSettingsBeforeEdit) {
        currentSettings = JSON.parse(snapshotSettingsBeforeEdit);
      }
      renderGridWidgets();
    } else if (save) {
      persistSettings();
    }

    inEditMode = false;
    getPageRoot().classList.remove("EditModeActive");

    unmountStudioOverlays();
    unmountAllWidgetEditChrome();

    // Clean up /customize URL if present
    if (
      typeof window !== "undefined" &&
      window.location.pathname.startsWith("/customize")
    ) {
      window.history.replaceState({}, "", "/");
    }
  }

  function applySettings(settings: KioskSettings): void {
    currentSettings = { ...settings };

    if (settings.layout_profiles && settings.layout_profiles.length > 0) {
      layoutProfiles = JSON.parse(JSON.stringify(settings.layout_profiles));
      // Migrate legacy initial "default" profile coordinates where up_next was at top-right (x=18, y=1)
      const defProf = layoutProfiles.find((p) => p.id === "default");
      if (defProf) {
        const legacyUpNext = defProf.widgets.find(
          (w) => w.widget_type === "up_next" && w.x === 18 && w.y === 1
        );
        if (legacyUpNext) {
          defProf.widgets = JSON.parse(
            JSON.stringify(DEFAULT_LAYOUT_PROFILES[0].widgets)
          );
        }
      }
    } else {
      layoutProfiles = JSON.parse(JSON.stringify(DEFAULT_LAYOUT_PROFILES));
    }

    if (settings.active_profile_id) {
      activeProfileId = settings.active_profile_id;
    }

    currentProfile =
      layoutProfiles.find((p) => p.id === activeProfileId) ||
      layoutProfiles[0] ||
      DEFAULT_LAYOUT_PROFILES[0];

    renderGridWidgets();
  }

  function onStateUpdate(state: AppStateSnapshot): void {
    latestState = state;
    for (const item of dynamicWidgets.values()) {
      item.mounted.onStateUpdate?.(state);
    }
  }

  // --------------------------------------------------------------------------
  // Keyboard Shortcuts & URL Boot Trigger
  // --------------------------------------------------------------------------
  if (typeof window !== "undefined") {
    window.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (modalBackdropEl) {
          closeModal();
          return;
        }
        if (catalogEl) {
          closeCatalogDrawer();
          return;
        }
        if (inEditMode) {
          exitEditMode(false);
          return;
        }
      }

      if ((e.key === "e" || e.key === "E") && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (!isTypingInInput(e.target)) {
          e.preventDefault();
          if (inEditMode) {
            exitEditMode(true);
          } else {
            enterEditMode();
          }
        }
      }
    });

    // Auto-enter edit mode if launched via /customize or ?edit=true
    const isCustomizeRoute =
      window.location.pathname.startsWith("/customize") ||
      new URLSearchParams(window.location.search).has("edit");

    if (isCustomizeRoute) {
      setTimeout(() => {
        enterEditMode();
      }, 100);
    }
  }

  return {
    applySettings,
    onStateUpdate,
    enterEditMode,
    exitEditMode,
    isEditMode: () => inEditMode,
  };
}
