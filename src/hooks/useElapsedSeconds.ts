import { useEffect, useRef, useState } from "react";

/** Tick interval in milliseconds. One second is enough for a readable clock. */
const TICK_INTERVAL_MS = 1000;

/**
 * Tracks how long an activity has been running, in whole seconds.
 *
 * Time is derived from `Date.now()` against a start timestamp rather than by
 * accumulating tick counts, so a throttled or suspended interval (background
 * tab, long render) does not make the displayed time drift.
 *
 * @param isActive Whether the activity is currently running.
 * @returns Elapsed whole seconds; 0 while inactive.
 */
export function useElapsedSeconds(isActive: boolean): number {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const startTimeRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isActive) {
      startTimeRef.current = null;
      setElapsedSeconds(0);
      return;
    }

    startTimeRef.current = Date.now();
    setElapsedSeconds(0);

    const intervalId = setInterval(() => {
      if (startTimeRef.current === null) return;
      setElapsedSeconds(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, TICK_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [isActive]);

  return elapsedSeconds;
}
