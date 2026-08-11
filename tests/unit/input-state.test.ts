import { describe, expect, it } from "vitest";
import { InputController } from "../../src/input";

describe("InputState", () => {
  it("guarantees a short press for one physics step", () => {
    const input = new InputController({ now: () => 0 });

    input.pointerDown(1, "leftFlipper");
    input.pointerUp(1);

    const firstStepEvents = input.applyPhysicsStep(1);
    expect(firstStepEvents.map((event) => event.phase)).toEqual(["pressed"]);
    expect(input.state.leftFlipper).toBe(true);
    expect(input.queue.size).toBe(1);

    const secondStepEvents = input.applyPhysicsStep(2);
    expect(secondStepEvents.map((event) => event.phase)).toEqual(["released"]);
    expect(input.state.leftFlipper).toBe(false);
    expect(input.queue.size).toBe(0);
  });

  it("keeps rapid sequential presses ordered across the bounded hold", () => {
    const input = new InputController({ now: () => 0 });

    input.pointerDown(1, "leftFlipper");
    input.pointerUp(1);
    input.pointerDown(1, "leftFlipper");
    input.pointerUp(1);

    input.applyPhysicsStep(1);
    expect(input.state.leftFlipper).toBe(true);
    input.applyPhysicsStep(2);
    expect(input.state.leftFlipper).toBe(true);
    input.applyPhysicsStep(3);
    expect(input.state.leftFlipper).toBe(false);
    expect(input.queue.size).toBe(0);
  });

  it("ignores keyboard repeat and does not duplicate a held source", () => {
    const input = new InputController({ now: () => 0 });

    expect(input.keyboardDown({ code: "ArrowLeft", action: "leftFlipper", repeat: false })).toBe(true);
    expect(input.keyboardDown({ code: "ArrowLeft", action: "leftFlipper", repeat: true })).toBe(false);
    expect(input.queue.size).toBe(1);

    input.applyPhysicsStep(1);
    expect(input.state.leftFlipper).toBe(true);
    expect(input.keyboardUp("ArrowLeft")).toBe(true);
    input.applyPhysicsStep(2);
    expect(input.state.leftFlipper).toBe(false);
  });

  it("keeps independent sources from releasing each other", () => {
    const input = new InputController({ now: () => 0 });

    input.pointerDown(4, "rightFlipper");
    input.keyboardDown({ code: "ArrowRight", action: "rightFlipper" });
    input.applyPhysicsStep(1);
    expect(input.state.rightFlipper).toBe(true);

    input.keyboardUp("ArrowRight");
    input.applyPhysicsStep(2);
    expect(input.state.rightFlipper).toBe(true);

    input.pointerCancel(4);
    input.applyPhysicsStep(3);
    expect(input.state.rightFlipper).toBe(false);
  });

  it.each([
    ["pointercancel", (input: InputController) => input.pointerCancel(7)],
    ["lostpointercapture", (input: InputController) => input.lostPointerCapture(7)],
  ] as const)("centralizes %s release", (_name, release) => {
    const input = new InputController({ now: () => 0 });

    input.pointerDown(7, "plunger");
    input.applyPhysicsStep(1);
    expect(input.state.plunger).toBe(true);
    release(input);
    input.applyPhysicsStep(2);
    expect(input.state.plunger).toBe(false);
    expect(input.ownership.size).toBe(0);
  });

  it("clears all pointer and keyboard input immediately on blur/visibility loss", () => {
    const input = new InputController({ now: () => 0 });

    input.pointerDown(8, "leftFlipper");
    input.keyboardDown({ code: "Space", action: "plunger" });
    input.applyPhysicsStep(1);
    expect(input.state.leftFlipper).toBe(true);
    expect(input.state.plunger).toBe(true);

    input.handleBlur();
    expect(input.state.leftFlipper).toBe(false);
    expect(input.state.plunger).toBe(false);
    expect(input.ownership.size).toBe(0);
    expect(input.queue.size).toBe(0);

    input.pointerDown(9, "rightFlipper");
    input.applyPhysicsStep(2);
    input.handleVisibilityChange(true);
    expect(input.state.rightFlipper).toBe(false);
    expect(input.ownership.size).toBe(0);
    expect(input.queue.size).toBe(0);
  });

  it("records bounded input-to-physics and input-to-draw latency", () => {
    let now = 100;
    const input = new InputController({ now: () => now });
    input.keyboardDown({ code: "KeyZ", action: "leftFlipper", receivedAtMs: 90 });

    input.applyPhysicsStep(1);
    now = 115;
    input.markRendered();

    expect(input.latencyDiagnostics()).toEqual({
      inputToPhysics: {
        sampleCount: 1,
        lastMs: 10,
        medianMs: 10,
        p95Ms: 10,
        maxMs: 10,
      },
      inputToDraw: {
        sampleCount: 1,
        lastMs: 25,
        medianMs: 25,
        p95Ms: 25,
        maxMs: 25,
      },
    });

    for (let cycle = 0; cycle < 300; cycle += 1) {
      now += 2;
      input.keyboardDown({ code: "KeyZ", action: "leftFlipper", receivedAtMs: now - 1 });
      input.applyPhysicsStep(cycle * 2 + 2);
      input.markRendered(now + 1);
      input.keyboardUp("KeyZ", now + 1);
      input.applyPhysicsStep(cycle * 2 + 3);
      input.markRendered(now + 2);
    }
    const bounded = input.latencyDiagnostics();
    expect(bounded.inputToPhysics.sampleCount).toBe(256);
    expect(bounded.inputToDraw.sampleCount).toBe(256);
    expect(Number.isFinite(bounded.inputToPhysics.p95Ms)).toBe(true);
    expect(Number.isFinite(bounded.inputToDraw.p95Ms)).toBe(true);
  });
});
