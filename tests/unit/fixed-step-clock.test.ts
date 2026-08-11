import { describe, expect, it, vi } from "vitest";
import { FixedStepClock, type PhysicsStepHz } from "../../src/loop/fixed-step-clock";

describe.each([60, 120] satisfies PhysicsStepHz[])("FixedStepClock at %iHz", (physicsStepHz) => {
  it("advances one second to the same simulation duration", () => {
    const clock = new FixedStepClock({ physicsStepHz });
    let simulatedSeconds = 0;
    for (let frame = 0; frame < 60; frame += 1) {
      clock.advance(1000 / 60, (stepSeconds) => {
        simulatedSeconds += stepSeconds;
      });
    }

    expect(simulatedSeconds).toBeCloseTo(1, 10);
    expect(clock.diagnostics().physicsStepId).toBe(physicsStepHz);
  });

  it("never exceeds the documented steps per display frame", () => {
    const clock = new FixedStepClock({ physicsStepHz });
    clock.advance(66, () => undefined);
    expect(clock.diagnostics().stepsThisFrame).toBeLessThanOrEqual(physicsStepHz === 60 ? 4 : 8);
  });

  it("does not replay time accumulated while hidden", () => {
    const update = vi.fn();
    const clock = new FixedStepClock({ physicsStepHz });
    clock.setSuspended(true);
    clock.advance(5_000, update);
    clock.setSuspended(false);
    clock.advance(1000 / physicsStepHz, update);

    expect(update).toHaveBeenCalledTimes(1);
    expect(clock.diagnostics().droppedSimulationMs).toBe(0);
  });

  it("rejects a stale 250ms delta instead of simulating it", () => {
    const update = vi.fn();
    const clock = new FixedStepClock({ physicsStepHz });
    clock.advance(250, update);

    expect(update).not.toHaveBeenCalled();
    expect(clock.diagnostics()).toMatchObject({
      droppedSimulationMs: 250,
      droppedSimulationCount: 1,
    });
  });

  it("records time above 66ms and invalidates repeated drops", () => {
    const clock = new FixedStepClock({ physicsStepHz });
    for (let index = 0; index < 3; index += 1) {
      clock.advance(80, () => undefined);
    }

    expect(clock.diagnostics()).toMatchObject({
      droppedSimulationMs: 42,
      droppedSimulationCount: 3,
      runIntegrity: "invalid",
      autoPauseReason: "repeated-dropped-simulation",
    });
  });

  it("does not combine isolated drops from separate fifteen-minute windows", () => {
    const clock = new FixedStepClock({ physicsStepHz });
    clock.advance(80, () => undefined);
    for (let frame = 0; frame < 54_001; frame += 1) {
      clock.advance(1000 / 60, () => undefined);
    }
    clock.advance(80, () => undefined);
    clock.advance(80, () => undefined);

    expect(clock.diagnostics()).toMatchObject({
      droppedSimulationCount: 3,
      runIntegrity: "valid",
      autoPauseReason: null,
    });
  });
});

describe("FixedStepClock validation", () => {
  it("rejects invalid frame deltas and limits", () => {
    const clock = new FixedStepClock({ physicsStepHz: 60 });
    expect(() => clock.advance(Number.NaN, () => undefined)).toThrow(/finite/u);
    expect(() => new FixedStepClock({ physicsStepHz: 60, maxCatchUpMs: 300 })).toThrow(/limits/u);
  });
});
