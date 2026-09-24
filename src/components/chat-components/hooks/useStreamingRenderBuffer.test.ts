import { act, renderHook } from "@testing-library/react";
import { useStreamingRenderBuffer } from "./useStreamingRenderBuffer";

const CONFIG = { intervalMs: 100, maxPendingChars: 400 };

const setup = (initialContent: string, enabled: boolean) =>
  renderHook(
    ({ content, isStreaming }: { content: string; isStreaming: boolean }) =>
      useStreamingRenderBuffer(content, isStreaming, CONFIG),
    { initialProps: { content: initialContent, isStreaming: enabled } }
  );

describe("useStreamingRenderBuffer", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("is transparent when buffering is disabled", () => {
    const { result, rerender } = setup("hello", false);

    expect(result.current).toBe("hello");

    rerender({ content: "hello world", isStreaming: false });

    expect(result.current).toBe("hello world");
  });

  it("holds streamed text until the cadence elapses", () => {
    const { result, rerender } = setup("", true);

    rerender({ content: "abc", isStreaming: true });
    expect(result.current).toBe("");

    act(() => {
      jest.advanceTimersByTime(100);
    });

    expect(result.current).toBe("abc");
  });

  it("commits a large chunk immediately", () => {
    const { result, rerender } = setup("", true);
    const chunk = "x".repeat(500);

    rerender({ content: chunk, isStreaming: true });

    expect(result.current).toBe(chunk);
  });

  it("commits immediately when content is replaced rather than extended", () => {
    const { result, rerender } = setup("first draft", true);

    rerender({ content: "regenerated", isStreaming: true });

    expect(result.current).toBe("regenerated");
  });

  it("flushes pending text when streaming ends", () => {
    const { result, rerender } = setup("", true);

    rerender({ content: "pending text", isStreaming: true });
    expect(result.current).toBe("");

    rerender({ content: "pending text", isStreaming: false });

    expect(result.current).toBe("pending text");
  });

  it("coalesces rapid chunks into a single commit", () => {
    const { result, rerender } = setup("", true);

    rerender({ content: "a", isStreaming: true });
    act(() => {
      jest.advanceTimersByTime(30);
    });
    rerender({ content: "ab", isStreaming: true });
    act(() => {
      jest.advanceTimersByTime(30);
    });
    rerender({ content: "abc", isStreaming: true });

    expect(result.current).toBe("");

    act(() => {
      jest.advanceTimersByTime(100);
    });

    expect(result.current).toBe("abc");
  });
});
