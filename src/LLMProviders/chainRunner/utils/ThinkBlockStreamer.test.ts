import { ThinkBlockStreamer } from "./ThinkBlockStreamer";

describe("ThinkBlockStreamer", () => {
  describe("OpenRouter delta.reasoning format", () => {
    it("should NOT treat empty reasoning_details array as thinking content", () => {
      let currentMessage = "";
      const streamer = new ThinkBlockStreamer((msg) => {
        currentMessage = msg;
      });

      // This was the bug: empty reasoning_details array should not trigger thinking mode
      streamer.processChunk({
        content: "Regular content",
        additional_kwargs: {
          reasoning_details: [],
        },
      });

      // Should NOT have <think> tags since reasoning_details is empty
      expect(currentMessage).toBe("Regular content");
      expect(currentMessage).not.toContain("<think>");
    });

    it("should handle delta.reasoning for streaming", () => {
      let currentMessage = "";
      const streamer = new ThinkBlockStreamer((msg) => {
        currentMessage = msg;
      });

      // First chunk with delta.reasoning
      streamer.processChunk({
        content: "",
        additional_kwargs: {
          delta: {
            reasoning: "Thinking step 1: ",
          },
        },
      });

      expect(currentMessage).toBe("\n<think>Thinking step 1: ");

      // Second chunk with more delta.reasoning
      streamer.processChunk({
        content: "",
        additional_kwargs: {
          delta: {
            reasoning: "Thinking step 2.",
          },
        },
      });

      expect(currentMessage).toBe("\n<think>Thinking step 1: Thinking step 2.");

      // Regular content should close think block
      streamer.processChunk({
        content: "Here's the result.",
        additional_kwargs: {},
      });

      expect(currentMessage).toBe(
        "\n<think>Thinking step 1: Thinking step 2.</think>Here's the result."
      );
    });

    it("should NOT duplicate when both delta.reasoning and reasoning_details are present", () => {
      let currentMessage = "";
      const streamer = new ThinkBlockStreamer((msg) => {
        currentMessage = msg;
      });

      // First chunk: delta.reasoning with streaming token
      streamer.processChunk({
        content: "",
        additional_kwargs: {
          delta: {
            reasoning: "Analyzing the ",
          },
        },
      });

      expect(currentMessage).toBe("\n<think>Analyzing the ");

      // Second chunk: more delta.reasoning
      streamer.processChunk({
        content: "",
        additional_kwargs: {
          delta: {
            reasoning: "question carefully.",
          },
        },
      });

      expect(currentMessage).toBe("\n<think>Analyzing the question carefully.");

      // Final chunk: reasoning_details with complete transcript (should be IGNORED)
      streamer.processChunk({
        content: "",
        additional_kwargs: {
          reasoning_details: [
            {
              text: "Analyzing the question carefully.", // Same content as accumulated delta
            },
          ],
        },
      });

      // Should NOT duplicate - reasoning_details should be ignored since we've seen delta.reasoning
      expect(currentMessage).toBe("\n<think>Analyzing the question carefully.");
      expect(currentMessage).not.toContain(
        "Analyzing the question carefully.Analyzing the question carefully."
      );

      // Regular content
      streamer.processChunk({
        content: "Here's my answer.",
        additional_kwargs: {},
      });

      expect(currentMessage).toBe(
        "\n<think>Analyzing the question carefully.</think>Here's my answer."
      );
    });
  });

  describe("Claude array-based format", () => {
    it("should handle Claude's content array with thinking type", () => {
      let currentMessage = "";
      const streamer = new ThinkBlockStreamer((msg) => {
        currentMessage = msg;
      });

      // Claude format with content array
      streamer.processChunk({
        content: [
          {
            type: "thinking",
            thinking: "Let me analyze this...",
          },
        ],
      });

      expect(currentMessage).toBe("\n<think>Let me analyze this...");

      // Text content in array
      streamer.processChunk({
        content: [
          {
            type: "text",
            text: "Based on my analysis, ",
          },
        ],
      });

      expect(currentMessage).toBe("\n<think>Let me analyze this...</think>Based on my analysis, ");
    });

    it("should guard against undefined thinking content in Claude format", () => {
      let currentMessage = "";
      const streamer = new ThinkBlockStreamer((msg) => {
        currentMessage = msg;
      });

      // Malformed chunk with undefined thinking
      streamer.processChunk({
        content: [
          {
            type: "thinking",
            // thinking property is undefined
          },
        ],
      });

      // Should not crash, and should not add undefined to response
      expect(currentMessage).toBe("\n<think>");
      expect(currentMessage).not.toContain("undefined");
    });
  });

  describe("Deepseek format", () => {
    it("should handle Deepseek reasoning_content", () => {
      let currentMessage = "";
      const streamer = new ThinkBlockStreamer((msg) => {
        currentMessage = msg;
      });

      streamer.processChunk({
        content: "",
        additional_kwargs: {
          reasoning_content: "Deepseek is thinking...",
        },
      });

      expect(currentMessage).toBe("\n<think>Deepseek is thinking...");

      streamer.processChunk({
        content: "The answer is here.",
        additional_kwargs: {},
      });

      expect(currentMessage).toBe("\n<think>Deepseek is thinking...</think>The answer is here.");
    });

    it("should guard against undefined reasoning_content in Deepseek format", () => {
      let currentMessage = "";
      const streamer = new ThinkBlockStreamer((msg) => {
        currentMessage = msg;
      });

      // Malformed chunk with undefined reasoning_content
      streamer.processChunk({
        content: "",
        additional_kwargs: {
          reasoning_content: undefined,
        },
      });

      // Should not crash, not open think block, and not add undefined
      expect(currentMessage).toBe("");
      expect(currentMessage).not.toContain("undefined");
      expect(currentMessage).not.toContain("<think>");
    });

    it("should handle streaming Deepseek reasoning_content without premature closure", () => {
      let currentMessage = "";
      const streamer = new ThinkBlockStreamer((msg) => {
        currentMessage = msg;
      });

      // First chunk with reasoning_content
      streamer.processChunk({
        content: "",
        additional_kwargs: {
          reasoning_content: "Thinking step 1...",
        },
      });

      expect(currentMessage).toBe("\n<think>Thinking step 1...");

      // Second chunk with MORE reasoning_content (streaming)
      // This should NOT close and reopen the think block
      streamer.processChunk({
        content: "",
        additional_kwargs: {
          reasoning_content: " Step 2...",
        },
      });

      // Should be continuous, NOT "</think>\n<think>"
      expect(currentMessage).toBe("\n<think>Thinking step 1... Step 2...");
      expect(currentMessage).not.toContain("</think>\n<think>");

      // Third chunk with regular content
      streamer.processChunk({
        content: "Final answer.",
        additional_kwargs: {},
      });

      expect(currentMessage).toBe("\n<think>Thinking step 1... Step 2...</think>Final answer.");
    });
  });

  describe("excludeThinking option", () => {
    it("should skip OpenRouter thinking content when excludeThinking is true", () => {
      let currentMessage = "";
      const streamer = new ThinkBlockStreamer(
        (msg) => {
          currentMessage = msg;
        },
        true // excludeThinking = true
      );

      // Thinking content should be skipped
      streamer.processChunk({
        content: "",
        additional_kwargs: {
          delta: {
            reasoning: "This should be skipped",
          },
        },
      });

      expect(currentMessage).toBe("");

      // Regular content should still be processed
      streamer.processChunk({
        content: "This should be included",
        additional_kwargs: {},
      });

      expect(currentMessage).toBe("This should be included");
    });

    it("should skip Claude thinking content when excludeThinking is true", () => {
      let currentMessage = "";
      const streamer = new ThinkBlockStreamer(
        (msg) => {
          currentMessage = msg;
        },
        true // excludeThinking = true
      );

      streamer.processChunk({
        content: [
          {
            type: "thinking",
            thinking: "Claude thinking",
          },
        ],
      });

      expect(currentMessage).toBe("");
      expect(currentMessage).not.toContain("<think>");
    });
  });

  describe("close() method", () => {
    it("should close any open think block at the end", () => {
      let currentMessage = "";
      const streamer = new ThinkBlockStreamer((msg) => {
        currentMessage = msg;
      });

      streamer.processChunk({
        content: "",
        additional_kwargs: {
          delta: {
            reasoning: "Thinking...",
          },
        },
      });

      expect(currentMessage).toBe("\n<think>Thinking...");

      const result = streamer.close();
      expect(result.content).toBe("\n<think>Thinking...</think>");
    });

    it("should not add extra closing tag if already closed", () => {
      let currentMessage = "";
      const streamer = new ThinkBlockStreamer((msg) => {
        currentMessage = msg;
      });

      streamer.processChunk({
        content: "",
        additional_kwargs: {
          delta: {
            reasoning: "Thinking...",
          },
        },
      });

      streamer.processChunk({
        content: "Done",
        additional_kwargs: {},
      });

      expect(currentMessage).toBe("\n<think>Thinking...</think>Done");

      const result = streamer.close();
      expect(result.content).toBe("\n<think>Thinking...</think>Done");
      // Should not have double closing tags
      expect(result.content.match(/<\/think>/g)?.length).toBe(1);
    });
  });

  describe("mixed content scenarios", () => {
    it("should handle rapid alternation between thinking and regular content", () => {
      let currentMessage = "";
      const streamer = new ThinkBlockStreamer((msg) => {
        currentMessage = msg;
      });

      const chunks = [
        { thinking: "Think 1", content: "" },
        { thinking: "", content: "Text 1" },
        { thinking: "Think 2", content: "" },
        { thinking: "", content: "Text 2" },
        { thinking: "Think 3", content: "" },
        { thinking: "", content: "Text 3" },
      ];

      chunks.forEach((chunk) => {
        if (chunk.thinking) {
          streamer.processChunk({
            content: "",
            additional_kwargs: {
              delta: {
                reasoning: chunk.thinking,
              },
            },
          });
        } else {
          streamer.processChunk({
            content: chunk.content,
            additional_kwargs: {},
          });
        }
      });

      // Should have three separate think blocks
      const thinkMatches = currentMessage.match(/<think>/g);
      const thinkCloseMatches = currentMessage.match(/<\/think>/g);
      expect(thinkMatches?.length).toBe(3);
      expect(thinkCloseMatches?.length).toBe(3);

      // Each text should be outside think blocks
      expect(currentMessage).toContain("</think>Text 1");
      expect(currentMessage).toContain("</think>Text 2");
      expect(currentMessage).toContain("</think>Text 3");
    });
  });

  describe("reasoning and content in a single chunk", () => {
    it("writes reasoning before content, never interleaved", () => {
      let currentMessage = "";
      const streamer = new ThinkBlockStreamer((msg) => {
        currentMessage = msg;
      });

      // Some gateways deliver reasoning and answer text in one delta. Reasoning
      // is produced first, so it must be written (and the block closed) before
      // the answer is appended.
      streamer.processChunk({
        content: "The answer.",
        additional_kwargs: { reasoning_content: "The reasoning." },
      });

      expect(currentMessage).toBe("\n<think>The reasoning.</think>The answer.");
    });

    it("does not leave the answer inside the think block", () => {
      let currentMessage = "";
      const streamer = new ThinkBlockStreamer((msg) => {
        currentMessage = msg;
      });

      streamer.processChunk({
        content: "Answer text.",
        additional_kwargs: { reasoning_content: "Reasoning text." },
      });

      const thinkClose = currentMessage.indexOf("</think>");
      const answerIndex = currentMessage.indexOf("Answer text.");

      expect(thinkClose).toBeGreaterThan(-1);
      expect(answerIndex).toBeGreaterThan(thinkClose);
    });

    it("keeps a reasoning-only chunk inside the open block until content arrives", () => {
      let currentMessage = "";
      const streamer = new ThinkBlockStreamer((msg) => {
        currentMessage = msg;
      });

      // Typical provider sequence: reasoning streams while content is empty,
      // then the answer arrives.
      streamer.processChunk({
        content: "",
        additional_kwargs: { reasoning_content: "Reasoning." },
      });
      streamer.processChunk({
        content: "",
        additional_kwargs: { reasoning_content: " More reasoning." },
      });
      streamer.processChunk({ content: "Answer.", additional_kwargs: {} });

      expect(currentMessage).toBe("\n<think>Reasoning. More reasoning.</think>Answer.");
    });

    it("never places answer text inside a reasoning block when reasoning resumes", () => {
      let currentMessage = "";
      const streamer = new ThinkBlockStreamer((msg) => {
        currentMessage = msg;
      });

      // Contradictory input: reasoning resumes after the answer has begun. A
      // single linear string cannot interleave the two, so the later reasoning
      // opens its own block. What matters is that no text is lost and that the
      // answer is never swallowed into a reasoning block.
      streamer.processChunk({
        content: "Answer.",
        additional_kwargs: { reasoning_content: "Reasoning." },
      });
      streamer.processChunk({
        content: "",
        additional_kwargs: { reasoning_content: " More reasoning." },
      });

      expect(currentMessage).toContain("Answer.");
      expect(currentMessage).toContain("Reasoning.");
      expect(currentMessage).toContain(" More reasoning.");

      // The answer must sit outside every think block.
      const segments = currentMessage.split(/(<\/?think>)/);
      let depth = 0;
      let answerOutsideBlock = false;
      for (const segment of segments) {
        if (segment === "<think>") depth++;
        else if (segment === "</think>") depth--;
        else if (depth === 0 && segment.includes("Answer.")) answerOutsideBlock = true;
      }
      expect(answerOutsideBlock).toBe(true);
    });

    it("does not emit a stray close tag when no reasoning preceded the answer", () => {
      let currentMessage = "";
      const streamer = new ThinkBlockStreamer((msg) => {
        currentMessage = msg;
      });

      streamer.processChunk({ content: "Just an answer.", additional_kwargs: {} });

      expect(currentMessage).toBe("Just an answer.");
      expect(currentMessage).not.toContain("</think>");
    });
  });

  describe("whitespace preservation when excluding thinking", () => {
    it("preserves indentation of content following an excluded block", () => {
      let currentMessage = "";
      const streamer = new ThinkBlockStreamer(
        (msg) => {
          currentMessage = msg;
        },
        true // excludeThinking
      );

      streamer.processChunk({
        content: "<think>hidden</think>    indented code",
        additional_kwargs: {},
      });

      // trimStart() used to eat the leading spaces here.
      expect(currentMessage).toBe("    indented code");
    });

    it("keeps a blank line that separates the block from following content", () => {
      let currentMessage = "";
      const streamer = new ThinkBlockStreamer((msg) => {
        currentMessage = msg;
      }, true);

      streamer.processChunk({
        content: "<think>hidden</think>\n\nParagraph after.",
        additional_kwargs: {},
      });

      expect(currentMessage).toContain("Paragraph after.");
      // One newline is kept as the block boundary, preserving the paragraph split.
      expect(currentMessage.startsWith("\n")).toBe(true);
    });

    it("keeps answer text that arrives after an excluded block", () => {
      let currentMessage = "";
      const streamer = new ThinkBlockStreamer((msg) => {
        currentMessage = msg;
      }, true);

      streamer.processChunk({ content: "<think>step 1", additional_kwargs: {} });
      streamer.processChunk({ content: " step 2</think>", additional_kwargs: {} });
      streamer.processChunk({ content: "Final answer.", additional_kwargs: {} });

      expect(currentMessage).toBe("Final answer.");
    });

    it("loses no content when reasoning and answer alternate under excludeThinking", () => {
      let currentMessage = "";
      const streamer = new ThinkBlockStreamer((msg) => {
        currentMessage = msg;
      }, true);

      streamer.processChunk({ content: "A", additional_kwargs: {} });
      streamer.processChunk({ content: "<think>secret", additional_kwargs: {} });
      streamer.processChunk({ content: " more secret</think>", additional_kwargs: {} });
      streamer.processChunk({ content: "B", additional_kwargs: {} });

      expect(currentMessage).toContain("A");
      expect(currentMessage).toContain("B");
      expect(currentMessage).not.toContain("secret");
    });
  });

  describe("special token stripping", () => {
    it("strips chat template tokens from OpenRouter-style content", () => {
      let currentMessage = "";
      const streamer = new ThinkBlockStreamer((msg) => {
        currentMessage = msg;
      });

      streamer.processChunk({
        content: "Answer.<|im_end|>",
        additional_kwargs: { delta: { reasoning: "thinking" } },
      });

      expect(currentMessage).not.toContain("<|im_end|>");
      expect(currentMessage).toContain("Answer.");
    });
  });

  describe("close() with an error response", () => {
    it("appends the error outside any think block", () => {
      // This case asserts on close()'s return value, not the streaming callback.
      const streamer = new ThinkBlockStreamer(() => {});

      streamer.processChunk({ content: "Partial", additional_kwargs: {} });
      streamer.processErrorChunk("Request failed");

      const result = streamer.close();

      // Error text is answer content, so it must not sit inside a think block.
      const thinkOpen = result.content.indexOf("<think>");
      const errorIndex = result.content.indexOf("Request failed");
      expect(errorIndex).toBeGreaterThan(-1);
      if (thinkOpen !== -1) {
        expect(errorIndex).toBeGreaterThan(result.content.indexOf("</think>"));
      }
    });
  });
});
