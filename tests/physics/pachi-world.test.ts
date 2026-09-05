import { describe, expect, it } from "vitest";
import { PachiWorld } from "../../src/physics/pachi-world";

describe("PachiWorld", () => {
  it("uses a real bullet ball, nails, pockets, and one capture event per ball", () => {
    const world = new PachiWorld({ random: () => 0.5, maxBalls: 4 });
    const first = world.launch(1);
    const second = world.launch(0.2);
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(world.snapshot().geometry.nails.length).toBeGreaterThan(20);
    expect(world.snapshot().geometry.screen).toEqual({ x: 187, y: 171, width: 346, height: 216 });
    expect(world.snapshot().balls.every((ball) => ball.bullet)).toBe(true);

    for (let step = 0; step < 120 * 8; step += 1) world.stepFixed();
    const events = world.drainEvents();
    const captured = events.filter((event) => event.type === "pocket" || event.type === "reclaimed");
    expect(new Set(captured.map((event) => event.ballId)).size).toBe(captured.length);
    expect(world.ballCount).toBeLessThanOrEqual(4);
    expect(world.snapshot().balls.every((ball) => ball.age <= 8)).toBe(true);
  });

  it("keeps the fixed-step result stable when a frame is split", () => {
    const whole = new PachiWorld({ random: () => 0.37 });
    const split = new PachiWorld({ random: () => 0.37 });
    whole.launch(0.72);
    split.launch(0.72);
    for (let frame = 0; frame < 120; frame += 1) whole.step(1 / 60);
    for (let frame = 0; frame < 240; frame += 1) split.step(1 / 120);

    const wholeBall = whole.snapshot().balls[0];
    const splitBall = split.snapshot().balls[0];
    expect(whole.snapshot().physicsStep).toBe(split.snapshot().physicsStep);
    if (wholeBall && splitBall) {
      expect(wholeBall.x).toBeCloseTo(splitBall.x, 8);
      expect(wholeBall.y).toBeCloseTo(splitBall.y, 8);
      expect(wholeBall.vx).toBeCloseTo(splitBall.vx, 8);
      expect(wholeBall.vy).toBeCloseTo(splitBall.vy, 8);
    }
  });

  it("bounds simultaneous balls and closes the attacker gate", () => {
    const world = new PachiWorld({ random: () => 0.5, maxBalls: 3 });
    expect(world.launch(0.2)).toBeTruthy();
    expect(world.launch(0.4)).toBeTruthy();
    expect(world.launch(0.8)).toBeTruthy();
    expect(world.launch(1)).toBeNull();
    world.setAttackerOpen(true);
    expect(world.snapshot().attackerOpen).toBe(true);
    world.setAttackerOpen(false);
    expect(world.snapshot().attackerOpen).toBe(false);
  });
});
