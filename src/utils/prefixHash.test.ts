import { hashPromptPrefix, hashString } from "./prefixHash";

describe("prefixHash", () => {
  it("hashes the same string to the same value", () => {
    expect(hashString("stable prompt")).toBe(hashString("stable prompt"));
  });

  it("ignores the last (current-turn) message", () => {
    const prefix = [
      { role: "system", content: "system" },
      { role: "user", content: "previous turn" },
    ];
    const withDifferentCurrentTurn = [
      ...prefix.slice(0, -1),
      { role: "user", content: "something else" },
    ];

    expect(hashPromptPrefix(withDifferentCurrentTurn)).toBe(hashPromptPrefix(prefix));
  });

  it("changes when the system prompt changes", () => {
    const base = [
      { role: "system", content: "system A" },
      { role: "user", content: "current" },
    ];
    const changed = [
      { role: "system", content: "system B" },
      { role: "user", content: "current" },
    ];

    expect(hashPromptPrefix(changed)).not.toBe(hashPromptPrefix(base));
  });

  it("supports LangChain messages", () => {
    const messages = [
      { _getType: () => "system", content: "system" },
      { _getType: () => "human", content: "current" },
    ];
    expect(hashPromptPrefix(messages)).toMatch(/^[0-9a-f]{8}$/);
  });
});
