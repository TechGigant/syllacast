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

import type { AppStateSnapshot, QueueItemDto } from "../../bridge/spotifyPlayer.ts";

export type WidgetType =
  | "lyrics"
  | "nowbar"
  | "clock"
  | "up_next"
  | "player_controls"
  | "iframe"
  | "visualizer"
  | "weather"
  | "extended_queue"
  | "note";

export interface WidgetInstance {
  id: string;
  widget_type: WidgetType;
  x: number; // 1..24
  y: number; // 1..12
  w: number; // 1..24
  h: number; // 1..12
  show_glass: boolean;
  config: Record<string, any>;
}

export interface LayoutProfile {
  id: string;
  name: string;
  target_aspect_ratio?: string; // e.g. "any", "16:9", "16:10", "5:3", "4:3", "21:9", "9:16", "1:1"
  widgets: WidgetInstance[];
}

export interface WidgetMetadata {
  type: WidgetType;
  title: string;
  description: string;
  iconSvg: string;
  singleton: boolean;
  defaultW: number;
  defaultH: number;
  minW: number;
  minH: number;
  defaultShowGlass: boolean;
  defaultConfig: Record<string, any>;
}

export interface WidgetContext {
  getInterpolatedPositionMs: () => number;
  sendCommand: (cmd: Record<string, any>) => void;
  getLatestState: () => AppStateSnapshot | null;
}

export interface MountedWidget {
  element: HTMLElement;
  updateConfig: (config: Record<string, any>) => void;
  onStateUpdate?: (state: AppStateSnapshot) => void;
  destroy: () => void;
  renderSettingsForm?: (
    currentConfig: Record<string, any>,
    onChange: (newConfig: Record<string, any>) => void
  ) => HTMLElement;
}

export type ElementVisibility = "auto" | "show" | "hide";
export type WidgetSizeTier = "tiny" | "compact" | "standard" | "expanded";
export type WidgetOrientation = "horizontal" | "vertical" | "square";

export interface WidgetDimensionClassification {
  sizeTier: WidgetSizeTier;
  orientation: WidgetOrientation;
  aspectRatio: number;
  cols: number;
  rows: number;
  widthPx: number;
  heightPx: number;
  isCompactWidth: boolean;
  isCompactHeight: boolean;
  isWide: boolean;
  isTall: boolean;
}

/**
 * Classifies a widget's dimensions (in pixels and grid spans) into a semantic
 * size tier and orientation for smart responsive element adaptation.
 */
export function classifyWidgetDimensions(
  arg1: number,
  arg2: number,
  arg3 = 6,
  arg4 = 3
): WidgetDimensionClassification {
  // Detect whether caller passed (cols, rows, widthPx, heightPx) or (widthPx, heightPx, cols, rows)
  let cols: number;
  let rows: number;
  let widthPx: number;
  let heightPx: number;

  if (arg1 <= 24 && arg2 <= 12 && (arg3 > 24 || arg4 > 12)) {
    cols = Math.max(1, arg1);
    rows = Math.max(1, arg2);
    widthPx = arg3;
    heightPx = arg4;
  } else {
    widthPx = arg1;
    heightPx = arg2;
    cols = Math.max(1, arg3);
    rows = Math.max(1, arg4);
  }

  const safeW = widthPx > 0 ? widthPx : cols * 64;
  const safeH = heightPx > 0 ? heightPx : rows * 68;
  const aspectRatio = safeW / Math.max(1, safeH);

  let orientation: WidgetOrientation = "square";
  if (aspectRatio >= 1.55 || (cols >= rows * 2 && rows <= 3)) {
    orientation = "horizontal";
  } else if (aspectRatio <= 0.72 || rows >= cols * 1.5) {
    orientation = "vertical";
  }

  const areaCells = cols * rows;
  let sizeTier: WidgetSizeTier = "standard";
  if (rows === 1 && cols <= 4) {
    sizeTier = "tiny";
  } else if (areaCells <= 6 || safeH < 95 || safeW < 150) {
    sizeTier = "tiny";
  } else if (areaCells <= 15 || safeH < 165 || safeW < 230) {
    sizeTier = "compact";
  } else if (areaCells >= 42 || (safeH >= 380 && safeW >= 380)) {
    sizeTier = "expanded";
  }

  return {
    sizeTier,
    orientation,
    aspectRatio,
    cols,
    rows,
    widthPx: safeW,
    heightPx: safeH,
    isCompactWidth: cols <= 3 || safeW < 180,
    isCompactHeight: rows <= 2 || safeH < 120,
    isWide: orientation === "horizontal",
    isTall: orientation === "vertical",
  };
}

/**
 * Returns the default Z-layer for a widget type so overlay widgets (Clock, Up Next,
 * Player Controls) naturally float above full-height Lyrics and NowBar cards.
 */
export function getDefaultWidgetZIndex(type: WidgetType): number {
  switch (type) {
    case "lyrics":
      return 2;
    case "nowbar":
    case "visualizer":
      return 4;
    case "weather":
    case "extended_queue":
    case "note":
    case "iframe":
      return 5;
    case "clock":
    case "up_next":
    case "player_controls":
      return 8;
    default:
      return 4;
  }
}

export const WIDGET_METADATA_CATALOG: Record<WidgetType, WidgetMetadata> = {
  nowbar: {
    type: "nowbar",
    title: "Now Playing",
    description: "Album art, track title, artist and playback info",
    iconSvg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/><line x1="12" y1="2" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22"/></svg>`,
    singleton: true,
    defaultW: 9,
    defaultH: 10,
    minW: 2,
    minH: 2,
    defaultShowGlass: false,
    defaultConfig: {
      layout_mode: "auto",
      show_cover: "auto",
      show_timeline: "auto",
      show_title: "auto",
      show_artist: "auto",
      center_when_no_lyrics: true,
    },
  },
  lyrics: {
    type: "lyrics",
    title: "Lyrics",
    description: "Syllable and line-synchronized scrolling lyrics",
    iconSvg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>`,
    singleton: true,
    defaultW: 12,
    defaultH: 12,
    minW: 4,
    minH: 2,
    defaultShowGlass: false,
    defaultConfig: {
      full_height_bleed: true,
      font_scale: 1.0,
      fade_mask: "auto",
    },
  },
  clock: {
    type: "clock",
    title: "Clock",
    description: "Digital time display with current hours, minutes, seconds and date",
    iconSvg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
    singleton: true,
    defaultW: 3,
    defaultH: 1,
    minW: 1,
    minH: 1,
    defaultShowGlass: true,
    defaultConfig: {
      layout_mode: "auto",
      show_seconds: "auto",
      show_date: "auto",
      use_24h: true,
      alignment: "stretch",
    },
  },
  up_next: {
    type: "up_next",
    title: "Up Next",
    description: "Preview of upcoming queued tracks",
    iconSvg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/></svg>`,
    singleton: true,
    defaultW: 6,
    defaultH: 1,
    minW: 2,
    minH: 1,
    defaultShowGlass: true,
    defaultConfig: {
      layout_mode: "auto",
      show_cover: "auto",
      show_header: "auto",
      show_artist: "auto",
      alignment: "stretch",
    },
  },
  player_controls: {
    type: "player_controls",
    title: "Player Controls",
    description: "Playback transport, track seeking and volume control",
    iconSvg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 3 20 12 6 21 6 3"/><line x1="20" y1="4" x2="20" y2="20"/></svg>`,
    singleton: true,
    defaultW: 8,
    defaultH: 2,
    minW: 2,
    minH: 1,
    defaultShowGlass: true,
    defaultConfig: {
      layout_mode: "auto",
      show_seek_bar: "auto",
      show_seek_time: "auto",
      show_shuffle_repeat: "auto",
      show_prev: "auto",
      show_volume: "auto",
    },
  },
  visualizer: {
    type: "visualizer",
    title: "Audio Visualizer",
    description: "Dynamic beat and vocal-reactive frequency visualizer",
    iconSvg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`,
    singleton: true,
    defaultW: 9,
    defaultH: 3,
    minW: 2,
    minH: 1,
    defaultShowGlass: true,
    defaultConfig: {
      style: "bars",
      bar_count: 32,
      sensitivity: 1.0,
      color_mode: "cover_accent",
      mirror: false,
    },
  },
  weather: {
    type: "weather",
    title: "Weather",
    description: "Live weather conditions and 3-day local forecast",
    iconSvg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg>`,
    singleton: true,
    defaultW: 5,
    defaultH: 3,
    minW: 2,
    minH: 1,
    defaultShowGlass: true,
    defaultConfig: {
      location_name: "Berlin",
      latitude: 52.52,
      longitude: 13.41,
      unit: "celsius",
      layout_mode: "auto",
      show_location: "auto",
      show_condition: "auto",
      show_wind_humidity: "auto",
      show_forecast: true,
    },
  },
  extended_queue: {
    type: "extended_queue",
    title: "Queue & History",
    description: "Upcoming queued songs and recently played track history",
    iconSvg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`,
    singleton: true,
    defaultW: 7,
    defaultH: 6,
    minW: 2,
    minH: 2,
    defaultShowGlass: true,
    defaultConfig: {
      mode: "tabs",
      max_items: 8,
      show_header: "auto",
      show_covers: true,
      show_duration: "auto",
      click_to_play: true,
    },
  },
  iframe: {
    type: "iframe",
    title: "Web Embed / Iframe",
    description: "Custom web page, Home Assistant card, or dashboard iframe",
    iconSvg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="15" x="2" y="3" rx="2"/><polyline points="2 9 22 9"/><circle cx="5" cy="6" r="1"/><circle cx="8" cy="6" r="1"/></svg>`,
    singleton: false,
    defaultW: 8,
    defaultH: 5,
    minW: 2,
    minH: 2,
    defaultShowGlass: true,
    defaultConfig: {
      url: "",
      title: "Web Embed",
      zoom: 1.0,
      refresh_interval_sec: 0,
      allow_interaction: true,
    },
  },
  note: {
    type: "note",
    title: "Note & Wi-Fi QR",
    description: "Custom guest message, Wi-Fi credentials QR, or link card",
    iconSvg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 7h3v3H7z"/><path d="M14 7h3v3h-3z"/><path d="M7 14h3v3H7z"/><path d="M14 14h3v3h-3z"/></svg>`,
    singleton: false,
    defaultW: 5,
    defaultH: 4,
    minW: 2,
    minH: 2,
    defaultShowGlass: true,
    defaultConfig: {
      mode: "note",
      layout_mode: "auto",
      title: "Welcome",
      body_text: "Enjoy the music!",
      text_align: "center",
      wifi_ssid: "",
      wifi_password: "",
      wifi_encryption: "WPA",
      wifi_hidden: false,
      show_title: "auto",
      show_ssid_url: "auto",
      show_password_text: true,
      qr_url: "",
    },
  },
};

export const DEFAULT_LAYOUT_PROFILES: LayoutProfile[] = [
  {
    id: "default",
    name: "Standard Kiosk",
    target_aspect_ratio: "any",
    widgets: [
      {
        id: "nowbar-1",
        widget_type: "nowbar",
        x: 2,
        y: 2,
        w: 9,
        h: 10,
        show_glass: false,
        config: {},
      },
      {
        id: "lyrics-1",
        widget_type: "lyrics",
        x: 12,
        y: 1,
        w: 12,
        h: 12,
        show_glass: false,
        config: {
          full_height_bleed: true,
        },
      },
      {
        id: "up_next-1",
        widget_type: "up_next",
        x: 19,
        y: 12,
        w: 6,
        h: 1,
        show_glass: true,
        config: {},
      },
      {
        id: "clock-1",
        widget_type: "clock",
        x: 1,
        y: 1,
        w: 3,
        h: 1,
        show_glass: true,
        config: {},
      },
    ],
  },
  {
    id: "living_room_tv",
    name: "Living Room Hub",
    target_aspect_ratio: "any",
    widgets: [
      {
        id: "nowbar-1",
        widget_type: "nowbar",
        x: 1,
        y: 1,
        w: 8,
        h: 8,
        show_glass: true,
        config: {},
      },
      {
        id: "visualizer-1",
        widget_type: "visualizer",
        x: 1,
        y: 9,
        w: 8,
        h: 4,
        show_glass: true,
        config: {
          style: "bars",
          bar_count: 32,
          sensitivity: 1.0,
          color_mode: "cover_accent",
          mirror: false,
        },
      },
      {
        id: "lyrics-1",
        widget_type: "lyrics",
        x: 9,
        y: 1,
        w: 10,
        h: 12,
        show_glass: true,
        config: {},
      },
      {
        id: "weather-1",
        widget_type: "weather",
        x: 19,
        y: 1,
        w: 6,
        h: 3,
        show_glass: true,
        config: {
          location_name: "Berlin",
          latitude: 52.52,
          longitude: 13.41,
          unit: "celsius",
          show_forecast: true,
        },
      },
      {
        id: "extended_queue-1",
        widget_type: "extended_queue",
        x: 19,
        y: 4,
        w: 6,
        h: 5,
        show_glass: true,
        config: {
          mode: "tabs",
          max_items: 8,
          show_covers: true,
          click_to_play: true,
        },
      },
      {
        id: "note-1",
        widget_type: "note",
        x: 19,
        y: 9,
        w: 6,
        h: 4,
        show_glass: true,
        config: {
          mode: "wifi_qr",
          title: "Guest Wi-Fi",
          body_text: "Scan to connect",
          text_align: "center",
          wifi_ssid: "GuestNetwork",
          wifi_password: "WelcomeGuests",
          wifi_encryption: "WPA",
          wifi_hidden: false,
          show_password_text: true,
          qr_url: "",
        },
      },
    ],
  },
  {
    id: "party",
    name: "Party & Visualizer",
    target_aspect_ratio: "any",
    widgets: [
      {
        id: "nowbar-1",
        widget_type: "nowbar",
        x: 1,
        y: 1,
        w: 7,
        h: 7,
        show_glass: true,
        config: {},
      },
      {
        id: "extended_queue-1",
        widget_type: "extended_queue",
        x: 1,
        y: 8,
        w: 7,
        h: 5,
        show_glass: true,
        config: {
          mode: "tabs",
          max_items: 8,
          show_covers: true,
          click_to_play: true,
        },
      },
      {
        id: "lyrics-1",
        widget_type: "lyrics",
        x: 8,
        y: 1,
        w: 11,
        h: 9,
        show_glass: false,
        config: {},
      },
      {
        id: "visualizer-1",
        widget_type: "visualizer",
        x: 8,
        y: 10,
        w: 17,
        h: 3,
        show_glass: true,
        config: {
          style: "waves",
          bar_count: 32,
          sensitivity: 1.0,
          color_mode: "neon_gradient",
          mirror: false,
        },
      },
      {
        id: "note-1",
        widget_type: "note",
        x: 19,
        y: 1,
        w: 6,
        h: 5,
        show_glass: true,
        config: {
          mode: "note",
          title: "Party Rules",
          body_text: "Feel free to add songs to the queue!\nHave fun!",
          text_align: "center",
          wifi_ssid: "",
          wifi_password: "",
          wifi_encryption: "WPA",
          wifi_hidden: false,
          show_password_text: false,
          qr_url: "",
        },
      },
      {
        id: "player_controls-1",
        widget_type: "player_controls",
        x: 19,
        y: 6,
        w: 6,
        h: 4,
        show_glass: true,
        config: {},
      },
    ],
  },
  {
    id: "minimal",
    name: "Cinema Lyrics",
    target_aspect_ratio: "any",
    widgets: [
      {
        id: "lyrics-1",
        widget_type: "lyrics",
        x: 3,
        y: 1,
        w: 20,
        h: 12,
        show_glass: false,
        config: {
          full_height_bleed: true,
        },
      },
      {
        id: "clock-1",
        widget_type: "clock",
        x: 22,
        y: 1,
        w: 3,
        h: 1,
        show_glass: true,
        config: {},
      },
    ],
  },
];
