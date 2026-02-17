import { synthesizeSpeech, isTTSAvailable } from "@/lib/tts/manager";
import { saveFile } from "@/lib/storage/local-storage";
import { extractVisemes } from "@/lib/lipsync/rhubarb";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  if (!isTTSAvailable()) {
    return NextResponse.json(
      { error: "TTS not available. Enable TTS in settings." },
      { status: 503 },
    );
  }

  const body = await req.json();
  const { text, voice, speed } = body;

  if (!text || typeof text !== "string") {
    return NextResponse.json({ error: "Missing text" }, { status: 400 });
  }

  let result;
  try {
    result = await synthesizeSpeech({ text, voice, speed });
  } catch (err) {
    console.error("[synthesize] TTS failed:", err);
    return NextResponse.json(
      { error: "TTS synthesis failed" },
      { status: 500 },
    );
  }

  // Determine file extension from mimeType
  const ext = result.mimeType === "audio/ogg" ? "ogg"
    : result.mimeType === "audio/opus" ? "opus"
    : result.mimeType === "audio/wav" ? "wav"
    : "mp3";

  // Save to local storage and return URL (avoids binary streaming issues)
  const saved = await saveFile(
    result.audio,
    "_voice-mode",
    `tts-${Date.now()}.${ext}`,
    "generated"
  );

  // Extract visemes for lip-sync (graceful: empty visemes on failure)
  let visemes: Awaited<ReturnType<typeof extractVisemes>> = [];
  try {
    visemes = await extractVisemes(
      Buffer.from(result.audio),
      result.mimeType,
      text,
    );
  } catch (err) {
    console.warn("[synthesize] Rhubarb viseme extraction failed, avatar will idle:", err);
  }

  return NextResponse.json({
    audioUrl: saved.url,
    visemes,
    mimeType: result.mimeType,
    durationMs: result.durationMs ?? 0,
  });
}
