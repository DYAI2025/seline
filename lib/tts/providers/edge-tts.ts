import { readFileSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { TTSOptions, TTSProvider, TTSResult } from "../types";

/**
 * node-edge-tts hangs on text longer than ~200 chars.
 * Split at sentence boundaries and synthesize each chunk separately.
 */
const CHUNK_MAX_CHARS = 150;

function splitIntoChunks(text: string): string[] {
  if (text.length <= CHUNK_MAX_CHARS) return [text];

  const chunks: string[] = [];
  // Split into sentences (. ! ? followed by space or end)
  const sentences = text.match(/[^.!?]*[.!?]+[\s]*/g);

  if (!sentences) {
    // No sentence boundaries — split on word boundaries
    for (let i = 0; i < text.length; i += CHUNK_MAX_CHARS) {
      chunks.push(text.slice(i, i + CHUNK_MAX_CHARS));
    }
    return chunks;
  }

  let current = "";
  for (const sentence of sentences) {
    if (current.length + sentence.length > CHUNK_MAX_CHARS && current.length > 0) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current += sentence;
    }
  }
  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks.length > 0 ? chunks : [text];
}

export class EdgeTTSProvider implements TTSProvider {
  name = "edge";

  isAvailable(): boolean {
    return true; // Edge TTS is always available (free, no API key)
  }

  async synthesize(options: TTSOptions): Promise<TTSResult> {
    const { EdgeTTS } = await import("node-edge-tts");

    const voice = options.voice || "de-DE-SeraphinaMultilingualNeural";
    const rate = options.speed ? `${((options.speed - 1) * 100).toFixed(0)}%` : undefined;
    const chunks = splitIntoChunks(options.text);

    // Synthesize all chunks in parallel for lower latency
    const audioBuffers = await Promise.all(
      chunks.map(async (chunk, i) => {
        const tts = new EdgeTTS({
          voice,
          outputFormat: "audio-24khz-96kbitrate-mono-mp3",
          rate: rate || undefined,
        });

        const tempPath = join(tmpdir(), `seline-tts-${Date.now()}-${i}-${Math.random().toString(36).slice(2)}.mp3`);

        try {
          await tts.ttsPromise(chunk, tempPath);
          return readFileSync(tempPath);
        } finally {
          try {
            unlinkSync(tempPath);
          } catch {
            // Ignore cleanup errors
          }
        }
      })
    );

    // Concatenate MP3 buffers in order (MP3 frames are independently decodable)
    const audio = Buffer.concat(audioBuffers);

    return {
      audio,
      mimeType: "audio/mpeg",
    };
  }
}
