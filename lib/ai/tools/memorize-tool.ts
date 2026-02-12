/**
 * Memorize Tool
 *
 * AI tool that saves memories via EverMemOS MCP server.
 * Falls back to local AgentMemoryManager if EverMemOS is unavailable.
 */

import { tool, jsonSchema } from "ai";
import { AgentMemoryManager, type MemoryCategory } from "@/lib/agent-memory";
import { MCPClientManager } from "@/lib/mcp/client-manager";

interface MemorizeInput {
  content: string;
  category?: MemoryCategory;
  reasoning?: string;
}

export interface MemorizeToolOptions {
  characterId: string;
  sessionId: string;
}

const memorizeSchema = jsonSchema<MemorizeInput>({
  type: "object",
  title: "MemorizeInput",
  description: "Input schema for saving a memory",
  properties: {
    content: {
      type: "string",
      description:
        "The fact, preference, or instruction to remember. Be concise and specific. Examples: 'User prefers dark mode designs', 'User's name is Lea', 'Use Google Calendar for private events and cIT calendar for work'.",
    },
    category: {
      type: "string",
      enum: [
        "visual_preferences",
        "communication_style",
        "workflow_patterns",
        "domain_knowledge",
        "business_rules",
      ],
      description:
        "Category for the memory. If omitted, defaults to 'domain_knowledge'.",
    },
    reasoning: {
      type: "string",
      description:
        "Brief explanation of why this is being memorized.",
    },
  },
  required: ["content"],
  additionalProperties: false,
});

export function createMemorizeTool(options: MemorizeToolOptions) {
  const { characterId, sessionId } = options;

  return tool({
    description: `Save a memory/fact/preference that should persist across conversations. Use this when the user says things like:
- "Remember that..." / "Memorize that..."
- "Please note..." / "Note for future reference..."
- "Always do X" / "Never do Y"
- "My name is..." / "I prefer..."
- "Use X for Y" (tool/service preferences)

The memory is saved immediately and will be available in all future conversations with this agent.
Memories are organized by category and injected into the system prompt automatically.

**Guidelines:**
- Keep memories concise and specific (one fact per memory)
- Don't duplicate existing memories — check if you already know something before saving
- Use the most fitting category, or omit it to default to domain_knowledge
- For conflicting info, save the new version (the old one can be removed from the memory UI)`,

    inputSchema: memorizeSchema,

    execute: async (input: MemorizeInput) => {
      const {
        content,
        category = "domain_knowledge",
        reasoning = "User explicitly asked to remember this",
      } = input;

      if (!content || content.trim().length === 0) {
        return { success: false, error: "Memory content cannot be empty." };
      }

      if (content.trim().length > 1000) {
        return {
          success: false,
          error: "Memory content is too long (max 1000 characters). Please be more concise.",
        };
      }

      // Try EverMemOS via MCP first
      const mcpManager = MCPClientManager.getInstance();
      if (mcpManager.isConnected("evermemos")) {
        try {
          const result = await mcpManager.executeTool("evermemos", "memory_store", {
            content: `[${category}] ${content.trim()}`,
            sender: "selina",
            group_id: `selina-chat-${sessionId}`,
            sender_name: characterId,
          });

          console.log(`[memorize] Saved to EverMemOS for ${characterId}: "${content.trim().substring(0, 60)}..." (${category})`);

          return {
            success: true,
            backend: "evermemos",
            category,
            message: `Memorized: "${content.trim()}"`,
          };
        } catch (error) {
          console.warn("[memorize] EverMemOS failed, falling back to local:", error);
        }
      }

      // Fallback: local AgentMemoryManager
      try {
        const manager = new AgentMemoryManager(characterId);

        const existing = await manager.loadApprovedMemories();
        const normalizedContent = content.trim().toLowerCase();
        const duplicate = existing.find((m) => {
          const normalizedExisting = m.content.trim().toLowerCase();
          return (
            normalizedExisting === normalizedContent ||
            jaccardSimilarity(normalizedContent, normalizedExisting) > 0.85
          );
        });

        if (duplicate) {
          return {
            success: true,
            alreadyExists: true,
            message: `I already have this memorized: "${duplicate.content}"`,
            memoryId: duplicate.id,
            category: duplicate.category,
          };
        }

        const memory = await manager.addMemory({
          category,
          content: content.trim(),
          reasoning,
          confidence: 1.0,
          importance: 1.0,
          factors: {
            repetition: 1.0,
            impact: 1.0,
            specificity: 1.0,
            recency: 1.0,
            conflictResolution: 0,
          },
          status: "approved",
          source: "manual",
          sessionId,
        });

        console.log(`[memorize] Saved locally for ${characterId}: "${content.trim().substring(0, 60)}..." (${category})`);

        return {
          success: true,
          backend: "local",
          memoryId: memory.id,
          category: memory.category,
          message: `Memorized: "${content.trim()}"`,
        };
      } catch (error) {
        console.error("[memorize] Failed to save memory:", error);
        return {
          success: false,
          error: `Failed to save memory: ${error instanceof Error ? error.message : "Unknown error"}`,
        };
      }
    },
  });
}

function jaccardSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.replace(/[^\w\s]/g, "").split(/\s+/).filter(Boolean));
  const wordsB = new Set(b.replace(/[^\w\s]/g, "").split(/\s+/).filter(Boolean));
  if (wordsA.size === 0 && wordsB.size === 0) return 1;
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  const intersection = new Set([...wordsA].filter((x) => wordsB.has(x)));
  const union = new Set([...wordsA, ...wordsB]);
  return intersection.size / union.size;
}
