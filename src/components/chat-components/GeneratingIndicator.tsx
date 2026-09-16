import { useElapsedSeconds } from "@/hooks/useElapsedSeconds";
import { formatElapsedTime } from "@/utils/formatElapsedTime";
import React from "react";

interface GeneratingIndicatorProps {
  /** Whether the model is currently generating. */
  isGenerating: boolean;
  /** Optional stage label, such as "Reading files". */
  loadingMessage?: string;
}

/**
 * Three-dot pulse, rendered in CSS rather than by a timer-driven React state.
 *
 * The previous implementation advanced the dots from a 200ms `setInterval`
 * inside the message list, re-rendering the whole tree several times a second
 * for a purely decorative effect.
 */
const StreamingDots: React.FC = () => (
  <span className="copilot-streaming-dots" aria-hidden="true">
    <span />
    <span />
    <span />
  </span>
);

/**
 * Status line shown while the model is generating.
 *
 * Reports the stage label (when one is set) alongside a live elapsed-time
 * counter, so a slow first token reads as "still working" rather than an
 * ambiguous spinner. The elapsed clock also makes a stuck request obvious
 * instead of leaving the user to guess.
 */
export const GeneratingIndicator: React.FC<GeneratingIndicatorProps> = ({
  isGenerating,
  loadingMessage,
}) => {
  const elapsedSeconds = useElapsedSeconds(isGenerating);

  if (!isGenerating) {
    return null;
  }

  return (
    <div
      className="copilot-generating-indicator tw-flex tw-min-w-0 tw-items-center tw-gap-1.5 tw-px-1 tw-text-sm tw-text-muted"
      role="status"
      aria-live="polite"
    >
      <StreamingDots />
      {loadingMessage ? (
        <span className="tw-truncate">{loadingMessage}</span>
      ) : (
        <span>Generating</span>
      )}
      <span className="copilot-generating-timer tw-text-faint">
        {formatElapsedTime(elapsedSeconds)}
      </span>
    </div>
  );
};

export default GeneratingIndicator;
