import { describe, expect, it } from "vitest";
import { bindLoopControls } from "../../src/ui/loop-controls";

class MatchableEventTarget extends EventTarget {
  public constructor(
    private readonly matchesSelector: boolean,
    private readonly hasInteractiveAncestor = matchesSelector,
  ) {
    super();
  }

  public matches(selectors: string): boolean {
    void selectors;
    return this.matchesSelector;
  }

  public closest(selectors: string): EventTarget | null {
    void selectors;
    return this.hasInteractiveAncestor ? this : null;
  }
}

describe("loop controls", () => {
  it("removes click and keyboard subscriptions across twenty reinitializations", () => {
    const button = new EventTarget();
    const keyboard = new EventTarget();
    let toggleCount = 0;

    for (let index = 0; index < 20; index += 1) {
      const controller = bindLoopControls({
        button,
        keyboardTarget: keyboard,
        onToggle: () => {
          toggleCount += 1;
        },
      });

      button.dispatchEvent(new Event("click"));
      const space = Object.assign(new Event("keydown", { cancelable: true }), {
        code: "Space",
        repeat: false,
      });
      keyboard.dispatchEvent(space);
      expect(space.defaultPrevented).toBe(true);
      expect(toggleCount).toBe((index + 1) * 2);

      controller.abort();
      button.dispatchEvent(new Event("click"));
      keyboard.dispatchEvent(Object.assign(new Event("keydown"), { code: "Space", repeat: false }));
      expect(toggleCount).toBe((index + 1) * 2);
    }
  });

  it("leaves Space to a focused interactive control", () => {
    const button = new EventTarget();
    const focusedControl = new MatchableEventTarget(false, true);
    let toggleCount = 0;
    const controller = bindLoopControls({
      button,
      keyboardTarget: focusedControl,
      onToggle: () => {
        toggleCount += 1;
      },
    });

    const space = Object.assign(new Event("keydown", { cancelable: true }), {
      code: "Space",
      repeat: false,
    });
    focusedControl.dispatchEvent(space);

    expect(space.defaultPrevented).toBe(false);
    expect(toggleCount).toBe(0);
    controller.abort();
  });

  it("supports assigning Escape to pause without consuming Space", () => {
    const button = new EventTarget();
    const keyboard = new EventTarget();
    let toggleCount = 0;
    const controller = bindLoopControls({
      button,
      keyboardTarget: keyboard,
      keyboardCode: "Escape",
      onToggle: () => {
        toggleCount += 1;
      },
    });

    keyboard.dispatchEvent(Object.assign(new Event("keydown"), { code: "Space", repeat: false }));
    const escape = Object.assign(new Event("keydown", { cancelable: true }), {
      code: "Escape",
      repeat: false,
    });
    keyboard.dispatchEvent(escape);

    expect(toggleCount).toBe(1);
    expect(escape.defaultPrevented).toBe(true);
    controller.abort();
  });
});
