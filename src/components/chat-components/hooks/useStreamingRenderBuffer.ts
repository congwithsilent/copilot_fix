import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Render buffer for streamed model output.
 *
 * Stream chunks arrive far faster than a reader can follow, and committing each
 * one to the markdown renderer produces the harsh typewriter effect: text jumps
 * a few characters at a time and every partial word flickers before it settles.
 *
 * This hook decouples "text received" from "text committed to the DOM". While
 * streaming, new characters are held and committed on a fixed cadence, so output
 * lands in readable gulps. Two escape hatches keep it from feeling laggy:
 *
 * - A chunk larger than `maxPendingChars` is committed immediately (a gulp that
 *   big is already a natural unit).
 * - Content that does not extend what is on screen (edit, regeneration) is
 *   committed immediately.
 *
 * When `enabled` is false the hook is transparent: it returns `content` as-is,
 * so the final render of a message is always complete and never delayed.
 */

export interface StreamingBufferConfig {
  /** Minimum gap between two committed renders, in milliseconds. */
  intervalMs: number;
  /** Commit immediately when pending text grows past this many characters. */
  maxPendingChars: number;
}

export const DEFAULT_STREAMING_BUFFER_CONFIG: StreamingBufferConfig = {
  intervalMs: 80,
  maxPendingChars: 320,
};

/**
 * Hold back streamed text so it is rendered in gulps rather than per chunk.
 *
 * @param content Latest streamed content for the message.
 * @param enabled Buffer only while the message is actively streaming.
 * @param config Cadence and immediate-flush threshold.
 * @returns Content that is safe to render now; equals `content` when disabled.
 */
export function useStreamingRenderBuffer(
  content: string,
  enabled: boolean,
  config: StreamingBufferConfig = DEFAULT_STREAMING_BUFFER_CONFIG
): string {
  const [buffered, setBuffered] = useState(content);
  const latestRef = useRef(content);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { intervalMs, maxPendingChars } = config;

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    latestRef.current = content;

    if (!enabled) {
      clearTimer();
      setBuffered(content);
      return;
    }

    // Replaced rather than extended (edit or regeneration): never show a stale
    // prefix, commit at once.
    if (!content.startsWith(buffered)) {
      clearTimer();
      setBuffered(content);
      return;
    }

    const pending = content.length - buffered.length;
    if (pending <= 0) {
      return;
    }

    // Big enough to be a gulp on its own.
    if (pending >= maxPendingChars) {
      clearTimer();
      setBuffered(content);
      return;
    }

    if (timerRef.current === null) {
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        setBuffered(latestRef.current);
      }, intervalMs);
    }
  }, [content, enabled, buffered, intervalMs, maxPendingChars, clearTimer]);

  useEffect(() => clearTimer, [clearTimer]);

  return enabled ? buffered : content;
}
