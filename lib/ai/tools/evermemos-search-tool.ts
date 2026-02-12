/**
 * EverMemOS Memory Recall Tool
 *
 * Searches the shared EverMemOS memory system for relevant memories,
 * foresights, and episodic records across all agents.
 */

import { tool, jsonSchema } from "ai";
import { MCPClientManager } from "@/lib/mcp/client-manager";

interface MemoryRecallInput {
  query: string;
  memory_types?: string;
}

export interface MemoryRecallToolOptions {
  characterId: string;
  sessionId: string;
  userId?: string;
}

const memoryRecallSchema = jsonSchema<MemoryRecallInput>({
  type: "object",
  title: "MemoryRecallInput",
  description: "Input schema for searching memories",
  properties: {
    query: {
      type: "string",
      description:
        "Natural language search query. Examples: 'What does Ben prefer for calendar apps?', 'Bazodiac project details', 'Recent conversations about MCP'",
    },
    memory_types: {
      type: "string",
      description:
        "Comma-separated memory types to search: episodic_memory, foresight, event_log. Leave empty to search all types.",
    },
  },
  required: ["query"],
  additionalProperties: false,
});

export function createMemoryRecallTool(options: MemoryRecallToolOptions) {
  const { userId = "ben" } = options;

  return tool({
    description: `Search the shared memory system for relevant memories, facts, and predictions. Use this when you need to recall:
- Previously memorized facts or preferences
- Past conversation topics and decisions
- Predictions about future actions (foresights)
- Anything the user or other agents have stored

This searches across ALL agents (Selina, Claude Code, etc.) - it's the shared brain.`,

    inputSchema: memoryRecallSchema,

    execute: async (input: MemoryRecallInput) => {
      const { query, memory_types } = input;

      if (!query || query.trim().length === 0) {
        return { success: false, error: "Search query cannot be empty." };
      }

      const mcpManager = MCPClientManager.getInstance();
      if (!mcpManager.isConnected("evermemos")) {
        return {
          success: false,
          error: "EverMemOS memory system is not connected. Memories are unavailable.",
        };
      }

      try {
        const args: Record<string, unknown> = {
          query: query.trim(),
          user_id: userId,
          retrieve_method: "vector",
          limit: 10,
        };

        if (memory_types) {
          args.memory_types = memory_types;
        }

        const result = await mcpManager.executeTool("evermemos", "memory_search", args);

        // MCP results come as { content: [{ type: "text", text: "..." }] }
        const textContent = extractMCPText(result);

        return {
          success: true,
          memories: textContent,
        };
      } catch (error) {
        console.error("[memory_recall] Search failed:", error);
        return {
          success: false,
          error: `Memory search failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        };
      }
    },
  });
}

function extractMCPText(result: unknown): string {
  if (!result || typeof result !== "object") return String(result);
  const r = result as { content?: Array<{ type: string; text: string }> };
  if (r.content && Array.isArray(r.content)) {
    return r.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");
  }
  return JSON.stringify(result);
}
