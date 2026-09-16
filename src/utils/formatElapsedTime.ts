/**
 * Formats a duration in seconds into a compact, human-readable label.
 *
 * Used by the wait indicator and the reasoning block so both surfaces report
 * elapsed time identically.
 *
 * @param seconds Elapsed time in whole seconds. Negative values clamp to 0.
 * @returns A short label such as "9s", "1m 05s", or "1h 02m".
 */
export function formatElapsedTime(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));

  if (safeSeconds < 60) {
    return `${safeSeconds}s`;
  }

  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;

  if (minutes < 60) {
    return `${minutes}m ${String(remainingSeconds).padStart(2, "0")}s`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${String(remainingMinutes).padStart(2, "0")}m`;
}
