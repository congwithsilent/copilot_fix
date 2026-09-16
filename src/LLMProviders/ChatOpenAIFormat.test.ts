import { AIMessageChunk } from "@langchain/core/messages";
import { ChatOpenAIFormat } from "./ChatOpenAIFormat";

/**
 * Build a minimal raw response object matching the shape LangChain's converter
 * reads (it only needs `id`, `usage`, and `choices[0].index`).
 */
function buildRawResponse(): any {
  return {
    id: "chatcmpl-test",
    usage: undefined,
    choices: [{ index: 0 }],
  };
}

/**
 * Invoke the protected delta converter through the injected completions
 * instance, mirroring how the streaming loop calls it.
 */
function convertDelta(delta: Record<string, any>): any {
  const model: any = new ChatOpenAIFormat({ modelName: "test-model", apiKey: "test-key" });
  return model.completions._convertCompletionsDeltaToBaseMessageChunk(
    delta,
    buildRawResponse(),
    undefined
  );
}

describe("ChatOpenAIFormat", () => {
  it("reports its own llm type", () => {
    const model = new ChatOpenAIFormat({ modelName: "test-model", apiKey: "test-key" });
    expect(model._llmType()).toBe("openai-format");
  });

  describe("array content normalization", () => {
    it("converts array content into a string so the chunk is not dropped", () => {
      const chunk = convertDelta({
        role: "assistant",
        content: [
          { type: "text", text: "Hello " },
          { type: "text", text: "world" },
        ],
      });

      expect(typeof chunk.content).toBe("string");
      expect(chunk.content).toBe("Hello world");
    });

    it("keeps a plain string content unchanged", () => {
      const chunk = convertDelta({ role: "assistant", content: "plain" });

      expect(chunk.content).toBe("plain");
    });

    it("produces empty content for a null content delta", () => {
      const chunk = convertDelta({ role: "assistant", content: null });

      expect(chunk.content).toBe("");
    });
  });

  describe("reasoning passthrough", () => {
    it("preserves reasoning_content so the streamer can separate thinking", () => {
      const chunk = convertDelta({
        role: "assistant",
        content: "",
        reasoning_content: "step by step",
      });

      expect(chunk.additional_kwargs.reasoning_content).toBe("step by step");
    });

    it("maps delta reasoning into additional_kwargs.delta.reasoning", () => {
      const chunk = convertDelta({
        role: "assistant",
        content: "",
        reasoning: "openrouter style",
      });

      expect(chunk.additional_kwargs.delta).toEqual({ reasoning: "openrouter style" });
    });

    it("preserves a non-empty reasoning_details array", () => {
      const details = [{ type: "reasoning.text", text: "d" }];
      const chunk = convertDelta({ role: "assistant", content: "", reasoning_details: details });

      expect(chunk.additional_kwargs.reasoning_details).toEqual(details);
    });

    it("routes thinking content parts into the reasoning channel", () => {
      // Claude-family gateways can interleave thinking with text in one array.
      // The thinking must not be silently discarded by the flattener.
      const chunk = convertDelta({
        role: "assistant",
        content: [
          { type: "thinking", thinking: "internal reasoning" },
          { type: "text", text: "the answer" },
        ],
      });

      expect(chunk.content).toBe("the answer");
      expect(chunk.additional_kwargs.reasoning_content).toBe("internal reasoning");
    });

    it("omits reasoning kwargs entirely when no reasoning is present", () => {
      const chunk = convertDelta({ role: "assistant", content: "just text" });

      expect(chunk.additional_kwargs.reasoning_content).toBeUndefined();
      expect(chunk.additional_kwargs.delta).toBeUndefined();
      expect(chunk.additional_kwargs.reasoning_details).toBeUndefined();
    });
  });

  describe("role backfill", () => {
    it("defaults a missing role to assistant so tool_call_chunks survive", () => {
      const chunk = convertDelta({
        content: "text without role",
      });

      // Without the backfill this would fall through to ChatMessageChunk, which
      // carries no tool_call_chunks.
      expect(chunk).toBeInstanceOf(AIMessageChunk);
    });

    it("still honors an explicitly provided role", () => {
      const chunk = convertDelta({ role: "user", content: "from user" });

      expect(chunk._getType()).toBe("human");
    });
  });

  describe("withConfig", () => {
    it("returns a ChatOpenAIFormat so normalization survives chain construction", () => {
      // chainFactory calls llm.withConfig({ signal }); the base implementation
      // hardcodes `new ChatOpenAI(...)`, which would drop the adapter.
      const model = new ChatOpenAIFormat({ modelName: "test-model", apiKey: "test-key" });
      const configured = model.withConfig({ signal: undefined });

      expect(configured).toBeInstanceOf(ChatOpenAIFormat);
      expect((configured as any).completions.constructor.name).toBe("ChatOpenAIFormatCompletions");
    });

    it("carries the passed call options onto the new instance", () => {
      const model = new ChatOpenAIFormat({ modelName: "test-model", apiKey: "test-key" });
      const controller = new AbortController();
      const configured = model.withConfig({ signal: controller.signal });

      // defaultOptions is protected; read it through a widening cast. Compare the
      // signal by identity rather than with a deep matcher, which would recurse
      // into AbortSignal's internal graph.
      expect((configured as any).defaultOptions.signal).toBe(controller.signal);
    });
  });
});
