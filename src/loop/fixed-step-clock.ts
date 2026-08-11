export type PhysicsStepHz = 60 | 120;

export type RunIntegrity = "valid" | "invalid";

export interface FixedStepDiagnostics {
  physicsStepHz: PhysicsStepHz;
  physicsStepId: number;
  stepsThisFrame: number;
  accumulatorMs: number;
  droppedSimulationMs: number;
  droppedSimulationCount: number;
  runIntegrity: RunIntegrity;
  autoPauseReason: "repeated-dropped-simulation" | null;
  suspended: boolean;
}

export interface FixedStepClockOptions {
  physicsStepHz: PhysicsStepHz;
  maxCatchUpMs?: number;
  staleDeltaMs?: number;
  maxDroppedBeforeInvalid?: number;
}

export type FixedStepUpdate = (stepSeconds: number, physicsStepId: number) => void;

const DEFAULT_MAX_CATCH_UP_MS = 66;
const DEFAULT_STALE_DELTA_MS = 250;
const DEFAULT_MAX_DROPPED_BEFORE_INVALID = 2;
const DROP_WINDOW_MS = 15 * 60 * 1000;

/**
 * Converts variable display-frame time into deterministic physics steps.
 * Visibility changes must call setSuspended so hidden time is never replayed.
 */
export class FixedStepClock {
  private readonly physicsStepHz: PhysicsStepHz;

  private readonly stepMs: number;

  private readonly maxStepsPerFrame: number;

  private readonly maxCatchUpMs: number;

  private readonly staleDeltaMs: number;

  private readonly maxDroppedBeforeInvalid: number;

  private accumulatorMsValue = 0;

  private physicsStepIdValue = 0;

  private stepsThisFrameValue = 0;

  private droppedSimulationMsValue = 0;

  private droppedSimulationCountValue = 0;

  private visibleElapsedMsValue = 0;

  private dropTimesMs: number[] = [];

  private integrityInvalid = false;

  private suspendedValue = false;

  public constructor(options: FixedStepClockOptions) {
    this.physicsStepHz = options.physicsStepHz;
    this.stepMs = 1000 / options.physicsStepHz;
    this.maxStepsPerFrame = options.physicsStepHz === 60 ? 4 : 8;
    this.maxCatchUpMs = options.maxCatchUpMs ?? DEFAULT_MAX_CATCH_UP_MS;
    this.staleDeltaMs = options.staleDeltaMs ?? DEFAULT_STALE_DELTA_MS;
    this.maxDroppedBeforeInvalid =
      options.maxDroppedBeforeInvalid ?? DEFAULT_MAX_DROPPED_BEFORE_INVALID;

    if (
      !Number.isFinite(this.maxCatchUpMs) ||
      this.maxCatchUpMs <= 0 ||
      !Number.isFinite(this.staleDeltaMs) ||
      this.staleDeltaMs <= this.maxCatchUpMs ||
      !Number.isInteger(this.maxDroppedBeforeInvalid) ||
      this.maxDroppedBeforeInvalid < 0
    ) {
      throw new Error("Invalid fixed-step clock limits");
    }
  }

  public setSuspended(suspended: boolean): void {
    this.suspendedValue = suspended;
    this.stepsThisFrameValue = 0;
    if (suspended) {
      this.accumulatorMsValue = 0;
    }
  }

  public advance(deltaMs: number, update: FixedStepUpdate): number {
    this.stepsThisFrameValue = 0;
    if (this.suspendedValue) {
      return 0;
    }
    if (!Number.isFinite(deltaMs) || deltaMs < 0) {
      throw new Error("Frame delta must be a finite non-negative number");
    }
    this.visibleElapsedMsValue += deltaMs;
    this.pruneDropWindow();
    if (deltaMs >= this.staleDeltaMs) {
      this.recordDrop(deltaMs);
      this.accumulatorMsValue = 0;
      return 0;
    }

    const acceptedMs = Math.min(deltaMs, this.maxCatchUpMs);
    if (deltaMs > acceptedMs) {
      this.recordDrop(deltaMs - acceptedMs);
    }
    this.accumulatorMsValue += acceptedMs;

    while (
      this.accumulatorMsValue + Number.EPSILON >= this.stepMs &&
      this.stepsThisFrameValue < this.maxStepsPerFrame
    ) {
      this.physicsStepIdValue += 1;
      update(1 / this.physicsStepHz, this.physicsStepIdValue);
      this.accumulatorMsValue -= this.stepMs;
      this.stepsThisFrameValue += 1;
    }

    if (this.stepsThisFrameValue >= this.maxStepsPerFrame && this.accumulatorMsValue >= this.stepMs) {
      this.recordDrop(this.accumulatorMsValue);
      this.accumulatorMsValue = 0;
    }
    this.accumulatorMsValue = Math.max(0, this.accumulatorMsValue);
    return this.stepsThisFrameValue;
  }

  public diagnostics(): FixedStepDiagnostics {
    return {
      physicsStepHz: this.physicsStepHz,
      physicsStepId: this.physicsStepIdValue,
      stepsThisFrame: this.stepsThisFrameValue,
      accumulatorMs: this.accumulatorMsValue,
      droppedSimulationMs: this.droppedSimulationMsValue,
      droppedSimulationCount: this.droppedSimulationCountValue,
      runIntegrity: this.integrityInvalid ? "invalid" : "valid",
      autoPauseReason: this.integrityInvalid ? "repeated-dropped-simulation" : null,
      suspended: this.suspendedValue,
    };
  }

  private recordDrop(milliseconds: number): void {
    if (milliseconds <= 0) {
      return;
    }
    this.droppedSimulationMsValue += milliseconds;
    this.droppedSimulationCountValue += 1;
    this.dropTimesMs.push(this.visibleElapsedMsValue);
    this.pruneDropWindow();
    if (this.dropTimesMs.length > this.maxDroppedBeforeInvalid) {
      this.integrityInvalid = true;
    }
  }

  private pruneDropWindow(): void {
    const minimumTime = this.visibleElapsedMsValue - DROP_WINDOW_MS;
    this.dropTimesMs = this.dropTimesMs.filter((time) => time >= minimumTime);
  }
}
