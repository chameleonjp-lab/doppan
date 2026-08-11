import { describe, expect, it } from "vitest";
import {
  InputController,
  InputEventQueue,
  InputQueueOverflowError,
  MAX_PENDING_INPUT_EVENTS,
} from "../../src/input";

describe("input event queue and ownership", () => {
  it("drains events in sequence order even when insertion order differs", () => {
    const queue = new InputEventQueue({ now: () => 10 });
    queue.enqueue({
      sequenceId: 2,
      source: "keyboard",
      sourceId: "ArrowRight",
      action: "rightFlipper",
      phase: "released",
    });
    queue.enqueue({
      sequenceId: 1,
      source: "keyboard",
      sourceId: "ArrowRight",
      action: "rightFlipper",
      phase: "pressed",
    });

    expect(queue.drainForPhysicsStep(1).map((event) => event.sequenceId)).toEqual([1, 2]);
    expect(queue.size).toBe(0);
  });

  it("keeps 100 simultaneous two-pointer cycles stable and ignores a third pointer", () => {
    const input = new InputController({ now: () => 0 });
    let physicsStepId = 0;

    for (let cycle = 0; cycle < 100; cycle += 1) {
      const leftPointer = cycle * 3 + 11;
      const rightPointer = leftPointer + 1;
      const thirdPointer = leftPointer + 2;
      expect(input.pointerDown(leftPointer, "leftFlipper")).toBe(true);
      expect(input.pointerDown(rightPointer, "rightFlipper")).toBe(true);
      expect(input.pointerDown(thirdPointer, "leftFlipper")).toBe(false);
      physicsStepId += 1;
      input.applyPhysicsStep(physicsStepId);
      expect(input.state.leftFlipper).toBe(true);
      expect(input.state.rightFlipper).toBe(true);

      expect(input.pointerUp(leftPointer)).toBe(true);
      expect(input.pointerUp(rightPointer)).toBe(true);
      physicsStepId += 1;
      input.applyPhysicsStep(physicsStepId);
      expect(input.state.leftFlipper).toBe(false);
      expect(input.state.rightFlipper).toBe(false);
      expect(input.ownership.size).toBe(0);
    }
  });

  it("treats a pointer up from a non-owner as a no-op", () => {
    const input = new InputController({ now: () => 0 });

    input.pointerDown(21, "leftFlipper");
    expect(input.pointerUp(22)).toBe(false);
    expect(input.ownership.pointerForAction("leftFlipper")).toBe(21);
    expect(input.queue.size).toBe(1);
  });

  it("rejects disabled actions before claiming pointer or keyboard ownership", () => {
    let enabled = false;
    const input = new InputController({
      now: () => 0,
      isActionEnabled: () => enabled,
    });

    expect(input.pointerDown(31, "plunger")).toBe(false);
    expect(input.keyboardDown({ code: "Space", action: "plunger" })).toBe(false);
    expect(input.ownership.size).toBe(0);
    expect(input.queue.size).toBe(0);

    enabled = true;
    expect(input.pointerDown(31, "plunger")).toBe(true);
  });

  it("fails explicitly and latches safe-stop on the 257th pending event", () => {
    const queue = new InputEventQueue({ now: () => 0 });
    const event = {
      source: "keyboard" as const,
      sourceId: "Space",
      action: "plunger" as const,
      phase: "pressed" as const,
    };

    for (let index = 0; index < MAX_PENDING_INPUT_EVENTS; index += 1) {
      queue.enqueue(event);
    }

    expect(() => queue.enqueue(event)).toThrow(InputQueueOverflowError);
    expect(queue.isSafeStopped).toBe(true);
    expect(queue.size).toBe(0);
    expect(() => queue.enqueue(event)).toThrow(InputQueueOverflowError);
  });
});
