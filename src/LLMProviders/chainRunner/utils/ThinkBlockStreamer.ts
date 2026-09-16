import { StreamingResult, TokenUsage } from "@/types/message";
import { AIMessage } from "@langchain/core/messages";
import { detectTruncation, extractTokenUsage } from "./finishReasonDetector";
import { formatErrorChunk } from "@/utils/toolResultUtils";
import {
  NativeToolCall,
  ToolCallChunk,
  buildToolCallsFromChunks,
  createAIMessageWithToolCalls,
} from "./nativeToolCalling";
import { logInfo, logWarn } from "@/logger";
import { stripSpecialTokens } from "@/utils/stripSpecialTokens";

/**
 * ThinkBlockStreamer handles streaming content from various LLM providers
 * that support thinking/reasoning modes (like Claude and Deepseek).
 * Also accumulates native tool calls from tool_call_chunks during streaming.
 * Also detects truncation due to token limits across all providers.
 */
export class ThinkBlockStreamer {
  private hasOpenThinkBlock = false;
  private fullResponse = "";
  private errorResponse = "";
  private wasTruncated = false;
  private tokenUsage: TokenUsage | null = null;
  // Track if we've handled text-level think tags (e.g., from nvidia/nemotron)
  private hasHandledTextLevelThinkTag = false;
  // Character index where an excluded text-level think block started.
  // -1 means we're not currently inside an excluded block.
  private excludedThinkBlockStart = -1;

  // Native tool call accumulation
  private toolCallChunks: Map<number, ToolCallChunk> = new Map();
  private accumulatedToolCalls: NativeToolCall[] = [];

  constructor(
    private updateCurrentAiMessage: (message: string) => void,
    private excludeThinking: boolean = false
  ) {
    logInfo(`[ThinkBlockStreamer] Created with excludeThinking=${excludeThinking}`);
  }

  /**
   * Handle text-level think tags embedded in content (e.g., nvidia/nemotron, qwen3 models).
   * Some models output thinking with only </think> closing tag, no opening tag.
   * This method detects and fixes this during streaming.
   *
   * When excludeThinking is true, thinking content is suppressed during streaming
   * (not just stripped after the close tag arrives) by tracking the position where
   * the excluded block started and truncating fullResponse on each chunk.
   */
  private handleTextLevelThinkTags() {
    if (this.excludeThinking) {
      this.handleExcludedThinkTags();
      return;
    }

    const hasCloseTag = this.fullResponse.includes("</think>");
    const hasOpenTag = this.fullResponse.includes("<think>");

    if (!hasCloseTag) return;

    // excludeThinking is false - fix missing opening tag if needed
    if (!hasOpenTag && !this.hasHandledTextLevelThinkTag) {
      this.hasHandledTextLevelThinkTag = true;
      logWarn(
        "Detected </think> closing tag without opening <think> tag. " +
          "This may indicate a misconfigured chat template in LM Studio. Adding opening tag."
      );
      this.fullResponse = "<think>" + this.fullResponse;
    }
  }

  /**
   * Join the text around a removed think block without disturbing the answer's
   * own whitespace.
   *
   * The removed region acts as a boundary marker, not as content. Exactly one
   * newline is kept at the join when either side supplied one, so paragraph
   * breaks around the block survive while blank lines and indentation inside
   * `after` are preserved verbatim. Using `trimStart()` here would eat the
   * leading indentation of a code block that follows a think block.
   *
   * @param before Text preceding the block.
   * @param after Text following the block.
   * @returns The stitched text.
   */
  private joinAroundRemovedBlock(before: string, after: string): string {
    const beforeHasNewline = before.endsWith("\n");
    const afterHasNewline = after.startsWith("\n");

    const beforeTrimmed = beforeHasNewline ? before.slice(0, -1) : before;
    const afterTrimmed = afterHasNewline ? after.slice(1) : after;
    const separator = beforeHasNewline || afterHasNewline ? "\n" : "";

    return beforeTrimmed + separator + afterTrimmed;
  }

  /**
   * Strip text-level think tags when excludeThinking is true.
   * Handles three streaming states:
   * 1. Not inside a think block -- look for `<think>` to enter one
   * 2. Inside an incomplete block (no `</think>` yet) -- truncate to pre-block content
   * 3. Block just closed -- strip the complete block and exit the state
   */
  private handleExcludedThinkTags() {
    // Currently inside an excluded block from a previous chunk
    if (this.excludedThinkBlockStart >= 0) {
      const closeIdx = this.fullResponse.indexOf("</think>", this.excludedThinkBlockStart);
      if (closeIdx !== -1) {
        // Block closed -- stitch content before and after the block
        const before = this.fullResponse.substring(0, this.excludedThinkBlockStart);
        const after = this.fullResponse.substring(closeIdx + "</think>".length);
        this.fullResponse = this.joinAroundRemovedBlock(before, after);
        this.excludedThinkBlockStart = -1;
      } else {
        // Still streaming thinking -- truncate to the safe prefix
        this.fullResponse = this.fullResponse.substring(0, this.excludedThinkBlockStart);
      }
      return;
    }

    // Not inside a block -- check for a new one
    const openIdx = this.fullResponse.indexOf("<think>");
    if (openIdx !== -1) {
      this.excludedThinkBlockStart = openIdx;
      const closeIdx = this.fullResponse.indexOf("</think>", openIdx);
      if (closeIdx !== -1) {
        // Complete block in one pass
        const before = this.fullResponse.substring(0, openIdx);
        const after = this.fullResponse.substring(closeIdx + "</think>".length);
        this.fullResponse = this.joinAroundRemovedBlock(before, after);
        this.excludedThinkBlockStart = -1;
      } else {
        // Incomplete -- truncate
        this.fullResponse = this.fullResponse.substring(0, openIdx);
      }
      return;
    }

    // Handle malformed: only </think> without <think> (e.g., some chat templates)
    const closeIdx = this.fullResponse.indexOf("</think>");
    if (closeIdx !== -1) {
      const before = "";
      const after = this.fullResponse.substring(closeIdx + "</think>".length);
      this.fullResponse = this.joinAroundRemovedBlock(before, after);
    }
  }

  private handleClaudeChunk(content: any[]) {
    let textContent = "";
    let hasThinkingContent = false;
    for (const item of content) {
      switch (item.type) {
        case "text":
          textContent += item.text;
          break;
        case "thinking":
          hasThinkingContent = true;
          // Skip thinking content if excludeThinking is enabled
          if (this.excludeThinking) {
            break;
          }
          if (!this.hasOpenThinkBlock) {
            this.fullResponse += "\n<think>";
            this.hasOpenThinkBlock = true;
          }
          // Guard against undefined thinking content
          if (item.thinking !== undefined) {
            this.fullResponse += item.thinking;
          }
          this.updateCurrentAiMessage(this.fullResponse);
          break;
      }
    }
    // Close think block before adding text content
    if (textContent && this.hasOpenThinkBlock) {
      this.fullResponse += "</think>";
      this.hasOpenThinkBlock = false;
    }
    if (textContent) {
      this.fullResponse += stripSpecialTokens(textContent);
    }
    return hasThinkingContent;
  }

  /**
   * Handle DeepSeek-style chunks carrying `reasoning_content` alongside content.
   *
   * Ordering matters: a single chunk can deliver reasoning and answer text
   * together, and reasoning always precedes the answer it produced. Reasoning is
   * therefore written (and the think block opened) before any content text, so
   * the two streams cannot interleave.
   *
   * @param chunk Streamed chunk in DeepSeek/OpenAI-compatible format.
   * @returns True when the chunk carried reasoning content.
   */
  private handleDeepseekChunk(chunk: any): boolean {
    const reasoningContent = chunk.additional_kwargs?.reasoning_content;
    let handledThinking = false;

    // Reasoning first: it is produced before the answer text in the same chunk.
    if (reasoningContent !== undefined && reasoningContent !== null) {
      handledThinking = true;
      // Skip thinking content if excludeThinking is enabled
      if (!this.excludeThinking) {
        if (!this.hasOpenThinkBlock) {
          this.fullResponse += "\n<think>";
          this.hasOpenThinkBlock = true;
        }
        this.fullResponse += reasoningContent;
      }
    }

    // Handle standard string content. Empty strings are common on
    // reasoning-only chunks and must not close an in-progress think block.
    if (typeof chunk.content === "string" && chunk.content) {
      // Close the think block before any answer text is appended, so the answer
      // never lands inside the reasoning block.
      if (this.hasOpenThinkBlock) {
        this.fullResponse += "</think>";
        this.hasOpenThinkBlock = false;
      }
      this.fullResponse += stripSpecialTokens(chunk.content);
    }

    return handledThinking;
  }

  /**
   * Handle OpenRouter reasoning/thinking content
   *
   * OpenRouter exposes reasoning via two channels:
   * - delta.reasoning (streaming, token-by-token)
   * - reasoning_details (cumulative transcript array)
   *
   * STRATEGY: We use ONLY delta.reasoning for thinking content.
   *
   * Why delta-only?
   * - Provides minimal latency (streaming as tokens arrive)
   * - No duplication issues (single source of truth)
   * - No complex cumulative bookkeeping needed
   *
   * Trade-offs:
   * - Models that only populate reasoning_details (without delta.reasoning) won't show thinking
   * - This is acceptable for now as most models use delta.reasoning for streaming
   *
   * @param chunk Streamed chunk in OpenRouter format.
   */
  private handleOpenRouterChunk(chunk: any): void {
    // Only process delta.reasoning (streaming), ignore reasoning_details entirely.
    // Reasoning is written first because it is produced before the answer, even
    // when both arrive in the same chunk.
    if (chunk.additional_kwargs?.delta?.reasoning) {
      // Skip thinking content if excludeThinking is enabled, but still fall
      // through so any answer text in this chunk is not lost.
      if (!this.excludeThinking) {
        if (!this.hasOpenThinkBlock) {
          this.fullResponse += "\n<think>";
          this.hasOpenThinkBlock = true;
        }
        this.fullResponse += chunk.additional_kwargs.delta.reasoning;
      }
    }

    // Close think block before adding regular content
    if (typeof chunk.content === "string" && chunk.content && this.hasOpenThinkBlock) {
      this.fullResponse += "</think>";
      this.hasOpenThinkBlock = false;
    }

    // Handle standard string content (this is the actual response, not thinking).
    // stripSpecialTokens is applied for parity with the DeepSeek branch -- local
    // OpenAI-compatible servers leak chat-template tokens through either path.
    if (typeof chunk.content === "string" && chunk.content) {
      this.fullResponse += stripSpecialTokens(chunk.content);
    }
  }

  /**
   * Accumulate native tool call chunks during streaming.
   * LangChain providers send tool_call_chunks with incremental data.
   */
  private handleToolCallChunks(chunk: any) {
    // Check for tool_call_chunks in the chunk (LangChain streaming format)
    const toolCallChunks = chunk.tool_call_chunks;
    if (!toolCallChunks || !Array.isArray(toolCallChunks)) {
      return;
    }

    for (const tc of toolCallChunks) {
      const idx = tc.index ?? 0;
      const existing = this.toolCallChunks.get(idx) || { name: "", args: "" };

      // Accumulate data from chunk
      if (tc.id) existing.id = tc.id;
      if (tc.name) existing.name += tc.name;
      if (tc.args) existing.args += tc.args;

      this.toolCallChunks.set(idx, existing);
    }
  }

  processChunk(chunk: any) {
    // Detect truncation using multi-provider detector
    const truncationResult = detectTruncation(chunk);
    if (truncationResult.wasTruncated) {
      this.wasTruncated = true;
    }

    // Extract token usage if available
    const usage = extractTokenUsage(chunk);
    if (usage) {
      this.tokenUsage = usage;
    }

    // Handle native tool call chunks (LangChain streaming)
    this.handleToolCallChunks(chunk);

    // Determine if this chunk will handle thinking content
    // Note: For OpenRouter, we process only delta.reasoning, but we still need to recognize
    // reasoning_details as a thinking chunk to prevent premature think block closure
    const isThinkingChunk =
      Array.isArray(chunk.content) ||
      chunk.additional_kwargs?.delta?.reasoning ||
      (chunk.additional_kwargs?.reasoning_details &&
        Array.isArray(chunk.additional_kwargs.reasoning_details) &&
        chunk.additional_kwargs.reasoning_details.length > 0) ||
      chunk.additional_kwargs?.reasoning_content; // Deepseek format

    // Close think block BEFORE processing non-thinking content
    if (this.hasOpenThinkBlock && !isThinkingChunk) {
      this.fullResponse += "</think>";
      this.hasOpenThinkBlock = false;
    }

    // Now process the chunk
    // Route based on the actual chunk format
    if (Array.isArray(chunk.content)) {
      // Claude format with content array
      this.handleClaudeChunk(chunk.content);
    } else if (chunk.additional_kwargs?.reasoning_content) {
      // Deepseek format with reasoning_content
      this.handleDeepseekChunk(chunk);
    } else if (isThinkingChunk) {
      // OpenRouter format with delta.reasoning or reasoning_details
      this.handleOpenRouterChunk(chunk);
    } else {
      // Default case: regular content or other formats
      this.handleDeepseekChunk(chunk);
    }

    // Handle text-level think tags (e.g., from nvidia/nemotron models)
    this.handleTextLevelThinkTags();

    this.updateCurrentAiMessage(this.fullResponse);
  }

  processErrorChunk(errorMessage: string) {
    this.errorResponse = formatErrorChunk(errorMessage);
  }

  /**
   * Get the accumulated tool calls from streaming chunks.
   * Call this after streaming is complete to get all tool calls.
   */
  getToolCalls(): NativeToolCall[] {
    // If we have pre-accumulated tool calls (from non-streaming), return those
    if (this.accumulatedToolCalls.length > 0) {
      return this.accumulatedToolCalls;
    }
    // Otherwise build from streaming chunks
    return buildToolCallsFromChunks(this.toolCallChunks);
  }

  /**
   * Check if there are any tool calls accumulated
   */
  hasToolCalls(): boolean {
    return this.toolCallChunks.size > 0 || this.accumulatedToolCalls.length > 0;
  }

  /**
   * Set tool calls directly (for non-streaming responses)
   */
  setToolCalls(toolCalls: NativeToolCall[]) {
    this.accumulatedToolCalls = toolCalls;
  }

  /**
   * Build an AIMessage with the accumulated content and tool calls.
   * Use this to add the complete response to conversation history.
   */
  buildAIMessage(): AIMessage {
    const toolCalls = this.getToolCalls();
    return createAIMessageWithToolCalls(this.fullResponse, toolCalls);
  }

  close(): StreamingResult {
    // Close any think block left open by a stream that ended mid-reasoning, and
    // clear the flag so later state checks do not see a stale open block.
    if (this.hasOpenThinkBlock) {
      this.fullResponse += "</think>";
      this.hasOpenThinkBlock = false;
    }

    // Final check for text-level think tags (in case stream ended before </think> was seen)
    this.handleTextLevelThinkTags();

    // Error text is answer content, never reasoning. It is appended after all
    // think-block handling so it cannot be captured inside a reasoning block.
    if (this.errorResponse) {
      // close() may have re-opened a text-level think block; close it before the error.
      if (this.hasOpenThinkBlock) {
        this.fullResponse += "</think>";
        this.hasOpenThinkBlock = false;
      }
      this.fullResponse += this.errorResponse;
    }

    this.updateCurrentAiMessage(this.fullResponse);

    return {
      content: this.fullResponse,
      wasTruncated: this.wasTruncated,
      tokenUsage: this.tokenUsage,
    };
  }
}
