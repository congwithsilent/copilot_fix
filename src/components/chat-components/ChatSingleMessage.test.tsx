import React from "react";
import { act, render, waitFor } from "@testing-library/react";
import ChatSingleMessage, {
  normalizeFootnoteRendering,
} from "@/components/chat-components/ChatSingleMessage";
import { ChatMessage } from "@/types/message";
import type { App } from "obsidian";
import { TooltipProvider } from "@/components/ui/tooltip";

jest.mock("@/settings/model", () => ({
  useSettingsValue: jest.fn(() => ({
    enableInlineCitations: true,
    activeModels: [
      {
        name: "test-model",
        provider: "test-provider",
        enabled: true,
        capabilities: ["reasoning"],
      },
    ],
  })),
}));

jest.mock("@/aiParams", () => ({
  useModelKey: jest.fn(() => ["test-model|test-provider", jest.fn()]),
}));

jest.mock("@/LLMProviders/chainRunner/utils/toolCallParser", () => ({
  parseToolCallMarkers: jest.fn((message: string) => ({
    segments: [{ type: "text", content: message }],
  })),
}));

jest.mock("@/LLMProviders/chainRunner/utils/citationUtils", () => ({
  processInlineCitations: jest.fn((content: string) => content),
}));

jest.mock("obsidian", () => {
  const renderMarkdown = jest.fn();
  return {
    MarkdownRenderer: {
      renderMarkdown,
    },
    Component: class {
      load() {}
      unload() {}
    },
    MarkdownView: class {},
    TFile: class {},
    App: class {},
    Platform: {
      isMobile: false,
    },
    Modal: class {
      open() {
        /* noop */
      }
      close() {
        /* noop */
      }
    },
    __renderMarkdownMock: renderMarkdown,
  };
});

const { __renderMarkdownMock: renderMarkdownMock } = jest.requireMock("obsidian") as {
  __renderMarkdownMock: jest.Mock;
};

describe("normalizeFootnoteRendering", () => {
  beforeEach(() => {
    renderMarkdownMock.mockReset();
  });

  it("removes separator and backref while preserving non-footnote elements", () => {
    const container = document.createElement("div");
    container.innerHTML = `
      <div>
        <p>Body <sup><a href="#fn-1">1-1</a></sup></p>
        <hr class="content-separator" />
        <div class="footnotes">
          <hr class="footnotes-sep" />
          <ol>
            <li id="fn-1">
              Entry <a class="footnote-backref" href="#ref">↩</a>
            </li>
          </ol>
        </div>
      </div>
    `;

    normalizeFootnoteRendering(container);

    expect(container.querySelector(".footnotes hr")).toBeNull();
    expect(container.querySelector(".footnote-backref")).toBeNull();
    expect(container.querySelector(".content-separator")).not.toBeNull();
    expect(container.querySelector('a[href="#fn-1"]')?.textContent).toBe("1");
  });

  it("leaves non-numeric footnote references untouched", () => {
    const container = document.createElement("div");
    container.innerHTML = `
      <p>Body <sup><a href="#fn-note">Note-A</a></sup></p>
      <a class="footnote-backref" href="#ref">↩</a>
    `;

    normalizeFootnoteRendering(container);

    expect(container.querySelector('a[href="#fn-note"]')?.textContent).toBe("Note-A");
    expect(container.querySelector(".footnote-backref")).toBeNull();
  });
});

/**
 * Let pending animation frames run for the given window.
 *
 * The smooth buffer drains its queue from requestAnimationFrame, which jest
 * drives from the fake clock alongside timers.
 */
const runFrames = async (ms: number): Promise<void> => {
  await act(async () => {
    jest.advanceTimersByTime(ms);
    await Promise.resolve();
  });
};

describe("ChatSingleMessage", () => {
  const baseMessage: ChatMessage = {
    id: "message-1",
    message: "Test message",
    sender: "assistant",
    timestamp: { epoch: Date.now(), display: "now", fileName: "now" },
    isVisible: true,
  };

  const createAppStub = (): App =>
    ({
      workspace: {
        getActiveFile: jest.fn(() => null),
        getMostRecentLeaf: jest.fn(() => null),
        getLeaf: jest.fn(() => null),
      },
      metadataCache: {
        getFirstLinkpathDest: jest.fn(() => null),
      },
    }) as unknown as App;

  beforeEach(() => {
    renderMarkdownMock.mockReset();
  });

  beforeAll(() => {
    (globalThis as any).activeDocument = document;
  });

  it("normalizes rendered footnotes for assistant messages", async () => {
    renderMarkdownMock.mockImplementation((_markdown: string, el: HTMLElement) => {
      el.innerHTML = `
        <p>Example <sup><a href="#fn-2">2-1</a></sup></p>
        <hr class="content-hr" />
        <div class="footnotes">
          <hr class="footnotes-sep" />
          <ol>
            <li id="fn-2">
              Source <a class="footnote-backref" href="#back">↩</a>
            </li>
          </ol>
        </div>
      `;
    });

    const { container } = render(
      <TooltipProvider>
        <ChatSingleMessage
          message={baseMessage}
          app={createAppStub()}
          isStreaming={false}
          onDelete={() => {}}
        />
      </TooltipProvider>
    );

    await waitFor(() => expect(renderMarkdownMock).toHaveBeenCalled());

    const messageSegment = container.querySelector(".message-segment");
    expect(messageSegment).toBeTruthy();
    expect(messageSegment?.querySelector(".footnotes hr")).toBeNull();
    expect(messageSegment?.querySelector(".footnote-backref")).toBeNull();
    expect(messageSegment?.querySelector(".content-hr")).not.toBeNull();
    expect(messageSegment?.querySelector('a[href="#fn-2"]')?.textContent).toBe("2");
  });

  it("renders an unclosed think block as a collapsed details section while streaming", async () => {
    const streamingMessage: ChatMessage = {
      ...baseMessage,
      id: "streaming-think-message",
      message: "<think>Secret reasoning so far",
    };

    renderMarkdownMock.mockImplementation((_markdown: string, el: HTMLElement) => {
      el.innerHTML = `
        <details class="copilot-collapsible">
          <summary class="copilot-collapsible-summary">Thinking...</summary>
          <div class="copilot-collapsible-body">Secret reasoning so far</div>
        </details>
      `;
    });

    const { container } = render(
      <TooltipProvider>
        <ChatSingleMessage
          message={streamingMessage}
          app={createAppStub()}
          isStreaming={true}
          onDelete={() => {}}
        />
      </TooltipProvider>
    );

    await waitFor(() => expect(renderMarkdownMock).toHaveBeenCalled());

    // The streamed think block must render through the collapsible <details>
    // path (collapsed by default), not the legacy always-expanded streaming div.
    const details = container.querySelector("details.copilot-collapsible");
    expect(details).not.toBeNull();
    expect(details?.getAttribute("open")).toBeNull();
    expect(details?.querySelector(".copilot-collapsible-summary")?.textContent).toContain(
      "Thinking..."
    );
    expect(container.querySelector(".copilot-collapsible-streaming")).toBeNull();
  });

  it("keeps unclosed writeFile sections expanded while streaming", async () => {
    const streamingMessage: ChatMessage = {
      ...baseMessage,
      id: "streaming-writefile-message",
      message: "<writeFile>Partial generated content",
    };

    renderMarkdownMock.mockImplementation((_markdown: string, el: HTMLElement) => {
      el.innerHTML = `
        <div class="copilot-collapsible-streaming">
          <div class="copilot-collapsible-streaming-label">Generating changes...</div>
          <div class="copilot-collapsible-streaming-body">Partial generated content</div>
        </div>
      `;
    });

    const { container } = render(
      <TooltipProvider>
        <ChatSingleMessage
          message={streamingMessage}
          app={createAppStub()}
          isStreaming={true}
          onDelete={() => {}}
        />
      </TooltipProvider>
    );

    await waitFor(() => expect(renderMarkdownMock).toHaveBeenCalled());

    const streamingSection = container.querySelector(".copilot-collapsible-streaming");
    expect(streamingSection).not.toBeNull();
  });

  it("streams text through the smooth buffer without re-animating shown text", async () => {
    jest.useFakeTimers();

    try {
      renderMarkdownMock.mockImplementation((markdown: string, el: HTMLElement) => {
        const parts = markdown.split("\n\n").filter((part) => part.trim().length > 0);
        const blocks = parts.length > 0 ? parts : [markdown];
        el.innerHTML = blocks.map((part) => `<p>${part.trim()}</p>`).join("");
      });

      const streamingMessage: ChatMessage = {
        ...baseMessage,
        id: "streaming-reveal-message",
        message: "one",
      };

      const view = (content: string) => (
        <TooltipProvider>
          <ChatSingleMessage
            message={{ ...streamingMessage, message: content }}
            app={createAppStub()}
            isStreaming={true}
            onDelete={() => {}}
          />
        </TooltipProvider>
      );

      const { container, rerender } = render(view("one"));

      await act(async () => {
        await Promise.resolve();
      });

      expect(container.textContent).toContain("one");

      // New characters sit in the queue: nothing is painted until a frame runs.
      rerender(view("one\n\ntwo"));
      await act(async () => {
        await Promise.resolve();
      });
      expect(container.textContent).not.toContain("two");

      await runFrames(400);
      expect(container.textContent).toContain("two");

      // Growing the block already on screen must fade only the new characters.
      rerender(view("one\n\ntwo three"));
      await runFrames(400);

      expect(container.textContent).toContain("two three");
      const faded = Array.from(container.querySelectorAll(".copilot-stream-reveal-inline")).map(
        (el) => el.textContent
      );
      expect(faded.join("")).not.toContain("two");
      expect(faded.join("")).toContain("three");
    } finally {
      jest.useRealTimers();
    }
  });
});
