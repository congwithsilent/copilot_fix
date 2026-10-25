import { Coins } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TokenUsage } from "@/types/message";
import React from "react";

interface TokenCounterProps {
  usage?: TokenUsage | null;
}

/**
 * Displays the context used and prompt-cache hit rate from the latest AI response.
 * Shows "<1k" for counts under 1000, otherwise rounded thousands (e.g., "5k"),
 * plus the percentage of input tokens served from the provider cache.
 * Returns null if no token count is available.
 */
export const TokenCounter: React.FC<TokenCounterProps> = ({ usage }) => {
  const tokenCount = usage?.totalTokens;
  if (tokenCount === null || tokenCount === undefined) {
    return null;
  }

  const formatTokenCount = (count: number): string => {
    if (count < 1000) {
      return "<1k";
    }
    return `${Math.floor(count / 1000)}k`;
  };

  const inputTokens = usage?.inputTokens;
  const cachedTokens = usage?.cachedInputTokens ?? 0;
  const hitRate =
    inputTokens && inputTokens > 0 && usage?.cachedInputTokens !== undefined
      ? cachedTokens / inputTokens
      : null;
  const hitRateLabel = hitRate !== null ? `${Math.round(hitRate * 100)}%` : null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="tw-flex tw-items-center tw-gap-1 tw-text-sm tw-text-faint">
          <Coins className="tw-size-3" />
          <span>
            {formatTokenCount(tokenCount)}
            {hitRateLabel ? ` · ${hitRateLabel}` : ""}
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent>
        Context used: {tokenCount.toLocaleString()}
        {inputTokens !== undefined ? ` · Input: ${inputTokens.toLocaleString()}` : ""}
        {hitRateLabel ? ` · Cache read: ${cachedTokens.toLocaleString()} (${hitRateLabel})` : ""}
        {usage?.cacheWriteTokens !== undefined
          ? ` · Cache write: ${usage.cacheWriteTokens.toLocaleString()}`
          : ""}
      </TooltipContent>
    </Tooltip>
  );
};
