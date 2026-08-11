import {
  normalizeInputAction,
  type CanonicalInputAction,
  type InputAction,
} from "./input-types";

export interface PointerOwnershipRecord {
  readonly pointerId: number;
  readonly action: CanonicalInputAction;
}
/**
 * Bi-directional pointer ownership for the three pointer-driven controls.
 * A pointer and an action can each have at most one owner. Failed claims are
 * side-effect free, so an unneeded third pointer cannot release or replace an
 * existing flipper/plunger owner.
 */
export class InputOwnership {
  private readonly pointerToAction = new Map<number, CanonicalInputAction>();

  private readonly actionToPointer = new Map<CanonicalInputAction, number>();

  public claim(pointerId: number, action: InputAction): boolean {
    validatePointerId(pointerId);
    const canonicalAction = normalizeInputAction(action);
    const existingAction = this.pointerToAction.get(pointerId);
    if (existingAction !== undefined) {
      return false;
    }
    if (this.actionToPointer.has(canonicalAction)) {
      return false;
    }

    this.pointerToAction.set(pointerId, canonicalAction);
    this.actionToPointer.set(canonicalAction, pointerId);
    return true;
  }

  public actionForPointer(pointerId: number): CanonicalInputAction | undefined {
    validatePointerId(pointerId);
    return this.pointerToAction.get(pointerId);
  }

  public pointerForAction(action: InputAction): number | undefined {
    return this.actionToPointer.get(normalizeInputAction(action));
  }

  public owns(pointerId: number, action: InputAction): boolean {
    return this.actionForPointer(pointerId) === normalizeInputAction(action);
  }

  public release(pointerId: number): PointerOwnershipRecord | undefined {
    validatePointerId(pointerId);
    const action = this.pointerToAction.get(pointerId);
    if (action === undefined) {
      return undefined;
    }

    this.pointerToAction.delete(pointerId);
    this.actionToPointer.delete(action);
    return { pointerId, action };
  }

  public releaseAll(): PointerOwnershipRecord[] {
    const records = [...this.pointerToAction.entries()].map(([pointerId, action]) => ({
      pointerId,
      action,
    }));
    this.pointerToAction.clear();
    this.actionToPointer.clear();
    return records;
  }

  public get size(): number {
    return this.pointerToAction.size;
  }

  public snapshot(): readonly PointerOwnershipRecord[] {
    return [...this.pointerToAction.entries()].map(([pointerId, action]) => ({
      pointerId,
      action,
    }));
  }
}

function validatePointerId(pointerId: number): void {
  if (!Number.isSafeInteger(pointerId) || pointerId < 0) {
    throw new RangeError("pointerId must be a non-negative safe integer.");
  }
}
