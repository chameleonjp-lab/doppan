import { describe, expect, it } from "vitest";
import { PhysicsCommandSafetyError, PinballWorld } from "../../src/physics";

describe("G1-B physics command execution integrity", () => {
  it("rejects a circle that overlaps only the corner of a fixture", () => {
    const world = new PinballWorld({ gravityY: 0 });
    // The lane-divider top-left corner is (6.94, 4.5). None of the old
    // center/cardinal samples entered the box at this diagonal position, but
    // the actual radius-0.15 circle overlaps it.
    world.enqueueCommand({
      type: "teleportBall",
      targetId: "ball-1",
      payload: { position: { x: 6.85, y: 4.59 }, velocity: { x: 0, y: 0 } },
    });

    expect(() => world.step()).toThrow(PhysicsCommandSafetyError);
    expect(world.diagnostics()).toMatchObject({ safeStopped: true, runIntegrity: "invalid" });
    world.destroy();
  });

  it("keeps an opened or closed gate's physics, runtime, and snapshot aligned", () => {
    const world = new PinballWorld({ gravityY: 0 });
    expect(world.getSnapshot().staticGeometry.some((fixture) => fixture.id === "lane-divider")).toBe(true);

    world.enqueueCommand({ type: "openGate", targetId: "lane-divider" });
    world.step();
    expect(world.tableRuntime.gateStates.get("lane-divider")).toBe(true);
    expect(world.getSnapshot().staticGeometry.some((fixture) => fixture.id === "lane-divider")).toBe(false);

    world.enqueueCommand({ type: "closeGate", targetId: "lane-divider" });
    world.step();
    expect(world.tableRuntime.gateStates.get("lane-divider")).toBe(false);
    expect(world.getSnapshot().staticGeometry.some((fixture) => fixture.id === "lane-divider")).toBe(true);

    world.enqueueCommand({ type: "disableFixture", targetId: "flipper-left" });
    world.step();
    expect(world.getSnapshot().flippers.some((flipper) => flipper.side === "left")).toBe(false);
    world.enqueueCommand({ type: "enableFixture", targetId: "flipper-left" });
    world.step();
    expect(world.getSnapshot().flippers.some((flipper) => flipper.side === "left")).toBe(true);
    world.destroy();
  });

  it("clears a previous ball's safe recovery state at drain", () => {
    const world = new PinballWorld({ gravityY: 0 });
    world.ballBody.setTransform({ x: 4.5, y: 4 }, 0);
    world.ballBody.setLinearVelocity({ x: 0, y: 0 });
    for (let step = 0; step < 3; step += 1) {
      world.step();
    }
    expect(world.lastSafeBallState).not.toBeNull();

    world.ballBody.setTransform({ x: 4.5, y: 0.1 }, 0);
    world.ballBody.setLinearVelocity({ x: 0, y: -4 });
    const drained = world.step();

    expect(drained.drained).toBe(true);
    expect(world.lastSafeBallState).toBeNull();
    expect(world.getSnapshot().pendingTerminalEvents).toHaveLength(1);
    world.destroy();
  });

  it("removes a destroyed table body from physics, runtime state, and presentation", () => {
    const world = new PinballWorld({ gravityY: 0 });
    const baseline = world.diagnostics();
    expect(world.getSnapshot().staticGeometry.some((fixture) => fixture.id === "lane-divider")).toBe(true);
    expect(world.tableRuntime.gateStates.has("lane-divider")).toBe(true);

    world.enqueueCommand({ type: "destroyBody", targetId: "body-lane-divider" });
    const result = world.step();

    expect(result.executedCommands.map((command) => command.type)).toContain("destroyBody");
    expect(world.diagnostics()).toMatchObject({
      bodyCount: baseline.bodyCount - 1,
      fixtureCount: baseline.fixtureCount - 1,
      jointCount: baseline.jointCount,
    });
    expect(world.getSnapshot().staticGeometry.some((fixture) => fixture.id === "lane-divider")).toBe(false);
    expect(world.tableRuntime.gateStates.has("lane-divider")).toBe(false);

    world.enqueueCommand({ type: "enableFixture", targetId: "lane-divider" });
    expect(() => world.step()).toThrow(PhysicsCommandSafetyError);
    expect(world.diagnostics()).toMatchObject({ safeStopped: true, runIntegrity: "invalid" });
    world.destroy();
  });

  it("removes an owned flipper fixture and joint with its body", () => {
    const world = new PinballWorld({ gravityY: 0 });
    const baseline = world.diagnostics();
    expect(world.getSnapshot().flippers.some((flipper) => flipper.side === "left")).toBe(true);

    world.enqueueCommand({ type: "destroyBody", targetId: "body-flipper-left" });
    world.step();

    expect(world.diagnostics()).toMatchObject({
      bodyCount: baseline.bodyCount - 1,
      fixtureCount: baseline.fixtureCount - 1,
      jointCount: baseline.jointCount - 1,
    });
    expect(world.getSnapshot().flippers.some((flipper) => flipper.side === "left")).toBe(false);
    expect(() => world.getFlipperJointAngle("left")).toThrow("unknown flipper left");
    world.destroy();
  });

  it("disables routes and shots when one of their sensor bodies is destroyed", () => {
    const world = new PinballWorld({ gravityY: 0 });
    const baseline = world.diagnostics();
    expect(world.tableRuntime.enabledShots.has("safe-shot")).toBe(true);
    expect(world.tableRuntime.connectedRoutes.has("safe-shot-route")).toBe(true);

    world.enqueueCommand({ type: "destroyBody", targetId: "body-sensor-safe-shot-entry" });
    world.step();

    expect(world.diagnostics()).toMatchObject({
      bodyCount: baseline.bodyCount - 1,
      fixtureCount: baseline.fixtureCount - 1,
      jointCount: baseline.jointCount,
    });
    expect(world.getSnapshot().sensors.some((sensor) => sensor.id === "safe-shot-entry")).toBe(false);
    expect(world.tableRuntime.enabledShots.has("safe-shot")).toBe(false);
    expect(world.tableRuntime.connectedRoutes.has("safe-shot-route")).toBe(false);
    world.destroy();
  });
});
