import { PachiSession } from "../src/game/pachi-session";
import type { PachiSessionEvent, PachiSessionSnapshot } from "../src/game/pachi-types";

export const CALIBRATION_SEEDS = Array.from({ length: 64 }, (_, index) => index + 1);
export const CALIBRATION_POWERS = [0.35, 0.5, 0.65, 0.8, 0.95] as const;
const FRAME_MS = 100;
const PLAY_SECONDS = 90;
const MAX_SETTLE_SECONDS = 70;

interface RunMetrics {
  readonly seed: number;
  readonly power: number;
  readonly phase: PachiSessionSnapshot["phase"];
  readonly fired: number;
  readonly starts: number;
  readonly sides: number;
  readonly attackers: number;
  readonly drains: number;
  readonly reclaims: number;
  readonly stuck: number;
  readonly lifetime: number;
  readonly overflow: number;
  readonly jackpots: number;
  readonly wins: number;
  readonly finalScore: number;
  readonly firstStartSeconds: number | null;
  readonly firstJackpotSeconds: number | null;
  readonly settlementSeconds: number;
}

export interface CalibrationSummary {
  readonly runs: readonly RunMetrics[];
  readonly byPower: readonly {
    readonly power: number;
    readonly runs: number;
    readonly resultRuns: number;
    readonly medianFired: number;
    readonly medianStarts: number;
    readonly medianSides: number;
    readonly medianAttackers: number;
    readonly medianJackpots: number;
    readonly medianWins: number;
    readonly medianScore: number;
    readonly medianFirstStartSeconds: number | null;
    readonly medianFirstJackpotSeconds: number | null;
    readonly startPresence: number;
    readonly sidePresence: number;
    readonly attackerPresence: number;
    readonly drainPresence: number;
    readonly stuckRatio: number;
    readonly lifetimeRatio: number;
    readonly overflowRatio: number;
  }[];
  readonly representativePath: {
    readonly seed: number;
    readonly power: number;
    readonly firstStartSeconds: number;
    readonly firstJackpotSeconds: number;
    readonly attackerSeconds: number;
    readonly scoreAfterJackpot: number;
  } | null;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}

function medianNullable(values: readonly (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length === 0 ? null : median(present);
}

function count(events: readonly PachiSessionEvent[], type: PachiSessionEvent["type"]): number {
  return events.filter((event) => event.type === type).length;
}

function runOne(seed: number, power: number): RunMetrics & { readonly events: readonly PachiSessionEvent[] } {
  const session = new PachiSession({ seed, durationSeconds: PLAY_SECONDS });
  session.start();
  session.setPower(power);
  session.setFiring(true);

  // Long hold through the complete 90-second play window. This uses only the
  // public session input API; no ball, ticket, or result is injected.
  for (let elapsed = 0; elapsed < PLAY_SECONDS * 1000; elapsed += FRAME_MS) {
    session.step(FRAME_MS);
  }
  // Let existing balls, four queued tickets, and a possible six-second
  // jackpot finish. The hard cap is deliberately longer than the contract's
  // 60-second settling bound so a failed run is visible in the report.
  for (let elapsed = 0; elapsed < MAX_SETTLE_SECONDS * 1000 && session.snapshot().phase !== "result"; elapsed += 1000) {
    session.step(1000);
  }

  const snapshot = session.snapshot();
  const events = session.drainEvents();
  const reclaims = events.filter((event) => event.type === "reclaimed");
  const starts = events.filter((event) => event.type === "start-entry");
  const jackpots = events.filter((event) => event.type === "jackpot-start");
  const attacker = events.filter((event) => event.type === "attacker-entry");
  const wins = events.filter((event) => event.type === "spin-reveal" && event.win === true);
  const lastPlayingAt = events.find((event) => event.type === "deadline")?.at ?? PLAY_SECONDS;
  const settlementSeconds = Math.max(0, (events.find((event) => event.type === "result")?.at ?? snapshot.timeRemaining) - lastPlayingAt);
  const metrics: RunMetrics = {
    seed,
    power,
    phase: snapshot.phase,
    fired: count(events, "fired"),
    starts: starts.length,
    sides: count(events, "side-entry"),
    attackers: attacker.length,
    drains: count(events, "drain"),
    reclaims: reclaims.length,
    stuck: reclaims.filter((event) => event.reason === "stuck").length,
    lifetime: reclaims.filter((event) => event.reason === "lifetime").length,
    overflow: reclaims.filter((event) => event.reason === "overflow").length,
    jackpots: jackpots.length,
    wins: wins.length,
    finalScore: snapshot.score,
    firstStartSeconds: starts[0]?.at ?? null,
    firstJackpotSeconds: jackpots[0]?.at ?? null,
    settlementSeconds,
  };
  session.destroy();
  return { ...metrics, events };
}

function summarizePower(runs: readonly RunMetrics[], power: number): CalibrationSummary["byPower"][number] {
  const selected = runs.filter((run) => run.power === power);
  const fired = selected.reduce((sum, run) => sum + run.fired, 0);
  const ratio = (value: number): number => (fired === 0 ? 0 : value / fired);
  return {
    power,
    runs: selected.length,
    resultRuns: selected.filter((run) => run.phase === "result").length,
    medianFired: median(selected.map((run) => run.fired)),
    medianStarts: median(selected.map((run) => run.starts)),
    medianSides: median(selected.map((run) => run.sides)),
    medianAttackers: median(selected.map((run) => run.attackers)),
    medianJackpots: median(selected.map((run) => run.jackpots)),
    medianWins: median(selected.map((run) => run.wins)),
    medianScore: median(selected.map((run) => run.finalScore)),
    medianFirstStartSeconds: medianNullable(selected.map((run) => run.firstStartSeconds)),
    medianFirstJackpotSeconds: medianNullable(selected.map((run) => run.firstJackpotSeconds)),
    startPresence: selected.filter((run) => run.starts > 0).length / Math.max(1, selected.length),
    sidePresence: selected.filter((run) => run.sides > 0).length / Math.max(1, selected.length),
    attackerPresence: selected.filter((run) => run.attackers > 0).length / Math.max(1, selected.length),
    drainPresence: selected.filter((run) => run.drains > 0).length / Math.max(1, selected.length),
    stuckRatio: ratio(selected.reduce((sum, run) => sum + run.stuck, 0)),
    lifetimeRatio: ratio(selected.reduce((sum, run) => sum + run.lifetime, 0)),
    overflowRatio: ratio(selected.reduce((sum, run) => sum + run.overflow, 0)),
  };
}

export function simulatePachiCalibration(
  seeds: readonly number[] = CALIBRATION_SEEDS,
  powers: readonly number[] = CALIBRATION_POWERS,
): CalibrationSummary {
  const runsWithEvents: Array<RunMetrics & { readonly events: readonly PachiSessionEvent[] }> = [];
  for (const power of powers) {
    for (const seed of seeds) {
      runsWithEvents.push(runOne(seed, power));
    }
  }
  const runs: RunMetrics[] = runsWithEvents.map(({ events: _events, ...metrics }) => metrics);
  const representative = runs.find(
    (run) =>
      run.firstStartSeconds !== null &&
      run.firstJackpotSeconds !== null &&
      run.attackers > 0,
  );
  const representativeWithEvents = runsWithEvents.find(
    (run) => run.seed === representative?.seed && run.power === representative?.power,
  );
  const representativeEvents = representativeWithEvents?.events ?? [];
  const representativeAttacker = representativeEvents.find((event) => event.type === "attacker-entry");
  const representativeJackpot = representativeEvents.find((event) => event.type === "jackpot-start");
  return {
    runs,
    byPower: powers.map((power) => summarizePower(runs, power)),
    representativePath:
      representative === undefined || representative.firstStartSeconds === null || representative.firstJackpotSeconds === null || representativeJackpot === undefined || representativeAttacker === undefined
        ? null
        : {
          seed: representative.seed,
          power: representative.power,
          firstStartSeconds: representative.firstStartSeconds,
          firstJackpotSeconds: representative.firstJackpotSeconds,
          attackerSeconds: representativeAttacker.at,
          scoreAfterJackpot: representativeJackpot.score ?? 0,
        },
  };
}

/** Formats the compact comparison requested by the redesign review. */
export function formatCalibration(summary: CalibrationSummary): string {
  const rows = summary.byPower.map((row) => ({
    power: row.power,
    resultRuns: `${row.resultRuns}/${row.runs}`,
    fired: row.medianFired,
    starts: row.medianStarts,
    sides: row.medianSides,
    attackers: row.medianAttackers,
    jackpots: row.medianJackpots,
    wins: row.medianWins,
    score: row.medianScore,
    firstStart: row.medianFirstStartSeconds,
    firstJackpot: row.medianFirstJackpotSeconds,
    presence: {
      start: row.startPresence,
      side: row.sidePresence,
      attacker: row.attackerPresence,
      drain: row.drainPresence,
    },
    stuckRatio: row.stuckRatio,
    lifetimeRatio: row.lifetimeRatio,
    overflowRatio: row.overflowRatio,
  }));
  return JSON.stringify({ rows, representativePath: summary.representativePath }, null, 2);
}
