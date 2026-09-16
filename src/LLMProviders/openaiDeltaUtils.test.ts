import {
  applyReasoningToAdditionalKwargs,
  extractReasoningFromDelta,
  normalizeDeltaContent,
  normalizeReasoningPayload,
  splitDeltaContent,
} from "./openaiDeltaUtils";

describe("normalizeDeltaContent", () => {
  it("passes through a plain string", () => {
    expect(normalizeDeltaContent("hello")).toBe("hello");
  });

  it("returns empty string for null and undefined", () => {
    expect(normalizeDeltaContent(null)).toBe("");
    expect(normalizeDeltaContent(undefined)).toBe("");
  });

  it("flattens an array of content parts", () => {
    // This is the shape Claude-family models stream through OpenAI-format
    // gateways. Returning a non-string here makes LangChain drop the chunk.
    const content = [
      { type: "text", text: "Hello " },
      { type: "text", text: "world" },
    ];

    expect(normalizeDeltaContent(content)).toBe("Hello world");
  });

  it("flattens mixed string and part entries", () => {
    expect(normalizeDeltaContent(["a", { text: "b" }, "c"])).toBe("abc");
  });

  it("reads a single object with a text field", () => {
    expect(normalizeDeltaContent({ text: "solo" })).toBe("solo");
  });

  it("ignores parts without usable text", () => {
    expect(normalizeDeltaContent([{ foo: 1 }, null, { text: "kept" }])).toBe("kept");
  });

  it("returns empty string for an unrelated object", () => {
    expect(normalizeDeltaContent({ foo: "bar" })).toBe("");
  });
});

describe("normalizeReasoningPayload", () => {
  it("returns undefined for empty input", () => {
    expect(normalizeReasoningPayload(null)).toBeUndefined();
    expect(normalizeReasoningPayload(undefined)).toBeUndefined();
    expect(normalizeReasoningPayload("")).toBeUndefined();
  });

  it("passes through a string payload", () => {
    expect(normalizeReasoningPayload("thinking")).toBe("thinking");
  });

  it("joins an array of fragments", () => {
    expect(normalizeReasoningPayload(["a", "b"])).toBe("ab");
  });

  it("reads known fields from an object payload", () => {
    expect(normalizeReasoningPayload({ reasoning_content: "rc" })).toBe("rc");
    expect(normalizeReasoningPayload({ reasoning: "r" })).toBe("r");
    expect(normalizeReasoningPayload({ text: "t" })).toBe("t");
    expect(normalizeReasoningPayload({ thinking: "th" })).toBe("th");
  });

  it("skips empty strings and falls through to the next candidate", () => {
    expect(normalizeReasoningPayload({ reasoning_content: "", text: "fallback" })).toBe("fallback");
  });
});

describe("extractReasoningFromDelta", () => {
  it("returns an empty object when no reasoning fields are present", () => {
    expect(extractReasoningFromDelta({ content: "hi" })).toEqual({});
  });

  it("extracts reasoning_content", () => {
    expect(extractReasoningFromDelta({ reasoning_content: "rc" })).toEqual({
      reasoningContent: "rc",
    });
  });

  it("extracts delta-style reasoning", () => {
    expect(extractReasoningFromDelta({ reasoning: "r" })).toEqual({ reasoning: "r" });
  });

  it("extracts a non-empty reasoning_details array", () => {
    const details = [{ type: "reasoning.text", text: "d" }];
    expect(extractReasoningFromDelta({ reasoning_details: details })).toEqual({
      reasoningDetails: details,
    });
  });

  it("ignores an empty reasoning_details array", () => {
    expect(extractReasoningFromDelta({ reasoning_details: [] })).toEqual({});
  });
});

describe("splitDeltaContent", () => {
  it("returns text for a plain string", () => {
    expect(splitDeltaContent("plain")).toEqual({ text: "plain" });
  });

  it("collects thinking parts separately from text parts", () => {
    const result = splitDeltaContent([
      { type: "thinking", thinking: "let me think" },
      { type: "text", text: "the answer" },
    ]);

    expect(result.text).toBe("the answer");
    expect(result.thinking).toBe("let me think");
  });

  it("handles reasoning-type parts", () => {
    const result = splitDeltaContent([{ type: "reasoning", text: "why" }]);

    expect(result.text).toBe("");
    expect(result.thinking).toBe("why");
  });

  it("does not report thinking when only text parts are present", () => {
    const result = splitDeltaContent([{ type: "text", text: "only text" }]);

    expect(result).toEqual({ text: "only text" });
  });

  it("preserves ordering of multiple text parts around thinking", () => {
    const result = splitDeltaContent([
      { type: "text", text: "a" },
      { type: "thinking", thinking: "t" },
      { type: "text", text: "b" },
    ]);

    expect(result.text).toBe("ab");
    expect(result.thinking).toBe("t");
  });
});

describe("applyReasoningToAdditionalKwargs", () => {
  it("writes reasoning_content for the DeepSeek branch", () => {
    const kwargs: Record<string, unknown> = {};
    applyReasoningToAdditionalKwargs(kwargs, { reasoningContent: "rc" });

    expect(kwargs.reasoning_content).toBe("rc");
  });

  it("nests delta.reasoning for the OpenRouter branch", () => {
    const kwargs: Record<string, unknown> = {};
    applyReasoningToAdditionalKwargs(kwargs, { reasoning: "r" });

    expect(kwargs.delta).toEqual({ reasoning: "r" });
  });

  it("preserves pre-existing delta fields when adding reasoning", () => {
    const kwargs: Record<string, unknown> = { delta: { existing: true } };
    applyReasoningToAdditionalKwargs(kwargs, { reasoning: "r" });

    expect(kwargs.delta).toEqual({ existing: true, reasoning: "r" });
  });

  it("writes reasoning_details when present", () => {
    const kwargs: Record<string, unknown> = {};
    const details = [{ text: "d" }];
    applyReasoningToAdditionalKwargs(kwargs, { reasoningDetails: details });

    expect(kwargs.reasoning_details).toBe(details);
  });

  it("leaves kwargs untouched when nothing is provided", () => {
    const kwargs: Record<string, unknown> = {};
    applyReasoningToAdditionalKwargs(kwargs, {});

    expect(kwargs).toEqual({});
  });
});
