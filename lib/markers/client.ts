/**
 * Client for the WTME Marker System emotion detection.
 * Calls the /analyze endpoint on the selina-audio service (port 8100).
 */

import { loadSettings } from "@/lib/settings/settings-manager";

export interface EmotionResult {
  emotion: string;
  atos: string[];
  sems: string[];
  avatar: {
    mood: string;
    expression: string;
  };
  tts_instruct: string;
  duration_ms: number;
}

const FALLBACK: EmotionResult = {
  emotion: "neutral",
  atos: [],
  sems: [],
  avatar: { mood: "neutral", expression: "idle" },
  tts_instruct: "",
  duration_ms: 0,
};

/**
 * Analyze a single message for emotional markers.
 * Returns emotion label, avatar hints, and TTS voice instruction.
 * Gracefully returns neutral on failure (fire-and-forget safe).
 */
export async function analyzeEmotion(
  text: string,
  sender = "user"
): Promise<EmotionResult> {
  const settings = loadSettings();
  const baseUrl = settings.gpuAudioServiceUrl || "http://127.0.0.1:8100";

  try {
    const res = await fetch(`${baseUrl}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, sender }),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      console.warn("[Markers] Analyze failed:", res.status);
      return FALLBACK;
    }

    return await res.json();
  } catch (err) {
    // Service not running or timeout — degrade gracefully
    console.warn("[Markers] Emotion analysis unavailable:", err instanceof Error ? err.message : err);
    return FALLBACK;
  }
}
