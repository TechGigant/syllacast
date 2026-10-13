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

export interface TimeInterval {
    start: number;
    duration: number;
    confidence: number;
}

export interface Section extends TimeInterval {
    loudness: number;
    tempo: number;
    key: number;
    mode: number;
    time_signature: number;
}

export interface Beat extends TimeInterval {}

export interface Segment extends TimeInterval {
    loudness_start: number;
    loudness_max_time: number;
    loudness_max: number;
    loudness_end?: number;
}

export interface TrackData {
    tempo: number;
    loudness: number;
    duration: number;
}

export interface AudioAnalysisData {
    track: TrackData;
    sections: Section[];
    beats: Beat[];
    segments: Segment[];
}

export class BackgroundAnimationController {
    private readonly BASE_TEMPO = 120.0;
    private readonly BEAT_PULSE_MAX = 1.5;
    private readonly BEAT_PULSE_DECAY = 5.0;
    private readonly MIN_BEAT_CONFIDENCE = 0.4;
    
    /**
     * Finds the active element in a time-based array (Sections, Beats, Segments)
     */
    private getActiveElement<T extends TimeInterval>(elements: T[], currentTime: number): T | null {
        return elements.find(el => 
            currentTime >= el.start && currentTime < (el.start + el.duration)
        ) || null;
    }

    /**
     * Maps a loudness dB value (usually -60 to 0) to a usable multiplier
     * Example: -40dB -> ~0.5, 0dB -> 1.2
     */
    private getLoudnessFactor(dB: number): number {
        const normalized = Math.max(0, (dB + 40) / 40); 
        return 0.5 + (normalized * 0.7);
    }

    /**
     * Calculates the dynamic speed multiplier for the current frame
     * * @param currentTime Current playback time of the song in seconds
     * @param data The parsed audio analysis JSON object
     * @returns A float multiplier (e.g., 1.0 is normal, 2.5 is very fast, 0.5 is slow)
     */
    public getSpeedMultiplier(currentTime: number, data: AudioAnalysisData): number {
        let currentSpeed = 1.0;

        const currentSection = this.getActiveElement(data.sections, currentTime);
        if (currentSection) {
            const tempoMultiplier = currentSection.tempo / this.BASE_TEMPO;
            const loudnessMultiplier = this.getLoudnessFactor(currentSection.loudness);
            
            currentSpeed = tempoMultiplier * loudnessMultiplier;
        } else {
            currentSpeed = (data.track.tempo / this.BASE_TEMPO) * this.getLoudnessFactor(data.track.loudness);
        }

        const currentBeat = this.getActiveElement(data.beats, currentTime);
        if (currentBeat && currentBeat.confidence > this.MIN_BEAT_CONFIDENCE) {
            const progressIntoBeat = (currentTime - currentBeat.start) / currentBeat.duration;
            const pulseDecay = Math.exp(-this.BEAT_PULSE_DECAY * progressIntoBeat);
            const beatPulseAddition = this.BEAT_PULSE_MAX * pulseDecay * currentBeat.confidence;
            
            currentSpeed += beatPulseAddition;
        }

        // add tiny high-speed jitters for sharp sounds (snares, synths)
        /* const currentSegment = this.getActiveElement(data.segments, currentTime);
        if (currentSegment) {
            if (currentSegment.loudness_max > -10 && currentSegment.loudness_max_time < 0.05) {
                currentSpeed += 0.25; 
            }
        } */

        return Math.max(0.1, Math.min(currentSpeed, 3.0));
    }
}
