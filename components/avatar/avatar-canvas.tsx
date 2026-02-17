"use client";

import { useEffect, useRef, useState } from "react";
import type { VisemeCue } from "./viseme-types";

// Rhubarb shape → Oculus viseme ID mapping
const RHUBARB_TO_OCULUS: Record<string, string> = {
  X: "sil",
  A: "PP",
  B: "E",
  C: "aa",
  D: "O",
  E: "RR",
  F: "FF",
  G: "kk",
  H: "DD",
};

// Viseme shapes used for amplitude-based lip sync (cycle through for variety)
const AMPLITUDE_VISEMES = ["aa", "O", "E", "PP", "aa", "kk"];

/**
 * Generate simple viseme cues from audio amplitude analysis.
 * Much faster than Rhubarb (~instant) — runs on decoded PCM data.
 */
function generateAmplitudeVisemes(audioBuffer: AudioBuffer): {
  visemes: string[];
  vtimes: number[];
  vdurations: number[];
} {
  const channelData = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  const windowMs = 60; // analyze in 60ms windows
  const windowSamples = Math.floor(sampleRate * windowMs / 1000);
  const threshold = 0.02; // RMS below this = silence

  const visemes: string[] = [];
  const vtimes: number[] = [];
  const vdurations: number[] = [];
  let shapeIdx = 0;

  for (let i = 0; i < channelData.length; i += windowSamples) {
    const end = Math.min(i + windowSamples, channelData.length);
    let sum = 0;
    for (let j = i; j < end; j++) {
      sum += channelData[j] * channelData[j];
    }
    const rms = Math.sqrt(sum / (end - i));
    const timeMs = Math.round((i / sampleRate) * 1000);

    if (rms > threshold) {
      // Voice activity — cycle through viseme shapes for natural variety
      visemes.push(AMPLITUDE_VISEMES[shapeIdx % AMPLITUDE_VISEMES.length]);
      shapeIdx++;
    } else {
      visemes.push("sil");
    }
    vtimes.push(timeMs);
    vdurations.push(windowMs);
  }

  return { visemes, vtimes, vdurations };
}

interface AvatarCanvasProps {
  visemes: VisemeCue[];
  audioElement: HTMLAudioElement | null;
  isSpeaking: boolean;
  onError: (msg: string) => void;
}

export default function AvatarCanvas({
  visemes,
  audioElement,
  isSpeaking,
  onError,
}: AvatarCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const headRef = useRef<any>(null);
  const [ready, setReady] = useState(false);

  // Initialize TalkingHead
  useEffect(() => {
    if (!containerRef.current || headRef.current) return;

    let cancelled = false;

    async function init() {
      try {
        const { TalkingHead } = await import("@met4citizen/talkinghead");

        if (cancelled || !containerRef.current) return;

        const head = new TalkingHead(containerRef.current, {
          lipsyncModules: [],
          modelFPS: 30,
          cameraView: "upper",
        });

        if (cancelled) return;

        await head.showAvatar({
          url: "/avatars/default.glb",
          body: "F",
          avatarMood: "neutral",
          lipsyncLang: "de",
        });

        if (cancelled) return;

        headRef.current = head;
        setReady(true);
        console.log("[TalkingHead] Avatar loaded");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[TalkingHead] Init failed:", msg);
        if (!cancelled) onError(msg);
      }
    }

    init();

    return () => {
      cancelled = true;
      headRef.current?.hideAvatar();
      headRef.current = null;
    };
  }, [onError]);

  // Drive lip-sync: trigger speakAudio once all data is available
  const sentAudioRef = useRef<string | null>(null);
  useEffect(() => {
    const head = headRef.current;
    if (!head || !ready) return;

    // When speaking stops, reset
    if (!isSpeaking) {
      if (sentAudioRef.current) {
        head.stopSpeaking();
        sentAudioRef.current = null;
      }
      return;
    }

    // Need at least audio to proceed
    if (!audioElement?.src) return;

    // Don't re-send for the same audio source
    if (sentAudioRef.current === audioElement.src) return;
    sentAudioRef.current = audioElement.src;

    // Fetch audio, decode to AudioBuffer, and send to TalkingHead
    (async () => {
      try {
        const res = await fetch(audioElement.src);
        const arrayBuffer = await res.arrayBuffer();

        // TalkingHead expects a decoded AudioBuffer, not raw bytes
        const audioCtx = head.audioCtx as AudioContext;
        if (audioCtx.state === "suspended") await audioCtx.resume();
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

        let oculusVisemes: string[];
        let vtimes: number[];
        let vdurations: number[];

        if (visemes.length > 0) {
          // Use Rhubarb visemes when available
          oculusVisemes = visemes.map(
            (cue) => RHUBARB_TO_OCULUS[cue.shape] ?? "sil"
          );
          vtimes = visemes.map((cue) => Math.round(cue.time * 1000));
          vdurations = visemes.map((cue) => Math.round(cue.duration * 1000));
          console.log("[TalkingHead] speakAudio:", visemes.length, "Rhubarb visemes,", audioBuffer.duration.toFixed(1) + "s");
        } else {
          // Fallback: generate visemes from audio amplitude
          const generated = generateAmplitudeVisemes(audioBuffer);
          oculusVisemes = generated.visemes;
          vtimes = generated.vtimes;
          vdurations = generated.vdurations;
          console.log("[TalkingHead] speakAudio:", oculusVisemes.length, "amplitude visemes,", audioBuffer.duration.toFixed(1) + "s");
        }

        head.speakAudio(
          {
            audio: audioBuffer,
            words: ["_"],
            wtimes: [0],
            wdurations: [0],
            visemes: oculusVisemes,
            vtimes,
            vdurations,
          },
          { lipsyncLang: "de" },
        );
      } catch (err) {
        console.error("[TalkingHead] speakAudio failed:", err);
        sentAudioRef.current = null;
      }
    })();
  }, [isSpeaking, visemes, audioElement, ready]);

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center text-xs font-mono text-white/50">
          Loading model...
        </div>
      )}
    </div>
  );
}
