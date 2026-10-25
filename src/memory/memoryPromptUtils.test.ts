import { appendVolatileMemory } from "./memoryPromptUtils";

describe("appendVolatileMemory", () => {
  it("returns the original content when there is no memory", () => {
    expect(appendVolatileMemory("hello", null)).toBe("hello");
  });

  it("appends the volatile block at the very end", () => {
    const volatile = "<recent_conversations>recent</recent_conversations>";
    expect(appendVolatileMemory("hello", volatile)).toBe(`hello\n\n${volatile}`);
  });

  it("keeps the volatile block out of the prefix", () => {
    const content = "user question";
    const result = appendVolatileMemory(content, "tail");
    expect(result.startsWith(content)).toBe(true);
    expect(result.endsWith("tail")).toBe(true);
  });
});
