/**
 * Stable, non-cryptographic hash of a prompt prefix.
 *
 * Used only for cache diagnostics: two requests with the same system prompt and
 * history should print the same hash, so an accidental churn in the prefix is
 * visible in the debug log. FNV-1a is cheap and stable across runs.
 */

/**
 * Hash a string with 32-bit FNV-1a.
 *
 * @param value Input string.
 * @returns Zero-padded hexadecimal hash.
 */
export function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Hash everything except the last message.
 *
 * The last message is the current turn and is expected to change; the prefix
 * before it is what prompt caching can reuse.
 *
 * @param messages Provider-shaped messages.
 * @returns Hexadecimal prefix hash.
 */
export function hashPromptPrefix(
  messages: Array<{ role?: string; content?: unknown; _getType?: () => string }>
): string {
  const prefix = messages
    .slice(0, -1)
    .map((message) => {
      const role =
        typeof message._getType === "function" ? message._getType() : (message.role ?? "user");
      const content =
        typeof message.content === "string"
          ? message.content
          : JSON.stringify(message.content ?? "");
      return `${role}\u0000${content}`;
    })
    .join("\u0000");
  return hashString(prefix);
}
