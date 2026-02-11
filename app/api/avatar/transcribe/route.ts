import { transcribeAudio, isTranscriptionAvailable } from "@/lib/audio/transcription";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  if (!isTranscriptionAvailable()) {
    return NextResponse.json(
      { error: "Transcription not available. Configure OpenAI API key or whisper.cpp." },
      { status: 503 },
    );
  }

  const formData = await req.formData();
  const file = formData.get("file");

  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: "Missing audio file" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeType = file.type || "audio/wav";

  const result = await transcribeAudio(buffer, mimeType, file.name ?? "audio.wav");
  return NextResponse.json({ text: result.text });
}
