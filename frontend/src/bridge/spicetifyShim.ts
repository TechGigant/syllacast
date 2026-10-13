/*
 * Syllacast - Standalone Spotify Lyrics Kiosk
 * Bridge adapter for Spicetify / Spotify APIs
 *
 * Copyright (C) 2026 TechGigant
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

let currentVolumeLevel = 1.0;
let currentShuffleState = false;
let currentRepeatMode = 0; // 0: off, 1: context, 2: track
let volumeDebounceTimer: ReturnType<typeof setTimeout> | null = null;

export function setShimVolume(level: number) {
  currentVolumeLevel = Math.max(0, Math.min(1, level));
}

export function setShimShuffle(enabled: boolean) {
  currentShuffleState = enabled;
  if (Spicetify.Player.origin?._state) {
    Spicetify.Player.origin._state.shuffle = enabled;
  }
}

export function setShimRepeat(mode: number | string) {
  if (typeof mode === "string") {
    currentRepeatMode = mode === "track" ? 2 : mode === "context" ? 1 : 0;
  } else {
    currentRepeatMode = mode;
  }
}

let shimProgressGetter: (() => number) | null = null;
export function setShimProgressGetter(fn: () => number) {
  shimProgressGetter = fn;
}

let shimCommandSender: ((cmd: any) => void) | null = null;
export function setShimCommandSender(fn: (cmd: any) => void) {
  shimCommandSender = fn;
}

export function sendPlayerCommand(cmd: any) {
  if (shimCommandSender) {
    shimCommandSender(cmd);
  }
}

// Spicetify Platform Compatibility Shim for Syllacast
export const Spicetify = {
  LocalStorage: {
    get: (key: string): string | null => {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set: (key: string, val: string): void => {
      try {
        localStorage.setItem(key, val);
      } catch {}
    },
  },
  Player: {
    data: {
      item: {
        id: "",
        name: "",
        uri: "",
        type: "track",
        mediaType: "audio",
        duration: { milliseconds: 0 },
        artists: [] as Array<{ name: string; uri: string; type: "artist" }>,
        images: [] as Array<{ label: string; url: string }>,
        metadata: { album_title: "" },
      },
      track: {
        uri: "",
      },
    },
    isPlaying: (): boolean => false,
    getProgress: (): number => (shimProgressGetter ? shimProgressGetter() : 0),
    pause: () => sendPlayerCommand({ type: "pause" }),
    play: () => sendPlayerCommand({ type: "play" }),
    togglePlay: () => sendPlayerCommand({ type: "toggle_play" }),
    next: () => sendPlayerCommand({ type: "skip_next" }),
    back: () => sendPlayerCommand({ type: "skip_prev" }),
    seek: (position: number) => sendPlayerCommand({ type: "seek", position_ms: Math.round(position) }),
    setRepeat: (mode: number) => {
      currentRepeatMode = mode;
      const strMode = mode === 2 ? "track" : mode === 1 ? "context" : "off";
      sendPlayerCommand({ type: "set_repeat", mode: strMode });
    },
    setShuffle: (mode: boolean) => {
      currentShuffleState = mode;
      if (Spicetify.Player.origin?._state) {
        Spicetify.Player.origin._state.shuffle = mode;
      }
      sendPlayerCommand({ type: "set_shuffle", enabled: mode });
    },
    setVolume: (level: number) => {
      currentVolumeLevel = Math.max(0, Math.min(1, level));
      if (volumeDebounceTimer) {
        clearTimeout(volumeDebounceTimer);
      }
      volumeDebounceTimer = setTimeout(() => {
        sendPlayerCommand({ type: "set_volume", volume: Math.round(currentVolumeLevel * 100) });
        volumeDebounceTimer = null;
      }, 40);
    },
    origin: {
      seekTo: (position: number) => sendPlayerCommand({ type: "seek", position_ms: Math.round(position) }),
      _state: {
        smartShuffle: false,
        shuffle: false,
      },
    },
    getRepeat: (): number => currentRepeatMode,
    getShuffle: (): boolean => currentShuffleState,
    getVolume: (): number => currentVolumeLevel,
    getHeart: (): boolean => false,
    setMute: (_mute: boolean) => {},
    addEventListener: (event: string, callback: (e: any) => void) => {
      window.addEventListener(`spicetify:${event}`, (e: any) => callback(e.detail));
    },
    removeEventListener: (event: string, callback: (e: any) => void) => {
      window.removeEventListener(`spicetify:${event}`, (e: any) => callback(e.detail));
    },
    dispatchEvent: (event: string, detail?: any) => {
      window.dispatchEvent(new CustomEvent(`spicetify:${event}`, { detail }));
    },
  },
  CosmosAsync: {
    get: async () => ({}),
    post: async () => ({}),
  },
  Platform: {
    version: "1.2.0",
    History: {
      location: { pathname: "/SpicyLyrics" },
      listen: (_cb: any) => () => {},
      push: (_data: any) => {},
      goBack: () => {},
    },
    AuthorizationAPI: {
      getState: () => ({ isAuthorized: true, token: { accessToken: "dummy" } }),
    },
    PlaybackAPI: {
      _isLocal: false,
      _events: { addListener: () => {} },
    },
    PlayerAPI: {
      _contextPlayer: {
        getPositionState: async () => ({ position: 0 }),
        resume: async () => {},
      },
      _state: {
        positionAsOfTimestamp: 0,
        timestamp: 0,
      },
    },
  },
  Tippy: (_target: any, _props: any) => ({
    destroy: () => {},
    setContent: () => {},
    setProps: () => {},
  }),
  TippyProps: {},
  colorExtractor: async () => ({ VIBRANT_NON_ALARMING: "#999999" }),
  Keyboard: {
    KEYS: { ESCAPE: 27 },
    registerImportantShortcut: () => {},
  },
};

// Assign to globalThis and window before any module reads Spicetify
if (typeof globalThis !== "undefined") {
  (globalThis as any).Spicetify = Spicetify;
}
if (typeof window !== "undefined") {
  (window as any).Spicetify = Spicetify;
}
