import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Smooth Stream Buffer — decouples network arrival from the UI render loop.
 *
 * A streaming backend delivers text in bursts (server batching, safety-audit
 * windows, jitter). Appending each burst to React state makes the UI inherit
 * that rhythm, which is what produces the stop-start "blocks popping in" feel.
 *
 * Here the two sides are fully separated:
 *
 *   receive side   pushChunk() breaks a burst into characters and drops them in
 *                  an in-memory queue, without touching React state.
 *   render side    a requestAnimationFrame loop drains that queue. The step per
 *                  frame adapts to how much is pending: a shallow queue advances
 *                  one or two characters per frame for a fine-grained flow, a
 *                  deep queue accelerates so the UI never falls behind the
 *                  network.
 *
 * Only the render side produces state updates, so frame pacing is owned by the
 * browser rather than by the transport.
 */

export interface UseSmoothStreamOptions {
  /** Queue-drain divisor: higher is smoother, lower catches up faster (8-12). */
  catchupFactor?: number;
  /** Text already known at mount, seeded without animating it in. */
  initialText?: string;
  /** Target frame interval in ms. 1000/60 by default. */
  frameIntervalMs?: number;
  /** Ceiling the target interval may degrade to when frames are overrunning. */
  maxFrameIntervalMs?: number;
  /** Consecutive overrunning frames before the loop slows itself down. */
  overrunFramesBeforeDegrade?: number;
  /** Timestamp source, injectable for tests. */
  now?: () => number;
}

export interface SmoothStream {
  /** Text that is safe to render now. */
  displayText: string;
  /** Enqueue a network chunk. Characters only enter the queue, never state. */
  pushChunk: (chunk: string) => void;
  /** Dump the whole queue at once; used when the stream ends or is stopped. */
  flush: () => void;
  /** Clear everything for a fresh stream. */
  reset: (text?: string) => void;
  /** Characters still waiting to be rendered. */
  pendingLength: () => number;
}

const scheduleFrame = (callback: FrameRequestCallback): number =>
  typeof requestAnimationFrame === "function"
    ? requestAnimationFrame(callback)
    : (setTimeout(() => callback(Date.now()), 16) as unknown as number);

const cancelFrame = (handle: number): void => {
  if (typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(handle);
    return;
  }
  clearTimeout(handle);
};

/**
 * Drive streamed text into the UI from a character queue via rAF.
 *
 * Besides the queue and the adaptive step, the loop watches how fast frames
 * actually come back. Rendering streamed markdown is real work (parsing plus a
 * DOM rebuild of the growing tail), and a slow consumer at 60fps is worse than
 * a slightly slower cadence: it janks. When frames consistently overrun, the
 * loop stretches its own interval towards `maxFrameIntervalMs` and the dynamic
 * step compensates by taking more characters per frame, so throughput is kept
 * while smoothness degrades gracefully instead of stuttering.
 *
 * @param options Tuning knobs and injectable clock.
 * @returns Renderable text plus queue controls.
 */
export function useSmoothStream(options: UseSmoothStreamOptions = {}): SmoothStream {
  const {
    catchupFactor = 10,
    initialText = "",
    frameIntervalMs = 1000 / 60,
    maxFrameIntervalMs = 1000 / 20,
    overrunFramesBeforeDegrade = 4,
    now = Date.now,
  } = options;

  const [displayText, setDisplayText] = useState(initialText);
  const queueRef = useRef<string[]>([]);
  const targetTextRef = useRef(initialText);
  const rafIdRef = useRef<number | null>(null);
  const lastTickAtRef = useRef(0);
  const overrunCountRef = useRef(0);
  const intervalRef = useRef(frameIntervalMs);

  const stopLoop = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
  }, []);

  const tick = useCallback((): void => {
    rafIdRef.current = null;

    const timestamp = now();
    const sinceLastTick = lastTickAtRef.current === 0 ? 0 : timestamp - lastTickAtRef.current;
    const target = intervalRef.current;

    // Adaptive pacing: back off when the consumer cannot hold the frame rate.
    if (sinceLastTick > Math.max(2 * target, 32)) {
      overrunCountRef.current += 1;
      if (overrunCountRef.current >= overrunFramesBeforeDegrade && target < maxFrameIntervalMs) {
        intervalRef.current = Math.min(maxFrameIntervalMs, target * 1.5);
        overrunCountRef.current = 0;
      }
    } else {
      overrunCountRef.current = 0;
    }

    if (queueRef.current.length === 0) {
      lastTickAtRef.current = timestamp;
      return;
    }

    // Not enough time has passed for the next frame at the current target.
    if (lastTickAtRef.current !== 0 && sinceLastTick < target) {
      rafIdRef.current = scheduleFrame(tick);
      return;
    }

    const step = Math.max(1, Math.ceil(queueRef.current.length / catchupFactor));
    const rendered = queueRef.current.splice(0, step).join("");

    targetTextRef.current += rendered;
    lastTickAtRef.current = timestamp;
    setDisplayText(targetTextRef.current);

    if (queueRef.current.length > 0) {
      rafIdRef.current = scheduleFrame(tick);
    }
  }, [catchupFactor, maxFrameIntervalMs, now, overrunFramesBeforeDegrade]);

  const ensureLoop = useCallback(() => {
    if (rafIdRef.current === null && queueRef.current.length > 0) {
      rafIdRef.current = scheduleFrame(tick);
    }
  }, [tick]);

  const pushChunk = useCallback(
    (chunk: string): void => {
      if (!chunk) {
        return;
      }

      for (const char of chunk) {
        queueRef.current.push(char);
      }

      ensureLoop();
    },
    [ensureLoop]
  );

  const flush = useCallback((): void => {
    stopLoop();

    if (queueRef.current.length === 0) {
      return;
    }

    targetTextRef.current += queueRef.current.join("");
    queueRef.current = [];
    setDisplayText(targetTextRef.current);
  }, [stopLoop]);

  const reset = useCallback(
    (text = ""): void => {
      stopLoop();
      queueRef.current = [];
      targetTextRef.current = text;
      lastTickAtRef.current = 0;
      overrunCountRef.current = 0;
      intervalRef.current = frameIntervalMs;
      setDisplayText(text);
    },
    [frameIntervalMs, stopLoop]
  );

  const pendingLength = useCallback((): number => queueRef.current.length, []);

  useEffect(() => stopLoop, [stopLoop]);

  return { displayText, pushChunk, flush, reset, pendingLength };
}
