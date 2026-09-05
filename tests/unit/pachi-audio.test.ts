import { describe, expect, it } from "vitest";
import { PachiAudio } from "../../src/ui/pachi-audio";
import type { PachiSessionEvent } from "../../src/game/pachi-types";

type Deferred = {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
  readonly reject: (reason?: unknown) => void;
};

function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<void>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

class FakeOscillator {
  public readonly starts: number[] = [];
  public readonly stops: number[] = [];
  public readonly frequency = { setValueAtTime: (): void => undefined };
  public type: OscillatorType = "sine";
  public onended: (() => void) | null = null;

  public connect(): void {}

  public disconnect(): void {}

  public start(at = 0): void { this.starts.push(at); }

  public stop(at = 0): void { this.stops.push(at); }
}

class FakeGain {
  public readonly gain = {
    setValueAtTime: (): void => undefined,
    linearRampToValueAtTime: (): void => undefined,
    exponentialRampToValueAtTime: (): void => undefined,
  };

  public connect(): void {}

  public disconnect(): void {}
}

class FakeAudioContext {
  public state: AudioContextState;
  public currentTime = 0;
  public readonly destination = {};
  public readonly oscillators: FakeOscillator[] = [];
  public readonly resumes: Deferred[] = [];

  public constructor(state: AudioContextState = "suspended") {
    this.state = state;
  }

  public resume(): Promise<void> {
    const pending = deferred();
    this.resumes.push(pending);
    return pending.promise;
  }

  public close(): Promise<void> {
    this.state = "closed";
    return Promise.resolve();
  }

  public createOscillator(): OscillatorNode {
    const oscillator = new FakeOscillator();
    this.oscillators.push(oscillator);
    return oscillator as unknown as OscillatorNode;
  }

  public createGain(): GainNode {
    return new FakeGain() as unknown as GainNode;
  }
}

function asAudioContext(context: FakeAudioContext): AudioContext {
  return context as unknown as AudioContext;
}

const spinPush: PachiSessionEvent = { id: 1, type: "spin-push", at: 0 };

describe("PachiAudio", () => {
  it.each(["interrupted", "suspended"] as const)("resumes a %s context after suspension and plays new events", async (interruptedState) => {
    const context = new FakeAudioContext("running");
    const audio = new PachiAudio(() => asAudioContext(context));
    await expect(audio.setEnabled(true)).resolves.toBe(true);

    await audio.setSuspended(true);
    context.state = interruptedState;
    const resume = audio.setSuspended(false);
    expect(context.resumes).toHaveLength(1);

    // Events during an interruption are discarded rather than queued.
    audio.play(spinPush);
    expect(context.oscillators).toHaveLength(0);

    context.state = "running";
    context.resumes[0]?.resolve();
    await expect(resume).resolves.toBe(true);
    audio.play(spinPush);
    expect(context.oscillators).toHaveLength(1);
    expect(context.oscillators[0]?.starts).toHaveLength(1);
  });

  it("keeps a newer ON intent when an older resume rejects", async () => {
    const context = new FakeAudioContext();
    const audio = new PachiAudio(() => asAudioContext(context));
    const oldOn = audio.setEnabled(true);
    expect(context.resumes).toHaveLength(1);

    await expect(audio.setEnabled(false)).resolves.toBe(false);
    const newOn = audio.setEnabled(true);
    expect(context.resumes).toHaveLength(2);

    context.state = "running";
    context.resumes[1]?.resolve();
    await expect(newOn).resolves.toBe(true);
    context.resumes[0]?.reject(new Error("old resume failed"));
    await expect(oldOn).resolves.toBe(false);

    audio.play(spinPush);
    expect(context.oscillators).toHaveLength(1);
    expect(context.oscillators[0]?.starts).toHaveLength(1);
  });

  it("holds ON while paused, stops existing voices, and resumes only on release", async () => {
    const context = new FakeAudioContext("running");
    const audio = new PachiAudio(() => asAudioContext(context));
    await expect(audio.setEnabled(true)).resolves.toBe(true);
    audio.play(spinPush);
    expect(context.oscillators).toHaveLength(1);

    await expect(audio.setSuspended(true)).resolves.toBe(true);
    expect(context.oscillators[0]?.stops.length).toBeGreaterThanOrEqual(2);
    await expect(audio.setEnabled(true)).resolves.toBe(true);
    expect(context.resumes).toHaveLength(0);
    audio.play(spinPush);
    expect(context.oscillators).toHaveLength(1);

    context.state = "interrupted";
    const resume = audio.setSuspended(false);
    context.state = "running";
    context.resumes[0]?.resolve();
    await expect(resume).resolves.toBe(true);
    audio.play(spinPush);
    expect(context.oscillators).toHaveLength(2);
  });

  it("stays silent after destroy when an old resume settles or fails", async () => {
    const context = new FakeAudioContext();
    const audio = new PachiAudio(() => asAudioContext(context));
    const pending = audio.setEnabled(true);
    expect(context.resumes).toHaveLength(1);
    audio.destroy();
    context.resumes[0]?.reject(new Error("context closed"));

    await expect(pending).resolves.toBe(false);
    await expect(audio.setEnabled(true)).resolves.toBe(false);
    audio.play(spinPush);
    expect(context.oscillators).toHaveLength(0);
  });

  it.each([
    ["off", "resolve"], ["off", "reject"],
    ["paused", "resolve"], ["paused", "reject"],
    ["destroy", "resolve"], ["destroy", "reject"],
  ] as const)("does not revive audio after %s when an old resume %s", async (lifecycle, completion) => {
    const context = new FakeAudioContext();
    const audio = new PachiAudio(() => asAudioContext(context));
    const oldOn = audio.setEnabled(true);
    expect(context.resumes).toHaveLength(1);

    if (lifecycle === "off") await expect(audio.setEnabled(false)).resolves.toBe(false);
    else if (lifecycle === "paused") await expect(audio.setSuspended(true)).resolves.toBe(true);
    else audio.destroy();

    if (completion === "resolve") {
      // A stale completion may change the browser's context state, but it must
      // not change PachiAudio's lifecycle state or create a voice.
      context.state = "running";
      context.resumes[0]?.resolve();
    } else {
      context.resumes[0]?.reject(new Error("stale resume failed"));
    }
    await expect(oldOn).resolves.toBe(false);
    audio.play(spinPush);
    expect(context.oscillators).toHaveLength(0);

    if (lifecycle === "paused") {
      context.state = "interrupted";
      const release = audio.setSuspended(false);
      expect(context.resumes).toHaveLength(2);
      context.state = "running";
      context.resumes[1]?.resolve();
      await expect(release).resolves.toBe(true);
      audio.play(spinPush);
      expect(context.oscillators).toHaveLength(1);
    }
  });

  it("turns the latest ON intent off when its resume fails", async () => {
    const context = new FakeAudioContext("running");
    const audio = new PachiAudio(() => asAudioContext(context));
    await expect(audio.setEnabled(true)).resolves.toBe(true);
    context.state = "interrupted";
    const resume = audio.setSuspended(false);
    context.resumes[0]?.reject(new Error("latest resume failed"));
    await expect(resume).resolves.toBe(false);
    audio.play(spinPush);
    expect(context.oscillators).toHaveLength(0);
  });
});
