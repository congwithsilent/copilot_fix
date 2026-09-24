/**
 * Progressive reveal for streamed model output.
 *
 * The streaming renderer rebuilds a segment's markdown on every committed
 * chunk, so block elements are new DOM nodes even when their content has not
 * changed. Animating all of them would make the whole message pulse on every
 * commit. Instead only blocks that are *new since the previous commit* are
 * animated, tracked by their position: while a block is still being written to
 * it keeps its index and therefore never re-animates, and a block that appears
 * below it animates exactly once.
 *
 * The module is DOM-only on purpose so the rule can be tested without React.
 */

/** Class driving the default fade-in. */
export const STREAM_REVEAL_CLASS = "copilot-stream-reveal";

/** Class driving the optional left-to-right wipe. */
export const STREAM_REVEAL_WIPE_CLASS = "copilot-stream-reveal-wipe";

/**
 * Class driving the fade applied to characters appended to the block currently
 * being written. Block-level reveal alone still lets the growing block jump a
 * gulp at a time; wrapping the appended run in this class makes it dissolve in.
 */
export const STREAM_REVEAL_INLINE_CLASS = "copilot-stream-reveal-inline";

/** Available reveal animations. */
export type StreamRevealVariant = "fade" | "wipe";

/**
 * Variant used for new blocks. Switch to "wipe" for the left-to-right wipe
 * look; both classes are shipped in the stylesheet.
 */
export const STREAM_REVEAL_VARIANT: StreamRevealVariant = "fade";

/** Duration of the block-level reveal; must match `.copilot-stream-reveal`. */
export const STREAM_REVEAL_DURATION_MS = 240;

/** Duration of the inline reveal; must match `.copilot-stream-reveal-inline`. */
export const STREAM_REVEAL_INLINE_DURATION_MS = 280;

/**
 * Resolve the CSS class for a variant.
 *
 * @param variant Reveal variant.
 * @returns Class name to add to newly revealed blocks.
 */
export function revealClassFor(variant: StreamRevealVariant = STREAM_REVEAL_VARIANT): string {
  return variant === "wipe" ? STREAM_REVEAL_WIPE_CLASS : STREAM_REVEAL_CLASS;
}

/**
 * Resolve the CSS class used for appended inline text.
 *
 * @param variant Reveal variant.
 * @returns Class name to wrap appended characters in.
 */
export function revealInlineClassFor(variant: StreamRevealVariant = STREAM_REVEAL_VARIANT): string {
  return variant === "wipe" ? `${STREAM_REVEAL_INLINE_CLASS}-wipe` : STREAM_REVEAL_INLINE_CLASS;
}

/**
 * Collect the block elements of a rendered message segment in document order.
 *
 * A streaming segment nests its blocks inside `.message-segment-stable` and
 * `.message-segment-tail` wrappers; both contribute blocks to the same
 * sequence, stable first.
 *
 * @param segment Rendered segment container.
 * @returns Block elements to consider for reveal.
 */
export function collectRevealTargets(segment: HTMLElement): HTMLElement[] {
  const targets: HTMLElement[] = [];

  for (const child of Array.from(segment.children)) {
    const el = child as HTMLElement;
    const isStreamingWrapper =
      el.classList.contains("message-segment-stable") ||
      el.classList.contains("message-segment-tail");

    if (isStreamingWrapper) {
      for (const nested of Array.from(el.children)) {
        targets.push(nested as HTMLElement);
      }
    } else {
      targets.push(el);
    }
  }

  return targets;
}

/** Options for {@link revealBlocks}. */
export interface RevealBlocksOptions {
  /** Animation class to add to blocks that are still revealing. */
  className: string;
  /** Animation duration in ms; must match the class in the stylesheet. */
  durationMs: number;
  /** Current timestamp, used to compute how far a reveal has progressed. */
  now: number;
}

/**
 * Animate the blocks that are still revealing at this commit.
 *
 * A block keeps its index while it is on screen, so its reveal state survives
 * the renderer recreating its DOM: a block seen for the first time starts the
 * animation from zero, and a block that is still within its animation window is
 * resumed with a negative `animation-delay` equal to its age. Without that
 * resume the next commit recreates the element without the class and the fade
 * is cut short, which is exactly what makes output look like it is being spat
 * out block by block.
 *
 * @param targets Block elements in document order.
 * @param previousTimes First-seen timestamp per block index at the last commit.
 * @param options Animation class, duration, and current time.
 * @returns First-seen timestamps for the next commit.
 */
export function revealBlocks(
  targets: HTMLElement[],
  previousTimes: number[],
  options: RevealBlocksOptions
): number[] {
  const { className, durationMs, now } = options;
  const times: number[] = [];

  for (let i = 0; i < targets.length; i++) {
    const firstSeenAt = i < previousTimes.length ? previousTimes[i] : now;
    times.push(firstSeenAt);

    const el = targets[i];
    const age = now - firstSeenAt;
    if (age < 0 || age >= durationMs) {
      // Already fully revealed, or an element the renderer chose to keep: drop
      // any stale animation state so a finished reveal never replays.
      el.classList.remove(className);
      el.style.animationDelay = "";
      continue;
    }

    el.classList.add(className);
    if (age > 0) {
      el.style.animationDelay = `-${age}ms`;
    }
  }

  return times;
}

/**
 * Find the last text node that carries visible characters.
 *
 * Renderers commonly leave whitespace-only text nodes at the end of a block;
 * wrapping one of those would animate nothing.
 *
 * @param root Element to search.
 * @returns Last non-empty text node, or null.
 */
function findLastVisibleTextNode(root: HTMLElement): Text | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) {
    nodes.push(walker.currentNode as Text);
  }

  for (let i = nodes.length - 1; i >= 0; i--) {
    if (nodes[i].data.trim().length > 0) {
      return nodes[i];
    }
  }

  return null;
}

/** One gulp of appended text. */
export interface RevealMark {
  /** Cumulative tail length at the moment the gulp landed. */
  length: number;
  /** Timestamp at which it landed. */
  at: number;
}

/** Reveal state of a segment's tail across commits. */
export interface AppendedTextState {
  /** Plain text of the tail at the previous commit. */
  text: string;
  /** Length of the tail text that is already fully revealed. */
  settled: number;
  /** Gulps that are still animating, oldest first. */
  marks: RevealMark[];
}

/** State to use when nothing has been revealed yet. */
export const EMPTY_APPENDED_TEXT_STATE: AppendedTextState = { text: "", settled: 0, marks: [] };

/** Options for {@link revealAppendedText}. */
export interface RevealAppendedTextOptions {
  /** Inline animation class. */
  className: string;
  /** Animation duration in ms; must match the class in the stylesheet. */
  durationMs: number;
  /** Current timestamp. */
  now: number;
}

/**
 * Fade in the text appended since the previous commit, resuming the gulps that
 * are still fading.
 *
 * A single fade for "everything new" is not enough: the tail is re-rendered on
 * the next commit, which destroys the faded span and snaps that text to full
 * opacity mid-animation. So each gulp is remembered with the timestamp it
 * landed and re-wrapped on every subsequent commit with a negative
 * `animation-delay` equal to its age. The result is a rolling gradient of
 * opacity at the writing edge — a continuous dissolve — instead of one gulp
 * snapping to full brightness every commit.
 *
 * Only the last text node is touched, which is where the writing edge lives.
 * Anything that is not a clean extension of what was on screen (markdown
 * re-parse, text moved into the frozen prefix) is treated as settled instead of
 * animated wrongly.
 *
 * @param container Element holding the freshly rendered tail.
 * @param previous Reveal state from the previous commit.
 * @param options Animation class, duration, and current time.
 * @returns State to carry into the next commit.
 */
export function revealAppendedText(
  container: HTMLElement,
  previous: AppendedTextState,
  options: RevealAppendedTextOptions
): AppendedTextState {
  const { className, durationMs, now } = options;
  const currentText = container?.textContent ?? "";
  const settledState: AppendedTextState = {
    text: currentText,
    settled: currentText.length,
    marks: [],
  };

  const { text: previousText, settled: previousSettled, marks: previousMarks } = previous;
  const isExtension =
    previousText.length > 0 &&
    currentText.startsWith(previousText) &&
    currentText.length > previousText.length;

  if (!isExtension) {
    return settledState;
  }

  // Retire gulps whose animation has finished; their text is settled now.
  let settled = Math.min(previousSettled, previousText.length);
  const marks: RevealMark[] = [];
  for (const mark of previousMarks) {
    if (now - mark.at >= durationMs) {
      settled = Math.max(settled, mark.length);
    } else {
      marks.push(mark);
    }
  }
  marks.push({ length: currentText.length, at: now });

  const textNode = findLastVisibleTextNode(container);
  if (!textNode || settled >= currentText.length) {
    return { text: currentText, settled, marks };
  }

  const parent = textNode.parentNode;
  if (!parent) {
    return { text: currentText, settled, marks };
  }

  const nodeText = textNode.data;
  const nodeStart = currentText.length - nodeText.length;
  const fragment = document.createDocumentFragment();

  // Text of this node that predates the fading region stays plain.
  const headEnd = Math.max(0, Math.min(settled - nodeStart, nodeText.length));
  if (headEnd > 0) {
    fragment.appendChild(document.createTextNode(nodeText.slice(0, headEnd)));
  }

  let regionStart = settled;
  for (const mark of marks) {
    const regionEnd = Math.min(mark.length, currentText.length);
    const localStart = Math.max(regionStart, nodeStart) - nodeStart;
    const localEnd = Math.min(regionEnd, currentText.length) - nodeStart;

    if (regionEnd > regionStart && localEnd > localStart && localStart < nodeText.length) {
      const span = document.createElement("span");
      span.className = className;
      const age = now - mark.at;
      if (age > 0) {
        span.style.animationDelay = `-${age}ms`;
      }
      span.textContent = nodeText.slice(localStart, Math.min(localEnd, nodeText.length));
      fragment.appendChild(span);
    }

    regionStart = Math.max(regionStart, regionEnd);
  }

  // Anything of this node after the last gulp (trailing markup whitespace).
  if (regionStart < currentText.length) {
    const localStart = regionStart - nodeStart;
    if (localStart >= 0 && localStart < nodeText.length) {
      fragment.appendChild(document.createTextNode(nodeText.slice(localStart)));
    }
  }

  parent.replaceChild(fragment, textNode);

  return { text: currentText, settled, marks };
}
