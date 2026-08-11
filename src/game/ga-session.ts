import type { GrayboxAlphaDiagnostics, GrayboxAlphaSnapshot } from "../graybox";
import { GrayboxAlpha } from "../graybox";
import type { PinballStepResult, PinballWorld } from "../physics";
import type { PhysicsStepHz } from "../loop/fixed-step-clock";
import type { InputController } from "../input";
import { GRAYBOX_TABLE_VERSION } from "../table";
import type { GameState } from "./game-state";

export const GA_TOTAL_BALLS = 3 as const;
export const GA_RULE_VERSION = "ga-vertical-slice-1" as const;

export type GaSessionPhase = "launch-ready" | "playing" | "ball-ending" | "result";

export type GaReportEvent =
  | {
      readonly type: "game-start";
      readonly physicsStepId: number;
    }
  | {
      readonly type: "ball-start";
      readonly ballNumber: number;
      readonly physicsStepId: number;
    }
  | {
      readonly type: "shot-completed";
      readonly ballNumber: number;
      readonly physicsStepId: number;
      readonly shotId: string;
      readonly scoreAfter: number;
    }
  | {
      readonly type: "ball-end";
      readonly ballNumber: number;
      readonly physicsStepId: number;
      readonly scoreAfter: number;
      readonly progress: number;
    }
  | {
      readonly type: "game-end";
      readonly physicsStepId: number;
      readonly score: number;
      readonly completedBalls: number;
      readonly progress: number;
      readonly climaxState: GrayboxAlphaSnapshot["graybox"]["climaxState"];
    };

export interface GaResultSnapshot {
  readonly score: number;
  readonly completedBalls: number;
  readonly progress: number;
  readonly climaxState: GrayboxAlphaSnapshot["graybox"]["climaxState"];
  readonly runIntegrity: "valid" | "invalid";
}

export interface GaSessionSnapshot extends GrayboxAlphaSnapshot {
  readonly phase: GaSessionPhase;
  readonly totalBalls: typeof GA_TOTAL_BALLS;
  readonly currentBall: number;
  readonly ballsRemaining: number;
  readonly completedBalls: number;
  readonly result: GaResultSnapshot | null;
}

export interface GaSessionDiagnostics extends GrayboxAlphaDiagnostics {
  readonly ga: {
    readonly phase: GaSessionPhase;
    readonly currentBall: number;
    readonly ballsRemaining: number;
    readonly completedBalls: number;
    readonly reportEventCount: number;
  };
}

export interface GaSessionOptions {
  readonly physicsStepHz?: PhysicsStepHz;
  readonly onFatalError?: (error: unknown) => void;
}

export interface GaPlaytestReport {
  readonly schemaVersion: 1;
  readonly ruleVersion: typeof GA_RULE_VERSION;
  readonly tableVersion: string;
  readonly physicsStepHz: PhysicsStepHz;
  readonly totalBalls: typeof GA_TOTAL_BALLS;
  readonly currentBall: number;
  readonly completedBalls: number;
  readonly ballsRemaining: number;
  readonly phase: GaSessionPhase;
  readonly score: number;
  readonly progress: number;
  readonly climaxState: GrayboxAlphaSnapshot["graybox"]["climaxState"];
  readonly runIntegrity: "valid" | "invalid";
  readonly events: readonly GaReportEvent[];
}

const MAX_REPORT_EVENTS = 128;

/** Owns the GA game lifetime without persisting or transmitting play data. */
export class GaSession {
  public readonly input: InputController;

  private readonly alpha: GrayboxAlpha;
  private readonly onFatalError: ((error: unknown) => void) | undefined;
  private phaseValue: GaSessionPhase = "launch-ready";
  private currentBallValue: number = 1;
  private completedBallsValue: number = 0;
  private ballsRemainingValue: number = GA_TOTAL_BALLS;
  private resultValue: GaResultSnapshot | null = null;
  private reportEventsValue: GaReportEvent[] = [];
  private destroyed = false;

  public constructor(options: GaSessionOptions = {}) {
    this.onFatalError = options.onFatalError;
    this.alpha = new GrayboxAlpha({
      ...(options.physicsStepHz === undefined ? {} : { physicsStepHz: options.physicsStepHz }),
      ...(this.onFatalError === undefined ? {} : { onFatalError: this.onFatalError }),
      onPhysicsStep: (result) => this.consumePhysicsStep(result),
    });
    this.input = this.alpha.input;
    this.beginReport();
  }

  public get world(): PinballWorld {
    return this.alpha.world;
  }

  public get gameState(): GameState {
    return this.alpha.gameState;
  }

  public get physicsStepHz(): PhysicsStepHz {
    return this.alpha.physicsStepHz;
  }

  public get launchCharge(): number {
    return this.alpha.launchCharge;
  }

  public advance(deltaMs: number): number {
    this.assertAlive();
    return this.alpha.advance(deltaMs);
  }

  public togglePause(): boolean {
    this.assertAlive();
    return this.alpha.togglePause();
  }

  public markRendered(renderedAtMs?: number): void {
    this.assertAlive();
    this.alpha.markRendered(renderedAtMs);
  }

  public setVisibility(hidden: boolean): void {
    this.assertAlive();
    this.alpha.setVisibility(hidden);
  }

  public reset(physicsStepHz: PhysicsStepHz = this.physicsStepHz): void {
    this.assertAlive();
    this.alpha.reset(physicsStepHz);
    this.phaseValue = "launch-ready";
    this.currentBallValue = 1;
    this.completedBallsValue = 0;
    this.ballsRemainingValue = GA_TOTAL_BALLS;
    this.resultValue = null;
    this.beginReport();
  }

  public safeStop(error: unknown, report = true): void {
    this.assertAlive();
    this.alpha.safeStop(error, report);
  }

  public snapshot(): GaSessionSnapshot {
    this.assertAlive();
    const snapshot = this.alpha.snapshot();
    return {
      ...snapshot,
      phase: this.phaseValue,
      totalBalls: GA_TOTAL_BALLS,
      currentBall: this.currentBallValue,
      ballsRemaining: this.ballsRemainingValue,
      completedBalls: this.completedBallsValue,
      result: this.resultValue === null ? null : { ...this.resultValue },
    };
  }

  public diagnostics(): GaSessionDiagnostics {
    this.assertAlive();
    const diagnostics = this.alpha.diagnostics();
    return {
      ...diagnostics,
      ga: {
        phase: this.phaseValue,
        currentBall: this.currentBallValue,
        ballsRemaining: this.ballsRemainingValue,
        completedBalls: this.completedBallsValue,
        reportEventCount: this.reportEventsValue.length,
      },
    };
  }

  public playtestReport(): GaPlaytestReport {
    const snapshot = this.snapshot();
    return {
      schemaVersion: 1,
      ruleVersion: GA_RULE_VERSION,
      tableVersion: GRAYBOX_TABLE_VERSION,
      physicsStepHz: this.physicsStepHz,
      totalBalls: GA_TOTAL_BALLS,
      currentBall: this.currentBallValue,
      completedBalls: this.completedBallsValue,
      ballsRemaining: this.ballsRemainingValue,
      phase: this.phaseValue,
      score: snapshot.graybox.score,
      progress: snapshot.graybox.progress,
      climaxState: snapshot.graybox.climaxState,
      runIntegrity: this.diagnostics().runIntegrity,
      events: this.reportEventsValue.map((event) => ({ ...event })),
    };
  }

  public playtestReportJson(): string {
    return JSON.stringify(this.playtestReport(), null, 2);
  }

  public destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.alpha.destroy();
  }

  private consumePhysicsStep(result: PinballStepResult): void {
    if (this.destroyed) {
      return;
    }
    const snapshot = this.alpha.snapshot();
    for (const event of result.gameEvents) {
      this.pushReportEvent({
        type: "shot-completed",
        ballNumber: this.currentBallValue,
        physicsStepId: event.physicsStepId,
        shotId: event.shotId,
        scoreAfter: snapshot.graybox.score,
      });
    }

    const launchExecuted = result.executedCommands.some((command) => command.type === "launchBall");
    if (launchExecuted && this.phaseValue !== "result") {
      this.phaseValue = "playing";
      this.pushReportEvent({
        type: "ball-start",
        ballNumber: this.currentBallValue,
        physicsStepId: result.physicsStepId,
      });
    }

    if (result.drained) {
      this.completedBallsValue = Math.min(GA_TOTAL_BALLS, this.completedBallsValue + 1);
      this.ballsRemainingValue = GA_TOTAL_BALLS - this.completedBallsValue;
      this.pushReportEvent({
        type: "ball-end",
        ballNumber: this.currentBallValue,
        physicsStepId: result.physicsStepId,
        scoreAfter: snapshot.graybox.score,
        progress: snapshot.graybox.progress,
      });
      if (this.ballsRemainingValue === 0) {
        this.phaseValue = "result";
        this.resultValue = {
          score: snapshot.graybox.score,
          completedBalls: this.completedBallsValue,
          progress: snapshot.graybox.progress,
          climaxState: snapshot.graybox.climaxState,
          runIntegrity: this.diagnostics().runIntegrity,
        };
        this.gameState.transitionBase("Result");
        this.pushReportEvent({
          type: "game-end",
          physicsStepId: result.physicsStepId,
          score: snapshot.graybox.score,
          completedBalls: this.completedBallsValue,
          progress: snapshot.graybox.progress,
          climaxState: snapshot.graybox.climaxState,
        });
      } else {
        this.phaseValue = "ball-ending";
      }
      return;
    }

    if (
      this.phaseValue === "ball-ending" &&
      (this.gameState.baseState === "LaunchReady" || this.gameState.baseState === "NextBallReady")
    ) {
      this.currentBallValue += 1;
      this.phaseValue = "launch-ready";
    }
    if (this.phaseValue !== "result" && this.gameState.baseState === "Playing") {
      this.phaseValue = "playing";
    }
  }

  private beginReport(): void {
    this.reportEventsValue = [{ type: "game-start", physicsStepId: this.world.physicsStepId }];
  }

  private pushReportEvent(event: GaReportEvent): void {
    if (this.reportEventsValue.length >= MAX_REPORT_EVENTS) {
      this.reportEventsValue.shift();
    }
    this.reportEventsValue.push(event);
  }

  private assertAlive(): void {
    if (this.destroyed) {
      throw new Error("GaSession has been destroyed");
    }
  }
}
