import { describe, expect, it } from "vitest";
import { GrayboxAlpha } from "../../src/graybox";

describe("GrayboxAlpha physics-to-progress integration", () => {
  it("turns one real sensor route into a new target and return gate", () => {
    const alpha = new GrayboxAlpha({ physicsStepHz: 60 });
    alpha.world.launch("low");
    alpha.advance(1000 / 60);

    for (const sensorId of ["L0-entry", "L0-checkpoint", "L0-exit"]) {
      const sensor = alpha.world.table.sensors.find((candidate) => candidate.id === sensorId);
      if (sensor === undefined) {
        throw new Error(`missing sensor ${sensorId}`);
      }
      alpha.world.ballBody.setTransform({ x: sensor.position.x, y: sensor.position.y - 0.35 }, 0);
      alpha.world.ballBody.setLinearVelocity({ x: 0, y: 6 });
      alpha.advance(1000 / 60);
      alpha.advance(1000 / 60);
    }
    alpha.advance(1000 / 60);

    const snapshot = alpha.snapshot();
    expect(snapshot.graybox).toMatchObject({
      activeTargetIds: ["R1"],
      returnRouteId: "right-safe-return",
      score: 100,
      progress: 1 / 5,
    });
    expect(snapshot.graybox.gateStates["gate-return-right-safe"]).toBe(true);
    expect(snapshot.graybox.gateStates["gate-return-neutral"]).toBe(false);
    alpha.destroy();
  });

  it("keeps the G1-B high-launch route inside the main board", () => {
    for (const physicsStepHz of [60, 120] as const) {
      const alpha = new GrayboxAlpha({ physicsStepHz });
      alpha.world.launch("high");
      for (let step = 0; step < Math.round(physicsStepHz * 1.1); step += 1) {
        alpha.advance(1000 / physicsStepHz);
      }
      const label = JSON.stringify({ physicsStepHz });
      expect(alpha.snapshot().ball.position.x, label).toBeLessThan(6.64);
      expect(alpha.snapshot().suspensionState, label).toBe("None");
      alpha.destroy();
    }
  });
});
