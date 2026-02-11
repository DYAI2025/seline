/**
 * MiniMax Model Definitions
 *
 * MiniMax is a Chinese AI provider with OpenAI-compatible API.
 * MiniMax-M2.1 is their flagship model with strong multilingual capabilities.
 *
 * API: OpenAI-compatible at https://api.minimax.io/v1
 */

export const MINIMAX_MODEL_IDS = [
  // M2 generation (current flagship)
  "MiniMax-M2.1",
  "MiniMax-M2.1-lightning",
  "MiniMax-M2",

  // Roleplay model
  "M2-her",
] as const;

export type MiniMaxModelId = (typeof MINIMAX_MODEL_IDS)[number];

// Default models for different roles
export const MINIMAX_DEFAULT_MODELS = {
  chat: "MiniMax-M2.1" as MiniMaxModelId,
  utility: "MiniMax-M2.1-lightning" as MiniMaxModelId,
};

// MiniMax API configuration
export const MINIMAX_CONFIG = {
  BASE_URL: "https://api.minimax.io/v1",
} as const;

// Model display names
const MODEL_LABELS: Record<string, string> = {
  "MiniMax-M2.1": "MiniMax M2.1",
  "MiniMax-M2.1-lightning": "MiniMax M2.1 Lightning",
  "MiniMax-M2": "MiniMax M2",
  "M2-her": "MiniMax M2 Her (Roleplay)",
};

/**
 * Get display name for a MiniMax model
 */
export function getMiniMaxModelDisplayName(modelId: string): string {
  return MODEL_LABELS[modelId] || modelId;
}

/**
 * Get all MiniMax models with display names
 */
export function getMiniMaxModels(): Array<{ id: MiniMaxModelId; name: string }> {
  return MINIMAX_MODEL_IDS.map((id) => ({
    id,
    name: getMiniMaxModelDisplayName(id),
  }));
}
