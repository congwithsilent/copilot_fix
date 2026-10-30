import { LLMChainRunner } from "./LLMChainRunner";
import { AgentChainRunner } from "./AgentChainRunner";
import { ImageBatchProcessor } from "@/imageProcessing/imageProcessor";

jest.mock("@/settings/model", () => ({ getSettings: () => ({ passMarkdownImages: false }) }));
jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock("./utils/chatHistoryUtils", () => ({ loadAndAddChatHistory: jest.fn() }));
jest.mock("@/LLMProviders/projectManager", () => ({}));
jest.mock("@/tools/builtinTools", () => ({ initializeBuiltinTools: jest.fn() }));
jest.mock("@/tools/SearchTools", () => ({ localSearchTool: {}, webSearchTool: {} }));
jest.mock("@/tools/memoryTools", () => ({ updateMemoryTool: {} }));

const pages = [5, 6].map((page) => ({
  type: "image_url",
  image_url: { url: `data:image/jpeg;base64,page${page}` },
  pdfPage: { path: "paper.pdf", page },
}));

describe("PDF page payload delivery", () => {
  afterEach(() => jest.restoreAllMocks());

  it("delivers PDF-only messages even when the envelope has no user text", async () => {
    const runner = new LLMChainRunner({
      memoryManager: { getMemory: () => ({}) },
      userMemoryManager: { getVolatileMemoryPrompt: async () => "" },
    } as any);
    const messages = await (runner as any).constructMessages({
      content: pages,
      contextEnvelope: { layers: [{ id: "L1_SYSTEM", text: "System", segments: [] }] },
    });
    const user = messages.find((message: any) => message.role === "user");
    expect(user.content.filter((part: any) => part.type === "image_url")).toHaveLength(2);
    expect(user.content.some((part: any) => part.type === "text" && !part.text)).toBe(false);
  });

  it("preserves page labels and ordinary image inputs in regular chat", async () => {
    const runner = new LLMChainRunner({
      memoryManager: { getMemory: () => ({}) },
      userMemoryManager: { getVolatileMemoryPrompt: async () => "" },
    } as any);
    const messages = await (runner as any).constructMessages({
      content: [...pages, { type: "text", text: "Question" }],
      contextEnvelope: {
        layers: [
          { id: "L1_SYSTEM", text: "System", segments: [] },
          { id: "L5_USER", text: "Explain the table", segments: [] },
        ],
      },
    });
    const content = messages.find((message: any) => message.role === "user").content;
    expect(content.filter((part: any) => part.type === "image_url")).toEqual(
      pages.map(({ image_url }) => ({ type: "image_url", image_url }))
    );
    expect(
      content.filter((part: any) => part.type === "text").map((part: any) => part.text)
    ).toEqual([
      'PDF page: "paper.pdf", physical page 5.',
      'PDF page: "paper.pdf", physical page 6.',
      "Explain the table",
    ]);
  });

  it("preserves page ordering in the shared agent builder without reprocessing PDF images", async () => {
    const processImages = jest
      .spyOn(ImageBatchProcessor, "processChatImageBatch")
      .mockResolvedValue({ successfulImages: [], failureDescriptions: [] });
    jest.spyOn(ImageBatchProcessor, "showFailedImagesNotice").mockImplementation(() => {});
    const runner = new AgentChainRunner({ app: { vault: {} } } as any);
    const content = await (runner as any).buildMessageContent("Explain the table", {
      content: pages,
    });
    expect(processImages.mock.calls[0][0]).toEqual([]);
    expect(content.map((part: any) => part.type)).toEqual([
      "text",
      "text",
      "image_url",
      "text",
      "image_url",
    ]);
    expect(content[1].text).toContain("physical page 5");
    expect(content[3].text).toContain("physical page 6");
    expect(JSON.stringify(content)).not.toContain('"pdfPage"');
  });
});
