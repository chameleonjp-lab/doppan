import type { InputAction, InputController } from "../input";

export interface PrototypeInputBindings {
  readonly root: HTMLElement;
  readonly keyboardTarget: Window;
  readonly visibilityTarget: Document;
  readonly input: InputController;
  readonly controller?: AbortController;
  readonly onPauseToggle?: () => void;
  readonly onVisibilityChange?: (hidden: boolean) => void;
  readonly onError?: (error: unknown) => void;
}

const KEY_ACTIONS = new Map<string, InputAction>([
  ["KeyZ", "leftFlipper"],
  ["ArrowLeft", "leftFlipper"],
  ["Slash", "rightFlipper"],
  ["ArrowRight", "rightFlipper"],
  ["Space", "plunger"],
  ["z", "leftFlipper"],
  ["Z", "leftFlipper"],
  ["/", "rightFlipper"],
  [" ", "plunger"],
]);

const INTERACTIVE_SELECTOR =
  "input, textarea, select, button, a[href], summary, [contenteditable]:not([contenteditable='false']), " +
  "[role='textbox'], [role='button'], [role='switch'], [role='slider']";

interface InteractiveEventTarget extends EventTarget {
  closest?: (selectors: string) => EventTarget | null;
  matches?: (selectors: string) => boolean;
}

function isInteractive(target: EventTarget | null): boolean {
  if (target === null) {
    return false;
  }
  const candidate = target as InteractiveEventTarget;
  if (typeof candidate.closest === "function") {
    if (candidate.closest(INTERACTIVE_SELECTOR) !== null) {
      return true;
    }
  }
  return typeof candidate.matches === "function" && candidate.matches(INTERACTIVE_SELECTOR);
}

function keyboardSourceId(event: KeyboardEvent): string {
  return event.code || event.key;
}

function keyboardAction(event: KeyboardEvent): InputAction | undefined {
  return KEY_ACTIONS.get(event.code) ?? KEY_ACTIONS.get(event.key);
}

function isEscape(event: KeyboardEvent): boolean {
  return event.code === "Escape" || event.key === "Escape";
}

function actionFromElement(element: Element): InputAction | null {
  const action = element.getAttribute("data-input-action");
  if (
    action === "leftFlipper" ||
    action === "rightFlipper" ||
    action === "plunger" ||
    action === "launcher"
  ) {
    return action;
  }
  return null;
}

/** Owns pointer, keyboard, blur, and visibility subscriptions for G1-B. */
export function bindPrototypeInput(bindings: PrototypeInputBindings): AbortController {
  const controller = bindings.controller ?? new AbortController();
  const reportError = (error: unknown): void => {
    bindings.onError?.(error);
  };

  const releaseOnAbort = (): void => {
    try {
      bindings.input.releaseAll("manual");
    } catch (error: unknown) {
      reportError(error);
    }
  };
  if (controller.signal.aborted) {
    releaseOnAbort();
    return controller;
  }
  controller.signal.addEventListener("abort", releaseOnAbort, { once: true });

  const actionElements: HTMLElement[] = [];
  if (bindings.root.matches("[data-input-action]")) {
    actionElements.push(bindings.root);
  }
  actionElements.push(...bindings.root.querySelectorAll<HTMLElement>("[data-input-action]"));

  for (const element of actionElements) {
    const action = actionFromElement(element);
    if (action === null) {
      continue;
    }
    element.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      try {
        if (bindings.input.pointerDown(event.pointerId, action, event.timeStamp)) {
          try {
            element.setPointerCapture(event.pointerId);
          } catch (error: unknown) {
            try {
              bindings.input.pointerCancel(event.pointerId, event.timeStamp);
            } catch (releaseError: unknown) {
              reportError(releaseError);
            }
            reportError(error);
          }
        }
      } catch (error: unknown) {
        reportError(error);
      }
    }, { signal: controller.signal });
    element.addEventListener("pointerup", (event) => {
      event.preventDefault();
      try {
        bindings.input.pointerUp(event.pointerId, event.timeStamp);
      } catch (error: unknown) {
        reportError(error);
      }
    }, { signal: controller.signal });
    element.addEventListener("pointercancel", (event) => {
      try {
        bindings.input.pointerCancel(event.pointerId, event.timeStamp);
      } catch (error: unknown) {
        reportError(error);
      }
    }, { signal: controller.signal });
    element.addEventListener("lostpointercapture", (event) => {
      try {
        bindings.input.lostPointerCapture(event.pointerId, event.timeStamp);
      } catch (error: unknown) {
        reportError(error);
      }
    }, { signal: controller.signal });
  }

  bindings.keyboardTarget.addEventListener("keydown", (event) => {
    const keyboardEvent = event;
    if (isEscape(keyboardEvent) && !keyboardEvent.repeat && !isInteractive(keyboardEvent.target)) {
      event.preventDefault();
      bindings.onPauseToggle?.();
      return;
    }
    const action = keyboardAction(keyboardEvent);
    if (action === undefined || isInteractive(keyboardEvent.target)) {
      return;
    }
    try {
      const accepted = bindings.input.keyboardDown({
        code: keyboardSourceId(keyboardEvent),
        action,
        repeat: keyboardEvent.repeat,
        receivedAtMs: keyboardEvent.timeStamp,
      });
      if (accepted) {
        event.preventDefault();
      }
    } catch (error: unknown) {
      reportError(error);
    }
  }, { signal: controller.signal });

  bindings.keyboardTarget.addEventListener("keyup", (event) => {
    const keyboardEvent = event;
    const action = keyboardAction(keyboardEvent);
    if (action === undefined) {
      return;
    }
    try {
      const accepted = bindings.input.keyboardUp(
        keyboardSourceId(keyboardEvent),
        keyboardEvent.timeStamp,
      );
      if (accepted) {
        event.preventDefault();
      }
    } catch (error: unknown) {
      reportError(error);
    }
  }, { signal: controller.signal });

  bindings.keyboardTarget.addEventListener("blur", () => {
    try {
      bindings.input.handleBlur();
    } catch (error: unknown) {
      reportError(error);
    }
  }, { signal: controller.signal });

  bindings.visibilityTarget.addEventListener("visibilitychange", () => {
    const hidden = bindings.visibilityTarget.hidden;
    try {
      bindings.input.handleVisibilityChange(hidden);
    } catch (error: unknown) {
      reportError(error);
    }
    try {
      bindings.onVisibilityChange?.(hidden);
    } catch (error: unknown) {
      reportError(error);
    }
  }, { signal: controller.signal });

  return controller;
}
