import { describe, expect, it } from "vitest";
import { PinballWorld } from "../../src/physics";
import {
  formatGrayboxReturnRouteLabel,
  formatGrayboxTargetLabel,
  GrayboxRuntime,
} from "../../src/graybox";
import { createGrayboxTableDefinition, validateTableDefinition } from "../../src/table";
import type { PinballStepResult } from "../../src/physics";

function shotCompleted(shotId: string, physicsStepId: number): PinballStepResult {
  return {
    physicsStepId,
    dtSeconds: 1 / 60,
    suspended: false,
    contacts: {
      physicsStepId,
      sensorTransitions: [],
      impacts: [],
      occupancies: [],
      overflowed: false,
    },
    impacts: [],
    sensorTransitions: [],
    gameEvents: [{
      gameEventId: physicsStepId,
      physicsStepId,
      type: "ShotCompleted",
      ballId: "ball-1",
      shotId,
    }],
    scoringEvents: [],
    executedCommands: [],
    safeStateUpdated: false,
    drained: false,
    recovered: false,
  };
}

describe("G2 graybox table", () => {
  it("contains the eight-shot map and route gates without invalid geometry", () => {
    const table = createGrayboxTableDefinition();

    expect(validateTableDefinition(table)).toEqual([]);
    expect(table.shots.map((shot) => shot.id)).toEqual(["L0", "R0", "L1", "R1", "L2", "R2", "C0", "C1"]);
    expect(table.fixtures.map((fixture) => fixture.id)).toEqual(
      expect.arrayContaining([
        "gate-return-neutral",
        "gate-return-left-safe",
        "gate-return-right-safe",
        "gate-return-central",
        "gate-return-climax",
      ]),
    );
  });

  it("preserves the G1-B high-launch route on the graybox table", () => {
    for (const physicsStepHz of [60, 120] as const) {
      const world = new PinballWorld({
        physicsStepHz,
        table: createGrayboxTableDefinition(),
      });
      world.launch("high");
      let guideImpact = false;
      let mainBoardExit = false;

      for (let step = 0; step < 180; step += 1) {
        const result = world.step();
        guideImpact ||= result.impacts.some((impact) => impact.fixtureId === "launch-guide");
        const position = world.getSnapshot().ball.position;
        if (guideImpact && position.x <= 6.94 - 2 * 0.15) {
          mainBoardExit = true;
          break;
        }
      }

      const label = JSON.stringify({ physicsStepHz });
      expect(guideImpact, label).toBe(true);
      expect(mainBoardExit, label).toBe(true);
      world.destroy();
    }
  });
});

describe("GrayboxRuntime", () => {
  it("provides player-facing labels for internal target and route ids", () => {
    expect(formatGrayboxTargetLabel("L0")).toBe("左の安全ショット");
    expect(formatGrayboxTargetLabel("C1")).toBe("中央のクライマックス入口");
    expect(formatGrayboxReturnRouteLabel("neutral-return")).toBe("中央の基本戻り");
    expect(formatGrayboxReturnRouteLabel("climax-return")).toBe("中枢からの安全戻り");
  });

  it("changes both the next target and the physical return gate after a valid shot", () => {
    const world = new PinballWorld({ table: createGrayboxTableDefinition() });
    const runtime = new GrayboxRuntime();
    runtime.initialize(world);
    world.step();

    expect(runtime.snapshot(world)).toMatchObject({
      activeTargetIds: ["L0", "R0"],
      returnRouteId: "neutral-return",
      score: 0,
    });
    expect(world.tableRuntime.gateStates.get("gate-return-neutral")).toBe(true);

    runtime.consume(shotCompleted("L0", world.physicsStepId), world);
    expect(runtime.snapshot(world)).toMatchObject({
      activeTargetIds: ["R1"],
      returnRouteId: "right-safe-return",
      score: 100,
      progress: 1 / 5,
    });

    world.step();
    expect(world.tableRuntime.gateStates.get("gate-return-neutral")).toBe(false);
    expect(world.tableRuntime.gateStates.get("gate-return-right-safe")).toBe(true);
    world.destroy();
  });

  it("rejects a completed shot that is not the current target", () => {
    const world = new PinballWorld({ table: createGrayboxTableDefinition() });
    const runtime = new GrayboxRuntime();
    runtime.initialize(world);
    world.step();

    runtime.consume(shotCompleted("R1", world.physicsStepId), world);
    expect(runtime.snapshot(world)).toMatchObject({
      activeTargetIds: ["L0", "R0"],
      returnRouteId: "neutral-return",
      score: 0,
      progress: 0,
    });
    expect(runtime.snapshot(world).lastEventLabel).toBe("右の中核ショットは今の目標ではない");
    expect(runtime.snapshot(world).lastEventLabel).not.toContain("R1");
    world.destroy();
  });

  it("alternates the side before reaching the central climax", () => {
    const world = new PinballWorld({ table: createGrayboxTableDefinition() });
    const runtime = new GrayboxRuntime();
    runtime.initialize(world);
    world.step();

    for (const shotId of ["L0", "R1", "L2", "C0", "C1"]) {
      runtime.consume(shotCompleted(shotId, world.physicsStepId), world);
      world.step();
    }

    expect(runtime.snapshot(world)).toMatchObject({
      activeTargetIds: [],
      completedShotIds: ["L0", "R1", "L2", "C0", "C1"],
      score: 2_600,
      progress: 1,
      climaxState: "active",
      returnRouteId: "climax-return",
    });
    world.destroy();
  });
});
