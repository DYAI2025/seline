"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useThread } from "@assistant-ui/react";
import type { VisemeCue } from "@/components/avatar/viseme-types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EmotionData {
  emotion: string;
  avatar: { mood: string; expression: string };
  tts_instruct: string;
}

interface UseVoiceModeOptions {
  /** Called with the transcribed text from ASR */
  onTranscript: (text: string) => void;
  /** Whether the LLM is currently streaming a response */
  isRunning: boolean;
  /** Optional callbacks to sync avatar state */
  onVisemesChange?: (visemes: VisemeCue[]) => void;
  onAudioElementChange?: (el: HTMLAudioElement | null) => void;
  onEmotionChange?: (emotion: { emotion: string; mood: string; expression: string; ttsInstruct: string } | null) => void;
  onStateChange?: (state: {
    isVoiceMode: boolean;
    isListening: boolean;
    isTranscribing: boolean;
    isSpeaking: boolean;
  }) => void;
}

interface UseVoiceModeReturn {
  /** Whether voice mode is toggled on */
  isVoiceMode: boolean;
  /** Whether the mic is actively recording */
  isListening: boolean;
  /** Whether we're waiting for ASR transcription */
  isTranscribing: boolean;
  /** Whether TTS audio is currently playing */
  isSpeaking: boolean;
  /** Toggle voice mode on/off */
  toggleVoiceMode: () => void;
  /** Manually trigger TTS for a given text */
  speakText: (text: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** RMS threshold below which we consider "silence" */
const SILENCE_THRESHOLD = 0.01;
/** How long silence must persist before we stop recording (ms) */
const SILENCE_DURATION_MS = 1500;
/** How often to check audio levels (ms) */
const VAD_CHECK_INTERVAL_MS = 100;
/** Minimum recording duration before silence detection kicks in (ms) */
const MIN_RECORDING_MS = 500;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Strip markdown formatting from text before sending to TTS.
 * LLM responses often contain **bold**, `code`, ### headers, [links](url),
 * bullet lists, etc. that sound garbled when spoken aloud.
 */
function stripMarkdownForTTS(text: string): string {
  return (
    text
      // Remove code blocks (``` ... ```)
      .replace(/```[\s\S]*?```/g, "")
      // Remove inline code (`...`)
      .replace(/`([^`]+)`/g, "$1")
      // Remove images ![alt](url)
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      // Remove links [text](url) → keep text
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      // Remove headers (### ... )
      .replace(/^#{1,6}\s+/gm, "")
      // Remove bold/italic markers
      .replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1")
      .replace(/_{1,3}([^_]+)_{1,3}/g, "$1")
      // Remove strikethrough
      .replace(/~~([^~]+)~~/g, "$1")
      // Remove bullet/numbered list markers
      .replace(/^[\s]*[-*+]\s+/gm, "")
      .replace(/^[\s]*\d+\.\s+/gm, "")
      // Remove horizontal rules
      .replace(/^[-*_]{3,}\s*$/gm, "")
      // Remove blockquotes
      .replace(/^>\s+/gm, "")
      // Remove emojis
      .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/gu, "")
      // Collapse multiple newlines
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/**
 * Truncate text to a TTS-friendly length.
 * Edge TTS handles long text via chunking, but very long responses
 * are better summarized. Keep first ~3000 chars (split at sentence boundary).
 */
const TTS_MAX_CHARS = 3000;

function truncateForTTS(text: string): string {
  if (text.length <= TTS_MAX_CHARS) return text;

  // Split into sentences (period, exclamation, question mark followed by space or end)
  const sentences = text.match(/[^.!?]*[.!?]+[\s]*/g) || [text];
  let result = "";

  for (const sentence of sentences) {
    if (result.length + sentence.length > TTS_MAX_CHARS && result.length > 0) {
      break;
    }
    result += sentence;
  }

  return result.trim() || text.slice(0, TTS_MAX_CHARS);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useVoiceMode({
  onTranscript,
  isRunning,
  onVisemesChange,
  onAudioElementChange,
  onEmotionChange,
  onStateChange,
}: UseVoiceModeOptions): UseVoiceModeReturn {
  const [isVoiceMode, setIsVoiceMode] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  // Refs for Web Audio / MediaRecorder resources
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const vadIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const silenceStartRef = useRef<number | null>(null);
  const recordingStartRef = useRef<number>(0);
  const chunksRef = useRef<Blob[]>([]);
  const playbackRef = useRef<HTMLAudioElement | null>(null);

  // Stable refs for callbacks
  const onVisemesChangeRef = useRef(onVisemesChange);
  onVisemesChangeRef.current = onVisemesChange;
  const onAudioElementChangeRef = useRef(onAudioElementChange);
  onAudioElementChangeRef.current = onAudioElementChange;
  const onEmotionChangeRef = useRef(onEmotionChange);
  onEmotionChangeRef.current = onEmotionChange;
  const onStateChangeRef = useRef(onStateChange);
  onStateChangeRef.current = onStateChange;

  // Stable ref for the latest isRunning so effects see current value
  const isRunningRef = useRef(isRunning);
  isRunningRef.current = isRunning;

  // Stable ref for voice mode state
  const isVoiceModeRef = useRef(isVoiceMode);
  isVoiceModeRef.current = isVoiceMode;

  // Track previous isRunning to detect true→false transition
  const prevIsRunningRef = useRef(isRunning);

  // Get thread messages for extracting last assistant response
  const messages = useThread((t) => t.messages);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  // Sync voice state changes to context callback
  useEffect(() => {
    onStateChangeRef.current?.({
      isVoiceMode,
      isListening,
      isTranscribing,
      isSpeaking,
    });
  }, [isVoiceMode, isListening, isTranscribing, isSpeaking]);

  // ------------------------------------------------------------------
  // TTS playback
  // ------------------------------------------------------------------

  const speakText = useCallback(async (text: string) => {
    // Strip markdown so TTS doesn't try to read formatting syntax
    const cleanText = truncateForTTS(stripMarkdownForTTS(text));
    if (!cleanText) return;

    try {
      const res = await fetch("/api/avatar/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: cleanText }),
      });

      if (!res.ok) {
        console.warn("[VoiceMode] TTS failed:", res.status);
        setIsSpeaking(false);
        onVisemesChangeRef.current?.([]);
        if (isVoiceModeRef.current) {
          startRecording();
        }
        return;
      }

      const data = await res.json();
      if (!data.audioUrl) {
        console.warn("[VoiceMode] No audioUrl in TTS response");
        setIsSpeaking(false);
        onVisemesChangeRef.current?.([]);
        if (isVoiceModeRef.current) {
          startRecording();
        }
        return;
      }

      // Push visemes from response to avatar
      const visemes: VisemeCue[] = data.visemes ?? [];
      onVisemesChangeRef.current?.(visemes);

      // Stop any previous playback
      if (playbackRef.current) {
        playbackRef.current.pause();
        playbackRef.current.src = "";
      }

      // Play from server-saved file URL (same approach as speakAloud tool)
      const audio = new Audio(data.audioUrl);
      // Mute when avatar is active — TalkingHead handles audible playback.
      // Audio element still plays (muted) so onended fires for lifecycle.
      if (onAudioElementChangeRef.current) {
        audio.volume = 0;
      }
      playbackRef.current = audio;

      // Expose audio element for time-sync in avatar panel
      onAudioElementChangeRef.current?.(audio);

      // Set speaking AFTER visemes + audio are ready so avatar can sync
      setIsSpeaking(true);

      audio.onended = () => {
        playbackRef.current = null;
        onAudioElementChangeRef.current?.(null);
        onVisemesChangeRef.current?.([]);
        setIsSpeaking(false);
        if (isVoiceModeRef.current) {
          startRecording();
        }
      };

      audio.onerror = () => {
        console.warn("[VoiceMode] Audio playback error");
        playbackRef.current = null;
        onAudioElementChangeRef.current?.(null);
        onVisemesChangeRef.current?.([]);
        setIsSpeaking(false);
        if (isVoiceModeRef.current) {
          startRecording();
        }
      };

      await audio.play();
    } catch (err) {
      console.error("[VoiceMode] TTS error:", err);
      onVisemesChangeRef.current?.([]);
      setIsSpeaking(false);
    }
  }, []);

  // ------------------------------------------------------------------
  // Silence detection (VAD-lite)
  // ------------------------------------------------------------------

  const stopVAD = useCallback(() => {
    if (vadIntervalRef.current) {
      clearInterval(vadIntervalRef.current);
      vadIntervalRef.current = null;
    }
    silenceStartRef.current = null;
  }, []);

  const startVAD = useCallback(() => {
    stopVAD();

    const analyser = analyserRef.current;
    if (!analyser) return;

    const dataArray = new Float32Array(analyser.fftSize);

    vadIntervalRef.current = setInterval(() => {
      analyser.getFloatTimeDomainData(dataArray);

      // Calculate RMS
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i] * dataArray[i];
      }
      const rms = Math.sqrt(sum / dataArray.length);

      const now = Date.now();
      const elapsed = now - recordingStartRef.current;

      if (rms < SILENCE_THRESHOLD) {
        // Below threshold
        if (silenceStartRef.current === null) {
          silenceStartRef.current = now;
        } else if (
          elapsed > MIN_RECORDING_MS &&
          now - silenceStartRef.current >= SILENCE_DURATION_MS
        ) {
          // Silence long enough — stop recording
          stopRecordingAndTranscribe();
        }
      } else {
        // Voice activity detected — reset silence timer
        silenceStartRef.current = null;
      }
    }, VAD_CHECK_INTERVAL_MS);
  }, [stopVAD]);

  // ------------------------------------------------------------------
  // Recording lifecycle
  // ------------------------------------------------------------------

  const stopRecordingAndTranscribe = useCallback(() => {
    stopVAD();

    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop(); // triggers ondataavailable + onstop
    }
    setIsListening(false);
  }, [stopVAD]);

  const startRecording = useCallback(async () => {
    // Don't start if already listening, transcribing, speaking, or LLM is running
    if (isTranscribing || isSpeaking || isRunningRef.current) return;

    try {
      // Reuse existing stream or request new one
      if (!mediaStreamRef.current) {
        mediaStreamRef.current = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
      }

      const stream = mediaStreamRef.current;

      // Set up AudioContext + AnalyserNode for VAD
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext();
      }
      const ctx = audioContextRef.current;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      analyserRef.current = analyser;

      // MediaRecorder — try codecs in order of preference
      chunksRef.current = [];
      const candidates = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/ogg;codecs=opus",
        "audio/mp4",
        "",  // empty = browser default
      ];
      let mimeType = "";
      for (const c of candidates) {
        if (!c || MediaRecorder.isTypeSupported(c)) { mimeType = c; break; }
      }
      const recorderOpts: MediaRecorderOptions = mimeType ? { mimeType } : {};
      const recorder = new MediaRecorder(stream, recorderOpts);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.onerror = (e) => {
        console.warn("[VoiceMode] MediaRecorder error:", e);
        setIsListening(false);
      };

      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        chunksRef.current = [];

        // Skip very short recordings (likely just noise)
        if (blob.size < 1000) {
          // Resume listening if voice mode is still on
          if (isVoiceModeRef.current && !isRunningRef.current) {
            startRecording();
          }
          return;
        }

        // Transcribe
        setIsTranscribing(true);
        try {
          const formData = new FormData();
          formData.append("file", blob, "recording.webm");

          const res = await fetch("/api/avatar/transcribe", {
            method: "POST",
            body: formData,
          });

          if (!res.ok) {
            console.warn("[VoiceMode] Transcription failed:", res.status);
            setIsTranscribing(false);
            // Resume listening on failure
            if (isVoiceModeRef.current) {
              startRecording();
            }
            return;
          }

          const data = await res.json();
          setIsTranscribing(false);

          if (data.text && data.text.trim()) {
            // Pass detected emotion to avatar context
            if (data.emotion && onEmotionChangeRef.current) {
              const e = data.emotion;
              onEmotionChangeRef.current({
                emotion: e.emotion,
                mood: e.avatar?.mood ?? "neutral",
                expression: e.avatar?.expression ?? "idle",
                ttsInstruct: e.tts_instruct ?? "",
              });
              console.log("[VoiceMode] User emotion:", e.emotion, e.sems?.join(", ") || "");
            }
            onTranscript(data.text.trim());
            // Don't resume listening here — wait for LLM to finish + TTS
          } else {
            // Empty transcription — resume listening
            if (isVoiceModeRef.current) {
              startRecording();
            }
          }
        } catch (err) {
          console.error("[VoiceMode] Transcription error:", err);
          setIsTranscribing(false);
          if (isVoiceModeRef.current) {
            startRecording();
          }
        }
      };

      recorder.start();
      recordingStartRef.current = Date.now();
      setIsListening(true);

      // Start silence detection
      startVAD();
    } catch (err) {
      console.warn("[VoiceMode] Mic/recorder error (TTS still works):", err);
      // Don't disable voice mode — TTS output still works without mic
      setIsListening(false);
    }
  }, [isTranscribing, isSpeaking, onTranscript, startVAD, stopVAD]);

  // ------------------------------------------------------------------
  // Auto-TTS when LLM finishes responding
  // ------------------------------------------------------------------

  useEffect(() => {
    // Detect isRunning transition from true → false
    if (prevIsRunningRef.current && !isRunning && isVoiceModeRef.current) {
      // LLM just finished — extract last assistant message and speak it
      const msgs = messagesRef.current;
      const lastAssistant = [...msgs].reverse().find((m) => m.role === "assistant");

      if (lastAssistant) {
        const textParts = lastAssistant.content
          ?.filter(
            (part): part is { type: "text"; text: string } =>
              part.type === "text"
          )
          .map((part) => part.text);

        const responseText = textParts?.join("\n") || "";
        if (responseText.trim()) {
          speakText(responseText);
        } else {
          // No text to speak — resume listening
          if (isVoiceModeRef.current) {
            startRecording();
          }
        }
      } else {
        // No assistant message found — resume listening
        if (isVoiceModeRef.current) {
          startRecording();
        }
      }
    }

    prevIsRunningRef.current = isRunning;
  }, [isRunning, speakText, startRecording]);

  // ------------------------------------------------------------------
  // Toggle voice mode on/off
  // ------------------------------------------------------------------

  const cleanupResources = useCallback(() => {
    stopVAD();

    // Stop recorder
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== "inactive"
    ) {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;

    // Stop audio playback
    if (playbackRef.current) {
      playbackRef.current.pause();
      playbackRef.current.src = "";
      playbackRef.current = null;
    }

    // Clear avatar state
    onAudioElementChangeRef.current?.(null);
    onVisemesChangeRef.current?.([]);

    // Release mic stream
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    // Close AudioContext
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }

    analyserRef.current = null;

    setIsListening(false);
    setIsTranscribing(false);
    setIsSpeaking(false);
  }, [stopVAD]);

  const toggleVoiceMode = useCallback(() => {
    if (isVoiceMode) {
      // Turn off
      cleanupResources();
      setIsVoiceMode(false);
    } else {
      // Turn on
      setIsVoiceMode(true);
      // Start recording immediately (will request mic permission)
      startRecording();
    }
  }, [isVoiceMode, cleanupResources, startRecording]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupResources();
    };
  }, [cleanupResources]);

  return {
    isVoiceMode,
    isListening,
    isTranscribing,
    isSpeaking,
    toggleVoiceMode,
    speakText,
  };
}
