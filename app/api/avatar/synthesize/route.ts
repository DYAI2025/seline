import { synthesizeSpeech, isTTSAvailable } from "@/lib/tts/manager";
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

  const result = await synthesizeSpeech({ text, voice, speed });

  return new Response(new Uint8Array(result.audio), {
    headers: {
      "Content-Type": result.mimeType,
      "X-Duration-Ms": String(result.durationMs ?? 0),
    },
  });
}
