import { execFile } from "node:child_process";
import { writeFile, unlink, mkdtemp, rmdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import type { VisemeCue } from "@/components/avatar/viseme-types";
import { mapRhubarbToVisemes } from "@/components/avatar/viseme-types";

const execFileAsync = promisify(execFile);

const RHUBARB_BIN = "/home/dyai/avatar-realtime/packages/server/bin/rhubarb";

/**
 * Convert audio to WAV format using ffmpeg (rhubarb requires WAV input).
 */
async function convertToWav(
  inputPath: string,
  outputPath: string,
): Promise<void> {
  await execFileAsync("ffmpeg", [
    "-y",
    "-i", inputPath,
    "-ar", "16000",
    "-ac", "1",
    "-f", "wav",
    outputPath,
  ]);
}

/**
 * Extract viseme cues from audio using the Rhubarb lip-sync tool.
 *
 * @param audioBuffer - Raw audio data (MP3, OGG, etc.)
 * @param mimeType - MIME type of the audio (e.g. "audio/mpeg")
 * @param transcript - Optional transcript text for better accuracy
 * @returns Array of VisemeCue objects
 */
export async function extractVisemes(
  audioBuffer: Buffer,
  mimeType: string,
  transcript?: string,
): Promise<VisemeCue[]> {
  const tempDir = await mkdtemp(join(tmpdir(), "rhubarb-"));

  try {
    // Determine input extension from MIME type
    const ext =
      mimeType === "audio/ogg" || mimeType === "audio/opus"
        ? "ogg"
        : mimeType === "audio/wav"
          ? "wav"
          : "mp3";

    const inputPath = join(tempDir, `input.${ext}`);
    const wavPath = join(tempDir, "input.wav");
    const dialogPath = transcript ? join(tempDir, "dialog.txt") : null;

    // Write audio to temp file
    await writeFile(inputPath, audioBuffer);

    // Convert to WAV if not already WAV
    if (ext !== "wav") {
      await convertToWav(inputPath, wavPath);
    } else {
      // Already WAV, just use the input
      await writeFile(wavPath, audioBuffer);
    }

    // Optionally write dialog file for better accuracy
    if (dialogPath && transcript) {
      await writeFile(dialogPath, transcript, "utf-8");
    }

    // Build rhubarb arguments
    const args = [
      wavPath,
      "-f", "json",
      "--machineReadable",
    ];
    if (dialogPath) {
      args.push("-d", dialogPath);
    }

    // Run rhubarb
    const { stdout } = await execFileAsync(RHUBARB_BIN, args, {
      timeout: 30000,
    });

    // Parse JSON output
    const output = JSON.parse(stdout);
    return mapRhubarbToVisemes(output);
  } finally {
    // Cleanup temp files
    try {
      const files = ["input.mp3", "input.ogg", "input.wav", "dialog.txt"];
      await Promise.allSettled(
        files.map((f) => unlink(join(tempDir, f)).catch(() => {})),
      );
      await rmdir(tempDir).catch(() => {});
    } catch {
      // Ignore cleanup errors
    }
  }
}
