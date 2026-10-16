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

export const WIDGET_METADATA_CATALOG: Record<WidgetType, WidgetMetadata> = {
  nowbar: {
    type: "nowbar",
    title: "Now Playing",
    description: "Album art, track title, artist and playback info",
    iconSvg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/><line x1="12" y1="2" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22"/></svg>`,
    singleton: true,
    defaultW: 9,
    defaultH: 9,
    minW: 5,
    minH: 5,
    defaultShowGlass: false,
    defaultConfig: {},
  },
  lyrics: {
    type: "lyrics",
    title: "Lyrics",
    description: "Syllable and line-synchronized scrolling lyrics",
    iconSvg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>`,
    singleton: true,
    defaultW: 13,
    defaultH: 10,
    minW: 6,
    minH: 4,
    defaultShowGlass: false,
    defaultConfig: {},
  },
  clock: {
    type: "clock",
    title: "Clock",
    description: "Digital time display with current hours and minutes",
    iconSvg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
    singleton: true,
    defaultW: 3,
    defaultH: 1,
    minW: 2,
    minH: 1,
    defaultShowGlass: true,
    defaultConfig: {},
  },
  up_next: {
    type: "up_next",
    title: "Up Next",
    description: "Compact preview pill of the next queued track",
    iconSvg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/></svg>`,
    singleton: true,
    defaultW: 6,
    defaultH: 1,
    minW: 4,
    minH: 1,
    defaultShowGlass: true,
    defaultConfig: {},
  },
  player_controls: {
    type: "player_controls",
    title: "Player Controls",
    description: "Playback transport, track seeking and volume control",
    iconSvg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 3 20 12 6 21 6 3"/><line x1="20" y1="4" x2="20" y2="20"/></svg>`,
    singleton: true,
    defaultW: 8,
    defaultH: 2,
    minW: 5,
    minH: 2,
    defaultShowGlass: true,
    defaultConfig: {},
  },
  visualizer: {
    type: "visualizer",
    title: "Audio Visualizer",
    description: "Dynamic beat and vocal-reactive frequency visualizer",
    iconSvg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`,
    singleton: true,
    defaultW: 9,
    defaultH: 3,
    minW: 4,
    minH: 2,
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
    minW: 4,
    minH: 2,
    defaultShowGlass: true,
    defaultConfig: {
      location_name: "Berlin",
      latitude: 52.52,
      longitude: 13.41,
      unit: "celsius",
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
    minW: 5,
    minH: 4,
    defaultShowGlass: true,
    defaultConfig: {
      mode: "tabs",
      max_items: 8,
      show_covers: true,
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
    minW: 3,
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
    minW: 3,
    minH: 2,
    defaultShowGlass: true,
    defaultConfig: {
      mode: "note",
      title: "Welcome",
      body_text: "Enjoy the music!",
      text_align: "center",
      wifi_ssid: "",
      wifi_password: "",
      wifi_encryption: "WPA",
      wifi_hidden: false,
      show_password_text: true,
      qr_url: "",
    },
  },
};

export const DEFAULT_LAYOUT_PROFILES: LayoutProfile[] = [
  {
    id: "default",
    name: "Standard Kiosk",
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
        h: 11,
        show_glass: false,
        config: {},
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
    widgets: [
      {
        id: "lyrics-1",
        widget_type: "lyrics",
        x: 3,
        y: 1,
        w: 20,
        h: 12,
        show_glass: false,
        config: {},
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
