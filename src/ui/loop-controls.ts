export interface LoopControlBindings {
  button: EventTarget;
  keyboardTarget: EventTarget;
  onToggle: () => void;
  controller?: AbortController;
}

interface InteractiveTarget extends EventTarget {
  closest?: (selectors: string) => EventTarget | null;
  matches?: (selectors: string) => boolean;
}

const INTERACTIVE_SELECTOR =
  "input, textarea, select, button, a[href], summary, audio[controls], video[controls], " +
  "[contenteditable]:not([contenteditable='false']), [role='textbox'], [role='button'], " +
  "[role='switch'], [role='checkbox'], [role='radio'], [role='slider'], [role='spinbutton'], " +
  "[role='combobox'], [role='option'], [role='menuitem']";

function isEditableOrInteractiveTarget(target: EventTarget | null): boolean {
  if (!target) {
    return false;
  }

  const candidate = target as InteractiveTarget;
  if (typeof candidate.closest === "function") {
    return candidate.closest(INTERACTIVE_SELECTOR) !== null;
  }
  return typeof candidate.matches === "function" && candidate.matches(INTERACTIVE_SELECTOR);
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
    if (
      keyboardEvent.code !== "Space" ||
      keyboardEvent.repeat ||
      isEditableOrInteractiveTarget(keyboardEvent.target)
    ) {
      return;
    }
    keyboardEvent.preventDefault();
    bindings.onToggle();
  }, { signal: controller.signal });

  return controller;
}
