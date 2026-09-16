/**
 * Streaming-aware markdown boundary detection.
 *
 * While a response streams, the renderer re-runs on every chunk. Re-rendering
 * the entire accumulated markdown each time is quadratic and rebuilds blocks
 * that are already complete — most visibly tables, code fences, and math, which
 * visibly flicker and reflow.
 *
 * The fix is to split the streamed text at a "stable boundary": the point up to
 * which the markdown is structurally complete and its rendering will not change
 * again. Everything before it is rendered once and kept; only the trailing
 * fragment is re-rendered per frame.
 *
 * A boundary is stable when it sits on a blank line with all fenced code blocks
 * closed and no unterminated block-level HTML tags. Content inside an open fence
 * is excluded because an unclosed fence swallows and restyles the lines that
 * follow it, and a partially written table row is still being extended.
 */

/** Opening fence line: up to 3 spaces of indent, then at least 3 backticks or tildes. */
const FENCE_LINE_PATTERN = /^ {0,3}(`{3,}|~{3,})/;

/**
 * Block-level tags whose content is rendered as a unit and therefore must be
 * complete before the text around them can be considered stable.
 */
const BLOCK_TAGS = ["think", "writeFile"] as const;

/** Tracks markdown block structure while scanning line by line. */
interface ScanState {
  /** Marker character of the currently open code fence, or null when closed. */
  openFence: string | null;
  /** Block tag names that have been opened more often than closed. */
  openTagCounts: Map<string, number>;
}

/**
 * Update scan state for a single line.
 *
 * @param line Line of markdown without its trailing newline.
 * @param state Mutable scan state.
 */
function scanLine(line: string, state: ScanState): void {
  const fenceMatch = line.match(FENCE_LINE_PATTERN);
  if (fenceMatch) {
    const marker = fenceMatch[1][0];
    if (state.openFence === null) {
      state.openFence = marker;
    } else if (state.openFence === marker) {
      state.openFence = null;
    }
    // Fence lines never contain block tags, so nothing else to scan.
    return;
  }

  // Inside an open fence, tag-like text is code, not markup.
  if (state.openFence !== null) {
    return;
  }

  for (const tag of BLOCK_TAGS) {
    const opens = line.split(`<${tag}>`).length - 1;
    const closes = line.split(`</${tag}>`).length - 1;
    if (opens === 0 && closes === 0) continue;

    const current = state.openTagCounts.get(tag) ?? 0;
    const next = current + opens - closes;
    state.openTagCounts.set(tag, Math.max(0, next));
  }
}

/**
 * Check whether the scanner is at a structurally complete point.
 *
 * @param state Scan state after processing the current line.
 * @returns True when no fence or block tag is left open.
 */
function isStructurallyComplete(state: ScanState): boolean {
  if (state.openFence !== null) return false;
  for (const count of state.openTagCounts.values()) {
    if (count > 0) return false;
  }
  return true;
}

/**
 * Find the offset up to which streamed markdown can be rendered once and kept.
 *
 * The offset always lands at the end of a blank line, so a partial line is never
 * split across the stable and unstable portions.
 *
 * @param content Accumulated markdown streamed so far.
 * @returns Character offset of the stable boundary; 0 when nothing is stable yet.
 */
export function findStableMarkdownBoundary(content: string): number {
  if (!content) return 0;

  const state: ScanState = { openFence: null, openTagCounts: new Map() };
  let boundary = 0;
  let lineStart = 0;

  for (let i = 0; i <= content.length; i++) {
    if (i !== content.length && content[i] !== "\n") continue;

    const line = content.slice(lineStart, i);
    scanLine(line, state);

    // A blank line ends the previous block. Once the structure is complete at
    // that point, everything up to and including it is safe to freeze.
    const isBlankLine = line.trim() === "";
    if (isBlankLine && isStructurallyComplete(state)) {
      boundary = i < content.length ? i + 1 : i;
    }

    lineStart = i + 1;
  }

  return boundary;
}
