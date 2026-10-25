/**
 * Extract the note path from a chunk ID.
 * Chunk IDs have the format "note.md#0", "folder/note.md#2", etc.
 * If the ID has no "#" suffix, it's already a note path and is returned as-is.
 *
 * @param chunkId - A chunk ID like "folder/note.md#0" or a plain note path
 * @returns The note path without the chunk suffix (e.g., "folder/note.md")
 */
export function extractNotePathFromChunkId(chunkId: string): string {
  const hashIndex = chunkId.lastIndexOf("#");
  if (hashIndex === -1) {
    return chunkId;
  }
  return chunkId.substring(0, hashIndex);
}

/**
 * Extract the chunk index from a chunk ID.
 *
 * Uses the last "#" so note names that themselves contain "#" (for example
 * "C# Notes.md") are parsed correctly.
 *
 * @param chunkId - A chunk ID like "folder/note.md#2"
 * @returns The numeric chunk index, or 0 when the ID has no "#" suffix.
 */
export function extractChunkIndexFromChunkId(chunkId: string): number {
  const hashIndex = chunkId.lastIndexOf("#");
  if (hashIndex === -1) {
    return 0;
  }
  const parsed = Number.parseInt(chunkId.substring(hashIndex + 1), 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}
