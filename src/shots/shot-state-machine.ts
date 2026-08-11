import type { SensorTransitionEvent } from "../physics/contact-buffer";
import type { TablePoint, TableShotDefinition } from "../table/types";

export type ShotState = "Idle" | "Entered" | "Validated" | "Completed" | "Cooldown";

export type ShotFailureReason = "wrong-direction" | "timeout" | "returned-to-entry" | "exclusive-route" | "ball-ended" | "disabled";

export interface ShotProgress {
  readonly ballId: string;
  readonly shotId: string;
  readonly currentState: ShotState;
  readonly enteredStepId: number | null;
  readonly lastTransitionStepId: number;
  readonly direction: TablePoint;
  readonly entranceId: string | null;
  readonly exitId: string | null;
  readonly failureReason: ShotFailureReason | null;
  readonly completedGameEventId: number | null;
}

export interface GameEvent {
  readonly gameEventId: number;
  readonly physicsStepId: number;
  readonly type: "ShotCompleted";
  readonly ballId: string;
  readonly shotId: string;
}

export interface ScoringEvent {
  readonly scoringEventId: number;
  readonly gameEventId: number;
  readonly physicsStepId: number;
  readonly ballId: string;
  readonly shotId: string;
}

const copyPoint = (point: TablePoint): TablePoint => ({ x: point.x, y: point.y });

function directionIsCorrect(actual: TablePoint, expected: TablePoint): boolean {
  const actualLength = Math.hypot(actual.x, actual.y);
  const expectedLength = Math.hypot(expected.x, expected.y);
  if (actualLength <= 1e-9 || expectedLength <= 1e-9) {
    return false;
  }
  return (actual.x * expected.x + actual.y * expected.y) / (actualLength * expectedLength) >= 0.25;
}

interface MutableShotProgress {
  ballId: string;
  shotId: string;
  currentState: ShotState;
  enteredStepId: number | null;
  lastTransitionStepId: number;
  direction: TablePoint;
  entranceId: string | null;
  exitId: string | null;
  failureReason: ShotFailureReason | null;
  completedGameEventId: number | null;
}

/** Per-ball deterministic shot state machine; scoring is emitted only once. */
export class ShotStateMachine {
  private readonly definitions = new Map<string, TableShotDefinition>();
  private readonly progressByShot = new Map<string, MutableShotProgress>();
  private readonly completedGameEvents = new Set<number>();
  private nextGameEventId = 1;
  private nextScoringEventId = 1;

  public constructor(ballId: string, definitions: readonly TableShotDefinition[]) {
    if (ballId.length === 0) {
      throw new RangeError("ballId must not be empty");
    }
    for (const definition of definitions) {
      this.definitions.set(definition.id, definition);
      this.progressByShot.set(definition.id, {
        ballId,
        shotId: definition.id,
        currentState: "Idle",
        enteredStepId: null,
        lastTransitionStepId: 0,
        direction: { x: 0, y: 0 },
        entranceId: null,
        exitId: null,
        failureReason: null,
        completedGameEventId: null,
      });
    }
  }

  public progress(shotId: string): ShotProgress {
    const progress = this.progressByShot.get(shotId);
    if (progress === undefined) {
      throw new RangeError(`unknown shot ${shotId}`);
    }
    return this.copyProgress(progress);
  }

  public snapshot(): readonly ShotProgress[] {
    return [...this.progressByShot.values()].map((progress) => this.copyProgress(progress));
  }

  public consumeSensorEvents(events: readonly SensorTransitionEvent[], stepId: number): readonly GameEvent[] {
    const gameEvents: GameEvent[] = [];
    const ordered = [...events].sort((left, right) => left.eventId - right.eventId);
    for (const event of ordered) {
      for (const [shotId, definition] of this.definitions) {
        const progress = this.progressByShot.get(shotId);
        if (progress === undefined || progress.ballId !== event.ballId) {
          continue;
        }
        const generated = this.consumeEvent(progress, definition, event, stepId);
        if (generated !== null) {
          gameEvents.push(generated);
        }
      }
    }
    return gameEvents;
  }

  public markValidated(shotId: string, stepId: number): void {
    const progress = this.getProgress(shotId);
    if (progress.currentState === "Entered") {
      progress.currentState = "Validated";
      progress.lastTransitionStepId = stepId;
    }
  }

  public advance(stepId: number): readonly ShotProgress[] {
    for (const [shotId, definition] of this.definitions) {
      const progress = this.progressByShot.get(shotId);
      if (progress === undefined || progress.currentState === "Idle" || progress.enteredStepId === null) {
        continue;
      }
      if (
        (progress.currentState === "Entered" || progress.currentState === "Validated") &&
        stepId - progress.enteredStepId > definition.maxDurationSteps
      ) {
        progress.currentState = "Idle";
        progress.failureReason = "timeout";
        progress.lastTransitionStepId = stepId;
        progress.enteredStepId = null;
      }
      if (progress.currentState === "Cooldown" && stepId - progress.lastTransitionStepId > 2) {
        progress.currentState = "Idle";
        progress.failureReason = null;
        progress.completedGameEventId = null;
        progress.enteredStepId = null;
        progress.entranceId = null;
        progress.exitId = null;
      }
    }
    return this.snapshot();
  }

  public onBallEnded(stepId: number): void {
    for (const progress of this.progressByShot.values()) {
      progress.currentState = "Idle";
      progress.enteredStepId = null;
      progress.lastTransitionStepId = stepId;
      progress.failureReason = "ball-ended";
      progress.entranceId = null;
      progress.exitId = null;
      progress.completedGameEventId = null;
    }
    this.completedGameEvents.clear();
  }

  public toScoringEvents(gameEvents: readonly GameEvent[]): readonly ScoringEvent[] {
    const scoringEvents: ScoringEvent[] = [];
    for (const event of gameEvents) {
      if (this.completedGameEvents.has(event.gameEventId)) {
        continue;
      }
      this.completedGameEvents.add(event.gameEventId);
      scoringEvents.push({
        scoringEventId: this.nextScoringEventId++,
        gameEventId: event.gameEventId,
        physicsStepId: event.physicsStepId,
        ballId: event.ballId,
        shotId: event.shotId,
      });
    }
    return scoringEvents;
  }

  private consumeEvent(
    progress: MutableShotProgress,
    definition: TableShotDefinition,
    event: SensorTransitionEvent,
    stepId: number,
  ): GameEvent | null {
    if (event.phase !== "entered") {
      return null;
    }
    if (progress.currentState === "Cooldown") {
      return null;
    }
    if (event.sensorId === definition.entrySensorId) {
      if (progress.currentState !== "Idle") {
        progress.currentState = "Idle";
        progress.failureReason = "returned-to-entry";
        progress.enteredStepId = null;
        progress.lastTransitionStepId = stepId;
        return null;
      }
      if (!directionIsCorrect(event.direction, definition.expectedDirection)) {
        progress.currentState = "Idle";
        progress.failureReason = "wrong-direction";
        progress.lastTransitionStepId = stepId;
        progress.enteredStepId = null;
        return null;
      }
      progress.currentState = "Entered";
      progress.enteredStepId = stepId;
      progress.lastTransitionStepId = stepId;
      progress.direction = copyPoint(event.direction);
      progress.entranceId = event.sensorId;
      progress.exitId = null;
      progress.failureReason = null;
      progress.completedGameEventId = null;
      return null;
    }
    if (event.sensorId === definition.checkpointSensorId && progress.currentState === "Entered") {
      if (!directionIsCorrect(event.direction, definition.expectedDirection)) {
        progress.currentState = "Idle";
        progress.failureReason = "wrong-direction";
        progress.enteredStepId = null;
        progress.lastTransitionStepId = stepId;
        return null;
      }
      progress.currentState = "Validated";
      progress.lastTransitionStepId = stepId;
      return null;
    }
    if (event.sensorId === definition.exitSensorId && progress.currentState === "Validated") {
      if (!directionIsCorrect(event.direction, definition.expectedDirection)) {
        progress.currentState = "Idle";
        progress.failureReason = "wrong-direction";
        progress.enteredStepId = null;
        progress.lastTransitionStepId = stepId;
        return null;
      }
      progress.currentState = "Completed";
      progress.lastTransitionStepId = stepId;
      progress.exitId = event.sensorId;
      const gameEvent: GameEvent = {
        gameEventId: this.nextGameEventId++,
        physicsStepId: stepId,
        type: "ShotCompleted",
        ballId: progress.ballId,
        shotId: progress.shotId,
      };
      progress.completedGameEventId = gameEvent.gameEventId;
      progress.currentState = "Cooldown";
      return gameEvent;
    }
    return null;
  }

  private getProgress(shotId: string): MutableShotProgress {
    const progress = this.progressByShot.get(shotId);
    if (progress === undefined) {
      throw new RangeError(`unknown shot ${shotId}`);
    }
    return progress;
  }

  private copyProgress(progress: MutableShotProgress): ShotProgress {
    return {
      ...progress,
      direction: copyPoint(progress.direction),
    };
  }
}
