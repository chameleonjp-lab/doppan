import { describe, expect, it } from "vitest";
import { G1BPrototype } from "../../src/prototype";

describe("G1BPrototype integration", () => {
  it("turns a one-step Space tap into one deterministic low launch", () => {
    const prototype = new G1BPrototype({ physicsStepHz: 60 });
    prototype.input.keyboardDown({ code: "Space", action: "plunger", receivedAtMs: 0 });
    prototype.input.keyboardUp("Space", 1);

    prototype.advance(1000 / 60);
    expect(prototype.input.state.plunger).toBe(true);
    prototype.advance(1000 / 60);

    expect(prototype.snapshot().baseState).toBe("Playing");
    expect(prototype.world.ballBody.getLinearVelocity().y).toBeGreaterThan(0);
    prototype.destroy();
  });

  it("keeps manual pause across visibility loss and does not replay hidden time", () => {
    const prototype = new G1BPrototype({ physicsStepHz: 120 });
    prototype.togglePause();
    prototype.setVisibility(true);
    prototype.advance(5_000);
    prototype.setVisibility(false);

    expect(prototype.gameState.suspensionState).toBe("ManualPause");
    expect(prototype.diagnostics().fixedStep.physicsStepId).toBe(0);
    prototype.destroy();
  });

  it("resets worlds without growing Planck resources", () => {
    const prototype = new G1BPrototype({ physicsStepHz: 60 });
    const baseline = prototype.diagnostics().physics;
    for (let index = 0; index < 20; index += 1) {
      expect(prototype.input.pointerDown(index + 100, "leftFlipper")).toBe(true);
      prototype.advance(1000 / prototype.physicsStepHz);
      prototype.world.enqueueCommand({
        type: "resetTemporaryRoute",
        targetId: `route-${index}`,
        stepId: prototype.world.physicsStepId + 2,
      });
      prototype.reset(index % 2 === 0 ? 120 : 60);
      const diagnostics = prototype.diagnostics().physics;
      expect(diagnostics.bodyCount).toBe(baseline.bodyCount);
      expect(diagnostics.fixtureCount).toBe(baseline.fixtureCount);
      expect(diagnostics.jointCount).toBe(baseline.jointCount);
      expect(diagnostics.queuedCommandCount).toBe(0);
      expect(diagnostics.contactCount).toBe(0);
      expect(prototype.input.queue.size).toBe(0);
      expect(prototype.input.ownership.size).toBe(0);
      expect(prototype.input.state.snapshot().pressedActions).toEqual([]);
      expect(prototype.snapshot().shotProgress[0]?.currentState).toBe("Idle");
    }
    prototype.destroy();
  });

  it("resets the input and fixed-step IDs after an active run", () => {
    const prototype = new G1BPrototype({ physicsStepHz: 60 });
    prototype.advance(100);
    expect(prototype.diagnostics().fixedStep.physicsStepId).toBeGreaterThan(1);

    prototype.reset(120);
    expect(prototype.advance(1000 / 120)).toBe(1);
    expect(prototype.diagnostics()).toMatchObject({
      fatalError: null,
      runIntegrity: "valid",
      fixedStep: { physicsStepId: 1 },
    });
    prototype.destroy();
  });

  it("releases every held input when the ball drains", () => {
    const prototype = new G1BPrototype({ physicsStepHz: 60 });
    expect(prototype.input.pointerDown(71, "leftFlipper")).toBe(true);
    prototype.world.ballBody.setTransform({ x: 4.5, y: 0.1 }, 0);
    prototype.world.ballBody.setLinearVelocity({ x: 0, y: -4 });

    for (let step = 0; step < 5 && prototype.snapshot().baseState !== "BallEnding"; step += 1) {
      prototype.advance(1000 / 60);
    }

    expect(prototype.snapshot().baseState).toBe("BallEnding");
    expect(prototype.input.state.snapshot().pressedActions).toEqual([]);
    expect(prototype.input.ownership.size).toBe(0);
    expect(prototype.input.queue.size).toBe(0);
    expect(prototype.world.lastSafeBallState).toBeNull();
    prototype.destroy();
  });

  it.each([
    ["pointer cancel", (prototype: G1BPrototype) => prototype.input.pointerCancel(51)],
    ["blur", (prototype: G1BPrototype) => prototype.input.handleBlur()],
    ["visibility loss", (prototype: G1BPrototype) => {
      prototype.setVisibility(true);
      prototype.setVisibility(false);
    }],
    ["manual pause", (prototype: G1BPrototype) => {
      prototype.togglePause();
      prototype.togglePause();
    }],
  ] as const)("does not turn %s into a launch", (_name, interrupt) => {
    const prototype = new G1BPrototype({ physicsStepHz: 60 });
    expect(prototype.input.pointerDown(51, "plunger", 0)).toBe(true);
    prototype.advance(100);
    expect(prototype.launchCharge).toBeGreaterThan(0);

    interrupt(prototype);
    prototype.advance(100);

    expect(prototype.snapshot().baseState).toBe("LaunchReady");
    expect(prototype.launchCharge).toBe(0);
    expect(prototype.snapshot().ball.linearVelocity.y).toBeLessThanOrEqual(0);
    prototype.destroy();
  });

  it("latches a system safe stop until an explicit reset", () => {
    const prototype = new G1BPrototype({ physicsStepHz: 60 });
    prototype.safeStop(new Error("renderer lost"), false);
    const stoppedStep = prototype.diagnostics().fixedStep.physicsStepId;

    expect(prototype.diagnostics()).toMatchObject({
      fatalError: "renderer lost",
      runIntegrity: "invalid",
    });
    expect(prototype.advance(100)).toBe(0);
    expect(prototype.diagnostics().fixedStep.physicsStepId).toBe(stoppedStep);
    expect(prototype.input.pointerDown(61, "leftFlipper")).toBe(false);

    prototype.reset();
    expect(prototype.diagnostics()).toMatchObject({ fatalError: null, runIntegrity: "valid" });
    expect(prototype.input.pointerDown(61, "leftFlipper")).toBe(true);
    prototype.destroy();
  });
});
