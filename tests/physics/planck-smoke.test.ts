import { describe, expect, it } from "vitest";
import * as planck from "planck";

describe("planck smoke", () => {
  it("can create a world and step it", () => {
    const world = new planck.World({ gravity: planck.Vec2(0, -10) });
    const body = world.createDynamicBody({ position: planck.Vec2(0, 4) });
    body.createFixture(planck.Box(0.5, 0.5), { density: 1 });
    world.step(1 / 60, 8, 3);
    expect(body.getPosition().y).toBeLessThan(4);
  });
});
