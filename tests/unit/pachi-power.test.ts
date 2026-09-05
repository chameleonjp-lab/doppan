import { describe, expect, it } from "vitest";
import {
  PACHI_DEFAULT_POWER,
  PACHI_DEFAULT_POWER_INDEX,
  PACHI_POWER_PRESETS,
  clampPachiPowerIndex,
  pachiPowerForIndex,
} from "../../src/game/pachi-power";

describe("pachi launch presets", () => {
  it("keeps the normal controls to the calibrated settings", () => {
    expect(PACHI_POWER_PRESETS).toEqual([0.5, 0.8, 0.95]);
    expect(PACHI_DEFAULT_POWER_INDEX).toBe(2);
    expect(PACHI_DEFAULT_POWER).toBe(0.95);
  });

  it("clamps invalid preset indexes and returns the actual setting", () => {
    expect(clampPachiPowerIndex(-10)).toBe(0);
    expect(clampPachiPowerIndex(1.9)).toBe(1);
    expect(clampPachiPowerIndex(99)).toBe(2);
    expect(clampPachiPowerIndex(Number.NaN)).toBe(2);
    expect(pachiPowerForIndex(-10)).toBe(0.5);
    expect(pachiPowerForIndex(1.9)).toBe(0.8);
    expect(pachiPowerForIndex(99)).toBe(0.95);
  });
});
