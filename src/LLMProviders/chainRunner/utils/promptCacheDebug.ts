import { logInfo } from "@/logger";
import { getSettings } from "@/settings/model";
import { hashPromptPrefix } from "@/utils/prefixHash";

/** Message shape accepted by the debug logger (LangChain or plain objects). */
interface DebugMessage {
  role?: string;
  content?: unknown;
  _getType?: () => string;
}

/** Character length of a message content value. */
function contentLength(content: unknown): number {
  if (typeof content === "string") return content.length;
  try {
    return JSON.stringify(content ?? "").length;
  } catch {
    return 0;
  }
}

/** Resolve a message role for both LangChain and plain objects. */
function messageRole(message: DebugMessage): string {
  return typeof message._getType === "function" ? message._getType() : (message.role ?? "user");
}

/**
 * Log a cache-diagnostic snapshot of the outgoing request.
 *
 * Prints the prefix hash and per-section sizes so a changing system prompt or
 * history can be spotted immediately. No-op unless debug logging is enabled.
 *
 * @param messages Final provider messages.
 * @param modelName Model identifier, when known.
 */
export function logPromptCacheDebug(messages: DebugMessage[], modelName?: string): void {
  if (!getSettings().debug || messages.length === 0) {
    return;
  }

  const systemChars = messages
    .filter((message) => messageRole(message) === "system")
    .reduce((total, message) => total + contentLength(message.content), 0);
  const historyChars = messages
    .slice(0, -1)
    .filter((message) => messageRole(message) !== "system")
    .reduce((total, message) => total + contentLength(message.content), 0);
  const lastMessage = messages[messages.length - 1];

  logInfo("[PromptCache] request snapshot", {
    model: modelName || "unknown",
    messages: messages.length,
    prefixHash: hashPromptPrefix(messages),
    systemChars,
    historyChars,
    userChars: contentLength(lastMessage?.content),
  });
}
