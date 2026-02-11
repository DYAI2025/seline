import { streamText } from "ai";
import { NextResponse } from "next/server";
import { getLanguageModel } from "@/lib/ai/providers";
import { getSystemPrompt } from "@/lib/ai/config";
import { getCharacterFull } from "@/lib/characters/queries";
import { buildCharacterSystemPrompt } from "@/lib/ai/character-prompt";
import { loadSettings } from "@/lib/settings/settings-manager";

// Ensure settings are loaded (syncs provider selection to process.env)
loadSettings();

export async function POST(req: Request) {
  const body = await req.json();
  const { messages, characterId } = body;

  if (!messages || !Array.isArray(messages)) {
    return NextResponse.json({ error: "Missing messages array" }, { status: 400 });
  }

  const model = getLanguageModel();

  // Build system prompt: character-specific if characterId provided, else default
  let systemPrompt: string;

  if (characterId) {
    const character = await getCharacterFull(characterId);
    if (character) {
      systemPrompt = buildCharacterSystemPrompt(character);
    } else {
      systemPrompt = getSystemPrompt({ toolLoadingMode: "always" });
    }
  } else {
    systemPrompt = getSystemPrompt({ toolLoadingMode: "always" });
  }

  const result = streamText({
    model,
    system: systemPrompt,
    messages,
  });

  // Stream text with <think>...</think> tags stripped (MiniMax emits these)
  const textStream = result.textStream;
  const encoder = new TextEncoder();

  const filtered = new ReadableStream<Uint8Array>({
    async start(controller) {
      let insideThink = false;
      let buffer = "";

      for await (const chunk of textStream) {
        buffer += chunk;

        // Process buffer for <think> blocks
        while (buffer.length > 0) {
          if (insideThink) {
            const endIdx = buffer.indexOf("</think>");
            if (endIdx === -1) {
              // Still inside think block, discard buffer and wait for more
              buffer = "";
              break;
            }
            // Skip past </think>
            buffer = buffer.slice(endIdx + "</think>".length);
            insideThink = false;
          } else {
            const startIdx = buffer.indexOf("<think>");
            if (startIdx === -1) {
              // No think tag — flush buffer but keep last 7 chars (partial tag)
              if (buffer.length > 7) {
                const safe = buffer.slice(0, buffer.length - 7);
                controller.enqueue(encoder.encode(safe));
                buffer = buffer.slice(buffer.length - 7);
              }
              break;
            }
            // Emit text before <think>
            if (startIdx > 0) {
              controller.enqueue(encoder.encode(buffer.slice(0, startIdx)));
            }
            buffer = buffer.slice(startIdx + "<think>".length);
            insideThink = true;
          }
        }
      }

      // Flush remaining buffer
      if (buffer.length > 0 && !insideThink) {
        controller.enqueue(encoder.encode(buffer));
      }
      controller.close();
    },
  });

  return new Response(filtered, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
