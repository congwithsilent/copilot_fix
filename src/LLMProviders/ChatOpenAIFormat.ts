import type { BaseMessageChunk } from "@langchain/core/messages";
import { ChatOpenAI, ChatOpenAICompletions } from "@langchain/openai";
import {
  applyReasoningToAdditionalKwargs,
  extractReasoningFromDelta,
  splitDeltaContent,
} from "./openaiDeltaUtils";
import { logInfo } from "@/logger";

/**
 * `ChatOpenAICompletions` with OpenAI-format streaming deltas normalized.
 *
 * Aggregated gateways (Volcano Ark / 火山方舟, and others exposing one endpoint
 * for many model families) proxy Claude-family models that stream
 * `delta.content` as an array of content parts. LangChain's default converter
 * passes that array straight into the message chunk, after which
 * `ChatOpenAICompletions._streamResponseChunks` discards the whole chunk because
 * `typeof content !== "string"` — silently dropping every text token.
 *
 * The same converter also rebuilds `additional_kwargs` from only
 * `function_call` / `tool_calls`, so non-standard reasoning fields
 * (`reasoning_content`, `reasoning`, `reasoning_details`) never reach
 * `ThinkBlockStreamer`, which is why chain-of-thought leaks into the answer.
 *
 * Both problems are fixed at the delta boundary, before LangChain inspects the
 * content or drops the fields.
 */
class ChatOpenAIFormatCompletions extends ChatOpenAICompletions {
  /**
   * Normalize a streaming delta before LangChain converts it to a message chunk.
   *
   * Applied fixes, all required for correct output from aggregated gateways:
   * 1. Array/object `content` is flattened to a string so the parent's
   *    string-only guard does not discard the chunk.
   * 2. Reasoning fields are preserved in `additional_kwargs` so the reasoning
   *    streamer can separate thinking from the answer.
   * 3. A missing `delta.role` defaults to `assistant`, preventing a fall-through
   *    to `ChatMessageChunk`, which has no `tool_call_chunks` and would break
   *    native tool calling.
   *
   * `delta.content` is mutated in place rather than spread because OpenAI SDK
   * delta objects can carry non-enumerable properties (notably `tool_calls`)
   * that a spread would silently drop. Each delta is a single-use chunk, so
   * mutation is safe.
   */
  protected override _convertCompletionsDeltaToBaseMessageChunk(
    delta: Record<string, any>,
    rawResponse: any,
    defaultRole?: any
  ): BaseMessageChunk {
    // Split rather than flatten: array content can mix answer text with thinking
    // parts, and the thinking must be routed to the reasoning channel instead of
    // being discarded with the rest of the array.
    const split = splitDeltaContent(delta.content);
    delta.content = split.text;

    const reasoning = extractReasoningFromDelta(delta);

    // Thinking carried inside content parts is folded into the reasoning channel.
    const reasoningContent = reasoning.reasoningContent ?? split.thinking;
    const hasReasoning = Boolean(
      reasoningContent || reasoning.reasoning || reasoning.reasoningDetails
    );

    if (!delta.role && !defaultRole) {
      defaultRole = "assistant";
    }

    const chunk = super._convertCompletionsDeltaToBaseMessageChunk(delta, rawResponse, defaultRole);

    // Merge reasoning into the chunk the parent produced. The parent only sets
    // additional_kwargs from function_call/tool_calls, so these fields are
    // otherwise lost.
    if (hasReasoning) {
      const additionalKwargs = (chunk.additional_kwargs ?? {}) as Record<string, unknown>;
      applyReasoningToAdditionalKwargs(additionalKwargs, { ...reasoning, reasoningContent });

      chunk.additional_kwargs = additionalKwargs;
    }

    return chunk;
  }

  public thinking?: { type: string; [key: string]: any };
  public reasoningEffort?: string;

  constructor(fields?: any) {
    super(fields);
    if (fields?.reasoningEffort) {
      this.reasoningEffort = fields.reasoningEffort;
    } else if (fields?.reasoning?.effort) {
      this.reasoningEffort = fields.reasoning.effort;
    }

    if (fields?.thinking) {
      this.thinking = fields.thinking;
    } else if (fields?.disableThinking || this.reasoningEffort === "none") {
      this.thinking = { type: "disabled" };
    }
  }

  /**
   * Intercept requests sent to the OpenAI client to normalize payloads for
   * OpenAI-compatible providers (such as Volcano Ark / 火山方舟, SiliconFlow, DeepSeek, etc.):
   * 1. Inject explicit `reasoning_effort` and `reasoning.effort` if configured.
   * 2. Inject top-level `thinking` parameter if configured (e.g. `{ type: "disabled" }`).
   * 3. Ensure multimodal user messages have file parts before text parts.
   */
  override async completionWithRetry(request: any, requestOptions?: any): Promise<any> {
    if (this.reasoningEffort && request) {
      if (request.reasoning_effort === undefined) {
        request.reasoning_effort = this.reasoningEffort;
      }
      if (request.reasoning === undefined) {
        request.reasoning = { effort: this.reasoningEffort };
      }
    }

    if (this.thinking && request && request.thinking === undefined) {
      request.thinking = this.thinking;
    }

    if (Array.isArray(request?.messages)) {
      for (const msg of request.messages) {
        if (Array.isArray(msg?.content)) {
          const files = msg.content.filter((c: any) => c?.type === "file");
          const nonFiles = msg.content.filter((c: any) => c?.type !== "file");
          msg.content = [...files, ...nonFiles];
        }
      }
    }

    return super.completionWithRetry(request, requestOptions);
  }
}

/** Constructor fields for {@link ChatOpenAIFormat}. Mirrors `ChatOpenAI` fields with thinking and reasoning additions. */
export type ChatOpenAIFormatFields = ConstructorParameters<typeof ChatOpenAI>[0] & {
  thinking?: { type: string; [key: string]: any };
  disableThinking?: boolean;
  reasoningEffort?: string;
};

/**
 * Chat model for OpenAI-Format / OpenAI-compatible endpoints.
 *
 * Extends `ChatOpenAI` rather than `ChatOpenAICompletions` so that models
 * requiring the Responses API (GPT-5, per `createModelInstance`) keep working.
 * `ChatOpenAI` delegates streaming to an internal `completions` instance, so
 * overriding the delta converter on a `ChatOpenAI` subclass directly would be
 * dead code — the normalized instance must be injected through the `completions`
 * constructor field instead.
 */
export class ChatOpenAIFormat extends ChatOpenAI {
  public thinking?: { type: string; [key: string]: any };
  public reasoningEffort?: string;

  constructor(fields?: ChatOpenAIFormatFields) {
    super(fields);

    if (fields?.reasoningEffort) {
      this.reasoningEffort = fields.reasoningEffort;
    } else if (fields?.reasoning?.effort) {
      this.reasoningEffort = fields.reasoning.effort;
    }

    if (fields?.thinking) {
      this.thinking = fields.thinking;
    } else if (fields?.disableThinking || this.reasoningEffort === "none") {
      this.thinking = { type: "disabled" };
    }

    // ChatOpenAI uses this instance for every non-Responses-API request.
    // Assigned after super() rather than passed in `fields` so the injected
    // instance is not also forwarded to the Responses API instance.
    this.completions = new ChatOpenAIFormatCompletions({
      ...fields,
      thinking: this.thinking,
      reasoningEffort: this.reasoningEffort,
    } as any);

    logInfo("[ChatOpenAIFormat] Initialized with streaming delta normalization");
  }

  /**
   * Rebuild as `ChatOpenAIFormat`, not `ChatOpenAI`.
   *
   * The inherited implementation hardcodes `new ChatOpenAI(this.fields)`, which
   * would discard the normalizing completions instance on the main chat path
   * (chain construction calls `llm.withConfig({ signal })`). Rebuilding from the
   * constructor keeps the adapter attached.
   */
  override withConfig(config: any): this {
    const newModel = new ChatOpenAIFormat({
      ...(this.fields as ChatOpenAIFormatFields),
      thinking: this.thinking,
      reasoningEffort: this.reasoningEffort,
    });
    newModel.defaultOptions = {
      ...this.defaultOptions,
      ...config,
    };
    return newModel as this;
  }

  /** LangChain model type identifier. */
  override _llmType(): string {
    return "openai-format";
  }
}
