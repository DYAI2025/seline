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

    // All three must be present: speaking + audio + visemes
    if (!audioElement?.src || visemes.length === 0) return;

    // Don't re-send for the same audio source
    if (sentAudioRef.current === audioElement.src) return;
    sentAudioRef.current = audioElement.src;

    // Convert Rhubarb visemes to Oculus format for TalkingHead
    const oculusVisemes: string[] = [];
    const vtimes: number[] = [];
    const vdurations: number[] = [];

    for (const cue of visemes) {
      const oculusId = RHUBARB_TO_OCULUS[cue.shape] ?? "sil";
      oculusVisemes.push(oculusId);
      vtimes.push(Math.round(cue.time * 1000));
      vdurations.push(Math.round(cue.duration * 1000));
    }

    // Fetch audio, decode to AudioBuffer, and send to TalkingHead
    (async () => {
      try {
        const res = await fetch(audioElement.src);
        const arrayBuffer = await res.arrayBuffer();

        // TalkingHead expects a decoded AudioBuffer, not raw bytes
        const audioCtx = head.audioCtx as AudioContext;
        if (audioCtx.state === "suspended") await audioCtx.resume();
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

        console.log("[TalkingHead] speakAudio:", visemes.length, "visemes,", audioBuffer.duration.toFixed(1) + "s");
        head.speakAudio(
          {
            audio: audioBuffer,
            // TalkingHead requires `words` to be truthy for viseme processing
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
