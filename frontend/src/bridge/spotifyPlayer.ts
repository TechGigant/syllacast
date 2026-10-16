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

import { Spicetify, setShimVolume, setShimShuffle, setShimRepeat } from "./spicetifyShim.ts";
import { SpotifyPlayer } from "../spicy/components/Global/SpotifyPlayer.ts";
import Global from "../spicy/components/Global/Global.ts";

export interface TrackMetadata {
  id: string;
  uri: string;
  title: string;
  artist: string;
  album: string;
  cover_url?: string;
  duration_ms: number;
}

import type { PositionAnchor } from "../sync/timeline.ts";

export interface QueueItemDto {
  title: string;
  artist: string;
  cover_url?: string;
  uri?: string;
  duration_ms?: number;
}

export interface AppStateSnapshot {
  is_playing: boolean;
  status: string;
  track?: TrackMetadata;
  position?: PositionAnchor;
  queue_upcoming: QueueItemDto[];
  queue_history?: QueueItemDto[];
  lyrics?: any;
  lyrics_status?: "idle" | "loading" | "found" | "not_found" | "error" | string;
  volume?: number;
  shuffle?: boolean;
  repeat?: string;
}

let lastTrackUri: string | null = null;
let lastIsPlaying: boolean | null = null;
let lastVolume: number | null = null;
let lastShuffle: boolean | null = null;
let lastRepeat: string | null = null;

export function updateSpotifyPlayerState(state: AppStateSnapshot): { songChanged: boolean; playPauseChanged: boolean } {
  let songChanged = false;
  let playPauseChanged = false;

  if (state.track) {
    const track = state.track;
    const coverUrl = track.cover_url || "";

    Spicetify.Player.data.item = {
      id: track.id,
      name: track.title,
      uri: track.uri,
      type: "track",
      mediaType: "audio",
      duration: { milliseconds: track.duration_ms },
      artists: [{ name: track.artist, uri: `spotify:artist:${track.artist}`, type: "artist" }],
      images: [
        { label: "small", url: coverUrl },
        { label: "large", url: coverUrl },
        { label: "xlarge", url: coverUrl },
      ],
      metadata: { album_title: track.album },
    };

    Spicetify.Player.data.track = {
      uri: track.uri,
    };

    if (track.uri !== lastTrackUri) {
      songChanged = true;
      lastTrackUri = track.uri;
    }
  } else {
    Spicetify.Player.data.item = {
      id: "",
      name: "Ready to Play",
      uri: "",
      type: "track",
      mediaType: "audio",
      duration: { milliseconds: 0 },
      artists: [{ name: "Play music to see lyrics", uri: "", type: "artist" }],
      images: [],
      metadata: { album_title: "" },
    };
    Spicetify.Player.data.track = { uri: "" };
    if (lastTrackUri !== "") {
      songChanged = true;
      lastTrackUri = "";
    }
  }

  Spicetify.Player.isPlaying = () => state.is_playing;
  SpotifyPlayer.IsPlaying = state.is_playing;

  if (state.is_playing !== lastIsPlaying) {
    playPauseChanged = true;
    lastIsPlaying = state.is_playing;
  }

  if (typeof state.volume === "number") {
    const volumeNorm = Math.max(0, Math.min(1, state.volume / 100.0));
    setShimVolume(volumeNorm);
    if (volumeNorm !== lastVolume) {
      lastVolume = volumeNorm;
      Global.Event.evoke("playback:volume", volumeNorm);
    }
  }

  if (typeof state.shuffle === "boolean") {
    setShimShuffle(state.shuffle);
    const shuffleType = state.shuffle ? "normal" : "none";
    SpotifyPlayer.ShuffleType = shuffleType;
    if (state.shuffle !== lastShuffle) {
      lastShuffle = state.shuffle;
      Global.Event.evoke("playback:shuffle", shuffleType);
    }
  }

  if (typeof state.repeat === "string") {
    setShimRepeat(state.repeat);
    const loopType = state.repeat === "track" ? "track" : state.repeat === "context" ? "context" : "none";
    SpotifyPlayer.LoopType = loopType;
    if (state.repeat !== lastRepeat) {
      lastRepeat = state.repeat;
      Global.Event.evoke("playback:loop", loopType);
    }
  }

  return { songChanged, playPauseChanged };
}
