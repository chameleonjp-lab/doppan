export type FrameUpdate = (deltaMs: number, timestampMs: number) => void;

export interface RafDriver {
  request(callback: (timestampMs: number) => void): number;
  cancel(handle: number): void;
  now(): number;
}

export interface GameLoopOptions {
  update?: FrameUpdate;
  driver?: RafDriver;
  onError?: (error: unknown) => void;
}

export interface GameLoopDiagnostics {
  running: boolean;
  disposed: boolean;
  generation: number;
  frameCount: number;
  startCount: number;
  stopCount: number;
  doubleStartAttempts: number;
  errorCount: number;
  pendingFrame: boolean;
  startedAtMs: number | null;
  lastFrameAtMs: number | null;
  lastDeltaMs: number;
  activeLoopCount: number;
}

function browserRafDriver(): RafDriver {
  return {
    request: (callback) => window.requestAnimationFrame(callback),
    cancel: (handle) => window.cancelAnimationFrame(handle),
    now: () => window.performance.now(),
  };
}

/**
 * The one owner of requestAnimationFrame in the application.
 *
 * A generation is incremented on each start/stop boundary. It prevents a
 * callback from an older run from scheduling another frame after a restart.
 */
export class GameLoop {
  private static activeLoopCountValue = 0;

  private readonly update: FrameUpdate;

  private readonly driver: RafDriver;

  private readonly onError: ((error: unknown) => void) | undefined;

  private running = false;

  private disposed = false;

  private generationValue = 0;

  private frameCountValue = 0;

  private startCountValue = 0;

  private stopCountValue = 0;

  private doubleStartAttemptsValue = 0;

  private errorCountValue = 0;

  private frameHandle: number | null = null;

  private startedAtValue: number | null = null;

  private lastFrameAtValue: number | null = null;

  private lastDeltaValue = 0;

  public constructor(update: FrameUpdate, options?: Omit<GameLoopOptions, "update">);

  public constructor(options: GameLoopOptions);

  public constructor(
    updateOrOptions: FrameUpdate | GameLoopOptions,
    options: Omit<GameLoopOptions, "update"> = {},
  ) {
    if (typeof updateOrOptions === "function") {
      this.update = updateOrOptions;
      this.driver = options.driver ?? browserRafDriver();
      this.onError = options.onError;
    } else {
      this.update = updateOrOptions.update ?? (() => undefined);
      this.driver = updateOrOptions.driver ?? browserRafDriver();
      this.onError = updateOrOptions.onError;
    }
  }

  public get isRunning(): boolean {
    return this.running;
  }

  public get generation(): number {
    return this.generationValue;
  }

  public static get activeLoopCount(): number {
    return GameLoop.activeLoopCountValue;
  }

  /** Starts exactly one scheduled frame chain. A double start is rejected. */
  public start(): boolean {
    if (this.disposed || this.running || GameLoop.activeLoopCountValue > 0) {
      this.doubleStartAttemptsValue += this.running ? 1 : 0;
      return false;
    }

    this.running = true;
    GameLoop.activeLoopCountValue += 1;
    this.generationValue += 1;
    this.startCountValue += 1;
    this.lastFrameAtValue = null;
    this.lastDeltaValue = 0;
    try {
      this.startedAtValue = this.driver.now();
      this.schedule(this.generationValue);
      return true;
    } catch (error: unknown) {
      this.errorCountValue += 1;
      this.stop();
      this.notifyError(error);
      return false;
    }
  }

  /** Stops the current chain and cancels its pending callback. */
  public stop(): boolean {
    if (!this.running) {
      return false;
    }

    this.running = false;
    GameLoop.activeLoopCountValue = Math.max(0, GameLoop.activeLoopCountValue - 1);
    this.generationValue += 1;
    this.stopCountValue += 1;
    try {
      this.cancelPendingFrame();
    } catch (error: unknown) {
      this.errorCountValue += 1;
      this.notifyError(error);
    }
    return true;
  }

  /** Permanently disposes the loop. HMR uses this method at module disposal. */
  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.stop();
    this.disposed = true;
  }

  public diagnostics(): GameLoopDiagnostics {
    return {
      running: this.running,
      disposed: this.disposed,
      generation: this.generationValue,
      frameCount: this.frameCountValue,
      startCount: this.startCountValue,
      stopCount: this.stopCountValue,
      doubleStartAttempts: this.doubleStartAttemptsValue,
      errorCount: this.errorCountValue,
      pendingFrame: this.frameHandle !== null,
      startedAtMs: this.startedAtValue,
      lastFrameAtMs: this.lastFrameAtValue,
      lastDeltaMs: this.lastDeltaValue,
      activeLoopCount: GameLoop.activeLoopCountValue,
    };
  }

  private schedule(generation: number): void {
    if (!this.running || this.disposed || generation !== this.generationValue) {
      return;
    }
    this.frameHandle = this.driver.request((timestampMs) => {
      this.onFrame(timestampMs, generation);
    });
  }

  private onFrame(timestampMs: number, generation: number): void {
    if (!this.running || this.disposed || generation !== this.generationValue) {
      return;
    }

    this.frameHandle = null;
    const previous = this.lastFrameAtValue ?? timestampMs;
    const deltaMs = Math.max(0, timestampMs - previous);
    this.lastFrameAtValue = timestampMs;
    this.lastDeltaValue = deltaMs;
    this.frameCountValue += 1;

    try {
      this.update(deltaMs, timestampMs);
      this.schedule(generation);
    } catch (error: unknown) {
      this.errorCountValue += 1;
      this.stop();
      this.notifyError(error);
    }
  }

  private cancelPendingFrame(): void {
    if (this.frameHandle === null) {
      return;
    }
    const handle = this.frameHandle;
    this.frameHandle = null;
    this.driver.cancel(handle);
  }

  private notifyError(error: unknown): void {
    try {
      this.onError?.(error);
    } catch {
      // Error reporting must never revive or strand the frame chain.
    }
  }
}

export function createGameLoop(update: FrameUpdate, options?: Omit<GameLoopOptions, "update">): GameLoop {
  return new GameLoop(update, options);
}
