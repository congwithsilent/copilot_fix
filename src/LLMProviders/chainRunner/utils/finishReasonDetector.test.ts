import { extractTokenUsage } from "./finishReasonDetector";

describe("extractTokenUsage prompt-cache counters", () => {
  it("parses OpenAI cached tokens", () => {
    const usage = extractTokenUsage({
      response_metadata: {
        usage: {
          prompt_tokens: 100,
          completion_tokens: 10,
          total_tokens: 110,
          prompt_tokens_details: { cached_tokens: 80 },
        },
      },
    });

    expect(usage?.cachedInputTokens).toBe(80);
    expect(usage?.inputTokens).toBe(100);
  });

  it("parses Anthropic cache read and write tokens", () => {
    const usage = extractTokenUsage({
      response_metadata: {
        usage: {
          input_tokens: 100,
          output_tokens: 10,
          cache_read_input_tokens: 60,
          cache_creation_input_tokens: 20,
        },
      },
    });

    expect(usage?.cachedInputTokens).toBe(60);
    expect(usage?.cacheWriteTokens).toBe(20);
  });

  it("parses OpenRouter cache discount", () => {
    const usage = extractTokenUsage({
      response_metadata: {
        usage: {
          prompt_tokens: 100,
          completion_tokens: 10,
          total_tokens: 110,
          cache_discount: 0.5,
        },
      },
    });

    expect(usage?.cacheDiscount).toBe(0.5);
  });

  it("parses LangChain usage_metadata cache details", () => {
    const usage = extractTokenUsage({
      usage_metadata: {
        input_tokens: 100,
        output_tokens: 10,
        total_tokens: 110,
        input_token_details: { cache_read: 40 },
      },
    });

    expect(usage?.cachedInputTokens).toBe(40);
  });
});
