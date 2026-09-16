import { findStableMarkdownBoundary } from "./streamingMarkdownBoundary";

describe("findStableMarkdownBoundary", () => {
  it("returns 0 for empty content", () => {
    expect(findStableMarkdownBoundary("")).toBe(0);
  });

  it("returns 0 when no blank line has been seen yet", () => {
    expect(findStableMarkdownBoundary("A partial line")).toBe(0);
  });

  it("freezes through the last blank line", () => {
    const content = "First paragraph.\n\nSecond paragraph is still being writ";
    const boundary = findStableMarkdownBoundary(content);

    // Boundary lands after "First paragraph.\n\n"
    expect(content.slice(0, boundary)).toBe("First paragraph.\n\n");
    expect(content.slice(boundary)).toBe("Second paragraph is still being writ");
  });

  it("does not split a partial line across the boundary", () => {
    const content = "Done paragraph.\n\nrun";
    const boundary = findStableMarkdownBoundary(content);

    expect(boundary).toBe("Done paragraph.\n\n".length);
  });

  it("excludes an unterminated code fence from the stable prefix", () => {
    const content = "Intro.\n\n```ts\nconst a = 1;\n";
    const boundary = findStableMarkdownBoundary(content);

    // The fence is open, so the code block region must stay in the tail.
    expect(content.slice(boundary)).toContain("```ts");
  });

  it("freezes a closed code fence", () => {
    const content = "Intro.\n\n```ts\nconst a = 1;\n```\n\nNext sect";
    const boundary = findStableMarkdownBoundary(content);

    expect(content.slice(0, boundary)).toContain("```ts\nconst a = 1;\n```");
    expect(content.slice(boundary)).toBe("Next sect");
  });

  it("treats a tilde fence as a fence", () => {
    const content = "Intro.\n\n~~~\ncode\n";
    const boundary = findStableMarkdownBoundary(content);

    expect(content.slice(boundary)).toContain("~~~");
  });

  it("does not close a backtick fence with a tilde fence", () => {
    const content = "```\ncode\n~~~\n\nstill in fence";
    const boundary = findStableMarkdownBoundary(content);

    // The backtick fence is still open, so nothing is stable.
    expect(boundary).toBe(0);
  });

  it("excludes an unterminated block tag from the stable prefix", () => {
    const content = "Intro.\n\n<think>\nreasoning so far";
    const boundary = findStableMarkdownBoundary(content);

    expect(content.slice(boundary)).toContain("<think>");
  });

  it("freezes a closed block tag", () => {
    const content = "Intro.\n\n<think>\nreasoning\n</think>\n\nAnswer star";
    const boundary = findStableMarkdownBoundary(content);

    expect(content.slice(0, boundary)).toContain("</think>");
    expect(content.slice(boundary)).toBe("Answer star");
  });

  it("ignores tag-like text inside a code fence", () => {
    const content = "Intro.\n\n```\n<think>\n```\n\nAfter";
    const boundary = findStableMarkdownBoundary(content);

    // The <think> sits inside a fence, so it must not be treated as an open
    // block tag: the region through the closing fence is stable, and only the
    // trailing "After" remains in the tail. Had the in-fence tag counted, the
    // boundary would have stopped right after "Intro.\n\n".
    expect(content.slice(0, boundary)).toBe("Intro.\n\n```\n<think>\n```\n\n");
    expect(content.slice(boundary)).toBe("After");
  });

  it("handles content ending with a blank line", () => {
    const content = "Paragraph.\n\n";
    expect(findStableMarkdownBoundary(content)).toBe(content.length);
  });

  it("keeps a partially written table in the tail", () => {
    const content = "Intro.\n\n| a | b |\n| - | - |\n| 1 |";
    const boundary = findStableMarkdownBoundary(content);

    expect(content.slice(boundary)).toContain("| 1 |");
  });

  it("freezes a complete table followed by a blank line", () => {
    const content = "Intro.\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nTail tex";
    const boundary = findStableMarkdownBoundary(content);

    expect(content.slice(0, boundary)).toContain("| 1 | 2 |");
    expect(content.slice(boundary)).toBe("Tail tex");
  });

  it("never returns an offset inside a multi-byte character sequence boundary", () => {
    // Boundary is computed on blank lines only, so multi-byte text is preserved.
    const content = "中文段落。\n\n第二段还在";
    const boundary = findStableMarkdownBoundary(content);
    const stable = content.slice(0, boundary);

    expect(stable).toBe("中文段落。\n\n");
    expect(content.slice(boundary)).toBe("第二段还在");
  });
});
