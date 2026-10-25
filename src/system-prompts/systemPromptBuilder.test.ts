import { getStableSystemPrompt } from "./systemPromptBuilder";

jest.mock("@/settings/model", () => ({
  getSettings: jest.fn().mockReturnValue({ userSystemPrompt: "" }),
}));

jest.mock("@/system-prompts/state", () => ({
  getEffectiveSystemPromptContent: jest.fn().mockReturnValue(""),
  getDisableBuiltinSystemPrompt: jest.fn().mockReturnValue(false),
}));

describe("getStableSystemPrompt", () => {
  it("contains the memory placement note", () => {
    expect(getStableSystemPrompt()).toContain("<memory_placement>");
  });

  it("does not contain the volatile timestamp", () => {
    const prompt = getStableSystemPrompt();
    expect(prompt).not.toMatch(/The current time is \d{4}-\d{2}-\d{2}/);
  });
});
