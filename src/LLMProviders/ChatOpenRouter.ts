import { BaseChatModelParams } from "@langchain/core/language_models/chat_models";
import { AIMessageChunk } from "@langchain/core/messages";
import type { UsageMetadata } from "@langchain/core/messages";
import { ChatGenerationChunk } from "@langchain/core/outputs";
import { ChatOpenAI } from "@langchain/openai";
import OpenAI from "openai";
import { logInfo } from "@/logger";

type OpenRouterChatChunk = OpenAI.ChatCompletionChunk;
type OpenRouterUsage = NonNullable<OpenRouterChatChunk["usage"]>;
type OpenRouterMessageParam = OpenAI.ChatCompletionMessageParam;

/**
 * ChatOpenRouter extends ChatOpenAI to support OpenRouter-specific features,
 * particularly reasoning/thinking tokens.
 *
 * OpenRouter exposes thinking tokens via the `reasoning` request parameter
 * and responds with `reasoning_details` in both streaming and non-streaming modes.
 *
 * @see https://openrouter.ai/docs/use-cases/reasoning-tokens
 */
export interface ChatOpenRouterInput extends BaseChatModelParams {
  /**
   * Enable reasoning/thinking tokens from OpenRouter
   * When true, requests will include reasoning parameters
   */
  enableReasoning?: boolean;

  /**
   * Reasoning effort level (e.g. "none", "minimal", "low", "medium", "high", "xhigh", "max", "auto")
   * Controls the amount of reasoning the model uses
   */
  reasoningEffort?: string;

  /**
   * Enable prompt caching (cache_control) for OpenRouter requests.
   * Defaults to true. Set to false for Zero Data Retention (ZDR) endpoints
   * that do not support prompt caching.
   */
  enablePromptCaching?: boolean;

  /**
   * Prompt-cache strategy. "auto" detects Claude vs OpenAI from the model id.
   * Claude uses Anthropic-style `cache_control`; OpenAI relies on automatic
   * prefix caching plus a sticky-routing session key.
   */
  promptCacheStrategy?: "auto" | "anthropic" | "openai" | "off";

  /** Anthropic cache TTL. Defaults to "5m". */
  promptCacheTtl?: "5m" | "1h";

  /**
   * OpenRouter service tier. "flex" requests the lower-cost, slower endpoints
   * when the model offers them; "default" leaves routing at standard rates.
   */
  serviceTier?: "default" | "flex";

  /**
   * Pin specific OpenRouter endpoints (provider.only), e.g.
   * ["google-ai-studio/flex"]. Empty leaves routing to OpenRouter.
   */
  providerOnly?: string[];

  /** Whether OpenRouter may fall back to other endpoints. Defaults to true. */
  allowFallbacks?: boolean;

  // All other ChatOpenAI parameters
  modelName?: string;
  apiKey?: string;
  configuration?: any;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  streaming?: boolean;
  maxRetries?: number;
  maxConcurrency?: number;
  [key: string]: any;
}

export class ChatOpenRouter extends ChatOpenAI {
  private enableReasoning: boolean;
  private reasoningEffort?: string;
  private enablePromptCaching: boolean;
  private promptCacheStrategy: "auto" | "anthropic" | "openai" | "off";
  private promptCacheTtl: "5m" | "1h";
  private serviceTier: "default" | "flex";
  private providerOnly: string[];
  private allowFallbacks: boolean;
  private openaiClient: OpenAI;
  /** True when the configured baseURL belongs to the OpenRouter gateway. */
  private isOpenRouter: boolean;

  constructor(fields: ChatOpenRouterInput) {
    const {
      enableReasoning = false,
      reasoningEffort,
      enablePromptCaching = true,
      promptCacheStrategy = "auto",
      promptCacheTtl = "5m",
      serviceTier = "default",
      providerOnly = [],
      allowFallbacks = true,
      ...rest
    } = fields;

    // Pass all other parameters to ChatOpenAI
    super(rest);

    this.enableReasoning = enableReasoning;
    this.reasoningEffort = reasoningEffort;
    this.enablePromptCaching = enablePromptCaching;
    this.promptCacheStrategy = promptCacheStrategy;
    this.promptCacheTtl = promptCacheTtl;
    this.serviceTier = serviceTier;
    this.providerOnly = providerOnly;
    this.allowFallbacks = allowFallbacks;

    const baseURL = fields.configuration?.baseURL || "https://openrouter.ai/api/v1";
    this.isOpenRouter = baseURL.includes("openrouter.ai");

    // Create our own OpenAI client for raw access
    this.openaiClient = new OpenAI({
      apiKey: fields.apiKey,
      baseURL,
      defaultHeaders: fields.configuration?.defaultHeaders,
      fetch: fields.configuration?.fetch,
      dangerouslyAllowBrowser: true,
    });
  }

  /**
   * Rebuild as `ChatOpenRouter`, not plain `ChatOpenAI`.
   *
   * `ChatOpenAI.withConfig` hardcodes `new ChatOpenAI(this.fields)`, and
   * `bindTools()` routes through it. Without this override, tool planning and
   * agent mode silently lose the OpenRouter-specific fields (reasoning, prompt
   * caching, and the delta normalization this class performs).
   *
   * @param config Call options to attach to the clone.
   * @returns A new ChatOpenRouter with the same configuration.
   */
  override withConfig(config: any): this {
    const newModel = new ChatOpenRouter({
      ...(this.fields as ChatOpenRouterInput),
      enableReasoning: this.enableReasoning,
      reasoningEffort: this.reasoningEffort,
      enablePromptCaching: this.enablePromptCaching,
      promptCacheStrategy: this.promptCacheStrategy,
      promptCacheTtl: this.promptCacheTtl,
      serviceTier: this.serviceTier,
      providerOnly: this.providerOnly,
      allowFallbacks: this.allowFallbacks,
    });
    newModel.defaultOptions = {
      ...this.defaultOptions,
      ...config,
    };
    return newModel as this;
  }

  /**
   * Override the invocation parameters to include prompt caching and reasoning when enabled.
   *
   * Prompt caching: The `cache_control` field opts Anthropic models (via OpenRouter) into
   * automatic cache breakpoint detection, reducing token costs on repeated context. This
   * field is only sent when connected to the OpenRouter gateway; other backends (LM Studio,
   * Copilot Plus) use the same class but must not receive OpenRouter-specific fields.
   *
   * @see https://openrouter.ai/docs/features/prompt-caching
   */
  override invocationParams(options?: this["ParsedCallOptions"]): any {
    const baseParams = super.invocationParams(options);

    // Only inject OpenRouter-specific fields for OpenRouter endpoints.
    // LM Studio, Copilot Plus, and other OpenAI-compatible backends share this
    // class but reject unknown top-level fields.
    let providerParams = this.isOpenRouter
      ? this.applyPromptCaching(baseParams, options as any)
      : baseParams;

    // Non-default tiers are opt-in. When the model has no flex endpoint,
    // OpenRouter ignores the hint and routes at standard rates.
    if (this.isOpenRouter && this.serviceTier === "flex") {
      providerParams = { ...providerParams, service_tier: "flex" };
    }

    // Pin explicit endpoints when the user configured them. A full endpoint
    // tag such as "google-ai-studio/flex" selects that provider and tier.
    if (this.isOpenRouter && this.providerOnly.length > 0) {
      providerParams = {
        ...providerParams,
        provider: {
          only: [...this.providerOnly],
          allow_fallbacks: this.allowFallbacks,
        },
      };
    }

    // Add reasoning parameter if enabled or if reasoningEffort is explicitly specified
    if (this.enableReasoning || this.reasoningEffort) {
      // Per OpenRouter docs:
      // - For models supporting effort: reasoning.effort or reasoning_effort
      // - Prefer effort if provided, otherwise fall back to max_tokens
      if (this.reasoningEffort) {
        logInfo(`OpenRouter reasoning enabled with effort: ${this.reasoningEffort}`);
        return {
          ...providerParams,
          reasoning: {
            effort: this.reasoningEffort,
          },
          reasoning_effort: this.reasoningEffort,
        };
      } else {
        logInfo(`OpenRouter reasoning enabled with max_tokens: 1024`);
        return {
          ...providerParams,
          reasoning: {
            max_tokens: 1024,
          },
        };
      }
    }

    return providerParams;
  }

  /**
   * Resolve which provider cache policy to apply.
   *
   * @returns "anthropic", "openai", or "off".
   */
  private resolvePromptCacheStrategy(): "anthropic" | "openai" | "off" {
    if (!this.enablePromptCaching) {
      return "off";
    }

    const configured = this.promptCacheStrategy ?? "auto";
    if (configured !== "auto") {
      return configured;
    }

    const modelName = String(
      (this as any).fields?.modelName || (this as any).fields?.model || ""
    ).toLowerCase();
    if (modelName.includes("claude")) {
      return "anthropic";
    }
    if (modelName.includes("gpt") || /(^|\/)(o1|o3|o4)([-/.]|$)/.test(modelName)) {
      return "openai";
    }

    // Preserve the historical default for unknown models.
    return "anthropic";
  }

  /**
   * Add the provider-specific cache fields to the request payload.
   *
   * - Anthropic: a top-level `cache_control` breakpoint (automatic caching).
   * - OpenAI: automatic prefix caching; `prompt_cache_key` doubles as the
   *   sticky-routing key when `session_id` is not supplied.
   * - Both: `session_id` keeps requests on the same upstream provider, whose
   *   cache is the one being reused.
   *
   * @param params Base invocation parameters.
   * @param options Call options, which may carry `session_id` from the runner.
   * @returns Parameters with cache fields applied.
   */
  private applyPromptCaching(params: any, options?: any): any {
    const strategy = this.resolvePromptCacheStrategy();
    if (strategy === "off") {
      return params;
    }

    const sessionId = typeof options?.session_id === "string" ? options.session_id : undefined;
    const withSession = sessionId ? { ...params, session_id: sessionId } : params;

    if (strategy === "anthropic") {
      return {
        ...withSession,
        cache_control: {
          type: "ephemeral",
          ...(this.promptCacheTtl === "1h" ? { ttl: "1h" } : {}),
        },
      };
    }

    return {
      ...withSession,
      ...(sessionId ? { prompt_cache_key: sessionId } : {}),
    };
  }

  /**
   * Override to use raw OpenAI SDK to access reasoning_details
   * LangChain filters out reasoning_details, so we bypass it completely
   */
  override async *_streamResponseChunks(
    messages: any[],
    options: this["ParsedCallOptions"],
    _runManager?: any
  ): AsyncGenerator<ChatGenerationChunk> {
    const params = this.invocationParams(options);
    const openaiMessages = this.toOpenRouterMessages(messages);

    const stream = (await this.openaiClient.chat.completions.create(
      {
        ...params,
        messages: openaiMessages,
        stream: true,
        stream_options: {
          ...(params.stream_options ?? {}),
          include_usage: true,
        },
      },
      // This override bypasses LangChain's request layer, so the abort signal
      // has to be forwarded explicitly. Without it, Stop leaves the request
      // running until the first token (or forever on a stalled stream).
      { signal: options.signal }
    )) as unknown as AsyncIterable<OpenRouterChatChunk>;

    let usageSummary: OpenRouterUsage | undefined;

    for await (const rawChunk of stream as AsyncIterable<OpenRouterChatChunk>) {
      if (rawChunk.usage) {
        usageSummary = rawChunk.usage;
      }

      const choice = rawChunk.choices?.[0];
      const delta = choice?.delta;
      if (!choice || !delta) {
        continue;
      }

      const reasoningText = this.normalizeReasoningChunk(
        (delta as Record<string, unknown>)?.reasoning
      );
      const reasoningDetails = this.extractReasoningDetails(choice);
      const content = this.extractDeltaContent(delta.content);

      const messageChunk = this.buildMessageChunk({
        rawChunk,
        delta,
        content,
        finishReason: choice.finish_reason,
        reasoningDetails,
        reasoningText,
      });

      const generationChunk = new ChatGenerationChunk({
        message: messageChunk,
        text: typeof messageChunk.content === "string" ? messageChunk.content : "",
        generationInfo: {
          finish_reason: choice.finish_reason,
          system_fingerprint: rawChunk.system_fingerprint,
          model: rawChunk.model,
        },
      });

      yield generationChunk;
      if (generationChunk.text) {
        await _runManager?.handleLLMNewToken(generationChunk.text);
      }
    }

    if (usageSummary) {
      yield this.buildUsageGenerationChunk(usageSummary);
    }

    if (options.signal?.aborted) {
      throw new Error("AbortError");
    }
  }

  /**
   * Convert LangChain messages to OpenRouter-ready messages.
   *
   * @param messages LangChain messages passed into the model
   * @returns Messages formatted for the OpenRouter API
   */
  private toOpenRouterMessages(messages: any[]): OpenRouterMessageParam[] {
    return messages.map((msg) => {
      const role = typeof msg._getType === "function" ? msg._getType() : (msg.role ?? "user");
      const mappedRole =
        role === "human"
          ? "user"
          : role === "ai"
            ? "assistant"
            : (role as OpenAI.ChatCompletionRole);

      if (msg.tool_call_id) {
        return {
          role: "tool",
          content: msg.content,
          tool_call_id: msg.tool_call_id,
        } as OpenRouterMessageParam;
      }

      if (msg.additional_kwargs?.function_call) {
        return {
          role: mappedRole,
          content: msg.content,
          function_call: msg.additional_kwargs.function_call,
        } as OpenRouterMessageParam;
      }

      // Handle modern tool_calls format (used by autonomous agent)
      if (msg.additional_kwargs?.tool_calls) {
        return {
          role: mappedRole,
          content: msg.content,
          tool_calls: msg.additional_kwargs.tool_calls,
        } as OpenRouterMessageParam;
      }

      return {
        role: mappedRole,
        content: msg.content,
      } as OpenRouterMessageParam;
    });
  }

  /**
   * Build an `AIMessageChunk` enriched with reasoning metadata.
   *
   * @param config Chunk configuration values extracted from the stream
   * @returns AI message chunk ready for downstream streaming utilities
   */
  private buildMessageChunk(config: {
    rawChunk: OpenRouterChatChunk;
    delta: Record<string, any>;
    content: string;
    finishReason: string | null | undefined;
    reasoningText?: string;
    reasoningDetails?: unknown[];
  }): AIMessageChunk {
    const { rawChunk, delta, content, finishReason, reasoningText, reasoningDetails } = config;
    const toolCallChunks = this.extractToolCallChunks(delta.tool_calls);

    const additionalKwargs: Record<string, unknown> = {};

    if (delta.function_call) {
      additionalKwargs.function_call = delta.function_call;
    }

    if (Array.isArray(delta.tool_calls)) {
      additionalKwargs.tool_calls = delta.tool_calls;
    }

    const deltaPayload: Record<string, unknown> = {};
    if (reasoningText) {
      deltaPayload.reasoning = reasoningText;
    }
    if (reasoningDetails && reasoningDetails.length > 0) {
      deltaPayload.reasoning_details = reasoningDetails;
    }

    if (Object.keys(deltaPayload).length > 0) {
      additionalKwargs.delta = {
        ...(additionalKwargs.delta as Record<string, unknown>),
        ...deltaPayload,
      };
    }

    if (reasoningDetails && reasoningDetails.length > 0) {
      additionalKwargs.reasoning_details = reasoningDetails;
    }

    const responseMetadata = this.buildResponseMetadata(rawChunk, finishReason);

    return new AIMessageChunk({
      content,
      additional_kwargs: additionalKwargs,
      tool_call_chunks: toolCallChunks,
      response_metadata: responseMetadata,
      id: rawChunk.id,
    });
  }

  /**
   * Normalize streamed reasoning payloads into plain text for the UI.
   *
   * @param reasoning Arbitrary reasoning payload returned by OpenRouter
   * @returns Normalized reasoning text or undefined
   */
  private normalizeReasoningChunk(reasoning: unknown): string | undefined {
    if (!reasoning) {
      return undefined;
    }

    if (typeof reasoning === "string") {
      return reasoning;
    }

    if (Array.isArray(reasoning)) {
      return reasoning
        .map((item) => this.normalizeReasoningChunk(item))
        .filter((item): item is string => Boolean(item))
        .join("");
    }

    if (typeof reasoning === "object") {
      const record = reasoning as Record<string, unknown>;
      const candidates = [
        record.output_text,
        record.text,
        record.reasoning,
        record.thinking,
        record.content,
      ];

      const normalized = candidates.find((value) => typeof value === "string");
      if (typeof normalized === "string") {
        return normalized;
      }
    }

    return undefined;
  }

  /**
   * Extract reasoning details arrays from the streamed choice payload.
   *
   * @param choice Chunk choice object from the OpenRouter stream
   * @returns Array of reasoning detail entries, if present
   */
  private extractReasoningDetails(choice: any): unknown[] | undefined {
    const candidate =
      choice?.delta?.reasoning_details ??
      choice?.message?.reasoning_details ??
      choice?.reasoning_details;

    if (!Array.isArray(candidate)) {
      return undefined;
    }

    return candidate.filter((detail) => detail !== undefined && detail !== null);
  }

  /**
   * Flatten OpenRouter delta content into a single text string.
   *
   * @param content Delta content payload
   * @returns Text representation for downstream streaming
   */
  private extractDeltaContent(content: unknown): string {
    if (typeof content === "string") {
      return content;
    }

    if (Array.isArray(content)) {
      return content
        .map((part) => {
          if (typeof part === "string") {
            return part;
          }
          if (part && typeof part === "object" && typeof part.text === "string") {
            return part.text;
          }
          return "";
        })
        .join("");
    }

    return "";
  }

  /**
   * Map raw OpenRouter tool call deltas into LangChain tool call chunks.
   *
   * @param toolCalls Tool call deltas returned by OpenRouter
   * @returns Tool call chunk array compatible with LangChain
   */
  private extractToolCallChunks(
    toolCalls: any
  ):
    | Array<{ name?: string; args?: string; id?: string; index?: number; type: "tool_call_chunk" }>
    | undefined {
    if (!Array.isArray(toolCalls)) {
      return undefined;
    }

    return toolCalls.map((call) => ({
      name: call?.function?.name,
      args: call?.function?.arguments,
      id: call?.id,
      index: call?.index,
      type: "tool_call_chunk" as const,
    }));
  }

  /**
   * Build response metadata payload with finish reason and usage info.
   *
   * @param rawChunk Raw streaming chunk from OpenRouter
   * @param finishReason Stop reason reported by the model
   * @returns Metadata object attached to each AI message chunk
   */
  private buildResponseMetadata(
    rawChunk: OpenRouterChatChunk,
    finishReason: string | null | undefined
  ): Record<string, unknown> {
    const metadata: Record<string, unknown> = {
      model_provider: "openrouter",
    };

    if (finishReason) {
      metadata.finish_reason = finishReason;
    }

    if (rawChunk.model) {
      metadata.model = rawChunk.model;
    }

    if (rawChunk.system_fingerprint) {
      metadata.system_fingerprint = rawChunk.system_fingerprint;
    }

    if (rawChunk.usage) {
      metadata.usage = { ...rawChunk.usage };
      metadata.tokenUsage = {
        promptTokens: rawChunk.usage.prompt_tokens,
        completionTokens: rawChunk.usage.completion_tokens,
        totalTokens: rawChunk.usage.total_tokens,
      };
    }

    return metadata;
  }

  /**
   * Create a terminal usage chunk so downstream consumers can capture token usage.
   *
   * @param usage Usage payload returned by the streaming API
   * @returns Chat generation chunk containing usage metadata
   */
  private buildUsageGenerationChunk(usage: OpenRouterUsage): ChatGenerationChunk {
    const inputTokenDetails: Record<string, number> = {};
    const outputTokenDetails: Record<string, number> = {};

    const promptDetails = usage.prompt_tokens_details ?? {};
    if (typeof promptDetails.audio_tokens === "number") {
      inputTokenDetails.audio = promptDetails.audio_tokens;
    }
    if (typeof promptDetails.cached_tokens === "number") {
      inputTokenDetails.cache_read = promptDetails.cached_tokens;
    }

    const completionDetails = usage.completion_tokens_details ?? {};
    if (typeof completionDetails.audio_tokens === "number") {
      outputTokenDetails.audio = completionDetails.audio_tokens;
    }
    if (typeof completionDetails.reasoning_tokens === "number") {
      outputTokenDetails.reasoning = completionDetails.reasoning_tokens;
    }

    const usageMetadata: UsageMetadata = {
      input_tokens: usage.prompt_tokens ?? 0,
      output_tokens: usage.completion_tokens ?? 0,
      total_tokens: usage.total_tokens ?? 0,
    };

    if (Object.keys(inputTokenDetails).length > 0) {
      usageMetadata.input_token_details = inputTokenDetails;
    }

    if (Object.keys(outputTokenDetails).length > 0) {
      usageMetadata.output_token_details = outputTokenDetails;
    }

    const messageChunk = new AIMessageChunk({
      content: "",
      response_metadata: { usage: { ...usage } },
      usage_metadata: usageMetadata,
    });

    return new ChatGenerationChunk({
      message: messageChunk,
      text: "",
    });
  }
}
