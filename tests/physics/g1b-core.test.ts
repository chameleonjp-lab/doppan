import { describe, expect, it } from "vitest";
import * as planck from "planck";
import {
  BALL_ID,
  BALL_RADIUS,
  PinballWorld,
  PhysicsCommandOverflowError,
  PhysicsCommandQueue,
  createPinballPrototype,
  resolveLaunchStrength,
} from "../../src/physics/index";
import { createG1BTableDefinition, PhysicsViewport as TableViewport, validateTableDefinition } from "../../src/table/index";
import { ShotStateMachine as DirectShotStateMachine } from "../../src/shots/shot-state-machine";
import type { SensorTransitionEvent } from "../../src/physics/contact-buffer";

describe("G1-B table and viewport", () => {
  it("defines a valid 9-unit bottom-left-origin table", () => {
    const table = createG1BTableDefinition();
    expect(table.bounds).toEqual({ width: 9, height: 16 });
    expect(validateTableDefinition(table)).toEqual([]);
    expect(table.sensors.map((sensor) => sensor.id)).toEqual(
      expect.arrayContaining(["drain", "launch-low", "launch-medium", "launch-high", "safe-shot-entry"]),
    );
  });

  it("round-trips world and screen coordinates without changing physics", () => {
    const viewport = new TableViewport({ width: 9, height: 16 }, { width: 390, height: 844 });
    for (const point of [{ x: 0, y: 0 }, { x: 4.5, y: 8 }, { x: 9, y: 16 }]) {
      const screen = viewport.worldToScreen(point);
      const world = viewport.screenToWorld(screen);
      expect(world.x).toBeCloseTo(point.x, 10);
      expect(world.y).toBeCloseTo(point.y, 10);
    }
    expect(viewport.containsScreenPoint({ x: 0, y: 0 })).toBe(false);
    expect(viewport.tryScreenToWorld({ x: 0, y: 0 })).toBeNull();
    expect(viewport.worldAngleToScreen(Math.PI / 2)).toBeCloseTo(-Math.PI / 2);
  });

  it("provides deterministic three-band launch profiles", () => {
    expect(resolveLaunchStrength(0)).toMatchObject({ band: "low", speed: 8 });
    expect(resolveLaunchStrength(0.5)).toMatchObject({ band: "medium", speed: 12 });
    expect(resolveLaunchStrength(1)).toMatchObject({ band: "high", speed: 16 });
    expect(resolveLaunchStrength("high")).toEqual(resolveLaunchStrength(1));
  });
});

describe("G1-B command queue", () => {
  it("normalizes latest gate/filter commands and prioritizes destroy", () => {
    const queue = new PhysicsCommandQueue();
    queue.enqueue({ type: "openGate", targetId: "gate-1", stepId: 1 });
    queue.enqueue({ type: "closeGate", targetId: "gate-1", stepId: 1 });
    queue.enqueue({ type: "enableFixture", targetId: "fixture-1", stepId: 1 });
    queue.enqueue({ type: "disableFixture", targetId: "fixture-1", stepId: 1 });
    queue.enqueue({ type: "teleportBall", targetId: BALL_ID, stepId: 1, payload: { position: { x: 4, y: 4 } } });
    queue.enqueue({ type: "destroyBody", targetId: "body-1", stepId: 1 });
    queue.enqueue({ type: "openGate", targetId: "body-1", stepId: 1 });
    const normalized = queue.drainForStep(1);
    expect(normalized.map((command) => command.type)).toEqual(["closeGate", "disableFixture", "teleportBall", "destroyBody"]);
    expect(queue.size).toBe(0);
  });

  it("fails explicitly at command 257", () => {
    const queue = new PhysicsCommandQueue();
    for (let index = 0; index < 256; index += 1) {
      queue.enqueue({ type: "resetTemporaryRoute", targetId: `route-${index}`, stepId: 1 });
    }
    expect(() => queue.enqueue({ type: "resetTemporaryRoute", targetId: "overflow", stepId: 1 })).toThrow(PhysicsCommandOverflowError);
    expect(queue.isSafeStopped).toBe(true);
  });
});

describe("G1-B Planck prototype", () => {
  it("constructs bullet ball, walls, sensors, and motorized flippers", () => {
    const world = createPinballPrototype();
    expect(world.ballBody.isBullet()).toBe(true);
    expect(world.world.getBodyCount()).toBeGreaterThanOrEqual(17);
    expect(world.world.getJointCount()).toBe(2);
    expect(world.getSnapshot().staticGeometry).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "wall-left" }),
      expect.objectContaining({ id: "lane-divider" }),
    ]));
    expect(world.getSnapshot().sensors).toHaveLength(7);
    world.destroy();
  });

  it("applies a queued deterministic launch at a fixed-step boundary", () => {
    const world = new PinballWorld({ physicsStepHz: 120 });
    const profile = world.launch("medium");
    const result = world.step();
    expect(result.executedCommands.map((command) => command.type)).toContain("launchBall");
    expect(world.ballBody.getLinearVelocity().y).toBeCloseTo(profile.speed, 5);
    expect(world.getSnapshot().baseState).toBe("Playing");
    expect(world.diagnostics().ballSpeed).toBeLessThanOrEqual(world.velocityLimit + 1e-9);
    world.destroy();
  });

  it("copies impact data and does not expose Planck contact references", () => {
    const world = new PinballWorld({ gravityY: 0 });
    world.ballBody.setTransform(planck.Vec2(0.45, 8), 0);
    world.ballBody.setLinearVelocity(planck.Vec2(-18, 0));
    const result = world.step();
    expect(result.contacts.impacts.some((impact) => impact.fixtureId === "wall-left")).toBe(true);
    const copied = result.contacts.impacts[0];
    expect(copied).toBeDefined();
    if (copied !== undefined) {
      expect(copied.position).not.toBe(world.ballBody.getPosition());
      expect(Object.isFrozen(copied)).toBe(false);
      expect(Number.isFinite(copied.normalImpulse)).toBe(true);
    }
    world.destroy();
  });

  it("routes a drain sensor transition into a pending terminal event", () => {
    const world = new PinballWorld({ gravityY: 0 });
    world.ballBody.setTransform(planck.Vec2(4.5, 0.25), 0);
    world.ballBody.setLinearVelocity(planck.Vec2(0, -18));
    const result = world.step();
    expect(result.sensorTransitions.some((event) => event.sensorId === "drain" && event.phase === "entered")).toBe(true);
    expect(result.drained).toBe(true);
    expect(world.baseState).toBe("BallEnding");
    expect(world.pendingTerminalEvents).toHaveLength(1);
    const nextStep = world.step();
    expect(nextStep.suspended).toBe(false);
    expect(nextStep.drained).toBe(false);
    expect(world.pendingTerminalEvents).toHaveLength(0);
    expect(world.baseState).toBe("LaunchReady");
    world.destroy();
  });

  it("retains a drain terminal event while hidden and processes it after visibility resumes", () => {
    const world = new PinballWorld({ gravityY: 0 });
    world.ballBody.setTransform(planck.Vec2(4.5, 0.25), 0);
    world.ballBody.setLinearVelocity(planck.Vec2(0, -18));
    world.step();
    expect(world.pendingTerminalEvents).toHaveLength(1);

    world.setSuspension("VisibilityLost");
    const hidden = world.step();
    expect(hidden.suspended).toBe(true);
    expect(world.pendingTerminalEvents).toHaveLength(1);
    expect(world.baseState).toBe("BallEnding");

    world.setSuspension("None");
    const resumed = world.step();
    expect(resumed.suspended).toBe(false);
    expect(world.pendingTerminalEvents).toHaveLength(0);
    expect(world.baseState).toBe("LaunchReady");
    expect(world.getSnapshot().ball.position).toEqual({ x: 8.05, y: 0.8 });
    world.destroy();
  });

  it("routes every high launch through the angled guide and into the main board", () => {
    for (let repeat = 0; repeat < 10; repeat += 1) {
      const world = new PinballWorld({ physicsStepHz: repeat % 2 === 0 ? 60 : 120 });
      world.launch("high");
      let guideImpact = false;
      let mainBoardExit = false;
      for (let step = 0; step < 180; step += 1) {
        const result = world.step();
        guideImpact ||= result.impacts.some((impact) => impact.fixtureId === "launch-guide");
        const position = world.getSnapshot().ball.position;
        // Divider left edge is 6.94; include BALL_RADIUS clearance when
        // proving the center has actually left the launch lane.
        if (guideImpact && position.x <= 6.94 - 2 * 0.15) {
          mainBoardExit = true;
          break;
        }
      }
      const label = JSON.stringify({ repeat, physicsStepHz: world.physicsStepHz });
      expect(guideImpact, label).toBe(true);
      expect(mainBoardExit, label).toBe(true);
      world.destroy();
    }
  });

  it("repeats low, medium, and high launch bands ten times without randomness", () => {
    const expectedSensor = {
      low: "launch-low",
      medium: "launch-medium",
      high: "launch-high",
    } as const;
    for (const band of ["low", "medium", "high"] as const) {
      for (let repeat = 0; repeat < 10; repeat += 1) {
        const physicsStepHz = repeat % 2 === 0 ? 60 : 120;
        const world = new PinballWorld({ physicsStepHz });
        const profile = world.launch(band);
        let reachedExpectedBand = false;
        for (let step = 0; step < physicsStepHz * 3; step += 1) {
          const result = world.step();
          reachedExpectedBand ||= result.sensorTransitions.some(
            (event) => event.sensorId === expectedSensor[band] && event.phase === "entered",
          );
          if (reachedExpectedBand) {
            break;
          }
        }
        const label = JSON.stringify({ band, repeat, physicsStepHz, profile });
        expect(profile, label).toEqual(resolveLaunchStrength(band));
        expect(reachedExpectedBand, label).toBe(true);
        world.destroy();
      }
    }
  });

  it("connects contact-buffer overflow to a latched FatalRecovery stop", () => {
    const world = new PinballWorld({ gravityY: 0, maxContactEventsPerStep: 1 });
    world.ballBody.setTransform(planck.Vec2(0.4, 0.4), 0);
    world.ballBody.setLinearVelocity(planck.Vec2(-30, -30));
    expect(() => world.step()).toThrow(/Contact buffer exceeded/);
    expect(world.diagnostics()).toMatchObject({ safeStopped: true, runIntegrity: "invalid" });
    expect(world.getSnapshot().baseState).toBe("FatalRecovery");
    expect(() => world.step()).toThrow(/Contact buffer exceeded/);
    world.destroy();
  });

  it("opens and closes the lane-divider gate through the real fixture filter", () => {
    const world = new PinballWorld({ gravityY: 0 });
    expect(world.tableRuntime.gateStates.get("lane-divider")).toBe(false);

    world.enqueueCommand({ type: "openGate", targetId: "lane-divider", stepId: 1 });
    world.step();
    expect(world.tableRuntime.gateStates.get("lane-divider")).toBe(true);
    world.ballBody.setTransform(planck.Vec2(6.7, 3), 0);
    world.ballBody.setLinearVelocity(planck.Vec2(12, 0));
    const openResult = world.step();
    expect(openResult.impacts.some((impact) => impact.fixtureId === "lane-divider")).toBe(false);

    world.enqueueCommand({ type: "closeGate", targetId: "lane-divider", stepId: 3 });
    world.step();
    expect(world.tableRuntime.gateStates.get("lane-divider")).toBe(false);
    world.ballBody.setTransform(planck.Vec2(6.7, 3), 0);
    world.ballBody.setLinearVelocity(planck.Vec2(12, 0));
    const closedResult = world.step();
    expect(closedResult.impacts.some((impact) => impact.fixtureId === "lane-divider")).toBe(true);
    world.destroy();
  });

  it("only promotes a safe ball state after three clean steps and recovers without decrementing a ball", () => {
    const world = new PinballWorld({ gravityY: 0 });
    expect(world.lastSafeBallState).toBeNull();
    world.ballBody.setTransform(planck.Vec2(4.5, 8), 0);
    world.ballBody.setLinearVelocity(planck.Vec2(0, 0));
    world.step();
    world.step();
    expect(world.lastSafeBallState).toBeNull();
    world.step();
    expect(world.lastSafeBallState).not.toBeNull();
    expect(Number.isFinite(world.lastSafeBallState?.angle)).toBe(true);
    expect(Number.isFinite(world.lastSafeBallState?.angularVelocity)).toBe(true);
    world.ballBody.setTransform(planck.Vec2(Number.NaN, Number.NaN), 0);
    const recovered = world.recoverBall();
    expect(recovered).toBe(true);
    expect(Number.isFinite(world.ballBody.getPosition().x)).toBe(true);
    expect(world.baseState).toBe("Playing");
    world.ballBody.setTransform(planck.Vec2(Number.NaN, Number.NaN), 0);
    expect(world.recoverBall()).toBe(false);
    expect(world.lastSafeBallState).toBeNull();
    expect(world.baseState).toBe("LaunchReady");
    expect(world.getSnapshot().ball.position).toEqual({ x: 8.05, y: 0.8 });
    world.destroy();
  });

  it("keeps both motorized joints finite, bounded, and returning over 1,000 cycles", () => {
    const world = new PinballWorld({ gravityY: 0 });
    const baseline = world.diagnostics();
    for (let cycle = 0; cycle < 1_000; cycle += 1) {
      world.setFlipperInput({ left: true, right: true });
      world.step();
      world.setFlipperInput({ left: false, right: false });
      world.step();
      const leftAngle = world.getFlipperJointAngle("left");
      const rightAngle = world.getFlipperJointAngle("right");
      const caseLabel = JSON.stringify({ cycle, fixtureIds: ["flipper-left", "flipper-right"], flipperState: "both" });
      expect(Number.isFinite(leftAngle) && Number.isFinite(rightAngle), caseLabel).toBe(true);
      expect(leftAngle, caseLabel).toBeGreaterThanOrEqual(-0.3001);
      expect(leftAngle, caseLabel).toBeLessThanOrEqual(0.7501);
      expect(rightAngle, caseLabel).toBeGreaterThanOrEqual(-0.7501);
      expect(rightAngle, caseLabel).toBeLessThanOrEqual(0.3001);
    }
    expect(Math.abs(world.getFlipperJointAngle("left"))).toBeLessThan(0.08);
    expect(Math.abs(world.getFlipperJointAngle("right"))).toBeLessThan(0.08);
    expect(world.diagnostics()).toMatchObject({
      bodyCount: baseline.bodyCount,
      fixtureCount: baseline.fixtureCount,
      jointCount: baseline.jointCount,
    });
    world.destroy();
  });

  it("test-only deterministic fixture hold keeps flipper ContactOccupancy for 1.5 seconds (not a normal route)", () => {
    // This deliberately injects an already-contacting ball with gravity
    // disabled. It measures only the bounded contact-buffer occupancy path;
    // it is not evidence that ordinary launch play can produce a catch.
    let successfulTrials = 0;
    for (let trial = 0; trial < 20; trial += 1) {
      const side = trial % 2 === 0 ? "left" : "right";
      const world = new PinballWorld({ physicsStepHz: 60, gravityY: 0 });
      world.setFlipperInput({ left: false, right: false });
      for (let step = 0; step < 20; step += 1) {
        world.step();
      }
      const flipper = world.getSnapshot().flippers.find((candidate) => candidate.side === side);
      expect(flipper).toBeDefined();
      if (flipper === undefined) {
        world.destroy();
        continue;
      }
      const localX = 0.55;
      const localY = flipper.thickness / 2 + BALL_RADIUS - 0.01;
      const cosine = Math.cos(flipper.angle);
      const sine = Math.sin(flipper.angle);
      const position = {
        x: flipper.position.x + localX * cosine - localY * sine,
        y: flipper.position.y + localX * sine + localY * cosine,
      };
      world.ballBody.setTransform(planck.Vec2(position.x, position.y), 0);
      world.ballBody.setLinearVelocity(planck.Vec2(0, 0));

      let activeOccupancySteps = 0;
      let firstActiveStep: number | null = null;
      let lastActiveStep: number | null = null;
      let recoveryObserved = false;
      for (let step = 0; step < 90; step += 1) {
        const result = world.step(1 / 60, { left: false, right: false });
        recoveryObserved ||= result.recovered;
        const active = result.contacts.occupancies.some(
          (occupancy) => occupancy.fixturePair === `ball-1:flipper-${side}` && occupancy.active,
        );
        if (active) {
          activeOccupancySteps += 1;
          firstActiveStep ??= step;
          lastActiveStep = step;
        }
      }
      const heldForOnePointFiveSeconds =
        activeOccupancySteps === 90 && firstActiveStep === 0 && lastActiveStep === 89;
      // No recoverBall call is made in this trial, and the step result must
      // never report an automatic recovery; recovery cannot turn a failed
      // occupancy run into a passing result.
      if (heldForOnePointFiveSeconds && !recoveryObserved) {
        successfulTrials += 1;
      }
      world.destroy();
    }
    expect(successfulTrials).toBeGreaterThanOrEqual(18);
  });

  it("keeps diagnostics and the last snapshot readable after a safety stop", () => {
    const world = new PinballWorld();
    for (let index = 0; index < 256; index += 1) {
      world.enqueueCommand({
        type: "resetTemporaryRoute",
        targetId: `route-${index}`,
        stepId: 2,
      });
    }
    expect(() => world.enqueueCommand({
      type: "resetTemporaryRoute",
      targetId: "overflow",
      stepId: 2,
    })).toThrow(PhysicsCommandOverflowError);
    expect(world.diagnostics()).toMatchObject({
      safeStopped: true,
      runIntegrity: "invalid",
      queuedCommandCount: 256,
    });
    expect(world.getSnapshot().baseState).toBe("FatalRecovery");
    expect(() => world.step()).toThrow(PhysicsCommandOverflowError);
    world.destroy();
  });
});

describe("G1-B shot state machine", () => {
  it("requires direction, checkpoint, and exit and deduplicates scoring", () => {
    const table = createG1BTableDefinition();
    const machine = new DirectShotStateMachine(BALL_ID, table.shots);
    const event = (sensorId: string, eventId: number, direction: { x: number; y: number }): SensorTransitionEvent => ({
      eventId,
      physicsStepId: eventId,
      ballId: BALL_ID,
      sensorId,
      phase: "entered",
      direction,
      position: { x: 3.15, y: 9 + eventId },
    });
    expect(machine.consumeSensorEvents([event("safe-shot-entry", 1, { x: 0, y: -1 })], 1)).toEqual([]);
    expect(machine.progress("safe-shot").currentState).toBe("Idle");
    expect(machine.consumeSensorEvents([event("safe-shot-entry", 2, { x: 0, y: 1 })], 2)).toEqual([]);
    expect(machine.progress("safe-shot").currentState).toBe("Entered");
    expect(machine.consumeSensorEvents([event("safe-shot-checkpoint", 3, { x: 0, y: 1 })], 3)).toEqual([]);
    const completed = machine.consumeSensorEvents([event("safe-shot-exit", 4, { x: 0, y: 1 })], 4);
    expect(completed).toHaveLength(1);
    expect(machine.toScoringEvents(completed)).toHaveLength(1);
    expect(machine.toScoringEvents(completed)).toHaveLength(0);
  });
});

type MatrixPhase = "rest" | "rising" | "max" | "return";
type MatrixTarget =
  | "wall-left"
  | "wall-right"
  | "wall-top"
  | "corner-left-top"
  | "corner-right-top"
  | "lane-divider"
  | "safe-route-left"
  | "launch-guide"
  | "flipper-left-root"
  | "flipper-left-tip"
  | "flipper-right-root"
  | "flipper-right-tip";

interface Point {
  readonly x: number;
  readonly y: number;
}

const rotate = (point: Point, angle: number): Point => ({
  x: point.x * Math.cos(angle) - point.y * Math.sin(angle),
  y: point.x * Math.sin(angle) + point.y * Math.cos(angle),
});

const add = (left: Point, right: Point): Point => ({ x: left.x + right.x, y: left.y + right.y });
const scale = (point: Point, amount: number): Point => ({ x: point.x * amount, y: point.y * amount });

interface MatrixContactOffset {
  readonly along: number;
  readonly transverse: number;
  readonly velocityScale: number;
}

function matrixContactOffset(variation: number): MatrixContactOffset {
  const centered = variation - 5.5;
  return {
    along: centered * 0.012,
    transverse: (((variation * 5) % 12) - 5.5) * 0.004,
    velocityScale: 1 + centered * 0.0015,
  };
}

function prepareMatrixPhase(
  world: PinballWorld,
  phase: MatrixPhase,
  hz: 60 | 120,
  target: MatrixTarget,
): void {
  world.ballBody.setActive(true);
  world.ballBody.setTransform(planck.Vec2(8.05, 0.8), 0);
  world.ballBody.setLinearVelocity(planck.Vec2(0, 0));
  world.ballBody.setAngularVelocity(0);
  world.setFlipperInput({ left: false, right: false });
  const targetSide = target.includes("flipper-left")
    ? "left"
    : target.includes("flipper-right")
      ? "right"
      : null;
  for (const side of ["left", "right"] as const) {
    world.enqueueCommand({
      type: targetSide === null || targetSide === side ? "enableFixture" : "disableFixture",
      targetId: `flipper-${side}`,
    });
  }
  for (let step = 0; step < 12; step += 1) {
    world.step(1 / hz);
  }
  if (phase === "rest") {
    return;
  }
  world.setFlipperInput({ left: true, right: true });
  const activeSteps = phase === "rising" ? 1 : 24;
  for (let step = 0; step < activeSteps; step += 1) {
    world.step(1 / hz);
  }
  if (phase === "return") {
    world.setFlipperInput({ left: false, right: false });
    world.step(1 / hz);
  }
}

function matrixFixtureSetup(
  world: PinballWorld,
  target: MatrixTarget,
  speed: number,
  angle: number,
  phase: MatrixPhase,
  contactOffset: MatrixContactOffset,
): { readonly fixtureId: string; readonly fixtureIds: readonly string[]; readonly position: Point; readonly velocity: Point } {
  if (target === "wall-left") {
    return {
      fixtureId: target,
      fixtureIds: [target],
      position: { x: 0.6, y: 10 + contactOffset.transverse },
      velocity: { x: -speed * contactOffset.velocityScale * Math.cos(angle), y: speed * contactOffset.velocityScale * Math.sin(angle) },
    };
  }
  if (target === "wall-right") {
    return {
      fixtureId: target,
      fixtureIds: [target],
      position: { x: 8.4, y: 10 + contactOffset.transverse },
      velocity: { x: speed * contactOffset.velocityScale * Math.cos(angle), y: speed * contactOffset.velocityScale * Math.sin(angle) },
    };
  }
  if (target === "wall-top") {
    return {
      fixtureId: target,
      fixtureIds: [target],
      position: { x: 4.5 + contactOffset.transverse, y: 15.3 },
      velocity: { x: speed * contactOffset.velocityScale * Math.sin(angle), y: speed * contactOffset.velocityScale * Math.cos(angle) },
    };
  }
  if (target === "corner-left-top" || target === "corner-right-top") {
    const directionAngle = Math.PI / 4 - angle;
    const direction = { x: Math.cos(directionAngle), y: Math.sin(directionAngle) };
    const distance = 0.22 + contactOffset.along;
    const cornerY = 15.55;
    const cornerX = target === "corner-left-top" ? 0.45 : 8.55;
    return {
      fixtureId: target === "corner-left-top" ? "wall-left" : "wall-right",
      fixtureIds: target === "corner-left-top" ? ["wall-left", "wall-top"] : ["wall-right", "wall-top"],
      position: {
        x: cornerX + (target === "corner-left-top" ? 1 : -1) * distance * direction.x,
        y: cornerY - distance * direction.y,
      },
      velocity: {
        x: (target === "corner-left-top" ? -1 : 1) * speed * contactOffset.velocityScale * direction.x,
        y: speed * contactOffset.velocityScale * direction.y,
      },
    };
  }
  if (target === "lane-divider") {
    return {
      fixtureId: target,
      fixtureIds: [target],
      position: { x: 6.55 + contactOffset.along, y: 3 + contactOffset.transverse },
      velocity: { x: speed * contactOffset.velocityScale * Math.cos(angle), y: speed * contactOffset.velocityScale * Math.sin(angle) },
    };
  }
  if (target === "safe-route-left") {
    return {
      fixtureId: target,
      fixtureIds: [target],
      position: { x: 1.95 + contactOffset.along, y: 11.2 + contactOffset.transverse },
      velocity: { x: speed * contactOffset.velocityScale * Math.cos(angle), y: speed * contactOffset.velocityScale * Math.sin(angle) },
    };
  }
  if (target === "launch-guide") {
    const guideAngle = 2;
    const normal = rotate({ x: 0, y: 1 }, guideAngle);
    const tangent = rotate({ x: 1, y: 0 }, guideAngle);
    const towardGuide = add(scale(normal, -Math.cos(angle)), scale(tangent, Math.sin(angle)));
    return {
      fixtureId: target,
      fixtureIds: [target],
      position: add(add({ x: 7.75, y: 9.6 }, scale(normal, 0.4 + contactOffset.along)), scale(tangent, contactOffset.transverse)),
      velocity: scale(towardGuide, speed * contactOffset.velocityScale),
    };
  }

  const side = target.includes("left") ? "left" : "right";
  const snapshotFlipper = world.getSnapshot().flippers.find((flipper) => flipper.side === side);
  if (snapshotFlipper === undefined) {
    throw new Error(`missing ${side} flipper snapshot`);
  }
  const localX = target.endsWith("root") ? 0.6 : snapshotFlipper.length - 0.6;
  const localNormal = { x: 0, y: 1 };
  const localTangent = { x: 1, y: 0 };
  const normal = rotate(localNormal, snapshotFlipper.angle);
  const tangent = rotate(localTangent, snapshotFlipper.angle);
  // The two flippers overlap near their tips. Aim the left tip from below
  // and the right tip from above so the required ImpactEvent belongs to the
  // requested fixture rather than the mirrored neighbor.
  const normalSign = phase === "rising"
    ? side === "left" ? 1 : -1
    : target.endsWith("tip")
      ? side === "left" ? -1 : 1
      : side === "left" ? 1 : -1;
  const contactGap = phase === "rising" ? 0.02 : 0.11;
  const towardFlipper = add(scale(normal, -normalSign * Math.cos(angle)), scale(tangent, Math.sin(angle)));
  return {
    fixtureId: `flipper-${side}`,
    fixtureIds: [`flipper-${side}`],
    position: add(
      snapshotFlipper.position,
      rotate({ x: localX + contactOffset.along, y: normalSign * (snapshotFlipper.thickness / 2 + BALL_RADIUS + contactGap + contactOffset.transverse) }, snapshotFlipper.angle),
    ),
    velocity: scale(towardFlipper, speed * contactOffset.velocityScale),
  };
}

function orientedBoxSeparation(position: Point, center: Point, angle: number, width: number, height: number): number {
  const local = rotate({ x: position.x - center.x, y: position.y - center.y }, -angle);
  const dx = Math.max(Math.abs(local.x) - width / 2, 0);
  const dy = Math.max(Math.abs(local.y) - height / 2, 0);
  return Math.hypot(dx, dy);
}

describe("mixed deterministic collision matrix", () => {
  it("produces distinct root and tip trajectories on both flippers", () => {
    const sample = (side: "left" | "right", localX: number, physicsStepHz: 60 | 120): Point => {
      const world = new PinballWorld({ physicsStepHz, gravityY: 0 });
      const otherSide = side === "left" ? "right" : "left";
      world.enqueueCommand({
        type: "disableFixture",
        targetId: `flipper-${otherSide}`,
        stepId: 1,
      });
      world.step();
      world.setFlipperInput({ left: side === "left", right: side === "right" });
      world.step();
      const flipper = world.getSnapshot().flippers.find((candidate) => candidate.side === side);
      if (flipper === undefined) {
        throw new Error(`missing ${side} flipper snapshot`);
      }
      const normal = rotate({ x: 0, y: 1 }, flipper.angle);
      const position = add(
        flipper.position,
        rotate({ x: localX, y: flipper.thickness / 2 + BALL_RADIUS + 0.08 }, flipper.angle),
      );
      world.ballBody.setTransform(planck.Vec2(position.x, position.y), 0);
      world.ballBody.setLinearVelocity(planck.Vec2(-normal.x * 10, -normal.y * 10));
      let impacted = false;
      for (let step = 0; step < 12; step += 1) {
        const result = world.step();
        impacted ||= result.impacts.some((impact) => impact.fixtureId === `flipper-${side}`);
        if (impacted && step >= 2) {
          break;
        }
      }
      const finalFlipper = world.getSnapshot().flippers.find((candidate) => candidate.side === side);
      if (finalFlipper === undefined) {
        throw new Error(`missing final ${side} flipper snapshot`);
      }
      const velocity = world.ballBody.getLinearVelocity();
      const localVelocity = rotate({ x: velocity.x, y: velocity.y }, -finalFlipper.angle);
      expect(impacted, JSON.stringify({ side, localX, physicsStepHz })).toBe(true);
      world.destroy();
      return localVelocity;
    };

    for (const physicsStepHz of [60, 120] as const) {
      for (const side of ["left", "right"] as const) {
        const root = sample(side, 0.35, physicsStepHz);
        const tip = sample(side, 1.4, physicsStepHz);
        expect(
          Math.hypot(root.x - tip.x, root.y - tip.y),
          JSON.stringify({ side, physicsStepHz, root, tip }),
        ).toBeGreaterThan(0.25);
      }
    }
  });

  it("requires real target impacts across 10,000+ wall, lane, route, and flipper cases", () => {
    const speeds = [6, 14, 20, 26];
    const angles = [0, 0.15, 0.35];
    const phases: readonly MatrixPhase[] = ["rest", "rising", "max", "return"];
    const targets: readonly MatrixTarget[] = [
      "wall-left",
      "wall-right",
      "wall-top",
      "corner-left-top",
      "corner-right-top",
      "lane-divider",
      "safe-route-left",
      "launch-guide",
      "flipper-left-root",
      "flipper-left-tip",
      "flipper-right-root",
      "flipper-right-tip",
    ];
    const contactOffsets = Array.from({ length: 12 }, (_, variation) => ({
      variation,
      value: matrixContactOffset(variation),
    }));
    let cases = 0;
    for (const physicsStepHz of [60, 120] as const) {
      const world = new PinballWorld({ physicsStepHz, gravityY: 0 });
      for (const { variation, value: contactOffset } of contactOffsets) {
        for (const speed of speeds) {
          for (const angle of angles) {
            for (const phase of phases) {
              for (const target of targets) {
                prepareMatrixPhase(world, phase, physicsStepHz, target);
                const setup = matrixFixtureSetup(world, target, speed, angle, phase, contactOffset);
                world.ballBody.setActive(true);
                world.ballBody.setTransform(planck.Vec2(setup.position.x, setup.position.y), 0);
                world.ballBody.setLinearVelocity(planck.Vec2(setup.velocity.x, setup.velocity.y));
                world.ballBody.setAngularVelocity(0);
                let impactStep = -1;
                let resultStep = 0;
                let latestPosition: Point = setup.position;
                let latestVelocity: Point = setup.velocity;
                const impactedFixtures = new Set<string>();
                for (; resultStep < 18; resultStep += 1) {
                  const result = world.step(1 / physicsStepHz);
                  const position = world.ballBody.getPosition();
                  const velocity = world.ballBody.getLinearVelocity();
                  latestPosition = { x: position.x, y: position.y };
                  latestVelocity = { x: velocity.x, y: velocity.y };
                  const caseLabel = JSON.stringify({
                    seed: cases,
                    target,
                    speed,
                    angle,
                    variation,
                    contactOffset,
                    initialPosition: setup.position,
                    initialVelocity: setup.velocity,
                    initialAngularVelocity: 0,
                    physicsStepHz,
                    fixture: setup.fixtureId,
                    phase,
                    step: resultStep,
                  });
                  expect(Number.isFinite(position.x) && Number.isFinite(position.y), caseLabel).toBe(true);
                  expect(Number.isFinite(velocity.x) && Number.isFinite(velocity.y), caseLabel).toBe(true);
                  expect(Number.isFinite(world.ballBody.getAngle()), caseLabel).toBe(true);
                  expect(Number.isFinite(world.ballBody.getAngularVelocity()), caseLabel).toBe(true);
                  expect(Math.hypot(velocity.x, velocity.y), caseLabel).toBeLessThanOrEqual(world.velocityLimit + 1e-6);
                  expect(position.x, caseLabel).toBeGreaterThanOrEqual(-0.1);
                  expect(position.x, caseLabel).toBeLessThanOrEqual(9.1);
                  expect(position.y, caseLabel).toBeGreaterThanOrEqual(-0.1);
                  expect(position.y, caseLabel).toBeLessThanOrEqual(16.1);
                  for (const impact of result.impacts) {
                    if (setup.fixtureIds.includes(impact.fixtureId)) {
                      impactedFixtures.add(impact.fixtureId);
                    }
                  }
                  if (impactStep < 0 && setup.fixtureIds.every((fixtureId) => impactedFixtures.has(fixtureId))) {
                    impactStep = resultStep;
                  }
                  // Keep four solver frames after the real impact so a moving
                  // flipper can finish applying its post-solve separating
                  // impulse, especially while returning toward rest.
                  if (impactStep >= 0 && resultStep - impactStep >= 4) {
                    break;
                  }
                }
                const caseLabel = JSON.stringify({
                  seed: cases,
                  target,
                  speed,
                  angle,
                  variation,
                  contactOffset,
                  initialPosition: setup.position,
                  initialVelocity: setup.velocity,
                  initialAngularVelocity: 0,
                  physicsStepHz,
                  fixture: setup.fixtureId,
                  phase,
                  step: impactStep,
                });
                expect(impactStep, caseLabel).toBeGreaterThanOrEqual(0);
                for (const fixtureId of setup.fixtureIds) {
                  expect(impactedFixtures.has(fixtureId), caseLabel).toBe(true);
                }
                if (target === "wall-left") {
                  expect(latestPosition.x, caseLabel).toBeGreaterThanOrEqual(0.3 + BALL_RADIUS - 0.02);
                } else if (target === "wall-right") {
                  expect(latestPosition.x, caseLabel).toBeLessThanOrEqual(8.7 - BALL_RADIUS + 0.02);
                } else if (target === "wall-top") {
                  expect(latestPosition.y, caseLabel).toBeLessThanOrEqual(15.7 - BALL_RADIUS + 0.02);
                } else if (target === "corner-left-top") {
                  expect(latestPosition.x, caseLabel).toBeGreaterThanOrEqual(0.3 + BALL_RADIUS - 0.02);
                  expect(latestPosition.y, caseLabel).toBeLessThanOrEqual(15.7 - BALL_RADIUS + 0.02);
                } else if (target === "corner-right-top") {
                  expect(latestPosition.x, caseLabel).toBeLessThanOrEqual(8.7 - BALL_RADIUS + 0.02);
                  expect(latestPosition.y, caseLabel).toBeLessThanOrEqual(15.7 - BALL_RADIUS + 0.02);
                } else if (target === "lane-divider") {
                  const separation = orientedBoxSeparation(latestPosition, { x: 7.05, y: 2.55 }, 0, 0.22, 3.9);
                  expect(separation, caseLabel).toBeGreaterThanOrEqual(BALL_RADIUS - 0.02);
                } else if (target === "safe-route-left") {
                  const separation = orientedBoxSeparation(latestPosition, { x: 2.45, y: 11.2 }, 0, 0.18, 4);
                  expect(separation, caseLabel).toBeGreaterThanOrEqual(BALL_RADIUS - 0.02);
                } else if (target === "launch-guide") {
                  const separation = orientedBoxSeparation(latestPosition, { x: 7.75, y: 9.6 }, 2, 2.1, 0.22);
                  expect(separation, caseLabel).toBeGreaterThanOrEqual(BALL_RADIUS - 0.02);
                } else {
                  const side = target.includes("left") ? "left" : "right";
                  const flipper = world.getSnapshot().flippers.find((candidate) => candidate.side === side);
                  if (flipper === undefined) {
                    throw new Error(`missing ${side} flipper snapshot`);
                  }
                  const local = rotate(
                    { x: latestPosition.x - flipper.position.x, y: latestPosition.y - flipper.position.y },
                    -flipper.angle,
                  );
                  const dx = Math.max(Math.max(0, -local.x), local.x - flipper.length);
                  const dy = Math.max(Math.abs(local.y) - flipper.thickness / 2, 0);
                  expect(Math.hypot(dx, dy), caseLabel).toBeGreaterThanOrEqual(BALL_RADIUS - 0.02);
                }
                expect(Math.hypot(latestVelocity.x, latestVelocity.y), caseLabel).toBeLessThanOrEqual(world.velocityLimit + 1e-6);
                cases += 1;
              }
            }
          }
        }
      }
      world.destroy();
    }
    expect(cases).toBeGreaterThanOrEqual(10_000);
  }, 60_000);
});
