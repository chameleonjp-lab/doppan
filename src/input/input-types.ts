/**
 * Actions that can be driven by a player input source.
 *
 * `launcher` is kept as a source-level spelling for callers that use the
 * architecture document's terminology. Internally it is normalized to
 * `plunger`, which is the name used by the game input state.
 */
export type InputAction = "leftFlipper" | "rightFlipper" | "plunger" | "launcher";

export type CanonicalInputAction = "leftFlipper" | "rightFlipper" | "plunger";

export type InputSource = "pointer" | "keyboard";

export type InputPhase = "pressed" | "released" | "cancelled";

export type InputReleaseReason =
  | "pointerup"
  | "pointercancel"
  | "lostpointercapture"
  | "blur"
  | "visibilitychange"
  | "ball-end"
  | "manual"
  | "safe-stop";

export interface InputEvent {
  readonly sequenceId: number;
  readonly source: InputSource;
  readonly sourceId: number | string;
  readonly action: CanonicalInputAction;
  readonly phase: InputPhase;
  readonly receivedAtMs: number;
  readonly assignedPhysicsStepId?: number;
  readonly releaseReason?: InputReleaseReason;
}

export interface InputEventDraft {
  readonly sequenceId?: number;
  readonly source: InputSource;
  readonly sourceId: number | string;
  readonly action: InputAction;
  readonly phase: InputPhase;
  readonly receivedAtMs?: number;
  readonly assignedPhysicsStepId?: number;
  readonly releaseReason?: InputReleaseReason;
}

export function normalizeInputAction(action: InputAction): CanonicalInputAction {
  return action === "launcher" ? "plunger" : action;
}

export function inputSourceKey(event: Pick<InputEvent, "source" | "sourceId">): string {
  return `${event.source}:${String(event.sourceId)}`;
}
