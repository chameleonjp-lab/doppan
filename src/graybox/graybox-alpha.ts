import type { GameState } from "../game";
import type { InputController } from "../input";
import type { PhysicsStepHz } from "../loop/fixed-step-clock";
import type { PinballSnapshot, PinballWorld } from "../physics";
import { createGrayboxTableDefinition } from "../table";
import { G1BPrototype, type G1BPrototypeDiagnostics } from "../prototype";
import { GrayboxRuntime, type GrayboxRuntimeSnapshot } from "./graybox-runtime";

export interface GrayboxAlphaSnapshot extends PinballSnapshot {
  readonly graybox: GrayboxRuntimeSnapshot;
}

export interface GrayboxAlphaDiagnostics extends G1BPrototypeDiagnostics {
  readonly graybox: GrayboxRuntimeSnapshot;
}

export interface GrayboxAlphaOptions {
  readonly physicsStepHz?: PhysicsStepHz;
  readonly onFatalError?: (error: unknown) => void;
}

/** G2's playable graybox wrapper around the already-tested G1-B foundation. */
export class GrayboxAlpha {
  public readonly input: InputController;

  private readonly runtimeState: GrayboxRuntime;
  private readonly prototype: G1BPrototype;
  private readonly onFatalError: ((error: unknown) => void) | undefined;
  private destroyed = false;

  public constructor(options: GrayboxAlphaOptions = {}) {
    this.onFatalError = options.onFatalError;
    this.runtimeState = new GrayboxRuntime();
    this.prototype = new G1BPrototype({
      ...(options.physicsStepHz === undefined ? {} : { physicsStepHz: options.physicsStepHz }),
      table: createGrayboxTableDefinition(),
      ...(this.onFatalError === undefined ? {} : { onFatalError: this.onFatalError }),
      onPhysicsStep: (result) => this.runtimeState.consume(result, this.prototype.world),
    });
    this.input = this.prototype.input;
    this.runtimeState.initialize(this.prototype.world);
  }

  public get world(): PinballWorld {
    return this.prototype.world;
  }

  public get gameState(): GameState {
    return this.prototype.gameState;
  }

  public get physicsStepHz(): PhysicsStepHz {
    return this.prototype.physicsStepHz;
  }

  public get launchCharge(): number {
    return this.prototype.launchCharge;
  }

  public advance(deltaMs: number): number {
    this.assertAlive();
    return this.prototype.advance(deltaMs);
  }

  public togglePause(): boolean {
    this.assertAlive();
    return this.prototype.togglePause();
  }

  public markRendered(renderedAtMs?: number): void {
    this.assertAlive();
    this.prototype.markRendered(renderedAtMs);
  }

  public setVisibility(hidden: boolean): void {
    this.assertAlive();
    this.prototype.setVisibility(hidden);
  }

  public reset(physicsStepHz: PhysicsStepHz = this.physicsStepHz): void {
    this.assertAlive();
    this.prototype.reset(physicsStepHz);
    this.runtimeState.reset(this.prototype.world);
  }

  public safeStop(error: unknown, report = true): void {
    this.assertAlive();
    this.prototype.safeStop(error, report);
  }

  public snapshot(): GrayboxAlphaSnapshot {
    this.assertAlive();
    const snapshot = this.prototype.snapshot();
    return {
      ...snapshot,
      graybox: this.runtimeState.snapshot(this.prototype.world),
    };
  }

  public diagnostics(): GrayboxAlphaDiagnostics {
    this.assertAlive();
    const diagnostics = this.prototype.diagnostics();
    return {
      ...diagnostics,
      graybox: this.runtimeState.snapshot(this.prototype.world),
    };
  }

  public destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.prototype.destroy();
  }

  private assertAlive(): void {
    if (this.destroyed) {
      throw new Error("GrayboxAlpha has been destroyed");
    }
  }
}
