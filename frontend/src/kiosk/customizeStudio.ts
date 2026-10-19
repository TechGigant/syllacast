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
  WidgetContext,
  MountedWidget,
  ElementVisibility,
} from "./widgets/types.ts";
import {
  WIDGET_METADATA_CATALOG,
  DEFAULT_LAYOUT_PROFILES,
  classifyWidgetDimensions,
  getDefaultWidgetZIndex,
} from "./widgets/types.ts";

import type { KioskClockController } from "./clock.ts";
import type { KioskUpNextController } from "./upNext.ts";

import { createIframeWidget } from "./widgets/iframeWidget.ts";
import { createVisualizerWidget } from "./widgets/visualizerWidget.ts";
import { createWeatherWidget } from "./widgets/weatherWidget.ts";
import { createQueueWidget } from "./widgets/queueWidget.ts";
import { createNoteWidget } from "./widgets/noteWidget.ts";
import { createPlayerControlsWidget } from "./widgets/playerControlsWidget.ts";

import {
  GRID_COLS,
  GRID_ROWS,
  ASPECT_RATIO_PRESETS,
  clampWidgetRect,
  findOpenSlot,
  computeSnapGuides,
  isTypingInInput,
  pointerToGridCoord,
  parseAspectRatio,
  detectScreenAspectRatio,
  findBestProfileForAspectRatio,
  computePreviewStageDimensions,
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
  auto_switch_aspect_ratio?: boolean;
  layout_profiles?: LayoutProfile[];
  [key: string]: any;
}

export interface CustomizeStudioOptions {
  contentBox?: HTMLElement | null;
  nowBarElement?: HTMLElement | null;
  lyricsContainerElement?: HTMLElement | null;
  clockElement?: HTMLElement | null;
  upNextElement?: HTMLElement | null;
  clockController?: KioskClockController | null;
  upNextController?: KioskUpNextController | null;
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
  undo: () => boolean;
  redo: () => boolean;
  selectWidget: (widgetId: string | null) => void;
  getSelectedWidgetId: () => string | null;
  getActiveProfile: () => LayoutProfile;
  setPreviewAspectRatio: (presetId: string) => void;
}

const MAX_UNDO_HISTORY = 30;

function normalizeVisibility(
  val: unknown,
  fallback: ElementVisibility = "auto"
): ElementVisibility {
  if (val === true || val === "show") return "show";
  if (val === false || val === "hide") return "hide";
  if (val === "auto") return "auto";
  return fallback;
}

/**
 * Creates the interactive layout customization studio and grid layout manager.
 */
export function createCustomizeStudio(
  options: CustomizeStudioOptions = {}
): CustomizeStudioAPI {
  let inEditMode = false;
  let showGridBackdrop = true;
  let selectedWidgetId: string | null = null;
  let previewAspectPreset = "auto"; // "auto" or aspect ratio string like "16:9", "5:3", etc.

  let currentSettings: KioskSettings | null = null;
  let layoutProfiles: LayoutProfile[] = JSON.parse(
    JSON.stringify(DEFAULT_LAYOUT_PROFILES)
  );
  let activeProfileId = "default";
  let currentProfile: LayoutProfile = layoutProfiles[0];

  let snapshotBeforeEdit: string | null = null;
  let snapshotSettingsBeforeEdit: string | null = null;

  let undoStack: string[] = [];
  let redoStack: string[] = [];

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
      options.clockController?.element ||
      document.querySelector<HTMLElement>(".KioskClock")
    );
  }

  function getUpNextElement(): HTMLElement | null {
    return (
      options.upNextElement ||
      options.upNextController?.element ||
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
  // Undo / Redo History Management
  // --------------------------------------------------------------------------
  function pushUndoState() {
    if (!currentProfile) return;
    const snap = JSON.stringify(currentProfile.widgets);
    if (undoStack.length > 0 && undoStack[undoStack.length - 1] === snap) {
      return;
    }
    undoStack.push(snap);
    if (undoStack.length > MAX_UNDO_HISTORY) {
      undoStack.shift();
    }
    redoStack = [];
    updateUndoRedoButtons();
  }

  function undo(): boolean {
    if (undoStack.length === 0 || !currentProfile) return false;
    const currentSnap = JSON.stringify(currentProfile.widgets);
    redoStack.push(currentSnap);
    const prevSnap = undoStack.pop()!;
    currentProfile.widgets = JSON.parse(prevSnap);
    renderGridWidgets();
    updateUndoRedoButtons();
    return true;
  }

  function redo(): boolean {
    if (redoStack.length === 0 || !currentProfile) return false;
    const currentSnap = JSON.stringify(currentProfile.widgets);
    undoStack.push(currentSnap);
    const nextSnap = redoStack.pop()!;
    currentProfile.widgets = JSON.parse(nextSnap);
    renderGridWidgets();
    updateUndoRedoButtons();
    return true;
  }

  function updateUndoRedoButtons() {
    if (!dockEl) return;
    const undoBtn = dockEl.querySelector<HTMLButtonElement>(".CustomizeUndoBtn");
    const redoBtn = dockEl.querySelector<HTMLButtonElement>(".CustomizeRedoBtn");
    if (undoBtn) undoBtn.disabled = undoStack.length === 0;
    if (redoBtn) redoBtn.disabled = redoStack.length === 0;
  }

  // --------------------------------------------------------------------------
  // LyricsContainer & NowBar ResizeObservers
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

  const nowBarObserver =
    typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => {
          const el = getNowBar();
          const inst = currentProfile?.widgets?.find(
            (w) => w.widget_type === "nowbar"
          );
          if (el && inst) {
            applyNowBarResponsiveClasses(el, inst);
          }
        })
      : null;

  const initialNowBarEl = getNowBar();
  if (initialNowBarEl && nowBarObserver) {
    nowBarObserver.observe(initialNowBarEl);
  }

  function applyNowBarResponsiveClasses(
    el: HTMLElement,
    instance: WidgetInstance
  ) {
    const cfg = instance.config || {};
    const centerWhenNoLyrics = cfg.center_when_no_lyrics !== false;
    el.classList.toggle("NowBar--keep-position", !centerWhenNoLyrics);

    const rect = el.getBoundingClientRect();
    const widthPx = rect.width > 0 ? rect.width : instance.w * 64;
    const heightPx = rect.height > 0 ? rect.height : instance.h * 64;
    const dims = classifyWidgetDimensions(
      instance.w,
      instance.h,
      widthPx,
      heightPx
    );

    const rawMode = cfg.layout_mode || "auto";
    let mode: "vertical_full" | "vertical_compact" | "horizontal_bar" | "cover_only" =
      "vertical_full";

    if (
      rawMode === "vertical_full" ||
      rawMode === "vertical_compact" ||
      rawMode === "horizontal_bar" ||
      rawMode === "cover_only"
    ) {
      mode = rawMode;
    } else if (dims.cols <= 4 && dims.rows <= 4) {
      mode = "cover_only";
    } else if (dims.aspectRatio > 1.45 && dims.rows <= 5) {
      mode = "horizontal_bar";
    } else if (dims.rows <= 6 || dims.heightPx < 280) {
      mode = "vertical_compact";
    } else {
      mode = "vertical_full";
    }

    el.classList.toggle("NowBar--layout-horizontal", mode === "horizontal_bar");
    el.classList.toggle("NowBar--layout-compact", mode === "vertical_compact");
    el.classList.toggle("NowBar--layout-cover-only", mode === "cover_only");

    const resolveVis = (
      val: unknown,
      autoDefault: boolean
    ): boolean => {
      const norm = normalizeVisibility(val, "auto");
      if (norm === "show") return true;
      if (norm === "hide") return false;
      return autoDefault;
    };

    const showCover = resolveVis(cfg.show_cover, true);
    const showTimeline = resolveVis(
      cfg.show_timeline,
      mode === "vertical_full" || (mode === "horizontal_bar" && dims.cols >= 8)
    );
    const showTitle = resolveVis(cfg.show_title, mode !== "cover_only");
    const showArtist = resolveVis(cfg.show_artist, mode !== "cover_only");

    el.classList.toggle("NowBar--hide-cover", !showCover);
    el.classList.toggle("NowBar--hide-timeline", !showTimeline);
    el.classList.toggle("NowBar--hide-title", !showTitle);
    el.classList.toggle("NowBar--hide-artist", !showArtist);
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

    const zIndex =
      typeof instance.config?.z_index === "number"
        ? instance.config.z_index
        : getDefaultWidgetZIndex(instance.widget_type);
    el.style.zIndex = String(zIndex);

    el.dataset.widgetId = instance.id;
    el.dataset.widgetType = instance.widget_type;
    el.dataset.gridW = String(instance.w);
    el.dataset.gridH = String(instance.h);

    el.classList.add("KioskGridWidget");
    el.classList.remove("KioskWidget--hidden");
    el.classList.toggle(
      "KioskGridWidget--selected",
      inEditMode && selectedWidgetId === instance.id
    );

    if (instance.widget_type === "nowbar") {
      applyNowBarResponsiveClasses(el, instance);
    } else if (instance.widget_type === "lyrics") {
      const fullBleed = instance.config?.full_height_bleed !== false;
      el.classList.toggle("LyricsContainer--bleed-vertical", fullBleed);

      const fontScale =
        typeof instance.config?.font_scale === "number"
          ? Math.max(0.6, Math.min(1.6, instance.config.font_scale))
          : 1.0;
      el.style.setProperty("--CustomLyricsScale", String(fontScale));

      const fadeMask = instance.config?.fade_mask || "standard";
      el.dataset.fadeMask = fadeMask;
    } else if (instance.widget_type === "clock") {
      options.clockController?.updateConfig(instance.config || {});
    } else if (instance.widget_type === "up_next") {
      options.upNextController?.updateConfig(instance.config || {});
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
  // Aspect Ratio Preview Stage (Edit Mode)
  // --------------------------------------------------------------------------
  let aspectBadgeEl: HTMLElement | null = null;

  function updateAspectPreviewStage() {
    const pageRoot = getPageRoot();
    if (!inEditMode) {
      pageRoot.classList.remove("EditAspectStageActive");
      pageRoot.style.removeProperty("--edit-stage-w");
      pageRoot.style.removeProperty("--edit-stage-h");
      aspectBadgeEl?.remove();
      aspectBadgeEl = null;
      return;
    }

    const vw = typeof window !== "undefined" ? window.innerWidth || 1920 : 1920;
    const vh = typeof window !== "undefined" ? window.innerHeight || 1080 : 1080;
    const screenInfo = detectScreenAspectRatio(vw, vh);

    const effectivePreset =
      previewAspectPreset === "auto"
        ? currentProfile?.target_aspect_ratio &&
          currentProfile.target_aspect_ratio !== "any"
          ? currentProfile.target_aspect_ratio
          : "auto"
        : previewAspectPreset;

    const targetNumericRatio = parseAspectRatio(effectivePreset);

    if (
      targetNumericRatio !== null &&
      Math.abs(targetNumericRatio - screenInfo.ratio) > 0.02
    ) {
      const stage = computePreviewStageDimensions(
        vw,
        vh - 76, // leave room for bottom dock
        targetNumericRatio
      );
      pageRoot.classList.add("EditAspectStageActive");
      pageRoot.style.setProperty("--edit-stage-w", `${stage.widthPx}px`);
      pageRoot.style.setProperty("--edit-stage-h", `${stage.heightPx}px`);
    } else {
      pageRoot.classList.remove("EditAspectStageActive");
      pageRoot.style.removeProperty("--edit-stage-w");
      pageRoot.style.removeProperty("--edit-stage-h");
    }

    if (!aspectBadgeEl) {
      aspectBadgeEl = document.createElement("div");
      aspectBadgeEl.className = "EditAspectBadge";
      document.body.appendChild(aspectBadgeEl);
    }

    const previewLabel =
      effectivePreset === "auto" || effectivePreset === "any"
        ? `Match Screen (${screenInfo.presetId})`
        : effectivePreset;
    const profileTargetLabel =
      currentProfile?.target_aspect_ratio &&
      currentProfile.target_aspect_ratio !== "any"
        ? currentProfile.target_aspect_ratio
        : "Any Screen";

    aspectBadgeEl.textContent = `Screen: ${vw}×${vh} (${screenInfo.presetId}) · Preview: ${previewLabel} · Profile Target: ${profileTargetLabel}`;
  }

  function setPreviewAspectRatio(presetId: string) {
    previewAspectPreset = presetId || "auto";
    updateAspectPreviewStage();
    const sel = dockEl?.querySelector<HTMLSelectElement>(
      ".CustomizeAspectSelect"
    );
    if (sel && sel.value !== previewAspectPreset) {
      sel.value = previewAspectPreset;
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

    updateAspectPreviewStage();
    updateUndoRedoButtons();
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

    aspectBadgeEl?.remove();
    aspectBadgeEl = null;

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

  function selectWidget(widgetId: string | null) {
    selectedWidgetId = widgetId;
    const contentBox = getContentBox();
    contentBox.querySelectorAll<HTMLElement>(".KioskGridWidget").forEach((el) => {
      el.classList.toggle(
        "KioskGridWidget--selected",
        inEditMode && el.dataset.widgetId === selectedWidgetId
      );
    });
  }

  function changeWidgetLayer(instance: WidgetInstance, delta: number) {
    pushUndoState();
    const currentZ =
      typeof instance.config?.z_index === "number"
        ? instance.config.z_index
        : getDefaultWidgetZIndex(instance.widget_type);
    const nextZ = Math.max(1, Math.min(30, currentZ + delta));
    instance.config = {
      ...instance.config,
      z_index: nextZ,
    };
    renderGridWidgets();
  }

  // --------------------------------------------------------------------------
  // Widget Edit Chrome (Compact Interior Corner Pill + 8 Resize Handles + Shield)
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

    // Compact Interior Pill
    const header = document.createElement("div");
    header.className = "WidgetEditOverlay";

    const left = document.createElement("div");
    left.className = "WidgetEditHeaderLeft";
    left.innerHTML = `
      <span class="WidgetEditGrip">
        <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
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

    // Layer Up Button
    const layerUpBtn = document.createElement("button");
    layerUpBtn.className = "WidgetEditBtn WidgetEditBtn--layer-up";
    layerUpBtn.title = "Bring Forward (])";
    layerUpBtn.innerHTML = `↑`;
    layerUpBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      selectWidget(instance.id);
      changeWidgetLayer(instance, 1);
    });
    actions.appendChild(layerUpBtn);

    // Layer Down Button
    const layerDownBtn = document.createElement("button");
    layerDownBtn.className = "WidgetEditBtn WidgetEditBtn--layer-down";
    layerDownBtn.title = "Send Backward ([)";
    layerDownBtn.innerHTML = `↓`;
    layerDownBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      selectWidget(instance.id);
      changeWidgetLayer(instance, -1);
    });
    actions.appendChild(layerDownBtn);

    // ⚙ Settings Button
    const settingsBtn = document.createElement("button");
    settingsBtn.className = "WidgetEditBtn WidgetEditBtn--settings";
    settingsBtn.title = "Widget Settings";
    settingsBtn.innerHTML = `⚙`;
    settingsBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      selectWidget(instance.id);
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
    deleteBtn.title = "Delete (Del)";
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
    shield.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      selectWidget(instance.id);
      openWidgetSettingsModal(instance);
    });
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

    // Attach Drag Listeners (free placement — never pushes other widgets)
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
      .querySelectorAll(".KioskGridWidget--active, .KioskGridWidget--selected")
      .forEach((el) => {
        el.classList.remove("KioskGridWidget--active", "KioskGridWidget--selected");
      });
  }

  // --------------------------------------------------------------------------
  // Free-Placement Drag & Drop Handling (No Collision Pushing!)
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

      selectWidget(instance.id);

      const contentBox = getContentBox();
      const containerRect = contentBox.getBoundingClientRect();

      widgetEl.classList.add("KioskGridWidget--active", "KioskGridWidget--dragging");

      const startCoord = pointerToGridCoord(e.clientX, e.clientY, containerRect);
      const offsetCol = startCoord.col - instance.x;
      const offsetRow = startCoord.row - instance.y;

      const meta = WIDGET_METADATA_CATALOG[instance.widget_type];
      const minW = meta?.minW ?? 1;
      const minH = meta?.minH ?? 1;

      const origX = instance.x;
      const origY = instance.y;
      let currentTarget = {
        x: instance.x,
        y: instance.y,
        w: instance.w,
        h: instance.h,
      };

      function onPointerMove(moveEvent: PointerEvent) {
        moveEvent.preventDefault();
        const coord = pointerToGridCoord(
          moveEvent.clientX,
          moveEvent.clientY,
          containerRect
        );
        const rawTarget = {
          x: coord.col - offsetCol,
          y: coord.row - offsetRow,
          w: instance.w,
          h: instance.h,
        };

        currentTarget = clampWidgetRect(rawTarget, minW, minH);

        // Live preview on ghost element (always cyan — free overlapping is allowed!)
        if (ghostEl) {
          ghostEl.style.gridColumn = `${currentTarget.x} / span ${currentTarget.w}`;
          ghostEl.style.gridRow = `${currentTarget.y} / span ${currentTarget.h}`;
          ghostEl.classList.remove("GridGhostPreview--overlap");
          ghostEl.style.display = "block";
        }

        // Snap Guides
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

        widgetEl.classList.remove(
          "KioskGridWidget--active",
          "KioskGridWidget--dragging"
        );

        if (currentTarget.x !== origX || currentTarget.y !== origY) {
          pushUndoState();
          // Free placement: update ONLY the moved widget without pushing any other widgets
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
  // 8-Direction Resize Handling (Free Resizing — No Collision Pushing!)
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

      selectWidget(instance.id);

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
        const coord = pointerToGridCoord(
          moveEvent.clientX,
          moveEvent.clientY,
          containerRect
        );

        let newX = startX;
        let newY = startY;
        let newW = startW;
        let newH = startH;

        if (direction.includes("e")) {
          newW = Math.max(
            minW,
            Math.min(GRID_COLS - startX + 1, coord.col - startX + 1)
          );
        }
        if (direction.includes("s")) {
          newH = Math.max(
            minH,
            Math.min(GRID_ROWS - startY + 1, coord.row - startY + 1)
          );
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

        widgetEl.classList.remove("KioskGridWidget--active");

        if (
          currentTarget.x !== startX ||
          currentTarget.y !== startY ||
          currentTarget.w !== startW ||
          currentTarget.h !== startH
        ) {
          pushUndoState();
          instance.x = currentTarget.x;
          instance.y = currentTarget.y;
          instance.w = currentTarget.w;
          instance.h = currentTarget.h;
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
  // Widget CRUD Operations
  // --------------------------------------------------------------------------
  function duplicateWidget(source: WidgetInstance) {
    const meta = WIDGET_METADATA_CATALOG[source.widget_type];
    if (meta?.singleton) return;

    pushUndoState();
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
    selectedWidgetId = newId;
    renderGridWidgets();
  }

  function deleteWidget(instance: WidgetInstance) {
    const idx = currentProfile.widgets.findIndex((w) => w.id === instance.id);
    if (idx !== -1) {
      pushUndoState();
      currentProfile.widgets.splice(idx, 1);
      if (selectedWidgetId === instance.id) {
        selectedWidgetId = null;
      }
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

    pushUndoState();
    const slot = findOpenSlot(
      currentProfile.widgets,
      meta.defaultW,
      meta.defaultH
    );
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
    selectedWidgetId = newId;
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

    const div1 = document.createElement("div");
    div1.className = "CustomizeDockDivider";

    // Group 2: Profile Selector & Management
    const grp2 = document.createElement("div");
    grp2.className = "CustomizeDockGroup";

    const select = document.createElement("select");
    select.className = "CustomizeProfileSelect";
    select.title = "Active Layout Profile";
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

    const div2 = document.createElement("div");
    div2.className = "CustomizeDockDivider";

    // Group 3: Aspect Ratio Preview & Target Selector
    const grpAspect = document.createElement("div");
    grpAspect.className = "CustomizeDockGroup";

    const aspectSelect = document.createElement("select");
    aspectSelect.className = "CustomizeAspectSelect";
    aspectSelect.title = "Preview & Target Aspect Ratio";
    renderAspectSelectOptions(aspectSelect);
    aspectSelect.addEventListener("change", () => {
      const val = aspectSelect.value;
      if (val === "custom") {
        const customInput = window.prompt(
          "Enter custom aspect ratio (e.g. 5:3, 16:9, 32:9):",
          currentProfile.target_aspect_ratio &&
            currentProfile.target_aspect_ratio !== "any"
            ? currentProfile.target_aspect_ratio
            : "16:9"
        );
        if (customInput && parseAspectRatio(customInput) !== null) {
          const clean = customInput.trim();
          currentProfile.target_aspect_ratio = clean;
          setPreviewAspectRatio(clean);
          renderAspectSelectOptions(aspectSelect);
          renderProfileSelectOptions(select);
        } else {
          aspectSelect.value = previewAspectPreset;
        }
        return;
      }

      if (val === "auto") {
        currentProfile.target_aspect_ratio = "any";
        setPreviewAspectRatio("auto");
      } else {
        currentProfile.target_aspect_ratio = val;
        setPreviewAspectRatio(val);
      }
      renderProfileSelectOptions(select);
    });
    grpAspect.appendChild(aspectSelect);

    const divAspect = document.createElement("div");
    divAspect.className = "CustomizeDockDivider";

    // Group 4: Undo / Redo / Grid / Reset
    const grp3 = document.createElement("div");
    grp3.className = "CustomizeDockGroup";

    const undoBtn = document.createElement("button");
    undoBtn.className = "CustomizeDockBtn CustomizeUndoBtn";
    undoBtn.title = "Undo (Ctrl+Z)";
    undoBtn.innerHTML = `↶`;
    undoBtn.disabled = undoStack.length === 0;
    undoBtn.addEventListener("click", () => undo());
    grp3.appendChild(undoBtn);

    const redoBtn = document.createElement("button");
    redoBtn.className = "CustomizeDockBtn CustomizeRedoBtn";
    redoBtn.title = "Redo (Ctrl+Y)";
    redoBtn.innerHTML = `↷`;
    redoBtn.disabled = redoStack.length === 0;
    redoBtn.addEventListener("click", () => redo());
    grp3.appendChild(redoBtn);

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

    const div3 = document.createElement("div");
    div3.className = "CustomizeDockDivider";

    // Group 5: Save & Exit / Cancel
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
    dock.appendChild(grpAspect);
    dock.appendChild(divAspect);
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
      const ratioTag =
        p.target_aspect_ratio && p.target_aspect_ratio !== "any"
          ? ` [${p.target_aspect_ratio}]`
          : "";
      opt.textContent = `${p.name}${ratioTag}`;
      opt.selected = p.id === activeProfileId;
      selectEl.appendChild(opt);
    }
  }

  function renderAspectSelectOptions(selectEl: HTMLSelectElement) {
    selectEl.innerHTML = "";
    const curTarget =
      currentProfile?.target_aspect_ratio &&
      currentProfile.target_aspect_ratio !== "any"
        ? currentProfile.target_aspect_ratio
        : "auto";
    const activeVal =
      previewAspectPreset !== "auto" ? previewAspectPreset : curTarget;

    const autoOpt = document.createElement("option");
    autoOpt.value = "auto";
    autoOpt.textContent = "📐 Ratio: Any / Screen";
    autoOpt.selected = activeVal === "auto" || activeVal === "any";
    selectEl.appendChild(autoOpt);

    let matchedPreset = activeVal === "auto" || activeVal === "any";
    for (const preset of ASPECT_RATIO_PRESETS) {
      const opt = document.createElement("option");
      opt.value = preset.id;
      opt.textContent = `📐 ${preset.label}`;
      if (activeVal === preset.id) {
        opt.selected = true;
        matchedPreset = true;
      }
      selectEl.appendChild(opt);
    }

    if (!matchedPreset && activeVal) {
      const customActiveOpt = document.createElement("option");
      customActiveOpt.value = activeVal;
      customActiveOpt.textContent = `📐 Custom (${activeVal})`;
      customActiveOpt.selected = true;
      selectEl.appendChild(customActiveOpt);
    }

    const customPromptOpt = document.createElement("option");
    customPromptOpt.value = "custom";
    customPromptOpt.textContent = "📐 Custom Ratio...";
    selectEl.appendChild(customPromptOpt);
  }

  function switchProfile(profileId: string) {
    const target = layoutProfiles.find((p) => p.id === profileId);
    if (!target) return;

    activeProfileId = target.id;
    currentProfile = target;
    undoStack = [];
    redoStack = [];
    selectedWidgetId = null;

    if (
      currentProfile.target_aspect_ratio &&
      currentProfile.target_aspect_ratio !== "any"
    ) {
      previewAspectPreset = currentProfile.target_aspect_ratio;
    } else {
      previewAspectPreset = "auto";
    }

    const aspectSelect = dockEl?.querySelector<HTMLSelectElement>(
      ".CustomizeAspectSelect"
    );
    if (aspectSelect) renderAspectSelectOptions(aspectSelect);

    updateAspectPreviewStage();
    updateUndoRedoButtons();
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

    pushUndoState();
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
          <span class="WidgetCatalogSpanInfo">${meta.defaultW}×${meta.defaultH} cells (min ${meta.minW}×${meta.minH})</span>
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

    // Coordinates & Layer info
    const currentZ =
      typeof instance.config?.z_index === "number"
        ? instance.config.z_index
        : getDefaultWidgetZIndex(instance.widget_type);

    const infoRow = document.createElement("div");
    infoRow.style.cssText =
      "display: flex; align-items: center; justify-content: space-between; font-size: 11.5px; color: #94a3b8; padding-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.08);";
    infoRow.innerHTML = `
      <span>Grid: (${instance.x}, ${instance.y}) · Span: ${instance.w}×${instance.h}</span>
      <div style="display: flex; align-items: center; gap: 6px;">
        <span>Layer (Z: <strong class="ModalZBadge" style="color: #38bdf8;">${currentZ}</strong>)</span>
        <button type="button" class="WidgetEditBtn ModalLayerDownBtn" title="Send Backward">↓</button>
        <button type="button" class="WidgetEditBtn ModalLayerUpBtn" title="Bring Forward">↑</button>
      </div>
    `;
    const zBadge = infoRow.querySelector<HTMLElement>(".ModalZBadge")!;
    infoRow.querySelector(".ModalLayerDownBtn")!.addEventListener("click", () => {
      changeWidgetLayer(instance, -1);
      zBadge.textContent = String(instance.config.z_index);
    });
    infoRow.querySelector(".ModalLayerUpBtn")!.addEventListener("click", () => {
      changeWidgetLayer(instance, 1);
      zBadge.textContent = String(instance.config.z_index);
    });
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

    // NowBar specific settings
    if (instance.widget_type === "nowbar") {
      body.appendChild(buildNowBarSettingsForm(instance));
    } else if (instance.widget_type === "lyrics") {
      body.appendChild(buildLyricsSettingsForm(instance));
    } else if (instance.widget_type === "clock" && options.clockController) {
      const clockForm = options.clockController.renderSettingsForm(
        instance.config || {},
        (newCfg) => {
          instance.config = { ...instance.config, ...newCfg };
          renderGridWidgets();
        }
      );
      body.appendChild(clockForm);
    } else if (instance.widget_type === "up_next" && options.upNextController) {
      const upNextForm = options.upNextController.renderSettingsForm(
        instance.config || {},
        (newCfg) => {
          instance.config = { ...instance.config, ...newCfg };
          renderGridWidgets();
        }
      );
      body.appendChild(upNextForm);
    } else {
      // Dynamic widget settings form
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

  function buildNowBarSettingsForm(instance: WidgetInstance): HTMLElement {
    const wrap = document.createElement("div");
    wrap.style.cssText = "display: flex; flex-direction: column; gap: 14px;";

    const cfg = instance.config || {};
    const curLayout = cfg.layout_mode || "auto";

    const modeGroup = document.createElement("div");
    modeGroup.innerHTML = `
      <label class="StudioFormLabel" style="display: block; margin-bottom: 6px;">Display Layout Mode</label>
      <select class="StudioFormSelect" style="width: 100%; background: rgba(15, 23, 42, 0.85);">
        <option value="auto" ${curLayout === "auto" ? "selected" : ""}>Auto (Smart Responsive)</option>
        <option value="vertical_full" ${curLayout === "vertical_full" ? "selected" : ""}>Vertical Full (Cover + Timeline + Title)</option>
        <option value="vertical_compact" ${curLayout === "vertical_compact" ? "selected" : ""}>Vertical Compact (Cover + Title)</option>
        <option value="horizontal_bar" ${curLayout === "horizontal_bar" ? "selected" : ""}>Horizontal Bar (Side-by-Side Strip)</option>
        <option value="cover_only" ${curLayout === "cover_only" ? "selected" : ""}>Album Cover Only</option>
      </select>
    `;
    const modeSel = modeGroup.querySelector("select")!;
    modeSel.addEventListener("change", () => {
      instance.config = { ...instance.config, layout_mode: modeSel.value };
      renderGridWidgets();
    });
    wrap.appendChild(modeGroup);

    function addVisRow(label: string, key: string) {
      const row = document.createElement("div");
      row.style.cssText =
        "display: flex; align-items: center; justify-content: space-between; gap: 10px;";
      const curVal = normalizeVisibility(instance.config?.[key], "auto");
      row.innerHTML = `
        <span style="font-size: 0.84rem; color: #cbd5e1;">${label}</span>
        <select style="padding: 5px 8px; border-radius: 6px; background: rgba(15, 23, 42, 0.85); border: 1px solid rgba(255, 255, 255, 0.15); color: #fff; font-size: 0.82rem;">
          <option value="auto" ${curVal === "auto" ? "selected" : ""}>Auto (Smart)</option>
          <option value="show" ${curVal === "show" ? "selected" : ""}>Always Show</option>
          <option value="hide" ${curVal === "hide" ? "selected" : ""}>Always Hide</option>
        </select>
      `;
      const sel = row.querySelector("select")!;
      sel.addEventListener("change", () => {
        instance.config = { ...instance.config, [key]: sel.value };
        renderGridWidgets();
      });
      wrap.appendChild(row);
    }

    addVisRow("Album Cover Art", "show_cover");
    addVisRow("Playback Timeline & Progress", "show_timeline");
    addVisRow("Track Title", "show_title");
    addVisRow("Artist Name", "show_artist");

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
    wrap.appendChild(centerRow);

    return wrap;
  }

  function buildLyricsSettingsForm(instance: WidgetInstance): HTMLElement {
    const wrap = document.createElement("div");
    wrap.style.cssText = "display: flex; flex-direction: column; gap: 14px;";

    const fullBleed = instance.config?.full_height_bleed !== false;
    const bleedRow = document.createElement("div");
    bleedRow.className = "StudioToggleRow";
    bleedRow.innerHTML = `
      <div>
        <div class="StudioToggleLabel">Full Screen Vertical Bleed (Bottom-to-Top)</div>
        <div style="font-size: 11px; color: #94a3b8;">Extend lyrics edge-to-edge vertically (0 to 100vh) for full scrolling effect</div>
      </div>
      <label class="StudioSwitch">
        <input type="checkbox" ${fullBleed ? "checked" : ""}>
        <span class="StudioSlider"></span>
      </label>
    `;
    const bleedInput = bleedRow.querySelector("input")!;
    bleedInput.addEventListener("change", () => {
      instance.config = {
        ...instance.config,
        full_height_bleed: bleedInput.checked,
      };
      renderGridWidgets();
    });
    wrap.appendChild(bleedRow);

    // Font Scale Slider
    const curScale =
      typeof instance.config?.font_scale === "number"
        ? instance.config.font_scale
        : 1.0;
    const scaleGroup = document.createElement("div");
    scaleGroup.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
        <label class="StudioFormLabel">Lyrics Font Size Scale</label>
        <span class="LyricsScaleBadge" style="font-size: 0.8rem; font-weight: 600; color: #38bdf8;">${Math.round(
          curScale * 100
        )}%</span>
      </div>
      <input type="range" min="0.6" max="1.6" step="0.05" value="${curScale}" style="width: 100%; accent-color: #38bdf8; cursor: pointer;" />
    `;
    const scaleRange = scaleGroup.querySelector("input")!;
    const scaleBadge = scaleGroup.querySelector(".LyricsScaleBadge")!;
    scaleRange.addEventListener("input", () => {
      const val = parseFloat(scaleRange.value);
      scaleBadge.textContent = `${Math.round(val * 100)}%`;
      instance.config = { ...instance.config, font_scale: val };
      renderGridWidgets();
    });
    wrap.appendChild(scaleGroup);

    // Top/Bottom Fade Mask Selector
    const curMask = instance.config?.fade_mask || "standard";
    const maskGroup = document.createElement("div");
    maskGroup.innerHTML = `
      <label class="StudioFormLabel" style="display: block; margin-bottom: 6px;">Top / Bottom Edge Fade Mask</label>
      <select class="StudioFormSelect" style="width: 100%; background: rgba(15, 23, 42, 0.85);">
        <option value="standard" ${curMask === "standard" ? "selected" : ""}>Standard Smooth Fade</option>
        <option value="small" ${curMask === "small" ? "selected" : ""}>Subtle Edge Fade</option>
        <option value="large" ${curMask === "large" ? "selected" : ""}>Deep Cinema Fade</option>
        <option value="none" ${curMask === "none" ? "selected" : ""}>None (Sharp Edges)</option>
      </select>
    `;
    const maskSel = maskGroup.querySelector("select")!;
    maskSel.addEventListener("change", () => {
      instance.config = { ...instance.config, fade_mask: maskSel.value };
      renderGridWidgets();
    });
    wrap.appendChild(maskGroup);

    return wrap;
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
      <h3>Create New Layout Profile</h3>
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
      <input type="text" class="StudioFormInput" placeholder="e.g. Raspberry Pi 800×480, Living Room TV..." />
    `;
    body.appendChild(formGroup);

    const ratioGroup = document.createElement("div");
    ratioGroup.className = "StudioFormGroup";
    ratioGroup.innerHTML = `
      <label class="StudioFormLabel">Target Aspect Ratio (Auto-selected on matching displays)</label>
      <select class="StudioFormSelect NewProfileRatioSelect" style="background: rgba(15, 23, 42, 0.85);">
        <option value="any">Any Screen (Universal)</option>
        ${ASPECT_RATIO_PRESETS.map(
          (p) => `<option value="${p.id}">${p.label}</option>`
        ).join("")}
      </select>
    `;
    body.appendChild(ratioGroup);

    const input = formGroup.querySelector("input")!;
    const ratioSelect = ratioGroup.querySelector<HTMLSelectElement>(
      ".NewProfileRatioSelect"
    )!;
    if (previewAspectPreset !== "auto" && previewAspectPreset !== "any") {
      ratioSelect.value = previewAspectPreset;
    }

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
      const targetRatio = ratioSelect.value || "any";

      const newProfile: LayoutProfile = {
        id: newId,
        name,
        target_aspect_ratio: targetRatio,
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
    const clockActive = currentProfile.widgets.some(
      (w) => w.widget_type === "clock"
    );
    const upNextActive = currentProfile.widgets.some(
      (w) => w.widget_type === "up_next"
    );
    const nowbarActive = currentProfile.widgets.some(
      (w) => w.widget_type === "nowbar"
    );

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
    undoStack = [];
    redoStack = [];

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
    selectedWidgetId = null;
    getPageRoot().classList.remove("EditModeActive", "EditAspectStageActive");
    getPageRoot().style.removeProperty("--edit-stage-w");
    getPageRoot().style.removeProperty("--edit-stage-h");

    unmountStudioOverlays();
    unmountAllWidgetEditChrome();

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
      // or lyrics was at y=1, h=11 without full_height_bleed
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
        const defLyrics = defProf.widgets.find(
          (w) => w.widget_type === "lyrics" && w.y === 1 && w.h === 11
        );
        if (defLyrics) {
          defLyrics.h = 12;
          defLyrics.config = {
            full_height_bleed: true,
            ...(defLyrics.config || {}),
          };
        }
      }
    } else {
      layoutProfiles = JSON.parse(JSON.stringify(DEFAULT_LAYOUT_PROFILES));
    }

    if (settings.active_profile_id) {
      activeProfileId = settings.active_profile_id;
    }

    // In live mode, auto-select profile with closest matching target_aspect_ratio if enabled
    const vw = typeof window !== "undefined" ? window.innerWidth || 1920 : 1920;
    const vh = typeof window !== "undefined" ? window.innerHeight || 1080 : 1080;
    const screenRatio = vw / Math.max(1, vh);
    const autoSwitch = settings.auto_switch_aspect_ratio !== false;

    const bestProfile = !inEditMode
      ? findBestProfileForAspectRatio(
          layoutProfiles,
          activeProfileId,
          screenRatio,
          autoSwitch
        )
      : null;

    currentProfile =
      bestProfile ||
      layoutProfiles.find((p) => p.id === activeProfileId) ||
      layoutProfiles[0] ||
      DEFAULT_LAYOUT_PROFILES[0];

    activeProfileId = currentProfile.id;

    renderGridWidgets();
  }

  function onStateUpdate(state: AppStateSnapshot): void {
    latestState = state;
    for (const item of dynamicWidgets.values()) {
      item.mounted.onStateUpdate?.(state);
    }
  }

  // --------------------------------------------------------------------------
  // Keyboard Shortcuts, Precision Nudging & URL Boot Trigger
  // --------------------------------------------------------------------------
  if (typeof window !== "undefined") {
    window.addEventListener("resize", () => {
      if (inEditMode) {
        updateAspectPreviewStage();
      } else if (
        currentSettings &&
        currentSettings.auto_switch_aspect_ratio !== false
      ) {
        const vw = window.innerWidth || 1920;
        const vh = window.innerHeight || 1080;
        const best = findBestProfileForAspectRatio(
          layoutProfiles,
          activeProfileId,
          vw / Math.max(1, vh),
          true
        );
        if (best && best.id !== currentProfile.id) {
          currentProfile = best;
          activeProfileId = best.id;
          renderGridWidgets();
        }
      }
    });

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

      if (isTypingInInput(e.target)) return;

      // Toggle Edit Mode with 'E'
      if (
        (e.key === "e" || e.key === "E") &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey
      ) {
        e.preventDefault();
        if (inEditMode) {
          exitEditMode(true);
        } else {
          enterEditMode();
        }
        return;
      }

      if (!inEditMode || modalBackdropEl) return;

      // Undo / Redo shortcuts
      if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "y" || e.key === "Y")) {
        e.preventDefault();
        redo();
        return;
      }

      // Selected widget keyboard precision controls
      if (!selectedWidgetId) return;
      const inst = currentProfile.widgets.find((w) => w.id === selectedWidgetId);
      if (!inst) return;

      const meta = WIDGET_METADATA_CATALOG[inst.widget_type];
      const minW = meta?.minW ?? 1;
      const minH = meta?.minH ?? 1;

      if (
        e.key === "ArrowLeft" ||
        e.key === "ArrowRight" ||
        e.key === "ArrowUp" ||
        e.key === "ArrowDown"
      ) {
        e.preventDefault();
        pushUndoState();
        const dx = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
        const dy = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;

        if (e.shiftKey) {
          const clamped = clampWidgetRect(
            { x: inst.x, y: inst.y, w: inst.w + dx, h: inst.h + dy },
            minW,
            minH
          );
          inst.w = clamped.w;
          inst.h = clamped.h;
        } else {
          const clamped = clampWidgetRect(
            { x: inst.x + dx, y: inst.y + dy, w: inst.w, h: inst.h },
            minW,
            minH
          );
          inst.x = clamped.x;
          inst.y = clamped.y;
        }
        renderGridWidgets();
      } else if (e.key === "[") {
        e.preventDefault();
        changeWidgetLayer(inst, -1);
      } else if (e.key === "]") {
        e.preventDefault();
        changeWidgetLayer(inst, 1);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteWidget(inst);
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
    undo,
    redo,
    selectWidget,
    getSelectedWidgetId: () => selectedWidgetId,
    getActiveProfile: () => currentProfile,
    setPreviewAspectRatio,
  };
}
