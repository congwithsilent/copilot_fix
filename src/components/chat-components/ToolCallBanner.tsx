import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { ToolResultFormatter } from "@/tools/ToolResultFormatter";
import { Check, ChevronRight, Loader2, X } from "lucide-react";
import React, { useMemo, useState } from "react";

interface ToolCallBannerProps {
  toolName: string;
  displayName: string;
  emoji: string;
  isExecuting: boolean;
  result: string | null;
  confirmationMessage?: string | null;
  onAccept?: () => void;
  onReject?: () => void;
}

const MAX_DISPLAY_CHARS = 5_000;

/**
 * Produce a display-friendly tool result while guarding against oversized payloads.
 * Large strings are summarized instead of rendered to keep the UI responsive.
 * @param toolName Name of the tool that produced the result
 * @param result Raw tool result string (possibly null if there is nothing to show yet)
 * @returns Formatted result or a guardrail message; null when there is nothing to show
 */
const formatToolResult = (toolName: string, result: string | null): string | null => {
  if (!result) {
    return null;
  }

  if (result.length > MAX_DISPLAY_CHARS) {
    return `Tool '${toolName}' returned ${result.length.toLocaleString()} characters. The full output is preserved in chat history but omitted here to keep the UI responsive.`;
  }

  try {
    const formatted = ToolResultFormatter.format(toolName, result);
    if (formatted.length > MAX_DISPLAY_CHARS) {
      return (
        formatted.slice(0, MAX_DISPLAY_CHARS) +
        `\n\n… (truncated ${(formatted.length - MAX_DISPLAY_CHARS).toLocaleString()} characters for display)`
      );
    }
    return formatted;
  } catch {
    return result.length > MAX_DISPLAY_CHARS
      ? `Tool '${toolName}' returned ${result.length.toLocaleString()} characters. The full output is preserved in chat history but omitted here to keep the UI responsive.`
      : result;
  }
};

/**
 * Render one concise, progressively disclosed step in an agent's activity trail.
 */
export const ToolCallBanner: React.FC<ToolCallBannerProps> = ({
  toolName,
  displayName,
  emoji,
  isExecuting,
  result,
  confirmationMessage,
  onAccept,
  onReject,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  const formattedResult = useMemo(() => formatToolResult(toolName, result), [toolName, result]);
  const actuallyExecuting = isExecuting && !result;
  const canExpand = !actuallyExecuting && formattedResult !== null;

  return (
    <Collapsible
      open={canExpand ? isOpen : false}
      onOpenChange={setIsOpen}
      disabled={!canExpand}
      aria-disabled={!canExpand}
      className="copilot-tool-call tw-my-1 tw-w-full"
    >
      <div
        className={cn(
          "copilot-tool-surface tw-rounded-md",
          actuallyExecuting ? "tw-bg-secondary/50" : "tw-bg-transparent"
        )}
        data-executing={actuallyExecuting}
      >
        <CollapsibleTrigger
          className={cn(
            "tw-flex tw-w-full tw-items-center tw-justify-between tw-gap-2 tw-rounded-md tw-p-2 tw-text-left tw-text-sm",
            canExpand && "hover:tw-bg-secondary/60",
            !canExpand && "tw-cursor-default"
          )}
        >
          <div className="tw-flex tw-min-w-0 tw-items-center tw-gap-2">
            <span className="tw-flex tw-size-4 tw-shrink-0 tw-items-center tw-justify-center">
              {actuallyExecuting ? (
                <Loader2 className="tw-size-3.5 tw-animate-spin tw-text-accent" />
              ) : (
                <span aria-hidden="true">{emoji}</span>
              )}
            </span>
            <span className="tw-truncate tw-font-medium">
              {toolName === "readNote"
                ? `${actuallyExecuting ? "Reading" : "Read"} ${displayName}`
                : `${actuallyExecuting ? "Calling" : "Called"} ${displayName}`}
              {actuallyExecuting && toolName !== "readNote" && "…"}
            </span>
            {actuallyExecuting && confirmationMessage && (
              <span className="tw-truncate tw-text-xs tw-text-muted">{confirmationMessage}…</span>
            )}
          </div>

          <div className="tw-flex tw-shrink-0 tw-items-center tw-gap-1">
            {!actuallyExecuting && onAccept && onReject && (
              <>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onAccept();
                  }}
                  className="hover:tw-bg-green-rgb/20 tw-rounded tw-p-1"
                  title="Accept"
                >
                  <Check className="tw-size-4 tw-text-success" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onReject();
                  }}
                  className="hover:tw-bg-red-rgb/20 tw-rounded tw-p-1"
                  title="Reject"
                >
                  <X className="tw-size-4 tw-text-error" />
                </button>
              </>
            )}

            {canExpand && (
              <ChevronRight
                className={cn(
                  "tw-size-3.5 tw-text-muted tw-transition-transform",
                  isOpen && "tw-rotate-90"
                )}
              />
            )}
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="tw-mx-2 tw-border-l tw-border-border tw-pb-2 tw-pl-3 tw-pr-2">
            <div className="tw-text-sm tw-text-muted">
              <pre className="tw-overflow-x-auto tw-whitespace-pre-wrap tw-font-mono tw-text-xs">
                {formattedResult ?? "No result available"}
              </pre>
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
};
