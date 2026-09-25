import { act, renderHook } from "@testing-library/react";
import { useSmoothStream } from "./useSmoothStream";

/** Manual clock shared by rAF and Date.now, so frames and pacing agree. */
let clock = 0;
let frameCallbacks: FrameRequestCallback[] = [];
let nextHandle = 1;
const handles = new Map<number, FrameRequestCallback>();

const installFakeRaf = (): void => {
  jest.spyOn(window, "requestAnimationFrame").mockImplementation((cb: FrameRequestCallback) => {
    const handle = nextHandle++;
    handles.set(handle, cb);
    frameCallbacks.push(cb);
    return handle;
  });
  jest.spyOn(window, "cancelAnimationFrame").mockImplementation((handle: number) => {
    handles.delete(handle);
  });
};

/** Run at most `count` queued frames, advancing the clock between them. */
const runFrames = (count: number, stepMs = 17): void => {
  for (let i = 0; i < count; i++) {
    const pending = frameCallbacks;
    frameCallbacks = [];
    if (pending.length === 0) {
      return;
    }
    clock += stepMs;
    act(() => {
      pending.forEach((cb) => cb(clock));
    });
  }
};

/** Offer `frames` frames `stepMs` apart and count how many actually rendered. */
const countRenders = (
  hook: { result: { current: { displayText: string } } },
  frames: number,
  stepMs: number
): number => {
  let previous = hook.result.current.displayText.length;
  let renders = 0;

  for (let i = 0; i < frames; i++) {
    clock += stepMs;
    const pending = frameCallbacks;
    frameCallbacks = [];
    if (pending.length === 0) {
      break;
    }
    act(() => {
      pending.forEach((cb) => cb(clock));
    });

    const current = hook.result.current.displayText.length;
    if (current > previous) {
      renders += 1;
    }
    previous = current;
  }

  return renders;
};

const render = (options = {}) =>
  renderHook(() => useSmoothStream({ ...options, now: () => clock }));

describe("useSmoothStream", () => {
  beforeEach(() => {
    clock = 0;
    frameCallbacks = [];
    handles.clear();
    nextHandle = 1;
    installFakeRaf();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("does not touch state until the first frame runs", () => {
    const { result } = render();

    act(() => {
      result.current.pushChunk("hello");
    });

    expect(result.current.displayText).toBe("");
    expect(result.current.pendingLength()).toBe(5);
  });

  it("advances one character per frame when the queue is shallow", () => {
    const { result } = render();

    act(() => {
      result.current.pushChunk("abc");
    });
    runFrames(1);

    expect(result.current.displayText).toBe("a");

    runFrames(1);
    expect(result.current.displayText).toBe("ab");
  });

  it("accelerates the step when the queue is deep", () => {
    const { result } = render({ catchupFactor: 10 });

    act(() => {
      result.current.pushChunk("x".repeat(100));
    });
    runFrames(1);

    // ceil(100 / 10) characters in one frame.
    expect(result.current.displayText).toHaveLength(10);

    runFrames(1);
    expect(result.current.displayText).toHaveLength(19);
  });

  it("keeps the loop alive while the queue drains and stops afterwards", () => {
    const { result } = render();

    act(() => {
      result.current.pushChunk("abcd");
    });
    runFrames(20);

    expect(result.current.displayText).toBe("abcd");
    expect(result.current.pendingLength()).toBe(0);
    // Loop parked: no further frames requested.
    expect(frameCallbacks).toHaveLength(0);
  });

  it("flushes the remainder immediately", () => {
    const { result } = render();

    act(() => {
      result.current.pushChunk("hello world");
    });
    runFrames(1);

    act(() => {
      result.current.flush();
    });

    expect(result.current.displayText).toBe("hello world");
    expect(result.current.pendingLength()).toBe(0);
  });

  it("resets to a clean state for a new stream", () => {
    const { result } = render();

    act(() => {
      result.current.pushChunk("draft");
    });
    runFrames(1);

    act(() => {
      result.current.reset("fresh");
    });

    expect(result.current.displayText).toBe("fresh");
    expect(result.current.pendingLength()).toBe(0);
  });

  it("renders on every frame while the consumer keeps up", () => {
    const hook = render();
    act(() => {
      hook.result.current.pushChunk("y".repeat(400));
    });

    const renders = countRenders(hook, 10, 20);

    expect(renders).toBe(10);
  });

  it("skips frames instead of saturating the main thread after overruns", () => {
    const hook = render({ frameIntervalMs: 16, overrunFramesBeforeDegrade: 2 });
    act(() => {
      hook.result.current.pushChunk("y".repeat(400));
    });

    // Frames arrive 60ms apart, far above the target: the loop backs off.
    runFrames(4, 60);

    const renders = countRenders(hook, 10, 20);

    // Text keeps flowing, but no longer on every single offered frame.
    expect(renders).toBeGreaterThan(0);
    expect(renders).toBeLessThan(10);
  });

  it("cancels pending frames on unmount", () => {
    const cancel = jest.spyOn(window, "cancelAnimationFrame");
    const { result, unmount } = render();

    act(() => {
      result.current.pushChunk("pending");
    });
    unmount();

    expect(cancel).toHaveBeenCalled();
  });
});
