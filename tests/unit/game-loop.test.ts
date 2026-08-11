import { describe, expect, it } from "vitest";
import { GameLoop, type RafDriver } from "../../src/loop/game-loop";

class FakeRaf implements RafDriver {
  public nowValue = 0;

  public nextHandle = 1;

  public callbacks = new Map<number, (timestampMs: number) => void>();

  public canceled: number[] = [];

  request(callback: (timestampMs: number) => void): number {
    const handle = this.nextHandle++;
    this.callbacks.set(handle, callback);
    return handle;
  }

  cancel(handle: number): void {
    this.canceled.push(handle);
    this.callbacks.delete(handle);
  }

  now(): number {
    return this.nowValue;
  }

  flush(timestampMs: number): void {
    const pending = [...this.callbacks.entries()];
    this.callbacks.clear();
    this.nowValue = timestampMs;
    for (const [, callback] of pending) {
      callback(timestampMs);
    }
  }
}

describe("GameLoop", () => {
  it("reinitializes twenty times without leaving a second frame chain", () => {
    const raf = new FakeRaf();

    for (let index = 0; index < 20; index += 1) {
      const loop = new GameLoop(() => undefined, { driver: raf });
      expect(loop.start()).toBe(true);
      expect(loop.start()).toBe(false);
      expect(raf.callbacks.size).toBe(1);
      expect(loop.diagnostics().activeLoopCount).toBe(1);
      raf.flush(index * 16 + 16);
      expect(raf.callbacks.size).toBe(1);
      expect(loop.diagnostics().frameCount).toBe(1);
      loop.dispose();
      expect(raf.callbacks.size).toBe(0);
      expect(loop.diagnostics().activeLoopCount).toBe(0);
    }
  });

  it("rejects a second active loop instance", () => {
    const firstRaf = new FakeRaf();
    const secondRaf = new FakeRaf();
    const first = new GameLoop(() => undefined, { driver: firstRaf });
    const second = new GameLoop(() => undefined, { driver: secondRaf });

    expect(first.start()).toBe(true);
    expect(second.start()).toBe(false);
    expect(first.diagnostics().activeLoopCount).toBe(1);
    first.dispose();
    expect(second.start()).toBe(true);
    second.dispose();
    expect(second.diagnostics().activeLoopCount).toBe(0);
  });

  it("stops a pending frame and refuses to run an old generation", () => {
    const raf = new FakeRaf();
    const updates: number[] = [];
    const loop = new GameLoop((deltaMs) => updates.push(deltaMs), { driver: raf });

    expect(loop.start()).toBe(true);
    const oldHandle = [...raf.callbacks.keys()][0];
    expect(oldHandle).toBeDefined();
    const oldCallback = oldHandle === undefined ? undefined : raf.callbacks.get(oldHandle);
    expect(loop.stop()).toBe(true);
    expect(raf.canceled).toContain(oldHandle);
    oldCallback?.(16);
    expect(updates).toHaveLength(0);
    expect(loop.start()).toBe(true);
    raf.flush(32);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toBe(0);
    loop.dispose();
    expect(loop.diagnostics().activeLoopCount).toBe(0);
  });

  it("discards hidden wall-clock time before the next frame", () => {
    const raf = new FakeRaf();
    const updates: number[] = [];
    const loop = new GameLoop((deltaMs) => updates.push(deltaMs), { driver: raf });

    loop.start();
    raf.flush(16);
    raf.flush(32);
    loop.discardElapsedTime();
    raf.flush(5_032);

    expect(updates).toEqual([0, 16, 0]);
    expect(loop.diagnostics().lastDeltaMs).toBe(0);
    loop.dispose();
  });

  it("stops safely when the update callback throws", () => {
    const raf = new FakeRaf();
    const errors: unknown[] = [];
    const loop = new GameLoop(() => {
      throw new Error("frame failure");
    }, { driver: raf, onError: (error) => errors.push(error) });

    loop.start();
    raf.flush(20);
    expect(loop.isRunning).toBe(false);
    expect(loop.diagnostics().errorCount).toBe(1);
    expect(errors).toHaveLength(1);
  });

  it("disposes a running loop and rejects later starts", () => {
    const raf = new FakeRaf();
    const loop = new GameLoop(() => undefined, { driver: raf });
    loop.start();
    loop.dispose();
    expect(loop.diagnostics().disposed).toBe(true);
    expect(loop.start()).toBe(false);
    expect(raf.callbacks.size).toBe(0);
  });

  it("rolls back atomically when the RAF driver cannot start", () => {
    const errors: unknown[] = [];
    const driver: RafDriver = {
      request: () => {
        throw new Error("request failed");
      },
      cancel: () => undefined,
      now: () => 0,
    };
    const loop = new GameLoop(() => undefined, { driver, onError: (error) => errors.push(error) });

    expect(loop.start()).toBe(false);
    expect(loop.diagnostics().running).toBe(false);
    expect(loop.diagnostics().activeLoopCount).toBe(0);
    expect(loop.diagnostics().pendingFrame).toBe(false);
    expect(loop.diagnostics().errorCount).toBe(1);
    expect(errors).toHaveLength(1);
  });

  it("rolls back atomically when the RAF clock cannot be read", () => {
    const errors: unknown[] = [];
    const driver: RafDriver = {
      request: () => 1,
      cancel: () => undefined,
      now: () => {
        throw new Error("clock failed");
      },
    };
    const loop = new GameLoop(() => undefined, { driver, onError: (error) => errors.push(error) });

    expect(loop.start()).toBe(false);
    expect(loop.diagnostics().running).toBe(false);
    expect(loop.diagnostics().activeLoopCount).toBe(0);
    expect(loop.diagnostics().pendingFrame).toBe(false);
    expect(loop.diagnostics().errorCount).toBe(1);
    expect(errors).toHaveLength(1);
  });

  it("stops when a later RAF request fails", () => {
    const callbacks = new Map<number, (timestampMs: number) => void>();
    const errors: unknown[] = [];
    let requestCount = 0;
    const driver: RafDriver = {
      request: (callback) => {
        requestCount += 1;
        if (requestCount === 2) {
          throw new Error("follow-up request failed");
        }
        callbacks.set(requestCount, callback);
        return requestCount;
      },
      cancel: (handle) => {
        callbacks.delete(handle);
      },
      now: () => 0,
    };
    const loop = new GameLoop(() => undefined, { driver, onError: (error) => errors.push(error) });

    expect(loop.start()).toBe(true);
    callbacks.get(1)?.(16);
    expect(loop.diagnostics().running).toBe(false);
    expect(loop.diagnostics().activeLoopCount).toBe(0);
    expect(loop.diagnostics().pendingFrame).toBe(false);
    expect(loop.diagnostics().errorCount).toBe(1);
    expect(errors).toHaveLength(1);
  });

  it("stays stopped when cancellation or error reporting throws", () => {
    const callbacks = new Map<number, (timestampMs: number) => void>();
    const driver: RafDriver = {
      request: (callback) => {
        callbacks.set(1, callback);
        return 1;
      },
      cancel: () => {
        throw new Error("cancel failed");
      },
      now: () => 0,
    };
    const loop = new GameLoop(() => undefined, {
      driver,
      onError: () => {
        throw new Error("reporting failed");
      },
    });

    expect(loop.start()).toBe(true);
    expect(loop.stop()).toBe(true);
    expect(loop.diagnostics().running).toBe(false);
    expect(loop.diagnostics().activeLoopCount).toBe(0);
    expect(loop.diagnostics().pendingFrame).toBe(false);
    expect(loop.diagnostics().errorCount).toBe(1);
  });
});
