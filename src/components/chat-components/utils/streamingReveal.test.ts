import {
  collectRevealTargets,
  revealBlocks,
  revealAppendedText,
  revealClassFor,
  STREAM_REVEAL_CLASS,
  STREAM_REVEAL_INLINE_CLASS,
  EMPTY_APPENDED_TEXT_STATE,
  STREAM_REVEAL_WIPE_CLASS,
} from "./streamingReveal";

describe("collectRevealTargets", () => {
  it("flattens stable and tail wrappers into one ordered sequence", () => {
    const segment = document.createElement("div");
    segment.innerHTML = `
      <div class="message-segment-stable"><p>one</p><p>two</p></div>
      <div class="message-segment-tail"><p>three</p></div>
    `;

    expect(collectRevealTargets(segment).map((el) => el.textContent)).toEqual([
      "one",
      "two",
      "three",
    ]);
  });

  it("falls back to direct children when no streaming wrappers exist", () => {
    const segment = document.createElement("div");
    segment.innerHTML = `<p>only</p><ul><li>item</li></ul>`;

    expect(collectRevealTargets(segment).map((el) => el.tagName)).toEqual(["P", "UL"]);
  });
});

describe("revealBlocks", () => {
  const buildTargets = (count: number): HTMLElement[] => {
    const parent = document.createElement("div");
    return Array.from({ length: count }, (_unused, index) => {
      const p = document.createElement("p");
      p.textContent = `block ${index}`;
      parent.appendChild(p);
      return p;
    });
  };

  const reveal = (targets: HTMLElement[], previousTimes: number[], now: number) =>
    revealBlocks(targets, previousTimes, {
      className: STREAM_REVEAL_CLASS,
      durationMs: 240,
      now,
    });

  it("animates only blocks beyond the previously seen ones", () => {
    const targets = buildTargets(3);

    const next = reveal(targets, [0], 1000);

    expect(next).toEqual([0, 1000, 1000]);
    expect(targets[0].classList.contains(STREAM_REVEAL_CLASS)).toBe(false);
    expect(targets[1].classList.contains(STREAM_REVEAL_CLASS)).toBe(true);
    expect(targets[2].classList.contains(STREAM_REVEAL_CLASS)).toBe(true);
    expect(targets[1].style.animationDelay).toBe("");
  });

  it("resumes an animation that is still running after a DOM rebuild", () => {
    const targets = buildTargets(2);

    const next = reveal(targets, [0, 900], 1000);

    // Block 1 started 100ms ago and must pick the animation up at 100ms rather
    // than restarting, otherwise the fade is cut short by the next commit.
    expect(targets[1].classList.contains(STREAM_REVEAL_CLASS)).toBe(true);
    expect(targets[1].style.animationDelay).toBe("-100ms");
    expect(next[1]).toBe(900);
  });

  it("stops animating once a block is fully revealed", () => {
    const targets = buildTargets(2);

    reveal(targets, [0, 500], 1000);

    expect(targets[0].classList.contains(STREAM_REVEAL_CLASS)).toBe(false);
    expect(targets[1].classList.contains(STREAM_REVEAL_CLASS)).toBe(false);
  });

  it("drops state for blocks that disappeared in a re-parse", () => {
    const targets = buildTargets(1);

    const next = reveal(targets, [10, 20, 30], 1000);

    expect(next).toEqual([10]);
  });
});

describe("revealAppendedText", () => {
  const OPTIONS = { className: STREAM_REVEAL_INLINE_CLASS, durationMs: 280, now: 1000 };

  const state = (
    text: string,
    settled = text.length,
    marks: { length: number; at: number }[] = []
  ) => ({
    text,
    settled,
    marks,
  });

  const spans = (container: HTMLElement) =>
    Array.from(container.querySelectorAll<HTMLElement>(`span.${STREAM_REVEAL_INLINE_CLASS}`));

  it("wraps only the characters appended since the previous commit", () => {
    const container = document.createElement("div");
    container.innerHTML = "<p>hello world</p>";

    const next = revealAppendedText(container, state("hello"), OPTIONS);

    expect(container.textContent).toBe("hello world");
    expect(spans(container).map((el) => el.textContent)).toEqual([" world"]);
    expect(next.settled).toBe(5);
  });

  it("resumes the previous gulp instead of restarting it", () => {
    const container = document.createElement("div");
    container.innerHTML = "<p>hello world</p>";

    // " world" landed at 900 and is still fading; " again" lands now.
    const previous = state("hello world", 5, [{ length: 11, at: 900 }]);
    const current = document.createElement("div");
    current.innerHTML = "<p>hello world again</p>";

    const next = revealAppendedText(current, previous, OPTIONS);

    expect(current.textContent).toBe("hello world again");
    const [resumed, fresh] = spans(current);
    expect(resumed.textContent).toBe(" world");
    expect(resumed.style.animationDelay).toBe("-100ms");
    expect(fresh.textContent).toBe(" again");
    expect(fresh.style.animationDelay).toBe("");
    expect(next.marks).toEqual([
      { length: 11, at: 900 },
      { length: 17, at: 1000 },
    ]);
    expect(next.settled).toBe(5);
  });

  it("settles a gulp once its animation is over", () => {
    const container = document.createElement("div");
    container.innerHTML = "<p>hello world again</p>";

    const previous = state("hello world", 5, [{ length: 11, at: 500 }]);
    const next = revealAppendedText(container, previous, OPTIONS);

    // The 500ms-old gulp is finished: only the newest gulp is animated.
    expect(spans(container).map((el) => el.textContent)).toEqual([" again"]);
    expect(next.settled).toBe(11);
  });

  it("wraps text inside the deepest inline element", () => {
    const container = document.createElement("div");
    container.innerHTML = "<p>hello <strong>world</strong></p>";

    revealAppendedText(container, state("hello "), OPTIONS);

    const span = spans(container)[0];
    expect(span?.parentElement?.tagName).toBe("STRONG");
    expect(span?.textContent).toBe("world");
  });

  it("does nothing on the first commit", () => {
    const container = document.createElement("div");
    container.innerHTML = "<p>hello</p>";

    const next = revealAppendedText(container, EMPTY_APPENDED_TEXT_STATE, OPTIONS);

    expect(container.querySelector("span")).toBeNull();
    expect(next.settled).toBe(5);
  });

  it("treats replaced text as settled instead of animating it", () => {
    const container = document.createElement("div");
    container.innerHTML = "<p>regenerated</p>";

    const next = revealAppendedText(container, state("replaced"), OPTIONS);

    expect(container.querySelector("span")).toBeNull();
    expect(next.marks).toEqual([]);
    expect(next.settled).toBe(11);
  });
});

describe("revealClassFor", () => {
  it("maps variants to their stylesheet classes", () => {
    expect(revealClassFor("fade")).toBe(STREAM_REVEAL_CLASS);
    expect(revealClassFor("wipe")).toBe(STREAM_REVEAL_WIPE_CLASS);
    expect(revealClassFor()).toBe(STREAM_REVEAL_CLASS);
  });
});
