import { describe, expect, it } from "vitest";
import { bindLoopControls } from "../../src/ui/loop-controls";

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
});
