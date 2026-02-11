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

  // Return plain text stream for avatar adapter
  return result.toTextStreamResponse();
}
