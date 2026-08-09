export interface LoopControlBindings {
  button: EventTarget;
  keyboardTarget: EventTarget;
  onToggle: () => void;
  controller?: AbortController;
}

/**
 * Owns the boot-screen input subscriptions so HMR disposal can remove them as
 * one unit. Keeping this lifecycle explicit also makes subscription growth
 * testable without a browser renderer.
 */
export function bindLoopControls(bindings: LoopControlBindings): AbortController {
  const controller = bindings.controller ?? new AbortController();

  bindings.button.addEventListener("click", bindings.onToggle, { signal: controller.signal });
  bindings.keyboardTarget.addEventListener("keydown", (event) => {
    const keyboardEvent = event as KeyboardEvent;
    if (keyboardEvent.code !== "Space" || keyboardEvent.repeat) {
      return;
    }
    keyboardEvent.preventDefault();
    bindings.onToggle();
  }, { signal: controller.signal });

  return controller;
}
