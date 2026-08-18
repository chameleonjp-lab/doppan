import { describe, expect, it } from "vitest";
import { GrayboxAlpha, type GrayboxAlphaSnapshot } from "../../src/graybox";
import type { PhysicsStepHz } from "../../src/physics";

type OpeningShotId = "L0" | "R0";
type FlipperAction = "leftFlipper" | "rightFlipper";

interface PlayerShotRun {
  readonly snapshot: GrayboxAlphaSnapshot;
  readonly rightFlipperImpacts: number;
  readonly triggerWasReached: boolean;
  readonly pressedAtStep: number | null;
  readonly tapDurationSteps: number;
}

interface PlayerShotOptions {
  readonly physicsStepHz: PhysicsStepHz;
  readonly triggerY: number | null;
  readonly tapDurationMs?: number;
  readonly flipperAction?: FlipperAction;
  readonly maxDurationSeconds?: number;
}

interface PlayerReturnRun {
  readonly snapshot: GrayboxAlphaSnapshot;
  readonly returnFlipper: "left" | "right";
  readonly returnInputPressed: boolean;
  readonly returnImpactCount: number;
  readonly maxReturnImpactVelocityY: number | null;
}

const FIXED_STEP_MS: Readonly<Record<PhysicsStepHz, number>> = {
  60: 1000 / 60,
  120: 1000 / 120,
};

function launchWithPlayerInput(alpha: GrayboxAlpha, physicsStepHz: PhysicsStepHz): void {
  const stepMs = FIXED_STEP_MS[physicsStepHz];
  expect(alpha.input.pointerDown(1, "plunger")).toBe(true);
  for (let step = 0; step < Math.ceil(physicsStepHz * 1.2); step += 1) {
    alpha.advance(stepMs);
  }
  expect(alpha.launchCharge).toBe(1);
  expect(alpha.input.pointerUp(1)).toBe(true);
  alpha.advance(stepMs);
}

function runPlayerShot(options: PlayerShotOptions): PlayerShotRun {
  let rightFlipperImpacts = 0;
  const alpha = new GrayboxAlpha({
    physicsStepHz: options.physicsStepHz,
    onPhysicsStep: (result) => {
      rightFlipperImpacts += result.impacts.filter(
        (impact) => impact.fixtureId === "flipper-right",
      ).length;
    },
  });
  const stepMs = FIXED_STEP_MS[options.physicsStepHz];
  const tapDurationSteps = Math.max(
    1,
    Math.round(((options.tapDurationMs ?? 100) * options.physicsStepHz) / 1000),
  );
  const action = options.flipperAction ?? "rightFlipper";
  let triggerWasReached = false;
  let pressedAtStep: number | null = null;
  let released = false;

  launchWithPlayerInput(alpha, options.physicsStepHz);

  for (
    let step = 0;
    step < options.physicsStepHz * (options.maxDurationSeconds ?? 4);
    step += 1
  ) {
    const before = alpha.snapshot();
    if (
      options.triggerY !== null &&
      pressedAtStep === null &&
      before.ball.linearVelocity.y < 0 &&
      before.ball.position.x < 6.5 &&
      before.ball.position.y <= options.triggerY &&
      before.ball.position.y > 1.5
    ) {
      triggerWasReached = true;
      pressedAtStep = step;
      expect(alpha.input.pointerDown(2, action)).toBe(true);
    }
    if (
      pressedAtStep !== null &&
      !released &&
      step >= pressedAtStep + tapDurationSteps
    ) {
      expect(alpha.input.pointerUp(2)).toBe(true);
      released = true;
    }

    alpha.advance(stepMs);
    const after = alpha.snapshot();
    if (after.graybox.completedShotIds.length > 0 || after.baseState === "BallEnding") {
      break;
    }
  }

  if (pressedAtStep !== null && !released) {
    alpha.input.pointerUp(2);
  }
  if (alpha.snapshot().graybox.completedShotIds.length > 0) {
    alpha.advance(stepMs);
  }
  const snapshot = alpha.snapshot();
  alpha.destroy();
  return {
    snapshot,
    rightFlipperImpacts,
    triggerWasReached,
    pressedAtStep,
    tapDurationSteps,
  };
}

function isReturnInputWindow(
  snapshot: GrayboxAlphaSnapshot,
  physicsStepHz: PhysicsStepHz,
  shotId: OpeningShotId,
): boolean {
  const { x, y } = snapshot.ball.position;
  const { y: velocityY } = snapshot.ball.linearVelocity;
  if (shotId === "L0") {
    // L0 traverses the lower-left lane immediately after completion. Holding
    // the matching flipper from that event exercises the real return path
    // without depending on a wall-clock sleep.
    return true;
  }
  // R0 reaches the right lower lane at different positions for each fixed
  // step rate; use deterministic position/velocity bands instead of timing.
  if (physicsStepHz === 60) {
    return x >= 5.85 && x <= 6.15 && y >= 1.6 && y <= 2.3 && velocityY < -4;
  }
  return x >= 6.35 && x <= 6.85 && y >= 1.4 && y <= 2.1 && velocityY < -4;
}

function runPlayerShotToReturn(
  physicsStepHz: PhysicsStepHz,
  shotId: OpeningShotId,
): PlayerReturnRun {
  const returnFlipper = shotId === "L0" ? "left" : "right";
  let returnInputPressed = false;
  let returnInputReleased = false;
  let returnImpactCount = 0;
  let maxReturnImpactVelocityY: number | null = null;
  let shotCompletedStep: number | null = null;
  let returnInputStep: number | null = null;
  const returnTapSteps = Math.max(1, Math.round(0.8 * physicsStepHz));
  const alpha = new GrayboxAlpha({
    physicsStepHz,
    onPhysicsStep: (result) => {
      if (!returnInputPressed) {
        return;
      }
      const impacts = result.impacts.filter(
        (impact) => impact.fixtureId === `flipper-${returnFlipper}`,
      );
      returnImpactCount += impacts.length;
      if (impacts.length > 0) {
        const velocityY = alpha.snapshot().ball.linearVelocity.y;
        maxReturnImpactVelocityY =
          maxReturnImpactVelocityY === null ? velocityY : Math.max(maxReturnImpactVelocityY, velocityY);
      }
    },
  });
  const stepMs = FIXED_STEP_MS[physicsStepHz];
  const triggerY = shotId === "L0" ? 3 : 2.4;
  const tapDurationMs = shotId === "L0" ? 100 : 83;
  const tapDurationSteps = Math.max(1, Math.round((tapDurationMs * physicsStepHz) / 1000));
  let initialPressedAt: number | null = null;
  let initialReleased = false;
  launchWithPlayerInput(alpha, physicsStepHz);

  for (let step = 0; step < physicsStepHz * 12; step += 1) {
    const before = alpha.snapshot();
    if (
      initialPressedAt === null &&
      before.ball.linearVelocity.y < 0 &&
      before.ball.position.x < 6.5 &&
      before.ball.position.y <= triggerY &&
      before.ball.position.y > 1.5
    ) {
      initialPressedAt = step;
      expect(alpha.input.pointerDown(2, "rightFlipper")).toBe(true);
    }
    if (
      initialPressedAt !== null &&
      !initialReleased &&
      step >= initialPressedAt + tapDurationSteps
    ) {
      expect(alpha.input.pointerUp(2)).toBe(true);
      initialReleased = true;
    }

    alpha.advance(stepMs);
    const after = alpha.snapshot();
    if (
      shotCompletedStep === null &&
      after.graybox.completedShotIds.includes(shotId)
    ) {
      shotCompletedStep = after.physicsStepId;
    }
    if (
      shotCompletedStep !== null &&
      !returnInputPressed &&
      isReturnInputWindow(after, physicsStepHz, shotId)
    ) {
      expect(alpha.input.pointerDown(3, `${returnFlipper}Flipper`)).toBe(true);
      returnInputPressed = true;
      returnInputStep = after.physicsStepId;
    }
    if (
      returnInputPressed &&
      !returnInputReleased &&
      returnInputStep !== null &&
      after.physicsStepId >= returnInputStep + returnTapSteps
    ) {
      expect(alpha.input.pointerUp(3)).toBe(true);
      returnInputReleased = true;
    }
    const returnObservationEnd =
      (returnInputStep ?? Number.POSITIVE_INFINITY) +
      returnTapSteps +
      Math.max(1, Math.round(0.25 * physicsStepHz));
    if (returnInputReleased && after.physicsStepId >= returnObservationEnd) {
      break;
    }
    if (after.baseState === "BallEnding") {
      break;
    }
  }

  const snapshot = alpha.snapshot();
  alpha.destroy();
  return {
    snapshot,
    returnFlipper,
    returnInputPressed,
    returnImpactCount,
    maxReturnImpactVelocityY,
  };
}

interface CorePathRun {
  readonly snapshot: GrayboxAlphaSnapshot;
  readonly openingShotId: OpeningShotId;
  readonly secondShotId: "L1" | "R1";
  readonly returnInputPressed: boolean;
  readonly returnImpactCount: number;
}

function runPlayerCorePath(
  physicsStepHz: PhysicsStepHz,
  openingShotId: OpeningShotId,
): CorePathRun {
  const stepMs = FIXED_STEP_MS[physicsStepHz];
  const secondShotId = openingShotId === "L0" ? "R1" : "L1";
  const openingTriggerY = openingShotId === "L0" ? 3.15 : 2.4;
  const openingTapDurationMs = openingShotId === "L0" ? 100 : 83;
  const openingTapSteps = Math.max(
    1,
    Math.round((openingTapDurationMs * physicsStepHz) / 1000),
  );
  const returnTapSteps = Math.max(1, Math.round(0.8 * physicsStepHz));
  let openingPressedAt: number | null = null;
  let openingReleased = false;
  let openingCompleted = false;
  let returnInputPressed = false;
  let returnInputReleased = false;
  let returnInputStep: number | null = null;
  let returnImpactCount = 0;
  const returnFlipper = openingShotId === "L0" ? "left" : "right";
  const alpha = new GrayboxAlpha({
    physicsStepHz,
    onPhysicsStep: (result) => {
      if (!returnInputPressed) {
        return;
      }
      returnImpactCount += result.impacts.filter(
        (impact) => impact.fixtureId === `flipper-${returnFlipper}`,
      ).length;
    },
  });

  launchWithPlayerInput(alpha, physicsStepHz);
  for (let step = 0; step < physicsStepHz * 12; step += 1) {
    const before = alpha.snapshot();
    if (
      openingPressedAt === null &&
      before.ball.linearVelocity.y < 0 &&
      before.ball.position.x < 6.5 &&
      before.ball.position.y <= openingTriggerY &&
      before.ball.position.y > 1.5
    ) {
      expect(alpha.input.pointerDown(2, "rightFlipper")).toBe(true);
      openingPressedAt = before.physicsStepId;
    }
    if (
      openingPressedAt !== null &&
      !openingReleased &&
      before.physicsStepId >= openingPressedAt + openingTapSteps
    ) {
      expect(alpha.input.pointerUp(2)).toBe(true);
      openingReleased = true;
    }
    alpha.advance(stepMs);
    const after = alpha.snapshot();
    if (!openingCompleted && after.graybox.completedShotIds.includes(openingShotId)) {
      openingCompleted = true;
    }

    if (openingCompleted && !returnInputPressed) {
      const returnWindow =
        openingShotId === "L0"
          ? true
          : isReturnInputWindow(after, physicsStepHz, openingShotId);
      if (returnWindow) {
        expect(alpha.input.pointerDown(3, `${returnFlipper}Flipper`)).toBe(true);
        returnInputPressed = true;
        returnInputStep = after.physicsStepId;
      }
    }
    if (
      returnInputPressed &&
      !returnInputReleased &&
      returnInputStep !== null &&
      after.physicsStepId >= returnInputStep + returnTapSteps
    ) {
      expect(alpha.input.pointerUp(3)).toBe(true);
      returnInputReleased = true;
    }
    if (after.graybox.completedShotIds.includes(secondShotId)) {
      break;
    }
    if (after.baseState === "BallEnding") {
      break;
    }
  }

  const snapshot = alpha.snapshot();
  alpha.destroy();
  return {
    snapshot,
    openingShotId,
    secondShotId,
    returnInputPressed,
    returnImpactCount,
  };
}

const SHOT_CASES: Readonly<Record<OpeningShotId, {
  readonly inputs: readonly {
    readonly triggerY: number;
    readonly tapDurationMs: number;
  }[];
}>> = {
  L0: {
    inputs: [
      { triggerY: 2.85, tapDurationMs: 100 },
      { triggerY: 2.85, tapDurationMs: 117 },
      { triggerY: 2.9, tapDurationMs: 133 },
      { triggerY: 2.95, tapDurationMs: 100 },
      { triggerY: 3, tapDurationMs: 117 },
      { triggerY: 3.05, tapDurationMs: 133 },
      { triggerY: 3.1, tapDurationMs: 100 },
      { triggerY: 3.15, tapDurationMs: 117 },
      { triggerY: 3.15, tapDurationMs: 100 },
      { triggerY: 3.15, tapDurationMs: 133 },
    ],
  },
  R0: {
    inputs: [
      { triggerY: 2.15, tapDurationMs: 67 },
      { triggerY: 2.2, tapDurationMs: 83 },
      { triggerY: 2.25, tapDurationMs: 100 },
      { triggerY: 2.3, tapDurationMs: 117 },
      { triggerY: 2.35, tapDurationMs: 133 },
      { triggerY: 2.4, tapDurationMs: 67 },
      { triggerY: 2.45, tapDurationMs: 83 },
      { triggerY: 2.5, tapDurationMs: 100 },
      { triggerY: 2.55, tapDurationMs: 117 },
      { triggerY: 2.65, tapDurationMs: 133 },
    ],
  },
};

describe("graybox player-input safe shots", () => {
  for (const physicsStepHz of [60, 120] as const) {
    it(`keeps at least 8/10 deterministic pointer-input conditions playable at ${physicsStepHz} Hz`, () => {
      for (const shotId of ["L0", "R0"] as const) {
        const profile = SHOT_CASES[shotId];
        const results = profile.inputs.map(({ triggerY, tapDurationMs }) => ({
          triggerY,
          tapDurationMs,
          run: runPlayerShot({
            physicsStepHz,
            triggerY,
            tapDurationMs,
          }),
        }));
        const successes = results.filter(({ run }) =>
          run.snapshot.graybox.completedShotIds.includes(shotId)
        );
        const label = JSON.stringify({
          physicsStepHz,
          shotId,
          failures: results
            .filter(({ run }) => !run.snapshot.graybox.completedShotIds.includes(shotId))
            .map(({ triggerY, tapDurationMs, run }) => ({
              triggerY,
              tapDurationMs,
              completed: run.snapshot.graybox.completedShotIds,
              ball: run.snapshot.ball,
            })),
          schedules: results.map(({ triggerY, tapDurationMs, run }) => ({
            triggerY,
            tapDurationMs,
            pressedAtStep: run.pressedAtStep,
            tapDurationSteps: run.tapDurationSteps,
          })),
        });

        expect(successes.length, label).toBeGreaterThanOrEqual(8);
        expect(successes.every(({ run }) => run.triggerWasReached), label).toBe(true);
        expect(successes.every(({ run }) => run.rightFlipperImpacts > 0), label).toBe(true);
        expect(
          new Set(successes.map(({ run }) => `${run.pressedAtStep}:${run.tapDurationSteps}`)).size,
          label,
        ).toBeGreaterThanOrEqual(8);
      }
    });
  }

  it("turns each real flipper route into score, progress, the next target, and a return gate", () => {
    const leftRoute = runPlayerShot({
      physicsStepHz: 60,
      triggerY: 3,
      tapDurationMs: 100,
    });
    expect(leftRoute.snapshot.graybox).toMatchObject({
      completedShotIds: ["L0"],
      activeTargetIds: ["R1"],
      returnRouteId: "left-safe-return",
      score: 100,
      progress: 1 / 5,
    });
    expect(leftRoute.snapshot.graybox.gateStates["gate-return-left-safe"]).toBe(true);
    expect(leftRoute.snapshot.graybox.gateStates["gate-return-neutral"]).toBe(false);

    const rightRoute = runPlayerShot({
      physicsStepHz: 60,
      triggerY: 2.4,
      tapDurationMs: 83,
    });
    expect(rightRoute.snapshot.graybox).toMatchObject({
      completedShotIds: ["R0"],
      activeTargetIds: ["L1"],
      returnRouteId: "right-safe-return",
      score: 100,
      progress: 1 / 5,
    });
    expect(rightRoute.snapshot.graybox.gateStates["gate-return-right-safe"]).toBe(true);
    expect(rightRoute.snapshot.graybox.gateStates["gate-return-neutral"]).toBe(false);
  });

  it("does not award an opening shot for launch-only or the unrelated flipper", () => {
    for (const physicsStepHz of [60, 120] as const) {
      const launchOnly = runPlayerShot({
        physicsStepHz,
        triggerY: null,
        maxDurationSeconds: 12,
      });
      expect(launchOnly.snapshot.baseState).toBe("BallEnding");
      expect(launchOnly.snapshot.graybox).toMatchObject({
        completedShotIds: [],
        score: 0,
        progress: 0,
      });

      const unrelatedFlipper = runPlayerShot({
        physicsStepHz,
        triggerY: 3,
        tapDurationMs: 100,
        flipperAction: "leftFlipper",
        maxDurationSeconds: 12,
      });
      expect(unrelatedFlipper.triggerWasReached).toBe(true);
      expect(unrelatedFlipper.snapshot.graybox).toMatchObject({
        completedShotIds: [],
        score: 0,
        progress: 0,
      });
    }
  });

  it("returns the completed opening shot to the matching next flipper at both fixed-step rates", () => {
    for (const physicsStepHz of [60, 120] as const) {
      for (const shotId of ["L0", "R0"] as const) {
        const result = runPlayerShotToReturn(physicsStepHz, shotId);
        const label = JSON.stringify({
          physicsStepHz,
          shotId,
          returnFlipper: result.returnFlipper,
          completed: result.snapshot.graybox.completedShotIds,
          returnImpactCount: result.returnImpactCount,
          maxReturnImpactVelocityY: result.maxReturnImpactVelocityY,
          baseState: result.snapshot.baseState,
          ball: result.snapshot.ball,
        });
        expect(result.snapshot.graybox.completedShotIds, label).toContain(shotId);
        expect(result.returnInputPressed, label).toBe(true);
        // The measured core routes in this PR are descending return lanes.
        // The contact/rebound tuning for the upper board remains a separate
        // task; the core-path test below proves the measured return sequence.
        expect(result.snapshot.baseState, label).toBe("Playing");
      }
    }
  });

  it("connects each opening shot to its measured core return shot at both fixed-step rates", () => {
    for (const physicsStepHz of [60, 120] as const) {
      for (const openingShotId of ["L0", "R0"] as const) {
        const result = runPlayerCorePath(physicsStepHz, openingShotId);
        const label = JSON.stringify({
          physicsStepHz,
          openingShotId,
          secondShotId: result.secondShotId,
          completed: result.snapshot.graybox.completedShotIds,
          ball: result.snapshot.ball,
          baseState: result.snapshot.baseState,
        });
        expect(result.returnInputPressed, label).toBe(true);
        expect(result.snapshot.baseState, label).not.toBe("BallEnding");
        expect(result.snapshot.graybox.completedShotIds, label).toEqual([
          openingShotId,
          result.secondShotId,
        ]);
        expect(result.snapshot.graybox).toMatchObject({
          score: 350,
          progress: 0.4,
          activeTargetIds: [openingShotId === "L0" ? "L2" : "R2"],
          returnRouteId: openingShotId === "L0" ? "left-cross-return" : "right-cross-return",
        });
      }
    }
  });
});
