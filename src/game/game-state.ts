export type BaseGameState =
  | "Boot"
  | "Title"
  | "LaunchReady"
  | "Playing"
  | "BallEnding"
  | "NextBallReady"
  | "Result"
  | "FatalRecovery";

export type SuspensionState =
  | "None"
  | "ManualPause"
  | "VisibilityLost"
  | "WebGLLost"
  | "SystemInterrupted";

export interface PendingTerminalEvent {
  readonly id: string;
  readonly type: string;
  readonly physicsStepId?: number;
  readonly payload?: unknown;
}

export type TerminalEventInput =
  | string
  | (Omit<PendingTerminalEvent, "id"> & { readonly id?: string });

export interface GameStateSnapshot {
  readonly baseState: BaseGameState;
  readonly suspensionState: SuspensionState;
  readonly pendingTerminalEvents: readonly PendingTerminalEvent[];
}

export interface GameStateOptions {
  readonly initialBaseState?: BaseGameState;
  readonly initialSuspensionState?: SuspensionState;
}

/**
 * Canonical owner of base game state, suspension state, and terminal events.
 * Suspension is orthogonal to the base state: hiding the page while waiting
 * to launch therefore resumes to LaunchReady, not Playing.
 */
export class GameState {
  private currentBaseState: BaseGameState;

  private currentSuspensionState: SuspensionState;

  private suspensionBeforeVisibility: SuspensionState | undefined;

  private terminalEventSequence = 1;

  private pendingEvents: PendingTerminalEvent[] = [];

  public constructor(options: GameStateOptions = {}) {
    this.currentBaseState = options.initialBaseState ?? "Boot";
    this.currentSuspensionState = options.initialSuspensionState ?? "None";
    if (this.currentSuspensionState === "VisibilityLost") {
      this.suspensionBeforeVisibility = "None";
    }
  }

  public get baseState(): BaseGameState {
    return this.currentBaseState;
  }

  public get suspensionState(): SuspensionState {
    return this.currentSuspensionState;
  }

  public get pendingTerminalEvents(): readonly PendingTerminalEvent[] {
    return this.pendingEvents.map((event) => ({ ...event }));
  }

  public get isSuspended(): boolean {
    return this.currentSuspensionState !== "None";
  }

  public get isFatalRecovery(): boolean {
    return this.currentBaseState === "FatalRecovery";
  }

  /** Returns true when a fixed-step update is allowed to run. */
  public get canSimulate(): boolean {
    return this.currentBaseState === "Playing" && !this.isSuspended;
  }

  /**
   * Changes the base state through the one canonical state owner.
   * FatalRecovery is a latch: an ordinary transition or resume cannot turn it
   * back into active play.
   */
  public transitionBase(nextState: BaseGameState): boolean {
    if (this.currentBaseState === "FatalRecovery" && nextState !== "FatalRecovery") {
      return false;
    }
    if (nextState === "FatalRecovery") {
      this.enterFatalRecovery();
      return true;
    }
    this.currentBaseState = nextState;
    return true;
  }

  public setBaseState(nextState: BaseGameState): boolean {
    return this.transitionBase(nextState);
  }

  /** Enters a terminal safety state and removes suspension ambiguity. */
  public enterFatalRecovery(): void {
    this.currentBaseState = "FatalRecovery";
    this.currentSuspensionState = "None";
    this.suspensionBeforeVisibility = undefined;
  }

  /** Explicit operator-controlled restart; never called by resume/visibility. */
  public restart(): boolean {
    if (!this.isFatalRecovery) {
      return false;
    }
    this.currentBaseState = "Boot";
    this.currentSuspensionState = "None";
    this.suspensionBeforeVisibility = undefined;
    return true;
  }

  public suspend(reason: Exclude<SuspensionState, "None">): boolean {
    if (this.isFatalRecovery) {
      return false;
    }
    if (reason === "VisibilityLost") {
      return this.handleVisibilityLost();
    }
    this.currentSuspensionState = reason;
    return true;
  }

  public resume(): boolean {
    if (this.isFatalRecovery || this.currentSuspensionState === "None") {
      return false;
    }
    this.currentSuspensionState = "None";
    this.suspensionBeforeVisibility = undefined;
    return true;
  }

  public handleVisibilityLost(): boolean {
    if (this.isFatalRecovery) {
      return false;
    }
    if (this.currentSuspensionState !== "VisibilityLost") {
      this.suspensionBeforeVisibility = this.currentSuspensionState;
      this.currentSuspensionState = "VisibilityLost";
    }
    return true;
  }

  public handleVisibilityRestored(): boolean {
    if (this.isFatalRecovery || this.currentSuspensionState !== "VisibilityLost") {
      return false;
    }
    this.currentSuspensionState = this.suspensionBeforeVisibility ?? "None";
    this.suspensionBeforeVisibility = undefined;
    return true;
  }

  public handleVisibilityChange(hidden: boolean): boolean {
    return hidden ? this.handleVisibilityLost() : this.handleVisibilityRestored();
  }

  /**
   * Adds an event that must survive a suspension boundary. Events are copied
   * at insertion so callers cannot mutate pending terminal state afterward.
   */
  public queueTerminalEvent(input: TerminalEventInput, physicsStepId?: number): PendingTerminalEvent {
    const event = normalizeTerminalEvent(input, this.terminalEventSequence, physicsStepId);
    this.terminalEventSequence += 1;
    this.pendingEvents.push(event);
    return { ...event };
  }

  public enqueuePendingTerminalEvent(
    input: TerminalEventInput,
    physicsStepId?: number,
  ): PendingTerminalEvent {
    return this.queueTerminalEvent(input, physicsStepId);
  }

  public hasPendingTerminalEvent(id: string): boolean {
    return this.pendingEvents.some((event) => event.id === id);
  }

  /**
   * Consumes terminal events only while active. A caller cannot accidentally
   * erase a ball-ending event while the page is hidden.
   */
  public drainPendingTerminalEvents(): readonly PendingTerminalEvent[] {
    if (this.isSuspended || this.isFatalRecovery) {
      return [];
    }
    const events = this.pendingEvents.map((event) => ({ ...event }));
    this.pendingEvents = [];
    return events;
  }

  public consumePendingTerminalEvents(): readonly PendingTerminalEvent[] {
    return this.drainPendingTerminalEvents();
  }

  public snapshot(): GameStateSnapshot {
    return {
      baseState: this.currentBaseState,
      suspensionState: this.currentSuspensionState,
      pendingTerminalEvents: this.pendingTerminalEvents,
    };
  }
}

/** Alias for callers that prefer the store/manager naming. */
export class GameStateManager extends GameState {}

function normalizeTerminalEvent(
  input: TerminalEventInput,
  sequence: number,
  physicsStepId: number | undefined,
): PendingTerminalEvent {
  if (typeof input === "string") {
    return {
      id: `terminal-${sequence}`,
      type: input,
      ...(physicsStepId === undefined ? {} : { physicsStepId }),
    };
  }

  return {
    id: input.id ?? `terminal-${sequence}`,
    type: input.type,
    ...(input.physicsStepId === undefined
      ? physicsStepId === undefined
        ? {}
        : { physicsStepId }
      : { physicsStepId: input.physicsStepId }),
    ...(input.payload === undefined ? {} : { payload: input.payload }),
  };
}
