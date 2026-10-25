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

  describe("prompt caching", () => {
    it("uses Anthropic cache_control for Claude models", () => {
      const model = new ChatOpenRouter({
        modelName: "anthropic/claude-sonnet-5.5",
        apiKey: "test-key",
      });

      const params = model.invocationParams();
      expect(params.cache_control).toEqual({ type: "ephemeral" });
    });

    it("adds the 1h TTL when configured", () => {
      const model = new ChatOpenRouter({
        modelName: "anthropic/claude-haiku-5.5",
        apiKey: "test-key",
        promptCacheTtl: "1h",
      });

      expect(model.invocationParams().cache_control).toEqual({
        type: "ephemeral",
        ttl: "1h",
      });
    });

    it("uses automatic OpenAI caching plus a sticky session key for GPT models", () => {
      const model = new ChatOpenRouter({
        modelName: "openai/gpt-6-luna",
        apiKey: "test-key",
      });

      const params = model.invocationParams({ session_id: "chat-123" } as any);
      expect(params.cache_control).toBeUndefined();
      expect(params.session_id).toBe("chat-123");
      expect(params.prompt_cache_key).toBe("chat-123");
    });

    it("keeps the session id for Claude without adding prompt_cache_key", () => {
      const model = new ChatOpenRouter({
        modelName: "anthropic/claude-sonnet-5.5",
        apiKey: "test-key",
      });

      const params = model.invocationParams({ session_id: "chat-abc" } as any);
      expect(params.session_id).toBe("chat-abc");
      expect(params.prompt_cache_key).toBeUndefined();
      expect(params.cache_control).toEqual({ type: "ephemeral" });
    });

    it("can disable caching explicitly", () => {
      const model = new ChatOpenRouter({
        modelName: "anthropic/claude-sonnet-5.5",
        apiKey: "test-key",
        promptCacheStrategy: "off",
      });

      const params = model.invocationParams({ session_id: "chat-abc" } as any);
      expect(params.cache_control).toBeUndefined();
      expect(params.session_id).toBeUndefined();
    });
  });

  describe("service tier", () => {
    it("sends service_tier flex when requested", () => {
      const model = new ChatOpenRouter({
        modelName: "google/gemini-3.8-flash",
        apiKey: "test-key",
        serviceTier: "flex",
      });

      expect(model.invocationParams().service_tier).toBe("flex");
    });

    it("does not send service_tier by default", () => {
      const model = new ChatOpenRouter({
        modelName: "google/gemini-3.8-flash",
        apiKey: "test-key",
      });

      expect(model.invocationParams().service_tier).toBeUndefined();
    });

    it("keeps the tier alongside reasoning parameters", () => {
      const model = new ChatOpenRouter({
        modelName: "google/gemini-3.8-flash",
        apiKey: "test-key",
        serviceTier: "flex",
        reasoningEffort: "low",
      });

      const params = model.invocationParams();
      expect(params.service_tier).toBe("flex");
      expect(params.reasoning).toEqual({ effort: "low" });
    });
  });

  describe("endpoint routing", () => {
    it("pins an explicit endpoint and disables fallbacks", () => {
      const model = new ChatOpenRouter({
        modelName: "google/gemini-3.8-flash",
        apiKey: "test-key",
        providerOnly: ["google-ai-studio/flex"],
        allowFallbacks: false,
      });

      expect(model.invocationParams().provider).toEqual({
        only: ["google-ai-studio/flex"],
        allow_fallbacks: false,
      });
    });

    it("allows fallbacks by default when an endpoint is pinned", () => {
      const model = new ChatOpenRouter({
        modelName: "google/gemini-3.8-flash",
        apiKey: "test-key",
        providerOnly: ["google-ai-studio/flex"],
      });

      expect(model.invocationParams().provider).toEqual({
        only: ["google-ai-studio/flex"],
        allow_fallbacks: true,
      });
    });

    it("does not send a provider object when no endpoint is pinned", () => {
      const model = new ChatOpenRouter({
        modelName: "google/gemini-3.8-flash",
        apiKey: "test-key",
      });

      expect(model.invocationParams().provider).toBeUndefined();
    });

    it("combines an endpoint pin with the flex service tier", () => {
      const model = new ChatOpenRouter({
        modelName: "google/gemini-3.8-flash",
        apiKey: "test-key",
        serviceTier: "flex",
        providerOnly: ["google-ai-studio/flex"],
        allowFallbacks: false,
      });

      const params = model.invocationParams();
      expect(params.service_tier).toBe("flex");
      expect(params.provider).toEqual({
        only: ["google-ai-studio/flex"],
        allow_fallbacks: false,
      });
    });
  });
});
