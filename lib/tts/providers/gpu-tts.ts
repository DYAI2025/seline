import { loadSettings } from "@/lib/settings/settings-manager";
import type { TTSOptions, TTSProvider, TTSResult } from "../types";

/**
 * GPU TTS provider using the local selina-audio service (F5-TTS).
 * Supports voice cloning via reference audio and German/English synthesis.
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
    formData.append("language", "de"); // Default to German for Selina
    formData.append("nfe_step", "16"); // Fast mode for realtime chat

    if (options.speed) {
      formData.append("speed", String(options.speed));
    }

    const response = await fetch(`${serviceUrl}/synthesize`, {
      method: "POST",
      body: formData,
      signal: AbortSignal.timeout(30000),
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
