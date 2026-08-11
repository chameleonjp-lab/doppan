import type { InputEventQueue } from "./input-event-queue";
import {
  inputSourceKey,
  normalizeInputAction,
  type CanonicalInputAction,
  type InputAction,
  type InputEvent,
} from "./input-types";

export interface InputStateSnapshot {
  readonly leftFlipper: boolean;
  readonly rightFlipper: boolean;
  readonly plunger: boolean;
  readonly pressedActions: readonly CanonicalInputAction[];
}

/**
 * Current input state, deliberately separate from both the event queue and
 * pointer ownership. Source-level tracking prevents a keyboard release from
 * cancelling a pointer press on the same action.
 */
export class InputState {
  private readonly activeSources = new Map<CanonicalInputAction, Set<string>>();

  private sourcesBeforeStep = new Set<string>();

  private sourcesPressedThisStep = new Set<string>();

  private sourcesReleasedThisStep = new Set<string>();

  public get leftFlipper(): boolean {
    return this.isPressed("leftFlipper");
  }

  public get rightFlipper(): boolean {
    return this.isPressed("rightFlipper");
  }

  public get plunger(): boolean {
    return this.isPressed("plunger");
  }

  public get launcher(): boolean {
    return this.plunger;
  }

  public isPressed(action: InputAction): boolean {
    return (this.activeSources.get(normalizeInputAction(action))?.size ?? 0) > 0;
  }

  public snapshot(): InputStateSnapshot {
    const pressedActions = (Object.keys({ leftFlipper: true, rightFlipper: true, plunger: true }) as
      CanonicalInputAction[]).filter((action) => this.isPressed(action));
    return {
      leftFlipper: this.leftFlipper,
      rightFlipper: this.rightFlipper,
      plunger: this.plunger,
      pressedActions,
    };
  }

  /** Apply one event immediately. Most callers should use applyQueuedEvents. */
  public applyEvent(event: InputEvent): void {
    const action = normalizeInputAction(event.action);
    const sourceKey = inputSourceKey(event);
    if (event.phase === "pressed") {
      let sources = this.activeSources.get(action);
      if (sources === undefined) {
        sources = new Set<string>();
        this.activeSources.set(action, sources);
      }
      sources.add(sourceKey);
      return;
    }

    const sources = this.activeSources.get(action);
    sources?.delete(sourceKey);
    if (sources !== undefined && sources.size === 0) {
      this.activeSources.delete(action);
    }
  }

  /**
   * Applies all events eligible for one physics step in sequence order.
   *
   * A newly pressed source followed by its release in the same batch is
   * intentionally split over two steps. This is the small, bounded hold that
   * makes a very short tap observable to a fixed-step physics simulation.
   */
  public applyQueuedEvents(queue: InputEventQueue, physicsStepId: number): readonly InputEvent[] {
    const events = queue.drainForPhysicsStep(physicsStepId);
    this.sourcesBeforeStep = this.sourceKeys();
    this.sourcesPressedThisStep = new Set<string>();
    this.sourcesReleasedThisStep = new Set<string>();
    const applied: InputEvent[] = [];
    const deferredSources = new Set<string>();

    for (const event of events) {
      const sourceKey = stateSourceKey(event);
      if (deferredSources.has(sourceKey)) {
        queue.deferForPhysicsStep(event, physicsStepId + 1);
        continue;
      }
      if (event.phase === "pressed") {
        this.applyEvent(event);
        this.sourcesPressedThisStep.add(sourceKey);
        applied.push(event);
        continue;
      }

      const isNewPressThisStep =
        this.sourcesPressedThisStep.has(sourceKey) &&
        (!this.sourcesBeforeStep.has(sourceKey) || this.sourcesReleasedThisStep.has(sourceKey));
      if (isNewPressThisStep) {
        deferredSources.add(sourceKey);
        queue.deferForPhysicsStep(event, physicsStepId + 1);
        continue;
      }

      this.applyEvent(event);
      this.sourcesReleasedThisStep.add(sourceKey);
      applied.push(event);
    }

    return applied;
  }

  /** Returns whether a source is active without exposing mutable internals. */
  public hasSource(event: Pick<InputEvent, "source" | "sourceId" | "action">): boolean {
    return this.activeSources.get(normalizeInputAction(event.action))?.has(inputSourceKey(event)) ?? false;
  }

  /** Clears every source immediately, used by centralized safety release. */
  public releaseAll(): void {
    this.activeSources.clear();
    this.sourcesBeforeStep.clear();
    this.sourcesPressedThisStep.clear();
    this.sourcesReleasedThisStep.clear();
  }

  private sourceKeys(): Set<string> {
    const keys = new Set<string>();
    for (const [action, sources] of this.activeSources.entries()) {
      for (const source of sources) {
        keys.add(`${source}:${action}`);
      }
    }
    return keys;
  }
}

function stateSourceKey(event: Pick<InputEvent, "source" | "sourceId" | "action">): string {
  return `${inputSourceKey(event)}:${normalizeInputAction(event.action)}`;
}
