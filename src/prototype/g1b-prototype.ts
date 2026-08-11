import type { GameState } from "../game";
import { InputController, type InputLatencyDiagnostics } from "../input";
import { FixedStepClock, type FixedStepDiagnostics, type PhysicsStepHz } from "../loop/fixed-step-clock";
import {
  PinballWorld,
  type PhysicsDiagnostics,
  type PinballSnapshot,
  type PinballStepResult,
} from "../physics";
import type { TableDefinition } from "../table";

export interface G1BPrototypeDiagnostics {
  readonly fixedStep: FixedStepDiagnostics;
  readonly physics: PhysicsDiagnostics;
  readonly inputQueueSize: number;
  readonly inputOwners: number;
  readonly inputLatency: InputLatencyDiagnostics;
  readonly launchCharge: number;
  readonly launchReady: boolean;
  readonly fatalError: string | null;
  readonly runIntegrity: "valid" | "invalid";
}

export interface G1BPrototypeOptions {
  readonly physicsStepHz?: PhysicsStepHz;
  readonly table?: TableDefinition;
  readonly onPhysicsStep?: (result: PinballStepResult) => void;
  readonly onFatalError?: (error: unknown) => void;
}

const FULL_CHARGE_SECONDS = 1.2;

function canLaunchFrom(baseState: GameState["baseState"]): boolean {
  return baseState === "LaunchReady" || baseState === "NextBallReady";
}

function canAcceptGameplayInput(baseState: GameState["baseState"]): boolean {
  return baseState === "Playing" || canLaunchFrom(baseState);
}

/** Connects input, fixed time, Planck, and plain presentation snapshots. */
export class G1BPrototype {
  public readonly input: InputController;

  private worldValue: PinballWorld;

  private clockValue: FixedStepClock;

  private physicsStepHzValue: PhysicsStepHz;

  private readonly onFatalError: ((error: unknown) => void) | undefined;

  private readonly onPhysicsStep: ((result: PinballStepResult) => void) | undefined;

  private readonly table: TableDefinition | undefined;

  private plungerWasPressed = false;

  private chargeSteps = 0;

  private gameplayStartedValue = false;

  private fatalErrorValue: Error | null = null;

  private destroyed = false;

  public constructor(options: G1BPrototypeOptions = {}) {
    this.physicsStepHzValue = options.physicsStepHz ?? 60;
    this.onFatalError = options.onFatalError;
    this.onPhysicsStep = options.onPhysicsStep;
    this.table = options.table;
    this.worldValue = new PinballWorld({
      physicsStepHz: this.physicsStepHzValue,
      ...(this.table === undefined ? {} : { table: this.table }),
    });
    this.clockValue = new FixedStepClock({ physicsStepHz: this.physicsStepHzValue });
    this.input = new InputController({
      onSafeStop: (error) => this.fail(error),
      isActionEnabled: (action) =>
        !this.gameState.isFatalRecovery &&
        this.gameState.suspensionState === "None" &&
        canAcceptGameplayInput(this.gameState.baseState) &&
        (action !== "plunger" || canLaunchFrom(this.gameState.baseState)),
    });
  }

  public get world(): PinballWorld {
    return this.worldValue;
  }

  public get physicsStepHz(): PhysicsStepHz {
    return this.physicsStepHzValue;
  }

  public get gameState(): GameState {
    return this.worldValue.gameState;
  }

  public advance(deltaMs: number): number {
    this.assertAlive();
    if (this.fatalErrorValue !== null || this.gameState.isFatalRecovery) {
      return 0;
    }
    const suspended = this.gameState.suspensionState !== "None";
    this.clockValue.setSuspended(suspended);
    if (suspended) {
      return 0;
    }

    try {
      let gameplayStartedThisAdvance = false;
      const steps = this.clockValue.advance(deltaMs, (stepSeconds, physicsStepId) => {
        const appliedEvents = this.input.applyPhysicsStep(physicsStepId);
        const input = this.input.state.snapshot();
        let launch: number | undefined;
        const plungerReleased = appliedEvents.some(
          (event) => event.action === "plunger" && event.phase === "released",
        );

        if (input.plunger) {
          this.chargeSteps += 1;
        } else if (plungerReleased && this.plungerWasPressed) {
          if (canLaunchFrom(this.gameState.baseState)) {
            launch = this.launchCharge;
          }
        }
        if (!input.plunger) {
          this.chargeSteps = 0;
        }
        this.plungerWasPressed = input.plunger;

        if (launch !== undefined && !this.gameplayStartedValue) {
          this.gameplayStartedValue = true;
          gameplayStartedThisAdvance = true;
        }

        const stepResult = this.worldValue.step(stepSeconds, {
          left: input.leftFlipper,
          right: input.rightFlipper,
          ...(launch === undefined ? {} : { launch }),
        });
        this.onPhysicsStep?.(stepResult);
        if (stepResult.drained) {
          this.clearLaunchCharge();
          this.input.releaseAll("ball-end");
        }
      });

      // Renderer initialization and the first page frames can legitimately
      // exceed the catch-up budget before a run has started. Do not carry
      // that startup jitter into the next launch, but keep the strict
      // repeated-drop stop once gameplay is active.
      if (!this.gameplayStartedValue || gameplayStartedThisAdvance) {
        this.clockValue.resetRunIntegrity();
      }
      if (this.gameplayStartedValue && this.clockValue.diagnostics().autoPauseReason !== null) {
        this.input.releaseAll("safe-stop");
        this.gameState.suspend("SystemInterrupted");
        this.clockValue.setSuspended(true);
      }
      return steps;
    } catch (error: unknown) {
      this.fail(error);
      return 0;
    }
  }

  public get launchCharge(): number {
    const stepsForFullCharge = this.physicsStepHzValue * FULL_CHARGE_SECONDS;
    return Math.min(1, Math.max(0, this.chargeSteps / stepsForFullCharge));
  }

  public snapshot(): PinballSnapshot {
    this.assertAlive();
    return this.worldValue.getSnapshot();
  }

  public diagnostics(): G1BPrototypeDiagnostics {
    this.assertAlive();
    return {
      fixedStep: this.clockValue.diagnostics(),
      physics: this.worldValue.diagnostics(),
      inputQueueSize: this.input.queue.size,
      inputOwners: this.input.ownership.size,
      inputLatency: this.input.latencyDiagnostics(),
      launchCharge: this.launchCharge,
      launchReady: this.gameState.baseState === "LaunchReady",
      fatalError: this.fatalErrorValue?.message ?? null,
      runIntegrity:
        this.fatalErrorValue !== null ||
        this.worldValue.diagnostics().runIntegrity === "invalid" ||
        this.clockValue.diagnostics().runIntegrity === "invalid"
          ? "invalid"
          : "valid",
    };
  }

  public togglePause(): boolean {
    this.assertAlive();
    if (this.fatalErrorValue !== null || this.gameState.isFatalRecovery) {
      return false;
    }
    if (this.gameState.suspensionState === "ManualPause") {
      this.gameState.resume();
      this.clockValue.setSuspended(false);
      return true;
    }
    if (this.gameState.suspensionState !== "None") {
      return false;
    }
    this.clearLaunchCharge();
    this.input.releaseAll("manual");
    this.gameState.suspend("ManualPause");
    this.clockValue.setSuspended(true);
    return true;
  }

  public markRendered(renderedAtMs?: number): void {
    this.assertAlive();
    this.input.markRendered(renderedAtMs);
  }

  public setVisibility(hidden: boolean): void {
    this.assertAlive();
    if (hidden) {
      this.clearLaunchCharge();
    }
    this.gameState.handleVisibilityChange(hidden);
    this.clockValue.setSuspended(this.gameState.suspensionState !== "None");
    if (hidden) {
      this.input.releaseAll("visibilitychange");
    }
  }

  public reset(physicsStepHz: PhysicsStepHz = this.physicsStepHzValue): void {
    this.assertAlive();
    this.input.releaseAll("manual");
    this.input.resetSafeStop();
    this.worldValue.destroy();
    this.physicsStepHzValue = physicsStepHz;
    this.worldValue = new PinballWorld({
      physicsStepHz,
      ...(this.table === undefined ? {} : { table: this.table }),
    });
    this.clockValue = new FixedStepClock({ physicsStepHz });
    this.clearLaunchCharge();
    this.gameplayStartedValue = false;
    this.fatalErrorValue = null;
  }

  /** Latches a non-recoverable run error; operator reset is the only recovery. */
  public safeStop(error: unknown, report = true): void {
    this.assertAlive();
    this.fail(error, report);
  }

  public destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.input.releaseAll("manual");
    this.worldValue.destroy();
  }

  private fail(error: unknown, report = true): void {
    if (this.fatalErrorValue !== null) {
      return;
    }
    this.fatalErrorValue = error instanceof Error ? error : new Error(String(error));
    this.clearLaunchCharge();
    try {
      this.input.releaseAll("safe-stop");
    } catch {
      // The original safety failure remains the diagnostic source.
    }
    this.gameState.enterFatalRecovery();
    this.clockValue.setSuspended(true);
    try {
      if (report) {
        this.onFatalError?.(this.fatalErrorValue);
      }
    } catch {
      // Reporting cannot revive the prototype after a fatal transition.
    }
  }

  private assertAlive(): void {
    if (this.destroyed) {
      throw new Error("G1BPrototype has been destroyed");
    }
  }

  private clearLaunchCharge(): void {
    this.plungerWasPressed = false;
    this.chargeSteps = 0;
  }
}
