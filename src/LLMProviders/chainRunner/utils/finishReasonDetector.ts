/**
 * Finish Reason Detection Utility
 *
 * This module provides utilities to detect when LLM responses are truncated
 * due to token limits across different providers (OpenAI, Anthropic, Google, etc.)
 */

export interface FinishReasonResult {
  /** Whether the response was truncated due to token limits */
  wasTruncated: boolean;
  /** User-friendly message explaining the truncation */
  message: string | null;
}

/**
 * Detects whether a response was truncated due to token limits
 * by examining the response metadata from various LLM providers.
 *
 * Supports:
 * - OpenAI (finish_reason: "length")
 * - Anthropic (stop_reason: "max_tokens")
 * - Google Gemini (finishReason: "MAX_TOKENS")
 * - DeepSeek (finish_reason: "length")
 * - Mistral (finish_reason: "length")
 * - Cohere (finish_reason: "MAX_TOKENS")
 * - Groq (finish_reason: "length")
 *
 * @param chunk The streaming chunk from the LLM (AIMessageChunk)
 * @returns FinishReasonResult with truncation status and details
 */
export function detectTruncation(chunk: any): FinishReasonResult {
  const metadata = chunk.response_metadata || {};

  // OpenAI, DeepSeek, Mistral, Groq use "length"
  if (metadata.finish_reason === "length") {
    return {
      wasTruncated: true,
      message: "Response truncated due to token limit",
    };
  }

  // Anthropic uses "max_tokens"
  if (metadata.stop_reason === "max_tokens") {
    return {
      wasTruncated: true,
      message: "Response truncated due to max_tokens limit",
    };
  }

  // Google Gemini and Cohere use "MAX_TOKENS"
  if (metadata.finishReason === "MAX_TOKENS" || metadata.finish_reason === "MAX_TOKENS") {
    return {
      wasTruncated: true,
      message: "Response truncated due to MAX_TOKENS limit",
    };
  }

  // No truncation detected
  return {
    wasTruncated: false,
    message: null,
  };
}

/** First finite numeric value among the candidates. */
function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

/**
 * Extract prompt-cache counters from a provider usage object.
 *
 * OpenAI reports `prompt_tokens_details.cached_tokens`; Anthropic reports
 * `cache_read_input_tokens` / `cache_creation_input_tokens`; OpenRouter also
 * exposes `cache_write_tokens` and `cache_discount`. All are optional.
 *
 * @param usage Provider usage object (snake_case or camelCase).
 * @returns Cache counters, omitting fields the provider did not report.
 */
function extractCacheUsage(usage: any): {
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
  cacheDiscount?: number;
} {
  if (!usage) return {};
  return {
    cachedInputTokens: firstNumber(
      usage.prompt_tokens_details?.cached_tokens,
      usage.promptTokensDetails?.cachedTokens,
      usage.cache_read_input_tokens,
      usage.cacheReadInputTokens,
      usage.input_token_details?.cache_read,
      usage.inputTokenDetails?.cacheRead
    ),
    cacheWriteTokens: firstNumber(
      usage.cache_write_tokens,
      usage.cacheWriteTokens,
      usage.cache_creation_input_tokens,
      usage.cacheCreationInputTokens,
      usage.input_token_details?.cache_creation,
      usage.inputTokenDetails?.cacheCreation
    ),
    cacheDiscount: firstNumber(usage.cache_discount, usage.cacheDiscount),
  };
}

/**
 * Extracts token usage information from response metadata.
 * Different providers use different field names and structures.
 *
 * @param chunk The streaming chunk from the LLM
 * @returns Token usage object or null if not available
 */
export function extractTokenUsage(chunk: any): {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
  cacheDiscount?: number;
} | null {
  const metadata = chunk.response_metadata || {};

  // OpenAI format: tokenUsage with camelCase
  if (metadata.tokenUsage) {
    return {
      inputTokens: metadata.tokenUsage.promptTokens,
      outputTokens: metadata.tokenUsage.completionTokens,
      totalTokens: metadata.tokenUsage.totalTokens,
      ...extractCacheUsage(metadata.tokenUsage),
    };
  }

  // Anthropic/Bedrock/others format: usage with snake_case or camelCase
  if (metadata.usage) {
    return {
      inputTokens:
        metadata.usage.input_tokens ||
        metadata.usage.inputTokens || // Bedrock camelCase
        metadata.usage.inputTokenCount || // Bedrock invocationMetrics
        metadata.usage.prompt_tokens,
      outputTokens:
        metadata.usage.output_tokens ||
        metadata.usage.outputTokens || // Bedrock camelCase
        metadata.usage.outputTokenCount || // Bedrock invocationMetrics
        metadata.usage.completion_tokens,
      totalTokens:
        metadata.usage.total_tokens ||
        metadata.usage.totalTokens || // Bedrock camelCase
        (metadata.usage.input_tokens || metadata.usage.inputTokenCount || 0) +
          (metadata.usage.output_tokens || metadata.usage.outputTokenCount || 0),
      ...extractCacheUsage(metadata.usage),
    };
  }

  // LangChain's usage_metadata format
  if (chunk.usage_metadata) {
    return {
      inputTokens: chunk.usage_metadata.input_tokens,
      outputTokens: chunk.usage_metadata.output_tokens,
      totalTokens: chunk.usage_metadata.total_tokens,
      ...extractCacheUsage(chunk.usage_metadata),
    };
  }

  return null;
}
