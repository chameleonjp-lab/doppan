import { describe, expect, it } from "vitest";
import { GrayboxAlpha } from "../../src/graybox";

describe("GrayboxAlpha physics-to-progress integration", () => {
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
