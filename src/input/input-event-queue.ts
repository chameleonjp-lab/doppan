import {
  normalizeInputAction,
  type InputEvent,
  type InputEventDraft,
} from "./input-types";

export const MAX_PENDING_INPUT_EVENTS = 256;

/**
 * Thrown when an input queue would exceed its bounded capacity.
 *
 * The queue enters a latched safe-stop state before throwing. Callers must
 * make an explicit recovery decision; the queue never silently drops the
 * oldest event to make room for a new one.
 */
export class InputQueueOverflowError extends Error {
  public readonly code = "INPUT_QUEUE_OVERFLOW_SAFE_STOP" as const;

  public readonly maxPendingEvents: number;

  public constructor(maxPendingEvents = MAX_PENDING_INPUT_EVENTS) {
    super(`Input event queue exceeded its ${maxPendingEvents}-event limit; safe stop required.`);
    this.name = "InputQueueOverflowError";
    this.maxPendingEvents = maxPendingEvents;
  }
}
export interface InputEventQueueOptions {
  readonly maxPendingEvents?: number;
  readonly now?: () => number;
}

/**
 * A bounded, sequence-ordered queue for browser input events.
 *
 * Events are assigned a monotonically increasing sequence ID on insertion
 * when the caller does not provide one. Sorting happens when draining so the
 * queue remains correct even when a test adapter or an integration boundary
 * supplies events out of order.
 */
export class InputEventQueue {
  private readonly maxPendingEvents: number;

  private readonly now: () => number;

  private pendingEvents: InputEvent[] = [];

  private nextSequenceId = 1;

  private safeStopped = false;

  public constructor(options: InputEventQueueOptions = {}) {
    const maxPendingEvents = options.maxPendingEvents ?? MAX_PENDING_INPUT_EVENTS;
    if (!Number.isInteger(maxPendingEvents) || maxPendingEvents < 1) {
      throw new RangeError("maxPendingEvents must be a positive integer.");
    }
    this.maxPendingEvents = maxPendingEvents;
    this.now = options.now ?? defaultMonotonicNow;
  }

  public get size(): number {
    return this.pendingEvents.length;
  }

  public get limit(): number {
    return this.maxPendingEvents;
  }

  public get isSafeStopped(): boolean {
    return this.safeStopped;
  }

  public enqueue(draft: InputEventDraft): InputEvent {
    if (this.safeStopped) {
      throw new InputQueueOverflowError(this.maxPendingEvents);
    }

    if (this.pendingEvents.length >= this.maxPendingEvents) {
      this.safeStopped = true;
      this.pendingEvents = [];
      throw new InputQueueOverflowError(this.maxPendingEvents);
    }

    const sequenceId = draft.sequenceId ?? this.nextSequenceId;
    if (!Number.isSafeInteger(sequenceId) || sequenceId < 1) {
      throw new RangeError("sequenceId must be a positive safe integer.");
    }
    this.nextSequenceId = Math.max(this.nextSequenceId, sequenceId + 1);

    const event: InputEvent = {
      sequenceId,
      source: draft.source,
      sourceId: draft.sourceId,
      action: normalizeInputAction(draft.action),
      phase: draft.phase,
      receivedAtMs: draft.receivedAtMs ?? this.now(),
      ...(draft.assignedPhysicsStepId === undefined
        ? {}
        : { assignedPhysicsStepId: draft.assignedPhysicsStepId }),
      ...(draft.releaseReason === undefined ? {} : { releaseReason: draft.releaseReason }),
    };

    this.pendingEvents.push(event);
    return event;
  }

  /**
   * Returns the events eligible for the given physics step in sequence order.
   * An unassigned event is assigned to this step exactly once. Events
   * assigned to a later step remain pending.
   */
  public drainForPhysicsStep(physicsStepId: number): InputEvent[] {
    validatePhysicsStepId(physicsStepId);
    const eligible: InputEvent[] = [];
    const remaining: InputEvent[] = [];

    for (const event of this.sortedPendingEvents()) {
      const assignedStep = event.assignedPhysicsStepId;
      if (assignedStep !== undefined && assignedStep > physicsStepId) {
        remaining.push(event);
        continue;
      }

      eligible.push(
        assignedStep === undefined
          ? { ...event, assignedPhysicsStepId: physicsStepId }
          : event,
      );
    }

    this.pendingEvents = remaining;
    return eligible;
  }

  /**
   * Requeues an already-drained event for a later physics step.
   * This is used by InputState to guarantee that a short press is visible for
   * one complete step before its release is applied.
   */
  public deferForPhysicsStep(event: InputEvent, physicsStepId: number): void {
    validatePhysicsStepId(physicsStepId);
    if (this.safeStopped) {
      throw new InputQueueOverflowError(this.maxPendingEvents);
    }
    if (this.pendingEvents.length >= this.maxPendingEvents) {
      this.safeStopped = true;
      this.pendingEvents = [];
      throw new InputQueueOverflowError(this.maxPendingEvents);
    }
    this.pendingEvents.push({ ...event, assignedPhysicsStepId: physicsStepId });
  }

  public peek(): readonly InputEvent[] {
    return this.sortedPendingEvents();
  }

  /** Clears pending events without clearing the queue's safe-stop latch. */
  public clear(): void {
    this.pendingEvents = [];
  }

  /**
   * Explicitly releases a queue after its owner has handled the safe-stop
   * error. This is intentionally not called by enqueue or by a controller.
   */
  public resetSafeStop(): void {
    this.safeStopped = false;
    this.pendingEvents = [];
  }

  private sortedPendingEvents(): InputEvent[] {
    return [...this.pendingEvents].sort((left, right) => left.sequenceId - right.sequenceId);
  }
}

function defaultMonotonicNow(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function validatePhysicsStepId(physicsStepId: number): void {
  if (!Number.isSafeInteger(physicsStepId) || physicsStepId < 0) {
    throw new RangeError("physicsStepId must be a non-negative safe integer.");
  }
}
