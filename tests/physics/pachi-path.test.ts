import { describe, expect, it } from "vitest";
import { PachiWorld } from "../../src/physics/pachi-world";

describe("PachiWorld launch path", () => {
  it("keeps the launch in the right lane, reaches the upper release, and captures on descent", () => {
    const world = new PachiWorld({ random: () => 0.8, maxBalls: 1 });
    const ballId = world.launch(0.8);
    expect(ballId).toBeTruthy();
    if (ballId === null) return;

    const geometry = world.snapshot().geometry;
    const upperReleaseY = geometry.screen.y - 20;
    const laneCenter = geometry.launchGuide.x + geometry.launchGuide.width / 2;
    const laneMinX = laneCenter - geometry.ballRadius - 2;
    const laneMaxX = geometry.launchGuide.x + geometry.launchGuide.width + geometry.ballRadius + 2;
    let sawAboveStart = false;
    let sawUpperRelease = false;
    let ascendingLaneSamples = 0;
    let captureBefore: ReturnType<typeof world.snapshot>["balls"][number] | undefined;
    let pocket: Extract<ReturnType<typeof world.drainEvents>[number], { type: "pocket" }> | undefined;

    world.drainEvents();
    for (let step = 0; step < 120 * 8; step += 1) {
      const before = world.snapshot();
      const ball = before.balls.find((candidate) => candidate.id === ballId);
      if (ball === undefined) break;

      if (ball.y < geometry.start.y) sawAboveStart = true;
      if (ball.y <= upperReleaseY) sawUpperRelease = true;
      if (!sawUpperRelease && ball.vy < 0) {
        ascendingLaneSamples += 1;
        expect(ball.x).toBeGreaterThanOrEqual(laneMinX);
        expect(ball.x).toBeLessThanOrEqual(laneMaxX);
      }

      world.stepFixed();
      const events = world.drainEvents();
      const captured = events.find(
        (event): event is Extract<typeof event, { type: "pocket" }> =>
          event.type === "pocket" && event.ballId === ballId,
      );
      if (captured !== undefined) {
        captureBefore = ball;
        pocket = captured;
        break;
      }
    }

    expect(ascendingLaneSamples).toBeGreaterThan(10);
    expect(sawUpperRelease).toBe(true);
    expect(sawAboveStart).toBe(true);
    expect(pocket).toBeDefined();
    expect(captureBefore).toBeDefined();
    expect(captureBefore?.vy).toBeGreaterThan(0);
    expect(["start", "side", "attacker"]).toContain(pocket?.role);
    expect(world.ballCount).toBe(0);
  });
});
