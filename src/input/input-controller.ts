import { InputEventQueue, InputQueueOverflowError } from "./input-event-queue";
import { InputOwnership } from "./input-ownership";
import { InputState } from "./input-state";
import {
  normalizeInputAction,
  type CanonicalInputAction,
  type InputAction,
  type InputEvent,
  type InputReleaseReason,
} from "./input-types";

export interface InputControllerOptions {
  readonly queue?: InputEventQueue;
  readonly ownership?: InputOwnership;
  readonly state?: InputState;
  readonly now?: () => number;
  readonly onSafeStop?: (error: InputQueueOverflowError) => void;
  readonly isActionEnabled?: (action: CanonicalInputAction) => boolean;
}

export interface KeyboardInput {
  readonly code: string;
  readonly action: InputAction;
  readonly repeat?: boolean;
  readonly receivedAtMs?: number;
}

export interface InputLatencySummary {
  readonly sampleCount: number;
  readonly lastMs: number | null;
  readonly medianMs: number | null;
  readonly p95Ms: number | null;
  readonly maxMs: number | null;
}

export interface InputLatencyDiagnostics {
  readonly inputToPhysics: InputLatencySummary;
  readonly inputToDraw: InputLatencySummary;
}

const MAX_LATENCY_SAMPLES = 256;

interface InputSourceRecord {
  readonly source: "pointer" | "keyboard";
  readonly sourceId: number | string;
  readonly action: CanonicalInputAction;
}

/**
 * Coordinates browser-facing input concerns while keeping queue, state, and
 * pointer ownership as separate collaborators.
 *
 * This class does not install DOM listeners. The app shell can route Pointer
 * Events, keyboard events, blur, and visibility changes to these methods and
 * can therefore own listener lifetime explicitly.
 */
export class InputController {
  public readonly queue: InputEventQueue;

  public readonly ownership: InputOwnership;

  public readonly state: InputState;

  private readonly now: () => number;

  private readonly onSafeStop: ((error: InputQueueOverflowError) => void) | undefined;

  private readonly isActionEnabled: (action: CanonicalInputAction) => boolean;

  private readonly keyboardActions = new Map<string, CanonicalInputAction>();

  private physicsStepId = 0;

  private safeStopError: InputQueueOverflowError | undefined;

  private physicsLatencySamples: number[] = [];

  private drawLatencySamples: number[] = [];

  private pendingDrawTimestamps: number[] = [];

  public constructor(options: InputControllerOptions = {}) {
    this.queue =
      options.queue ??
      new InputEventQueue(options.now === undefined ? {} : { now: options.now });
    this.ownership = options.ownership ?? new InputOwnership();
    this.state = options.state ?? new InputState();
    this.now = options.now ?? defaultMonotonicNow;
    this.onSafeStop = options.onSafeStop;
    this.isActionEnabled = options.isActionEnabled ?? (() => true);
  }

  public get isSafeStopped(): boolean {
    return this.safeStopError !== undefined || this.queue.isSafeStopped;
  }

  public get safeStopReason(): InputQueueOverflowError | undefined {
    return this.safeStopError;
  }

  public get currentPhysicsStepId(): number {
    return this.physicsStepId;
  }

  public pointerDown(pointerId: number, action: InputAction, receivedAtMs = this.now()): boolean {
    if (this.isSafeStopped) {
      return false;
    }
    const canonicalAction = normalizeInputAction(action);
    if (!this.isActionEnabled(canonicalAction)) {
      return false;
    }
    if (!this.ownership.claim(pointerId, canonicalAction)) {
      return false;
    }

    try {
      this.enqueue({
        source: "pointer",
        sourceId: pointerId,
        action: canonicalAction,
        phase: "pressed",
        receivedAtMs,
      });
    } catch (error) {
      this.ownership.release(pointerId);
      this.handleQueueOverflow(error);
    }
    return true;
  }

  public pointerUp(pointerId: number, receivedAtMs = this.now()): boolean {
    return this.releasePointer(pointerId, "pointerup", "released", receivedAtMs);
  }

  public pointerCancel(pointerId: number, receivedAtMs = this.now()): boolean {
    return this.releasePointer(pointerId, "pointercancel", "cancelled", receivedAtMs);
  }

  public lostPointerCapture(pointerId: number, receivedAtMs = this.now()): boolean {
    return this.releasePointer(pointerId, "lostpointercapture", "cancelled", receivedAtMs);
  }

  /** Alias matching the DOM event's naming used by some adapters. */
  public handleLostPointerCapture(pointerId: number, receivedAtMs = this.now()): boolean {
    return this.lostPointerCapture(pointerId, receivedAtMs);
  }

  public keyboardDown(input: KeyboardInput): boolean {
    if (this.isSafeStopped || input.repeat === true || this.keyboardActions.has(input.code)) {
      return false;
    }
    const action = normalizeInputAction(input.action);
    if (!this.isActionEnabled(action)) {
      return false;
    }
    try {
      this.enqueue({
        source: "keyboard",
        sourceId: input.code,
        action,
        phase: "pressed",
        receivedAtMs: input.receivedAtMs ?? this.now(),
      });
    } catch (error) {
      this.handleQueueOverflow(error);
    }
    this.keyboardActions.set(input.code, action);
    return true;
  }

  public keyboardUp(code: string, receivedAtMs = this.now()): boolean {
    if (this.isSafeStopped) {
      return false;
    }
    const action = this.keyboardActions.get(code);
    if (action === undefined) {
      return false;
    }
    this.keyboardActions.delete(code);
    try {
      this.enqueue({
        source: "keyboard",
        sourceId: code,
        action,
        phase: "released",
        receivedAtMs,
      });
    } catch (error) {
      this.handleQueueOverflow(error);
    }
    return true;
  }

  public keyboardDownEvent(input: KeyboardInput): boolean {
    return this.keyboardDown(input);
  }

  public keyboardUpEvent(code: string, receivedAtMs = this.now()): boolean {
    return this.keyboardUp(code, receivedAtMs);
  }

  /** Apply queued browser events at the beginning of one fixed-step update. */
  public applyPhysicsStep(physicsStepId = this.physicsStepId + 1): readonly InputEvent[] {
    if (!Number.isSafeInteger(physicsStepId) || physicsStepId < this.physicsStepId) {
      throw new RangeError("physicsStepId must be a non-decreasing safe integer.");
    }
    this.physicsStepId = physicsStepId;
    if (this.isSafeStopped) {
      return [];
    }
    try {
      const events = this.state.applyQueuedEvents(this.queue, physicsStepId);
      const appliedAtMs = this.now();
      for (const event of events) {
        this.recordLatency(this.physicsLatencySamples, appliedAtMs - event.receivedAtMs);
        this.pendingDrawTimestamps.push(event.receivedAtMs);
      }
      return events;
    } catch (error) {
      this.handleQueueOverflow(error);
      return [];
    }
  }

  /** Marks applied input as visible after the owning renderer completes a frame. */
  public markRendered(renderedAtMs = this.now()): void {
    for (const receivedAtMs of this.pendingDrawTimestamps) {
      this.recordLatency(this.drawLatencySamples, renderedAtMs - receivedAtMs);
    }
    this.pendingDrawTimestamps = [];
  }

  public latencyDiagnostics(): InputLatencyDiagnostics {
    return {
      inputToPhysics: summarizeLatency(this.physicsLatencySamples),
      inputToDraw: summarizeLatency(this.drawLatencySamples),
    };
  }

  /**
   * Centralized release for every browser lifecycle interruption. The queue
   * is cleared before cancellation records are added so an old press cannot
   * resurrect after blur or visibility loss. Cancellation records are then
   * consumed immediately at the current physics boundary.
   */
  public releaseAll(reason: InputReleaseReason = "manual", receivedAtMs = this.now()): void {
    const pointerRecords = this.ownership.releaseAll();
    const keyboardRecords: InputSourceRecord[] = [...this.keyboardActions.entries()].map(([code, action]) => ({
      source: "keyboard",
      sourceId: code,
      action,
    }));
    this.keyboardActions.clear();
    this.pendingDrawTimestamps = [];

    this.queue.clear();
    this.state.releaseAll();
    if (this.isSafeStopped) {
      return;
    }

    try {
      for (const record of pointerRecords) {
        this.enqueueCancellation(
          { source: "pointer", sourceId: record.pointerId, action: record.action },
          reason,
          receivedAtMs,
        );
      }
      for (const record of keyboardRecords) {
        this.enqueueCancellation(record, reason, receivedAtMs);
      }
      this.state.applyQueuedEvents(this.queue, this.physicsStepId);
    } catch (error) {
      this.handleQueueOverflow(error);
    }
  }

  public handleBlur(receivedAtMs = this.now()): void {
    this.releaseAll("blur", receivedAtMs);
  }

  public handleWindowBlur(receivedAtMs = this.now()): void {
    this.handleBlur(receivedAtMs);
  }

  public handleVisibilityChange(hidden: boolean, receivedAtMs = this.now()): void {
    if (hidden) {
      this.releaseAll("visibilitychange", receivedAtMs);
    }
  }

  public handleVisibilityLost(receivedAtMs = this.now()): void {
    this.releaseAll("visibilitychange", receivedAtMs);
  }

  /** Explicit caller-controlled recovery after a safe stop. */
  public resetSafeStop(): void {
    this.safeStopError = undefined;
    this.queue.resetSafeStop();
    this.ownership.releaseAll();
    this.keyboardActions.clear();
    this.state.releaseAll();
    this.physicsStepId = 0;
    this.physicsLatencySamples = [];
    this.drawLatencySamples = [];
    this.pendingDrawTimestamps = [];
  }

  private releasePointer(
    pointerId: number,
    reason: InputReleaseReason,
    phase: "released" | "cancelled",
    receivedAtMs: number,
  ): boolean {
    if (this.isSafeStopped) {
      return false;
    }
    const record = this.ownership.release(pointerId);
    if (record === undefined) {
      return false;
    }
    try {
      this.enqueue({
        source: "pointer",
        sourceId: pointerId,
        action: record.action,
        phase,
        releaseReason: reason,
        receivedAtMs,
      });
    } catch (error) {
      this.handleQueueOverflow(error);
    }
    return true;
  }

  private enqueueCancellation(
    record: InputSourceRecord,
    reason: InputReleaseReason,
    receivedAtMs: number,
  ): void {
    this.enqueue({
      source: record.source,
      sourceId: record.sourceId,
      action: record.action,
      phase: "cancelled",
      releaseReason: reason,
      receivedAtMs,
    });
  }

  private enqueue(draft: Parameters<InputEventQueue["enqueue"]>[0]): InputEvent {
    return this.queue.enqueue(draft);
  }

  private recordLatency(samples: number[], latencyMs: number): void {
    if (!Number.isFinite(latencyMs)) {
      return;
    }
    samples.push(Math.max(0, latencyMs));
    if (samples.length > MAX_LATENCY_SAMPLES) {
      samples.splice(0, samples.length - MAX_LATENCY_SAMPLES);
    }
  }

  private handleQueueOverflow(error: unknown): never {
    if (!(error instanceof InputQueueOverflowError)) {
      throw error;
    }
    this.safeStopError = error;
    this.ownership.releaseAll();
    this.keyboardActions.clear();
    this.queue.clear();
    this.state.releaseAll();
    this.onSafeStop?.(error);
    throw error;
  }
}

function defaultMonotonicNow(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function summarizeLatency(samples: readonly number[]): InputLatencySummary {
  if (samples.length === 0) {
    return { sampleCount: 0, lastMs: null, medianMs: null, p95Ms: null, maxMs: null };
  }
  const sorted = [...samples].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
  const p95Index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  return {
    sampleCount: sorted.length,
    lastMs: samples.at(-1) ?? null,
    medianMs: median,
    p95Ms: sorted[p95Index] ?? null,
    maxMs: sorted.at(-1) ?? null,
  };
}
