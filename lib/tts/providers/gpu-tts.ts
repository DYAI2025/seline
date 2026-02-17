import { loadSettings } from "@/lib/settings/settings-manager";
import type { TTSOptions, TTSProvider, TTSResult } from "../types";

/**
 * GPU TTS provider using the local selina-audio service (Qwen3-TTS).
 * Uses preset voices with optional style/emotion instructions.
 */
export class GpuTTSProvider implements TTSProvider {
  name = "gpu";

  isAvailable(): boolean {
    const settings = loadSettings();
    return !!settings.gpuAudioServiceUrl;
  }

  async synthesize(options: TTSOptions): Promise<TTSResult> {
    const settings = loadSettings();
    const serviceUrl = settings.gpuAudioServiceUrl || "http://127.0.0.1:8100";

    const formData = new FormData();
    formData.append("text", options.text);
    formData.append("speaker", "Serena");
    formData.append("language", "de");

    // Pass non-standard voice names as style instructions
    if (options.voice && !["alloy", "echo", "fable", "nova", "onyx", "shimmer"].includes(options.voice)) {
      formData.append("instruct", options.voice);
    }

    const response = await fetch(`${serviceUrl}/synthesize`, {
      method: "POST",
      body: formData,
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`GPU TTS error ${response.status}: ${errorText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const audio = Buffer.from(arrayBuffer);
    const durationMs = parseInt(response.headers.get("X-Duration-Ms") || "0", 10);

    return {
      audio,
      mimeType: "audio/wav",
      durationMs,
    };
  }
}
