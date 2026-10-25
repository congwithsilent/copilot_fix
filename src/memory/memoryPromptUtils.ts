/**
 * Append the volatile memory block to the current user message.
 *
 * Keeping memory that changes every turn at the end of the message (rather than
 * at the start of the system prompt) keeps the cached prefix stable across
 * turns.
 *
 * @param userContent The user message content for this turn.
 * @param volatileMemory Output of `UserMemoryManager.getVolatileMemoryPrompt()`.
 * @returns The combined content, unchanged when there is no memory.
 */
export function appendVolatileMemory(userContent: string, volatileMemory: string | null): string {
  if (!volatileMemory) {
    return userContent;
  }
  return `${userContent}\n\n${volatileMemory}`;
}
