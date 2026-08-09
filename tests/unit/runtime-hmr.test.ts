import { describe, expect, it } from "vitest";
import { registerGameLoopHmrDispose, type HmrContext } from "../../src/runtime";

describe("runtime HMR ownership", () => {
  it("registers disposal on the caller-provided module context", () => {
    let disposeHandler: (() => void) | undefined;
    let applicationDisposeCount = 0;
    const hot: HmrContext = {
      dispose(callback) {
        disposeHandler = callback;
      },
    };
    const loop = registerGameLoopHmrDispose(() => undefined, hot, {
      onDispose: () => {
        applicationDisposeCount += 1;
      },
    });

    expect(disposeHandler).toBeTypeOf("function");
    disposeHandler?.();
    expect(loop.diagnostics().disposed).toBe(true);
    expect(loop.diagnostics().activeLoopCount).toBe(0);
    expect(loop.start()).toBe(false);
    expect(applicationDisposeCount).toBe(1);
  });
});
