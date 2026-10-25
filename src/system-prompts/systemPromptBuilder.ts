import { UserMemoryManager } from "@/memory/UserMemoryManager";
import { getSettings } from "@/settings/model";
import { DEFAULT_SYSTEM_PROMPT } from "@/constants";
import { logInfo } from "@/logger";
import {
  getDisableBuiltinSystemPrompt,
  getEffectiveSystemPromptContent,
} from "@/system-prompts/state";

/**
 * Get the effective user custom prompt with legacy fallback.
 * This is the single source of truth for user prompt content.
 *
 * Priority: file-based (session override > global default) > legacy setting > ""
 *
 * @returns The user custom prompt content
 */
export function getEffectiveUserPrompt(): string {
  const fileBasedUserPrompt = getEffectiveSystemPromptContent();

  // Fallback: if file-based prompts are unavailable (e.g. migration failed to write files),
  // continue honoring the legacy settings field to fulfill the promise in migration error message.
  return fileBasedUserPrompt || getSettings()?.userSystemPrompt || "";
}

/**
 * Build the complete system prompt for the current session.
 * Combines builtin prompt with user custom instructions.
 *
 * Priority for user prompt: session override > global default > legacy setting fallback > ""
 *
 * @returns The complete system prompt string
 */
export function getSystemPrompt(): string {
  const userPrompt = getEffectiveUserPrompt();

  // Check if builtin prompt is disabled for current session
  const disableBuiltin = getDisableBuiltinSystemPrompt();

  if (disableBuiltin) {
    // Only return user custom prompt
    return userPrompt;
  }

  // Default behavior: use builtin prompt
  const basePrompt = DEFAULT_SYSTEM_PROMPT;

  if (userPrompt) {
    return `${basePrompt}
<user_custom_instructions>
${userPrompt}
</user_custom_instructions>`;
  }
  return basePrompt;
}

/**
 * Stable instruction describing where per-turn memory lives.
 *
 * Kept static so it can sit inside the cached system prompt. The volatile
 * blocks themselves (recent conversations, current time) are appended to the
 * current user message by the chain runners.
 */
const MEMORY_PLACEMENT_NOTE = `<memory_placement>
User long-term memory is provided in two places: <saved_memories> appears in this system prompt, while <recent_conversations> and the current time appear at the end of the current user message. Treat both as authoritative context.
</memory_placement>`;

/**
 * Build the cache-stable part of the system prompt.
 *
 * Unlike {@link getSystemPromptWithMemory}, this excludes every block that
 * changes between turns, so the prefix can be reused by provider prompt caches.
 * Callers append saved memories after this text and volatile memory to the
 * current user message.
 *
 * @returns Static system prompt plus the memory-placement instruction.
 */
export function getStableSystemPrompt(): string {
  return `${getSystemPrompt()}\n\n${MEMORY_PLACEMENT_NOTE}`;
}

/**
 * Build system prompt with user memory prefix.
 *
 * @deprecated Chat requests should use {@link getStableSystemPrompt} together
 * with the split memory methods on `UserMemoryManager`; this pre-memory layout
 * changes the first tokens on every turn and defeats prompt caching.
 *
 * @param userMemoryManager - Optional memory manager to fetch user memory
 * @returns The complete system prompt with memory prefix
 */
export async function getSystemPromptWithMemory(
  userMemoryManager: UserMemoryManager | undefined
): Promise<string> {
  const systemPrompt = getSystemPrompt();

  if (!userMemoryManager) {
    logInfo("No UserMemoryManager provided to getSystemPromptWithMemory");
    return systemPrompt;
  }
  const memoryPrompt = await userMemoryManager.getUserMemoryPrompt();

  // Only include user_memory section if there's actual memory content
  if (!memoryPrompt) {
    return systemPrompt;
  }

  return `${memoryPrompt}\n${systemPrompt}`;
}
