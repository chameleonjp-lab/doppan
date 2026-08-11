import { describe, expect, it } from "vitest";
import { InputController } from "../../src/input";
import { bindPrototypeInput } from "../../src/ui/prototype-input-bindings";

class FakeInputElement extends EventTarget {
  public readonly action: string | null;

  public readonly capturedPointers: number[] = [];

  public captureThrows = false;

  public constructor(action: string | null = null) {
    super();
    this.action = action;
  }

  public getAttribute(name: string): string | null {
    return name === "data-input-action" ? this.action : null;
  }

  public matches(selector: string): boolean {
    return selector === "[data-input-action]" && this.action !== null;
  }

  public querySelectorAll<T extends Element>(_selector: string): T[] {
    void _selector;
    return [];
  }

  public setPointerCapture(pointerId: number): void {
    if (this.captureThrows) {
      throw new Error("capture unavailable");
    }
    this.capturedPointers.push(pointerId);
  }
}

class FakeRoot extends FakeInputElement {
  public constructor(public readonly children: FakeInputElement[]) {
    super();
  }

  public override querySelectorAll<T extends Element>(_selector: string): T[] {
    void _selector;
    return this.children as unknown as T[];
  }
}

class FakeKeyboardTarget extends EventTarget {
  public interactive = false;

  public closest(_selector: string): EventTarget | null {
    void _selector;
    return this.interactive ? this : null;
  }
}

class FakeVisibilityTarget extends EventTarget {
  public hidden = false;
}

function createPointerEvent(type: string, pointerId: number): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "pointerId", { value: pointerId });
  return event;
}

function createKeyboardEvent(
  type: string,
  code: string,
  key: string,
  repeat = false,
): Event {
  const event = new Event(type, { cancelable: true });
  Object.defineProperties(event, {
    code: { value: code },
    key: { value: key },
    repeat: { value: repeat },
  });
  return event;
}

function bindFixture(input: InputController, actionElement: FakeInputElement, keyboardTarget = new FakeKeyboardTarget()) {
  const root = new FakeRoot([actionElement]);
  const visibilityTarget = new FakeVisibilityTarget();
  const controller = bindPrototypeInput({
    root: root as unknown as HTMLElement,
    keyboardTarget: keyboardTarget as unknown as Window,
    visibilityTarget: visibilityTarget as unknown as Document,
    input,
  });
  return { actionElement, controller, keyboardTarget, root, visibilityTarget };
}

describe("prototype input bindings", () => {
  it("treats pointerup followed by lostpointercapture as one release", () => {
    const input = new InputController({ now: () => 0 });
    const fixture = bindFixture(input, new FakeInputElement("leftFlipper"));

    fixture.actionElement.dispatchEvent(createPointerEvent("pointerdown", 7));
    expect(fixture.actionElement.capturedPointers).toEqual([7]);
    input.applyPhysicsStep(1);
    expect(input.state.leftFlipper).toBe(true);

    fixture.actionElement.dispatchEvent(createPointerEvent("pointerup", 7));
    fixture.actionElement.dispatchEvent(createPointerEvent("lostpointercapture", 7));
    expect(input.ownership.size).toBe(0);
    input.applyPhysicsStep(2);
    expect(input.state.leftFlipper).toBe(false);
    fixture.controller.abort();
  });

  it("cancels ownership if pointer capture cannot be established", () => {
    const input = new InputController({ now: () => 0 });
    const element = new FakeInputElement("rightFlipper");
    element.captureThrows = true;
    const errors: unknown[] = [];
    const fixture = bindFixture(input, element);
    fixture.controller.abort();
    const rebound = bindPrototypeInput({
      root: fixture.root as unknown as HTMLElement,
      keyboardTarget: fixture.keyboardTarget as unknown as Window,
      visibilityTarget: fixture.visibilityTarget as unknown as Document,
      input,
      onError: (error) => errors.push(error),
    });

    element.dispatchEvent(createPointerEvent("pointerdown", 8));
    expect(input.ownership.size).toBe(0);
    expect(errors).toHaveLength(1);
    rebound.abort();
  });

  it("supports keyboard aliases while ignoring repeats", () => {
    const input = new InputController({ now: () => 0 });
    const fixture = bindFixture(input, new FakeInputElement("leftFlipper"));

    const keyDown = createKeyboardEvent("keydown", "KeyZ", "z");
    fixture.keyboardTarget.dispatchEvent(keyDown);
    expect(keyDown.defaultPrevented).toBe(true);
    expect(input.queue.size).toBe(1);

    const repeat = createKeyboardEvent("keydown", "KeyZ", "z", true);
    fixture.keyboardTarget.dispatchEvent(repeat);
    expect(repeat.defaultPrevented).toBe(false);
    expect(input.queue.size).toBe(1);

    input.applyPhysicsStep(1);
    expect(input.state.leftFlipper).toBe(true);
    const keyUp = createKeyboardEvent("keyup", "KeyZ", "z");
    fixture.keyboardTarget.dispatchEvent(keyUp);
    expect(keyUp.defaultPrevented).toBe(true);
    input.applyPhysicsStep(2);
    expect(input.state.leftFlipper).toBe(false);
    fixture.controller.abort();
  });

  it("releases a game-owned keyup even if focus moved to an interactive control", () => {
    const input = new InputController({ now: () => 0 });
    const keyboardTarget = new FakeKeyboardTarget();
    const fixture = bindFixture(input, new FakeInputElement("leftFlipper"), keyboardTarget);

    keyboardTarget.dispatchEvent(createKeyboardEvent("keydown", "KeyZ", "z"));
    input.applyPhysicsStep(1);
    keyboardTarget.interactive = true;
    const keyUp = createKeyboardEvent("keyup", "KeyZ", "z");
    keyboardTarget.dispatchEvent(keyUp);
    expect(keyUp.defaultPrevented).toBe(true);
    input.applyPhysicsStep(2);
    expect(input.state.leftFlipper).toBe(false);
    fixture.controller.abort();
  });

  it("releases pointer and keyboard state on blur and visibility loss", () => {
    const input = new InputController({ now: () => 0 });
    const fixture = bindFixture(input, new FakeInputElement("leftFlipper"));

    fixture.actionElement.dispatchEvent(createPointerEvent("pointerdown", 9));
    fixture.keyboardTarget.dispatchEvent(createKeyboardEvent("keydown", "Space", " "));
    input.applyPhysicsStep(1);
    expect(input.state.leftFlipper).toBe(true);
    expect(input.state.plunger).toBe(true);

    fixture.keyboardTarget.dispatchEvent(new Event("blur"));
    expect(input.state.leftFlipper).toBe(false);
    expect(input.state.plunger).toBe(false);
    expect(input.ownership.size).toBe(0);
    expect(input.queue.size).toBe(0);

    fixture.actionElement.dispatchEvent(createPointerEvent("pointerdown", 10));
    input.applyPhysicsStep(2);
    fixture.visibilityTarget.hidden = true;
    fixture.visibilityTarget.dispatchEvent(new Event("visibilitychange"));
    expect(input.state.leftFlipper).toBe(false);
    expect(input.ownership.size).toBe(0);
    expect(input.queue.size).toBe(0);
    fixture.controller.abort();
  });

  it("releases state and removes listeners when aborted", () => {
    const input = new InputController({ now: () => 0 });
    const fixture = bindFixture(input, new FakeInputElement("plunger"));

    fixture.keyboardTarget.dispatchEvent(createKeyboardEvent("keydown", "Space", " "));
    input.applyPhysicsStep(1);
    expect(input.state.plunger).toBe(true);
    fixture.controller.abort();
    expect(input.state.plunger).toBe(false);
    expect(input.queue.size).toBe(0);

    fixture.keyboardTarget.dispatchEvent(createKeyboardEvent("keydown", "Space", " "));
    expect(input.queue.size).toBe(0);
  });
});
