/*
 * Syllacast - Standalone Spotify Lyrics Kiosk
 * Portions derived from Spicy Lyrics (https://github.com/Spikerko/spicy-lyrics)
 *
 * Copyright (C) 2026 Spikerko
 * Copyright (C) 2026 TechGigant
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Define types for the event system
type EventCallback = (...args: any[]) => void;
type EventId = number;
type EventListeners = Map<EventId, EventCallback>;

const eventRegistry = new Map<string, EventListeners>();

let nextId = 1;

const listen = (eventName: string, callback: EventCallback): EventId => {
  if (!eventRegistry.has(eventName)) {
    eventRegistry.set(eventName, new Map());
  }

  const id = nextId++;
  const listeners = eventRegistry.get(eventName);
  if (listeners) {
    listeners.set(id, callback);
  }
  return id;
};

const unListen = (id: EventId): boolean => {
  for (const [eventName, listeners] of eventRegistry) {
    if (listeners.has(id)) {
      listeners.delete(id);
      if (listeners.size === 0) {
        eventRegistry.delete(eventName);
      }
      return true; // Listener removed
    }
  }
  return false; // Listener not found
};

const evoke = (eventName: string, ...args: any[]): void => {
  const listeners = eventRegistry.get(eventName);
  if (listeners) {
    for (const callback of listeners.values()) {
      callback(...args);
    }
  }
};

const Event = {
  listen,
  unListen,
  evoke,
};

export default Event;
