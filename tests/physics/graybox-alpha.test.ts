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
});
