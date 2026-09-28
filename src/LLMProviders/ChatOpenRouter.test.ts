import "openai/shims/node";
import { ChatOpenRouter } from "./ChatOpenRouter";

describe("ChatOpenRouter", () => {
  it("explicitly includes reasoning.effort and reasoning_effort when reasoningEffort is set", () => {
    const model = new ChatOpenRouter({
      modelName: "anthropic/claude-3.7-sonnet",
      apiKey: "test-key",
      reasoningEffort: "max",
    });

    const params = model.invocationParams();
    expect(params.reasoning).toEqual({ effort: "max" });
    expect(params.reasoning_effort).toBe("max");
  });

  it("does not downgrade 'minimal' to 'low' and forwards it directly", () => {
    const model = new ChatOpenRouter({
      modelName: "openai/o3-mini",
      apiKey: "test-key",
      reasoningEffort: "minimal",
    });

    const params = model.invocationParams();
    expect(params.reasoning).toEqual({ effort: "minimal" });
    expect(params.reasoning_effort).toBe("minimal");
  });

  it("supports 'none' reasoning effort", () => {
    const model = new ChatOpenRouter({
      modelName: "deepseek/deepseek-r1",
      apiKey: "test-key",
      reasoningEffort: "none",
    });

    const params = model.invocationParams();
    expect(params.reasoning).toEqual({ effort: "none" });
    expect(params.reasoning_effort).toBe("none");
  });

  it("falls back to default max_tokens when enableReasoning is true without reasoningEffort", () => {
    const model = new ChatOpenRouter({
      modelName: "deepseek/deepseek-r1",
      apiKey: "test-key",
      enableReasoning: true,
    });

    const params = model.invocationParams();
    expect(params.reasoning).toEqual({ max_tokens: 1024 });
  });
});
