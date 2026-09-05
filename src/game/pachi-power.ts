/**
 * The three launch settings exposed by the normal game UI.
 *
 * The board still accepts a continuous 0..1 power for deterministic physics
 * tests and diagnostics.  Player-facing controls use only these calibrated
 * settings so that the nonlinear physical release path does not expose dead
 * regions as apparently valid choices.
 */
export const PACHI_POWER_PRESETS = Object.freeze([0.5, 0.8, 0.95] as const);

export type PachiPowerPresetIndex = 0 | 1 | 2;

export const PACHI_DEFAULT_POWER_INDEX: PachiPowerPresetIndex = 2;
export const PACHI_DEFAULT_POWER = PACHI_POWER_PRESETS[PACHI_DEFAULT_POWER_INDEX];

/** Clamps any UI or URL index to one of the calibrated preset slots. */
export function clampPachiPowerIndex(index: number): PachiPowerPresetIndex {
  if (!Number.isFinite(index)) return PACHI_DEFAULT_POWER_INDEX;
  return Math.min(
    PACHI_POWER_PRESETS.length - 1,
    Math.max(0, Math.trunc(index)),
  ) as PachiPowerPresetIndex;
}

/** Returns the calibrated physical power for a possibly invalid preset index. */
export function pachiPowerForIndex(index: number): (typeof PACHI_POWER_PRESETS)[number] {
  return PACHI_POWER_PRESETS[clampPachiPowerIndex(index)];
}
