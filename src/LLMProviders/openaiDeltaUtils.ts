/**
 * Shared helpers for normalizing OpenAI-compatible streaming deltas.
 *
 * Several providers in this plugin speak the OpenAI Chat Completions wire format
 * but deviate from it in ways that break LangChain's default delta conversion:
 *
 * - Aggregated gateways (Volcano Ark / 火山方舟, GitHub Copilot, LM Studio) proxy
 *   multiple model families. Claude-family responses may deliver `delta.content`
 *   as an array of content parts instead of a plain string. LangChain's
 *   `_streamResponseChunks` skips chunks whose content is not a string, which
 *   silently drops every text token.
 * - Some gateways omit `delta.role` entirely, causing the parent converter to
 *   fall through to a message type without `tool_call_chunks`, breaking tools.
 * - Reasoning/thinking models report chain-of-thought through non-standard delta
 *   fields (`reasoning_content`, `reasoning`, `reasoning_details`) that the
 *   parent converter discards, so downstream reasoning separation never triggers.
 *
 * These helpers normalize all three cases into shapes LangChain and
 * `ThinkBlockStreamer` already understand.
 */

/**
 * Flatten an OpenAI-compatible `delta.content` payload into plain text.
 *
 * Accepts the string form, the array-of-parts form used by Claude-family
 * responses, and the single-object `{ text }` form.
 *
 * @param content Raw `delta.content` value from a streaming chunk.
 * @returns Flattened text, or an empty string when no text is present.
 */
export function normalizeDeltaContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (content == null) return "";

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") {
          const text = (part as { text?: unknown }).text;
          if (typeof text === "string") return text;
        }
        return "";
      })
      .join("");
  }

  if (typeof content === "object" && typeof (content as { text?: unknown }).text === "string") {
    return (content as { text: string }).text;
  }

  return "";
}

/** Result of splitting an OpenAI-compatible `content` payload into text and reasoning. */
export interface SplitDeltaContent {
  /** Answer text, ready to become the chunk's string content. */
  text: string;
  /** Chain-of-thought text found in content parts, if any. */
  thinking?: string;
}

/**
 * Split an OpenAI-compatible `delta.content` payload into answer text and reasoning.
 *
 * Claude-family models proxied through OpenAI-format gateways can stream content
 * as an array of parts mixing `{ type: "text" }` and `{ type: "thinking" }`
 * entries. Flattening that array by taking only `.text` would silently discard
 * the reasoning, so thinking parts are collected separately and returned to the
 * caller for routing into the reasoning channel.
 *
 * @param content Raw `delta.content` value from a streaming chunk.
 * @returns The answer text plus any reasoning text found in content parts.
 */
export function splitDeltaContent(content: unknown): SplitDeltaContent {
  if (!Array.isArray(content)) {
    return { text: normalizeDeltaContent(content) };
  }

  let text = "";
  let thinking = "";

  for (const part of content) {
    if (typeof part === "string") {
      text += part;
      continue;
    }
    if (!part || typeof part !== "object") continue;

    const record = part as Record<string, unknown>;
    const type = typeof record.type === "string" ? record.type : undefined;

    if (type === "thinking" || type === "reasoning" || type === "reasoning_text") {
      thinking += normalizeReasoningPayload(record) ?? "";
      continue;
    }

    if (typeof record.text === "string") {
      text += record.text;
    }
  }

  return thinking ? { text, thinking } : { text };
}

/** Reasoning fields extracted from an OpenAI-compatible streaming delta. */
export interface DeltaReasoning {
  /** DeepSeek-style `reasoning_content` string. */
  reasoningContent?: string;
  /** OpenRouter-style `reasoning` string. */
  reasoning?: string;
  /** OpenRouter-style cumulative `reasoning_details` array. */
  reasoningDetails?: unknown[];
}

/**
 * Reduce an arbitrary reasoning payload to plain text.
 *
 * Gateways are inconsistent here: some send a bare string, some an array of
 * fragments, and some an object with a nested text field. All of them appear in
 * the wild for the same model, so every shape is handled.
 *
 * @param reasoning Raw reasoning payload from a delta.
 * @returns Normalized reasoning text, or undefined when nothing usable is present.
 */
export function normalizeReasoningPayload(reasoning: unknown): string | undefined {
  if (reasoning == null) return undefined;

  if (typeof reasoning === "string") {
    return reasoning || undefined;
  }

  if (Array.isArray(reasoning)) {
    const joined = reasoning
      .map((item) => normalizeReasoningPayload(item))
      .filter((item): item is string => Boolean(item))
      .join("");
    return joined || undefined;
  }

  if (typeof reasoning === "object") {
    const record = reasoning as Record<string, unknown>;
    const candidates = [
      record.reasoning_content,
      record.reasoning,
      record.output_text,
      record.text,
      record.thinking,
      record.content,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate) {
        return candidate;
      }
    }
  }

  return undefined;
}

/**
 * Extract reasoning/thinking payloads from an OpenAI-compatible delta.
 *
 * Early-exits without allocating when the delta carries no reasoning fields,
 * which is the common case for non-reasoning models.
 *
 * @param delta Streaming `delta` object from a chat completion chunk.
 * @returns Extracted reasoning fields; empty when the delta has none.
 */
export function extractReasoningFromDelta(delta: Record<string, any>): DeltaReasoning {
  const result: DeltaReasoning = {};

  const reasoningContent = normalizeReasoningPayload(delta.reasoning_content);
  if (reasoningContent) {
    result.reasoningContent = reasoningContent;
  }

  const reasoning = normalizeReasoningPayload(delta.reasoning);
  if (reasoning) {
    result.reasoning = reasoning;
  }

  const details = delta.reasoning_details;
  if (Array.isArray(details) && details.length > 0) {
    result.reasoningDetails = details;
  }

  return result;
}

/**
 * Write extracted reasoning fields into a message chunk's `additional_kwargs`
 * using the shapes downstream reasoning consumers already look for.
 *
 * `ThinkBlockStreamer` recognizes `reasoning_content` (DeepSeek branch) and
 * `additional_kwargs.delta.reasoning` (OpenRouter branch), so both are
 * populated to cover every provider that routes through this adapter.
 *
 * @param additionalKwargs Mutable `additional_kwargs` object on the chunk.
 * @param reasoning Reasoning fields extracted from the delta.
 */
export function applyReasoningToAdditionalKwargs(
  additionalKwargs: Record<string, unknown>,
  reasoning: DeltaReasoning
): void {
  if (reasoning.reasoningContent) {
    additionalKwargs.reasoning_content = reasoning.reasoningContent;
  }

  if (reasoning.reasoning) {
    const existingDelta = (additionalKwargs.delta as Record<string, unknown>) ?? {};
    additionalKwargs.delta = { ...existingDelta, reasoning: reasoning.reasoning };
  }

  if (reasoning.reasoningDetails) {
    additionalKwargs.reasoning_details = reasoning.reasoningDetails;
  }
}
