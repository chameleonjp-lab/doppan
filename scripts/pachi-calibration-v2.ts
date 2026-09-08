import { createHash } from "node:crypto";

import { PachiSession } from "../src/game/pachi-session";
import { PACHI_POWER_PRESETS } from "../src/game/pachi-power";
import {
  PACHI_MAX_PENDING,
  PACHI_MAX_SESSION_SETTLE_SECONDS,
} from "../src/game/pachi-types";
import type {
  PachiScoreParts,
  PachiSessionEvent,
  PachiSessionSnapshot,
} from "../src/game/pachi-types";

export const CALIBRATION_SCHEMA_VERSION = 2 as const;
export const CALIBRATION_VERSION = "pachi-calibration-v1" as const;
export const CALIBRATION_CONTROLLER_TICK_MS = 100 as const;
export const CALIBRATION_PLAY_SECONDS = 90 as const;
export const CALIBRATION_EARLY_STOP_LEAD_SECONDS = 0.6 as const;
export const CALIBRATION_DELAYS = Object.freeze([0, 0.3, 0.6] as const);
export const CALIBRATION_DYNAMIC_POLICIES = Object.freeze([
  "fullPause",
  "bonus50",
  "bonus80",
  "earlyStop",
] as const);
export const CALIBRATION_FIXED_POLICIES = Object.freeze([
  "fixed50",
  "fixed80",
  "fixed95",
] as const);
export const CALIBRATION_POLICIES = Object.freeze([
  ...CALIBRATION_FIXED_POLICIES,
  ...CALIBRATION_DYNAMIC_POLICIES,
] as const);
export const CALIBRATION_GATE_THRESHOLDS = Object.freeze({
  fixed95Within10Seconds: 231,
  fixed95Within30Seconds: 244,
  fixedPresetWithin30Seconds: 244,
  primaryMedianMinPoints: 500,
  primaryMedianMinFraction: 0.05,
  primaryPositiveMinCount: 154,
  primaryIqrMultiplier: 4,
  bootstrapResamples: 10_000,
  positiveWilsonLowerMin: 0.5,
  q10FloorPoints: -500,
  bonusOpenMin: 128,
  bonusSuccessRateMin: 0.8,
} as const);

export type CalibrationCohort = "legacy" | "tuning-v1" | "holdout-v1";
export type CalibrationPolicy = (typeof CALIBRATION_POLICIES)[number];
export type CalibrationDelaySeconds = (typeof CALIBRATION_DELAYS)[number];

const COHORT_COUNTS: Readonly<Record<CalibrationCohort, number>> = Object.freeze({
  legacy: 64,
  "tuning-v1": 256,
  "holdout-v1": 256,
});
const FRAME_MS = CALIBRATION_CONTROLLER_TICK_MS;
const RUN_TIMEOUT_SECONDS = CALIBRATION_PLAY_SECONDS + PACHI_MAX_SESSION_SETTLE_SECONDS + 1;
const EPSILON = 1e-9;

export interface CalibrationCondition {
  readonly policy: CalibrationPolicy;
  readonly delaySeconds: CalibrationDelaySeconds;
  readonly delayApplied: boolean;
}

export interface CalibrationShard {
  readonly index: number;
  readonly count: number;
}

export interface CalibrationCase {
  readonly cohort: CalibrationCohort;
  readonly index: number;
  readonly seed: number;
  readonly condition: CalibrationCondition;
}

export interface SeedCohortManifest {
  readonly count: number;
  readonly seeds: readonly number[];
  readonly checksum: string;
}

export interface CalibrationManifest {
  readonly schemaVersion: typeof CALIBRATION_SCHEMA_VERSION;
  readonly version: typeof CALIBRATION_VERSION;
  readonly controllerTickMs: typeof CALIBRATION_CONTROLLER_TICK_MS;
  readonly playSeconds: typeof CALIBRATION_PLAY_SECONDS;
  readonly settleLimitSeconds: typeof PACHI_MAX_SESSION_SETTLE_SECONDS;
  readonly earlyStopLeadSeconds: typeof CALIBRATION_EARLY_STOP_LEAD_SECONDS;
  readonly cohorts: Readonly<Record<CalibrationCohort, SeedCohortManifest>>;
  readonly tuningConditions: readonly CalibrationCondition[];
  readonly fixedConditions: readonly CalibrationCondition[];
  readonly gateThresholds: typeof CALIBRATION_GATE_THRESHOLDS;
  readonly gameCommit: string;
  readonly seedSetChecksum: string;
  readonly configChecksum: string;
}

export interface CalibrationOpenInterval {
  readonly round: number;
  readonly openedAt: number;
  readonly closedAt: number | null;
  readonly observedAt: number | null;
  readonly actionDueAt: number | null;
  readonly actionAppliedAt: number | null;
  readonly actionCancelledAt: number | null;
  readonly dueOpen: boolean;
  readonly dueBallsRemaining: number | null;
  readonly dueEligible: boolean;
  readonly dueFiring: boolean | null;
  readonly duePower: number | null;
  readonly postOpenFired: number;
  readonly postOpenAttackerHits: number;
  readonly postOpenBallIds: readonly string[];
  readonly postDueFired: number;
  readonly postDueAttackerHits: number;
  readonly postDueBallIds: readonly string[];
  readonly postDueAttackerBallIds: readonly string[];
  readonly firstPostDueAttackerAt: number | null;
  readonly successful: boolean;
}

export interface CalibrationRun {
  readonly schemaVersion: typeof CALIBRATION_SCHEMA_VERSION;
  readonly version: typeof CALIBRATION_VERSION;
  readonly gameCommit: string;
  readonly configChecksum: string;
  readonly seedSetChecksum: string;
  readonly conditionsChecksum: string;
  readonly cohort: CalibrationCohort;
  readonly index: number;
  readonly seed: number;
  readonly policy: CalibrationPolicy;
  readonly delaySeconds: CalibrationDelaySeconds;
  readonly controllerTickMs: typeof CALIBRATION_CONTROLLER_TICK_MS;
  readonly startedAt: number;
  readonly phase: PachiSessionSnapshot["phase"];
  readonly timedOut: boolean;
  readonly deadlineAt: number | null;
  readonly deadlineReason: string | null;
  readonly resultAt: number | null;
  readonly settlementSeconds: number | null;
  readonly finalScore: number;
  readonly scoreParts: PachiScoreParts;
  readonly fired: number;
  readonly firedByPower: Readonly<Record<string, number>>;
  readonly acceptedStarts: number;
  readonly rejectedFull: number;
  readonly rejectedDeadline: number;
  readonly firstAcceptedStartSeconds: number | null;
  readonly completedSpins: number;
  readonly jackpots: number;
  readonly wins: number;
  readonly remainingBalls: number;
  readonly finalPending: number;
  readonly startEntries: number;
  readonly pendingFullNormalSeconds: number;
  readonly pendingFullBonusSeconds: number;
  readonly pendingFullSettlingSeconds: number;
  readonly reclaimedByReason: Readonly<Record<string, number>>;
  readonly firedBallIds: readonly string[];
  readonly firedBallAt: Readonly<Record<string, number>>;
  readonly firedBallPower: Readonly<Record<string, number>>;
  readonly terminalBallAt: Readonly<Record<string, number>>;
  readonly terminalBallTypes: Readonly<Record<string, string>>;
  readonly terminalDelaySeconds: Readonly<Record<string, number>>;
  readonly eventBallIds: Readonly<Record<string, number>>;
  readonly invariantViolations: readonly string[];
  readonly openIntervals: readonly CalibrationOpenInterval[];
  readonly openSuccesses: number;
  readonly postOpenFiredBalls: number;
  readonly postOpenAttackerHits: number;
}

export interface CalibrationReport {
  readonly schemaVersion: typeof CALIBRATION_SCHEMA_VERSION;
  readonly version: typeof CALIBRATION_VERSION;
  readonly manifestChecksum: string;
  readonly gameCommit: string;
  readonly configChecksum: string;
  readonly seedSetChecksum: string;
  readonly conditionsChecksum: string;
  readonly candidateChecksum: string | null;
  readonly cohort: CalibrationCohort;
  readonly shard: CalibrationShard;
  readonly conditions: readonly CalibrationCondition[];
  readonly runs: readonly CalibrationRun[];
}

export interface CalibrationCandidateManifest {
  readonly schemaVersion: typeof CALIBRATION_SCHEMA_VERSION;
  readonly version: typeof CALIBRATION_VERSION;
  readonly kind: "holdout-candidate";
  readonly gameCommit: string;
  readonly configChecksum: string;
  readonly seedSetChecksum: string;
  readonly tuningReportChecksum: string;
  readonly tuningRunChecksum: string;
  readonly primary: CalibrationPolicy;
  readonly secondary: CalibrationPolicy | null;
  readonly conditions: readonly CalibrationCondition[];
  readonly conditionsChecksum: string;
  readonly candidateChecksum: string;
}

interface MutableOpenInterval {
  readonly round: number;
  readonly openedAt: number;
  closedAt: number | null;
  observedAt: number | null;
  actionDueAt: number | null;
  actionAppliedAt: number | null;
  actionCancelledAt: number | null;
  dueOpen: boolean;
  dueBallsRemaining: number | null;
  dueEligible: boolean;
  dueFiring: boolean | null;
  duePower: number | null;
  postOpenFired: number;
  postOpenAttackerHits: number;
  postDueFired: number;
  readonly postDueBallIds: Set<string>;
  readonly postDueAttackerBallIds: Set<string>;
  firstPostDueAttackerAt: number | null;
  readonly postOpenBallIds: Set<string>;
}

interface ControllerCommand {
  readonly power: number;
  readonly firing: boolean;
}

interface PendingCommand {
  readonly dueTick: number;
  readonly dueAt: number;
  readonly command: ControllerCommand;
  readonly open: MutableOpenInterval | null;
}

interface RunCollector {
  readonly firedAt: Map<string, number>;
  readonly firedPowerByBall: Map<string, number>;
  readonly firedByPower: Map<string, number>;
  readonly reclaimedByReason: Map<string, number>;
  readonly openIntervals: MutableOpenInterval[];
  readonly eventBallIds: Map<string, number>;
  readonly terminalAt: Map<string, number>;
  readonly terminalTypes: Map<string, string>;
  readonly invariantViolations: string[];
  currentOpen: MutableOpenInterval | null;
  startedAt: number | null;
  deadlineAt: number | null;
  deadlineReason: string | null;
  resultAt: number | null;
  acceptedStarts: number;
  rejectedFull: number;
  rejectedDeadline: number;
  firstAcceptedStartSeconds: number | null;
  completedSpins: number;
  jackpots: number;
  wins: number;
  startEntries: number;
  pendingFullNormalSeconds: number;
  pendingFullBonusSeconds: number;
  pendingFullSettlingSeconds: number;
}

const isDynamicPolicy = (policy: CalibrationPolicy): boolean =>
  (CALIBRATION_DYNAMIC_POLICIES as readonly string[]).includes(policy);

const powerForPolicy = (policy: CalibrationPolicy): number => {
  switch (policy) {
    case "fixed50":
      return PACHI_POWER_PRESETS[0];
    case "fixed80":
      return PACHI_POWER_PRESETS[1];
    case "fixed95":
    case "fullPause":
    case "bonus50":
    case "bonus80":
    case "earlyStop":
      return PACHI_POWER_PRESETS[2];
  }
};

function assertDelay(delaySeconds: number): asserts delaySeconds is CalibrationDelaySeconds {
  if (!(CALIBRATION_DELAYS as readonly number[]).includes(delaySeconds)) {
    throw new RangeError(`unsupported reaction delay: ${delaySeconds}`);
  }
}

const conditionKey = (condition: Pick<CalibrationCondition, "policy" | "delaySeconds">): string =>
  `${condition.policy}:${condition.delaySeconds.toFixed(1)}`;

const caseKey = (run: Pick<CalibrationRun, "seed" | "policy" | "delaySeconds">): string =>
  `${run.seed}:${run.policy}:${run.delaySeconds.toFixed(1)}`;

/** Stable JSON keeps manifests, shards and merges byte-reproducible. */
export function stableJson(value: unknown): string {
  const canonicalize = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map((item) => canonicalize(item));
    if (input !== null && typeof input === "object") {
      const source = input as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(source)
          .sort()
          .map((key) => [key, canonicalize(source[key])]),
      );
    }
    return input;
  };
  return JSON.stringify(canonicalize(value));
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function seedForCohort(cohort: Exclude<CalibrationCohort, "legacy">, index: number): number {
  if (!Number.isInteger(index) || index < 0 || index >= COHORT_COUNTS[cohort]) {
    throw new RangeError(`invalid ${cohort} index: ${index}`);
  }
  const label = `${CALIBRATION_VERSION}/${cohort}/${index}`;
  const digest = createHash("sha256").update(label, "utf8").digest();
  const seed = digest.readUInt32BE(0);
  if (seed !== 0) return seed;
  return createHash("sha256").update(`${label}/nonzero`, "utf8").digest().readUInt32BE(0) || 1;
}

export function generateCohortSeeds(cohort: CalibrationCohort): readonly number[] {
  if (cohort === "legacy") return Object.freeze(Array.from({ length: COHORT_COUNTS.legacy }, (_, index) => index + 1));
  return Object.freeze(Array.from({ length: COHORT_COUNTS[cohort] }, (_, index) => seedForCohort(cohort, index)));
}

export function seedChecksum(seeds: readonly number[]): string {
  return sha256Hex(stableJson(seeds));
}

const makeCondition = (policy: CalibrationPolicy, delaySeconds: CalibrationDelaySeconds): CalibrationCondition => ({
  policy,
  delaySeconds,
  delayApplied: isDynamicPolicy(policy),
});

export const fixedConditions = (): readonly CalibrationCondition[] =>
  Object.freeze(CALIBRATION_FIXED_POLICIES.map((policy) => makeCondition(policy, 0)));

export const tuningConditions = (): readonly CalibrationCondition[] =>
  Object.freeze([
    ...fixedConditions(),
    ...CALIBRATION_DYNAMIC_POLICIES.flatMap((policy) =>
      CALIBRATION_DELAYS.map((delaySeconds) => makeCondition(policy, delaySeconds))),
  ]);

export function conditionsForCohort(
  cohort: CalibrationCohort,
  candidates: readonly CalibrationPolicy[] = [],
): readonly CalibrationCondition[] {
  if (cohort === "legacy") return fixedConditions();
  if (cohort === "tuning-v1") return tuningConditions();
  if (candidates.length === 0) {
    throw new Error("holdout-v1 requires a fixed candidate policy manifest");
  }
  const unique = [...new Set(candidates)];
  if (unique.some((policy) => !isDynamicPolicy(policy))) {
    throw new Error("holdout candidates must be dynamic policies");
  }
  return Object.freeze([
    ...fixedConditions(),
    ...unique.flatMap((policy) => CALIBRATION_DELAYS.map((delaySeconds) => makeCondition(policy, delaySeconds))),
  ]);
}

export function createCalibrationManifest(gameCommit = "unit-test"): CalibrationManifest {
  if (gameCommit.length === 0 || gameCommit === "unknown" || gameCommit === "uncommitted") throw new Error("gameCommit must be explicit");
  const legacySeeds = generateCohortSeeds("legacy");
  const tuningSeeds = generateCohortSeeds("tuning-v1");
  const holdoutSeeds = generateCohortSeeds("holdout-v1");
  const cohorts = {
    legacy: {
      count: COHORT_COUNTS.legacy,
      seeds: legacySeeds,
      checksum: seedChecksum(legacySeeds),
    },
    "tuning-v1": {
      count: COHORT_COUNTS["tuning-v1"],
      seeds: tuningSeeds,
      checksum: seedChecksum(tuningSeeds),
    },
    "holdout-v1": {
      count: COHORT_COUNTS["holdout-v1"],
      seeds: holdoutSeeds,
      checksum: seedChecksum(holdoutSeeds),
    },
  } as const;
  const seedSetChecksum = sha256Hex(stableJson({ legacy: cohorts.legacy.checksum, tuning: cohorts["tuning-v1"].checksum, holdout: cohorts["holdout-v1"].checksum }));
  const body = {
    schemaVersion: CALIBRATION_SCHEMA_VERSION,
    version: CALIBRATION_VERSION,
    controllerTickMs: CALIBRATION_CONTROLLER_TICK_MS,
    playSeconds: CALIBRATION_PLAY_SECONDS,
    settleLimitSeconds: PACHI_MAX_SESSION_SETTLE_SECONDS,
    earlyStopLeadSeconds: CALIBRATION_EARLY_STOP_LEAD_SECONDS,
    cohorts,
    tuningConditions: tuningConditions(),
    fixedConditions: fixedConditions(),
    gateThresholds: CALIBRATION_GATE_THRESHOLDS,
    gameCommit,
    seedSetChecksum,
  };
  return Object.freeze({ ...body, configChecksum: sha256Hex(stableJson(body)) });
}

export function casesForCohort(
  cohort: CalibrationCohort,
  candidates: readonly CalibrationPolicy[] = [],
): readonly CalibrationCase[] {
  const conditions = conditionsForCohort(cohort, candidates);
  return Object.freeze(
    generateCohortSeeds(cohort).flatMap((seed, index) =>
      conditions.map((condition) => ({ cohort, index, seed, condition }))),
  );
}

export function shardCases(cases: readonly CalibrationCase[], shard: CalibrationShard): readonly CalibrationCase[] {
  if (!Number.isInteger(shard.index) || !Number.isInteger(shard.count) || shard.count < 1 || shard.index < 1 || shard.index > shard.count) {
    throw new RangeError(`invalid shard ${shard.index}/${shard.count}`);
  }
  return Object.freeze(cases.filter((_, index) => index % shard.count === shard.index - 1));
}

function isBonusOpen(snapshot: PachiSessionSnapshot): boolean {
  return snapshot.rushStage === "open" && snapshot.jackpotRemaining > EPSILON;
}

export function commandForPolicy(
  policy: CalibrationPolicy,
  snapshot: PachiSessionSnapshot,
): ControllerCommand {
  const bonusOpen = isBonusOpen(snapshot);
  const playing = snapshot.phase === "playing";
  const normalPower = powerForPolicy(policy);
  if (policy === "fixed50" || policy === "fixed80" || policy === "fixed95") {
    return { power: normalPower, firing: playing || bonusOpen };
  }
  if (policy === "fullPause") {
    return {
      power: PACHI_POWER_PRESETS[2],
      firing: bonusOpen || (playing && snapshot.pending < PACHI_MAX_PENDING),
    };
  }
  if (policy === "bonus50" || policy === "bonus80") {
    return {
      power: bonusOpen ? (policy === "bonus50" ? PACHI_POWER_PRESETS[0] : PACHI_POWER_PRESETS[1]) : PACHI_POWER_PRESETS[2],
      firing: playing || bonusOpen,
    };
  }
  return {
    power: PACHI_POWER_PRESETS[2],
    firing: playing || (bonusOpen && snapshot.jackpotRemaining > CALIBRATION_EARLY_STOP_LEAD_SECONDS),
  };
}

function sameCommand(left: ControllerCommand, right: ControllerCommand): boolean {
  return left.power === right.power && left.firing === right.firing;
}

function powerKey(power: number): string {
  return power.toFixed(2);
}

function createCollector(): RunCollector {
  return {
    firedAt: new Map(),
    firedPowerByBall: new Map(),
    firedByPower: new Map(),
    reclaimedByReason: new Map(),
    openIntervals: [],
    eventBallIds: new Map(),
    terminalAt: new Map(),
    terminalTypes: new Map(),
    invariantViolations: [],
    currentOpen: null,
    startedAt: null,
    deadlineAt: null,
    deadlineReason: null,
    resultAt: null,
    acceptedStarts: 0,
    rejectedFull: 0,
    rejectedDeadline: 0,
    firstAcceptedStartSeconds: null,
    completedSpins: 0,
    jackpots: 0,
    wins: 0,
    startEntries: 0,
    pendingFullNormalSeconds: 0,
    pendingFullBonusSeconds: 0,
    pendingFullSettlingSeconds: 0,
  };
}

function closeOpen(collector: RunCollector, at: number): void {
  const open = collector.currentOpen;
  if (open === null) return;
  open.closedAt = at;
  collector.openIntervals.push(open);
  collector.currentOpen = null;
}

function newOpen(round: number, openedAt: number): MutableOpenInterval {
  return {
    round,
    openedAt,
    closedAt: null,
    observedAt: null,
    actionDueAt: null,
    actionAppliedAt: null,
    actionCancelledAt: null,
    dueOpen: false,
    dueBallsRemaining: null,
    dueEligible: false,
    dueFiring: null,
    duePower: null,
    postOpenFired: 0,
    postOpenAttackerHits: 0,
    postDueFired: 0,
    postDueBallIds: new Set(),
    postDueAttackerBallIds: new Set(),
    firstPostDueAttackerAt: null,
    postOpenBallIds: new Set(),
  };
}

function recordTerminalBall(collector: RunCollector, ballId: string, eventType: string, at: number): void {
  if (!collector.firedAt.has(ballId)) {
    collector.invariantViolations.push(`${eventType}:${ballId}:terminal-before-fired`);
  }
  const previous = collector.eventBallIds.get(ballId) ?? 0;
  if (previous > 0) collector.invariantViolations.push(`${eventType}:${ballId}:duplicate-terminal`);
  collector.eventBallIds.set(ballId, previous + 1);
  if (previous === 0) {
    collector.terminalAt.set(ballId, at);
    collector.terminalTypes.set(ballId, eventType);
  }
}

function consumeEvents(collector: RunCollector, events: readonly PachiSessionEvent[], playSeconds: number, firedPower: number): void {
  for (const event of events) {
    if (event.type === "started") {
      if (collector.startedAt !== null) collector.invariantViolations.push("started:duplicate");
      collector.startedAt = event.at;
    } else if (event.type === "fired" && event.ballId !== undefined) {
      if (collector.firedAt.has(event.ballId)) collector.invariantViolations.push(`fired:${event.ballId}:duplicate`);
      collector.firedAt.set(event.ballId, event.at);
      collector.firedPowerByBall.set(event.ballId, firedPower);
      const key = powerKey(firedPower);
      collector.firedByPower.set(key, (collector.firedByPower.get(key) ?? 0) + 1);
      const open = collector.currentOpen;
      if (open !== null && event.at + EPSILON >= open.openedAt) {
        open.postOpenFired += 1;
        open.postOpenBallIds.add(event.ballId);
      }
      if (open !== null && open.actionDueAt !== null && event.at + EPSILON >= open.actionDueAt) {
        if (!open.postDueBallIds.has(event.ballId)) {
          open.postDueFired += 1;
          open.postDueBallIds.add(event.ballId);
        }
      }
    } else if (event.type === "start-entry") {
      if (event.ballId !== undefined) recordTerminalBall(collector, event.ballId, event.type, event.at);
      collector.startEntries += 1;
      if (event.accepted === true) {
        collector.acceptedStarts += 1;
        if (collector.firstAcceptedStartSeconds === null) collector.firstAcceptedStartSeconds = event.at;
      } else if ((collector.deadlineAt !== null && event.at + EPSILON >= collector.deadlineAt) || event.at + EPSILON >= playSeconds) {
        collector.rejectedDeadline += 1;
      } else {
        collector.rejectedFull += 1;
      }
    } else if (event.type === "side-entry") {
      if (event.ballId !== undefined) recordTerminalBall(collector, event.ballId, event.type, event.at);
    } else if (event.type === "drain") {
      if (event.ballId !== undefined) recordTerminalBall(collector, event.ballId, event.type, event.at);
    } else if (event.type === "reclaimed" && event.reason !== undefined) {
      if (event.ballId !== undefined) recordTerminalBall(collector, event.ballId, event.type, event.at);
      collector.reclaimedByReason.set(event.reason, (collector.reclaimedByReason.get(event.reason) ?? 0) + 1);
    } else if (event.type === "deadline") {
      if (collector.deadlineAt === null) collector.deadlineAt = event.at;
      collector.deadlineReason = event.reason ?? "time";
    } else if (event.type === "result") {
      collector.resultAt = event.at;
    } else if (event.type === "spin-reveal") {
      collector.completedSpins += 1;
      if (event.win === true) collector.wins += 1;
    } else if (event.type === "jackpot-start") {
      collector.jackpots += 1;
      if (event.opened === true) {
        closeOpen(collector, event.at);
        collector.currentOpen = newOpen(event.rushRound ?? 1, event.at);
      }
    } else if (event.type === "rush-continue") {
      closeOpen(collector, event.at);
      collector.currentOpen = newOpen(event.rushRound ?? 1, event.at);
    } else if (event.type === "jackpot-end") {
      closeOpen(collector, event.at);
    } else if (event.type === "attacker-entry" && event.ballId !== undefined) {
      recordTerminalBall(collector, event.ballId, event.type, event.at);
      const open = collector.currentOpen;
      const firedAt = collector.firedAt.get(event.ballId);
      if (open !== null && firedAt !== undefined && firedAt + EPSILON >= open.openedAt) {
        open.postOpenAttackerHits += 1;
        if (open.actionDueAt !== null && firedAt + EPSILON >= open.actionDueAt && open.postDueBallIds.has(event.ballId) && !open.postDueAttackerBallIds.has(event.ballId)) {
          open.postDueAttackerBallIds.add(event.ballId);
          open.postOpenAttackerHits = Math.max(0, open.postOpenAttackerHits);
          if (open.firstPostDueAttackerAt === null) open.firstPostDueAttackerAt = event.at;
        }
      }
    }
  }
}

function sortedRecord(source: Map<string, number>): Readonly<Record<string, number>> {
  return Object.fromEntries([...source.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function intervalOutput(interval: MutableOpenInterval): CalibrationOpenInterval {
  return {
    round: interval.round,
    openedAt: interval.openedAt,
    closedAt: interval.closedAt,
    observedAt: interval.observedAt,
    actionDueAt: interval.actionDueAt,
    actionAppliedAt: interval.actionAppliedAt,
    actionCancelledAt: interval.actionCancelledAt,
    dueOpen: interval.dueOpen,
    dueBallsRemaining: interval.dueBallsRemaining,
    dueEligible: interval.dueEligible,
    dueFiring: interval.dueFiring,
    duePower: interval.duePower,
    postOpenFired: interval.postOpenFired,
    postOpenAttackerHits: interval.postOpenAttackerHits,
    postOpenBallIds: [...interval.postOpenBallIds],
    postDueFired: interval.postDueFired,
    postDueAttackerHits: interval.postDueAttackerBallIds.size,
    postDueBallIds: [...interval.postDueBallIds],
    postDueAttackerBallIds: [...interval.postDueAttackerBallIds],
    firstPostDueAttackerAt: interval.firstPostDueAttackerAt,
    successful: interval.dueEligible && interval.postDueAttackerBallIds.size > 0,
  };
}

function markActionDue(interval: MutableOpenInterval, snapshot: PachiSessionSnapshot, at: number, command: ControllerCommand): void {
  if (interval.actionDueAt !== null) return;
  interval.actionDueAt = at;
  interval.dueOpen = isBonusOpen(snapshot);
  interval.dueBallsRemaining = snapshot.ballsRemaining;
  interval.dueFiring = command.firing;
  interval.dueEligible = interval.dueOpen && snapshot.ballsRemaining > 0 && command.firing;
  interval.duePower = command.power;
}

function markActionCancelled(interval: MutableOpenInterval, at: number): void {
  if (interval.actionDueAt === null && interval.actionCancelledAt === null) interval.actionCancelledAt = at;
}

function observeSnapshot(collector: RunCollector, snapshot: PachiSessionSnapshot, deltaSeconds: number, at: number): void {
  const open = collector.currentOpen;
  if (open !== null && open.observedAt === null) open.observedAt = at;
  if (snapshot.pending < PACHI_MAX_PENDING) return;
  if (snapshot.phase === "playing" && !isBonusOpen(snapshot)) {
    collector.pendingFullNormalSeconds += deltaSeconds;
  } else if (isBonusOpen(snapshot)) {
    collector.pendingFullBonusSeconds += deltaSeconds;
  } else if (snapshot.phase === "settling") {
    collector.pendingFullSettlingSeconds += deltaSeconds;
  }
}

export function simulateCalibrationRun(
  input: CalibrationCase,
  manifest = createCalibrationManifest(),
  conditionsChecksum = sha256Hex(stableJson([input.condition])),
): CalibrationRun {
  const { cohort, index, seed, condition } = input;
  assertDelay(condition.delaySeconds);
  const session = new PachiSession({ seed, durationSeconds: CALIBRATION_PLAY_SECONDS });
  const collector = createCollector();
  const initialPower = powerForPolicy(condition.policy);
  let currentCommand: ControllerCommand = { power: initialPower, firing: true };
  let pendingCommand: PendingCommand | null = null;
  let boundaryTick = 0;
  const delayTicks = Math.round(condition.delaySeconds * 1000 / CALIBRATION_CONTROLLER_TICK_MS);
  const apply = (command: ControllerCommand): void => {
    session.setPower(command.power);
    session.setFiring(command.firing);
    currentCommand = command;
  };
  const schedule = (desired: ControllerCommand, snapshot: PachiSessionSnapshot): void => {
    const observationAt = boundaryTick * FRAME_MS / 1000;
    const open = collector.currentOpen;
    if (open !== null && open.observedAt === null) open.observedAt = observationAt;
    if (pendingCommand !== null && pendingCommand.open !== open) {
      if (pendingCommand.open !== null) markActionCancelled(pendingCommand.open, observationAt);
      pendingCommand = null;
    }
    const effective = pendingCommand?.command ?? currentCommand;
    const actualMatches = snapshot.power === desired.power && snapshot.firing === desired.firing;
    const hasPendingForOpen = pendingCommand !== null && pendingCommand.open === open;
    const needsOpenDue = open !== null && open.actionDueAt === null && open.actionCancelledAt === null && !hasPendingForOpen;
    if (!needsOpenDue && sameCommand(desired, effective) && (pendingCommand !== null || actualMatches)) return;
    if (delayTicks === 0) {
      if (open !== null) markActionDue(open, snapshot, observationAt, desired);
      pendingCommand = null;
      apply(desired);
      if (open !== null && open.actionAppliedAt === null) open.actionAppliedAt = observationAt;
      return;
    }
    if (pendingCommand?.open !== null && pendingCommand?.open !== undefined && !sameCommand(desired, pendingCommand.command)) {
      markActionCancelled(pendingCommand.open, observationAt);
      pendingCommand = {
        dueTick: boundaryTick + delayTicks,
        dueAt: observationAt + condition.delaySeconds,
        command: desired,
        open: null,
      };
      return;
    }
    pendingCommand = {
      dueTick: boundaryTick + delayTicks,
      dueAt: observationAt + condition.delaySeconds,
      command: desired,
      open,
    };
  };

  try {
    session.start();
    apply(currentCommand);
    consumeEvents(collector, session.drainEvents(), CALIBRATION_PLAY_SECONDS, currentCommand.power);
    const maxTicks = Math.ceil(RUN_TIMEOUT_SECONDS * 1000 / FRAME_MS) + 2;
    let timedOut = false;
    for (let step = 0; step < maxTicks && session.snapshot().phase !== "result"; step += 1) {
      const dueTick = (pendingCommand as PendingCommand | null)?.dueTick;
      if (dueTick !== undefined && dueTick <= boundaryTick) {
        const pending = pendingCommand as unknown as PendingCommand;
        const dueSnapshot = session.snapshot();
        pendingCommand = null;
        if (pending.open !== null) {
          markActionDue(pending.open, dueSnapshot, pending.dueAt, pending.command);
          if (pending.open.actionAppliedAt === null) pending.open.actionAppliedAt = pending.dueAt;
        }
        apply(pending.command);
      }
      session.step(FRAME_MS);
      boundaryTick += 1;
      const snapshot = session.snapshot();
      consumeEvents(collector, session.drainEvents(), CALIBRATION_PLAY_SECONDS, snapshot.power);
      observeSnapshot(collector, snapshot, FRAME_MS / 1000, boundaryTick * FRAME_MS / 1000);
      if (snapshot.phase === "result") break;
      schedule(commandForPolicy(condition.policy, snapshot), snapshot);
      if (step === maxTicks - 1) timedOut = true;
    }
    if (session.snapshot().phase !== "result") timedOut = true;
    if (collector.currentOpen !== null) closeOpen(collector, collector.resultAt ?? RUN_TIMEOUT_SECONDS);
    const snapshot = session.snapshot();
    const openIntervals = collector.openIntervals.map(intervalOutput);
    const resultAt = collector.resultAt;
    const deadlineAt = collector.deadlineAt;
    return {
      schemaVersion: CALIBRATION_SCHEMA_VERSION,
      version: CALIBRATION_VERSION,
      gameCommit: manifest.gameCommit,
      configChecksum: manifest.configChecksum,
      seedSetChecksum: manifest.seedSetChecksum,
      conditionsChecksum,
      cohort,
      index,
      seed,
      policy: condition.policy,
      delaySeconds: condition.delaySeconds,
      controllerTickMs: CALIBRATION_CONTROLLER_TICK_MS,
      startedAt: collector.startedAt ?? 0,
      phase: snapshot.phase,
      timedOut,
      deadlineAt,
      deadlineReason: collector.deadlineReason,
      resultAt,
      settlementSeconds: resultAt === null || deadlineAt === null ? null : Math.max(0, resultAt - deadlineAt),
      finalScore: snapshot.score,
      scoreParts: { ...snapshot.scoreParts },
      fired: collector.firedAt.size,
      firedByPower: sortedRecord(collector.firedByPower),
      acceptedStarts: collector.acceptedStarts,
      rejectedFull: collector.rejectedFull,
      rejectedDeadline: collector.rejectedDeadline,
      firstAcceptedStartSeconds: collector.firstAcceptedStartSeconds,
      completedSpins: snapshot.stats.completedSpins,
      jackpots: collector.jackpots,
      wins: collector.wins,
      remainingBalls: snapshot.ballsRemaining,
      finalPending: snapshot.pending,
      startEntries: collector.startEntries,
      pendingFullNormalSeconds: collector.pendingFullNormalSeconds,
      pendingFullBonusSeconds: collector.pendingFullBonusSeconds,
      pendingFullSettlingSeconds: collector.pendingFullSettlingSeconds,
      reclaimedByReason: sortedRecord(collector.reclaimedByReason),
      firedBallIds: [...collector.firedAt.keys()],
      firedBallAt: sortedRecord(collector.firedAt),
      firedBallPower: sortedRecord(collector.firedPowerByBall),
      terminalBallAt: sortedRecord(collector.terminalAt),
      terminalBallTypes: Object.fromEntries([...collector.terminalTypes.entries()].sort(([left], [right]) => left.localeCompare(right))),
      terminalDelaySeconds: sortedRecord(new Map([...collector.terminalAt.entries()].map(([ballId, terminalAt]) => [ballId, terminalAt - (collector.firedAt.get(ballId) ?? terminalAt)]))),
      eventBallIds: sortedRecord(collector.eventBallIds),
      invariantViolations: [...collector.invariantViolations],
      openIntervals,
      openSuccesses: openIntervals.filter((interval) => interval.successful).length,
      postOpenFiredBalls: openIntervals.reduce((sum, interval) => sum + interval.postOpenFired, 0),
      postOpenAttackerHits: openIntervals.reduce((sum, interval) => sum + interval.postOpenAttackerHits, 0),
    };
  } finally {
    session.destroy();
  }
}

export interface RunShardOptions {
  readonly cohort: CalibrationCohort;
  readonly shard: CalibrationShard;
  readonly gameCommit: string;
  readonly candidateManifest?: CalibrationCandidateManifest;
}

export function runCalibrationShard(options: RunShardOptions): CalibrationReport {
  const manifest = createCalibrationManifest(options.gameCommit);
  let candidateChecksum: string | null = null;
  let candidates: readonly CalibrationPolicy[] = [];
  if (options.cohort === "holdout-v1") {
    if (options.candidateManifest === undefined) {
      throw new Error("holdout-v1 requires a candidate manifest");
    }
    validateCandidateManifest(options.candidateManifest, manifest);
    candidates = [options.candidateManifest.primary, ...(options.candidateManifest.secondary === null ? [] : [options.candidateManifest.secondary])];
    candidateChecksum = options.candidateManifest.candidateChecksum;
  } else if (options.candidateManifest !== undefined) {
    throw new Error("candidate manifest is only valid for holdout-v1");
  }
  const conditions = conditionsForCohort(options.cohort, candidates);
  const conditionsChecksum = sha256Hex(stableJson(conditions));
  const cases = shardCases(casesForCohort(options.cohort, candidates), options.shard);
  const runs = cases.map((input) => simulateCalibrationRun(input, manifest, conditionsChecksum));
  const conditionsByKey = new Map(conditions.map((condition) => [conditionKey(condition), condition]));
  for (const run of runs) {
    const expectedCondition = conditionsByKey.get(conditionKey(run));
    if (expectedCondition === undefined) throw new Error(`calibration generated an unknown condition: ${caseKey(run)}`);
    validateCalibrationRun(run, manifest, expectedCondition);
  }
  return {
    schemaVersion: CALIBRATION_SCHEMA_VERSION,
    version: CALIBRATION_VERSION,
    manifestChecksum: manifest.configChecksum,
    gameCommit: manifest.gameCommit,
    configChecksum: manifest.configChecksum,
    seedSetChecksum: manifest.seedSetChecksum,
    conditionsChecksum,
    candidateChecksum,
    cohort: options.cohort,
    shard: options.shard,
    conditions,
    runs,
  };
}

function validateConditions(left: readonly CalibrationCondition[], right: readonly CalibrationCondition[]): void {
  if (stableJson(left) !== stableJson(right)) throw new Error("calibration condition manifest mismatch");
}

function finiteNumber(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new Error(`calibration invariant: ${label} is not finite`);
}

export function validateCalibrationRun(
  run: CalibrationRun,
  manifest: CalibrationManifest,
  expectedCondition: CalibrationCondition,
): void {
  if (run.schemaVersion !== CALIBRATION_SCHEMA_VERSION || run.version !== CALIBRATION_VERSION) {
    throw new Error(`calibration run schema mismatch: ${caseKey(run)}`);
  }
  if (run.gameCommit !== manifest.gameCommit || run.configChecksum !== manifest.configChecksum || run.seedSetChecksum !== manifest.seedSetChecksum) {
    throw new Error(`calibration run manifest mismatch: ${caseKey(run)}`);
  }
  if (run.policy !== expectedCondition.policy || run.delaySeconds !== expectedCondition.delaySeconds || run.controllerTickMs !== CALIBRATION_CONTROLLER_TICK_MS) {
    throw new Error(`calibration run condition mismatch: ${caseKey(run)}`);
  }
  const expectedSeed = generateCohortSeeds(run.cohort)[run.index];
  if (expectedSeed !== run.seed) throw new Error(`calibration run seed mismatch: ${caseKey(run)}`);
  const scalarNumbers: Readonly<Record<string, number>> = {
    seed: run.seed,
    index: run.index,
    delaySeconds: run.delaySeconds,
    startedAt: run.startedAt,
    finalScore: run.finalScore,
    fired: run.fired,
    acceptedStarts: run.acceptedStarts,
    rejectedFull: run.rejectedFull,
    rejectedDeadline: run.rejectedDeadline,
    completedSpins: run.completedSpins,
    jackpots: run.jackpots,
    wins: run.wins,
    remainingBalls: run.remainingBalls,
    finalPending: run.finalPending,
    startEntries: run.startEntries,
    pendingFullNormalSeconds: run.pendingFullNormalSeconds,
    pendingFullBonusSeconds: run.pendingFullBonusSeconds,
    pendingFullSettlingSeconds: run.pendingFullSettlingSeconds,
    openSuccesses: run.openSuccesses,
    postOpenFiredBalls: run.postOpenFiredBalls,
    postOpenAttackerHits: run.postOpenAttackerHits,
  };
  for (const [label, value] of Object.entries(scalarNumbers)) finiteNumber(value, label);
  if (run.startedAt < -EPSILON) throw new Error(`calibration start time invalid: ${caseKey(run)}`);
  for (const [label, value] of Object.entries({ fired: run.fired, acceptedStarts: run.acceptedStarts, rejectedFull: run.rejectedFull, rejectedDeadline: run.rejectedDeadline, startEntries: run.startEntries, completedSpins: run.completedSpins, jackpots: run.jackpots, wins: run.wins, remainingBalls: run.remainingBalls, finalPending: run.finalPending, openSuccesses: run.openSuccesses, postOpenFiredBalls: run.postOpenFiredBalls, postOpenAttackerHits: run.postOpenAttackerHits })) {
    if (!Number.isInteger(value) || value < 0) throw new Error(`calibration counter invalid: ${caseKey(run)} ${label}`);
  }
  for (const [label, value] of Object.entries({ pendingFullNormalSeconds: run.pendingFullNormalSeconds, pendingFullBonusSeconds: run.pendingFullBonusSeconds, pendingFullSettlingSeconds: run.pendingFullSettlingSeconds })) {
    if (value < -EPSILON) throw new Error(`calibration pending duration invalid: ${caseKey(run)} ${label}`);
  }
  for (const [label, value] of Object.entries(run.scoreParts) as Array<[keyof PachiScoreParts, number]>) finiteNumber(value, `scoreParts.${label}`);
  if (run.deadlineAt !== null) finiteNumber(run.deadlineAt, "deadlineAt");
  if (run.resultAt !== null) finiteNumber(run.resultAt, "resultAt");
  if (run.settlementSeconds !== null) finiteNumber(run.settlementSeconds, "settlementSeconds");
  if (run.firstAcceptedStartSeconds !== null) finiteNumber(run.firstAcceptedStartSeconds, "firstAcceptedStartSeconds");
  if (run.phase !== "result" || run.timedOut || run.deadlineAt === null || run.resultAt === null) {
    throw new Error(`calibration run did not reach a settled result: ${caseKey(run)}`);
  }
  if (run.deadlineAt < -EPSILON || run.deadlineAt > CALIBRATION_PLAY_SECONDS + EPSILON || run.resultAt < run.deadlineAt - EPSILON) {
    throw new Error(`calibration run deadline/result order invalid: ${caseKey(run)}`);
  }
  if (run.deadlineReason !== "time" && run.deadlineReason !== "balls-exhausted") throw new Error(`calibration deadline reason invalid: ${caseKey(run)}`);
  if (run.deadlineReason === "time" && Math.abs(run.deadlineAt - CALIBRATION_PLAY_SECONDS) > 1 / 120 + EPSILON) throw new Error(`calibration time deadline drift: ${caseKey(run)}`);
  if (run.settlementSeconds === null || Math.abs(run.settlementSeconds - (run.resultAt - run.deadlineAt)) > EPSILON) throw new Error(`calibration settlement accounting mismatch: ${caseKey(run)}`);
  if (run.settlementSeconds === null || run.settlementSeconds > PACHI_MAX_SESSION_SETTLE_SECONDS + 1 / 120 + EPSILON) {
    throw new Error(`calibration run settlement limit exceeded: ${caseKey(run)}`);
  }
  const scorePartSum = (Object.values(run.scoreParts) as number[]).reduce((sum, value) => sum + value, 0);
  if (Math.abs(scorePartSum - run.finalScore) > EPSILON) throw new Error(`calibration score parts mismatch: ${caseKey(run)}`);
  if (run.startEntries !== run.acceptedStarts + run.rejectedFull + run.rejectedDeadline) {
    throw new Error(`calibration start-entry accounting mismatch: ${caseKey(run)}`);
  }
  const firedByPowerTotal = Object.values(run.firedByPower).reduce((sum, value) => sum + value, 0);
  if (Object.values(run.firedByPower).some((value) => !Number.isInteger(value) || value < 0)) throw new Error(`calibration fired-power counter invalid: ${caseKey(run)}`);
  if (firedByPowerTotal !== run.fired) throw new Error(`calibration fired-power accounting mismatch: ${caseKey(run)}`);
  const terminalTotal = Object.values(run.eventBallIds).reduce((sum, value) => sum + value, 0);
  if (run.firedBallIds.length !== run.fired || new Set(run.firedBallIds).size !== run.fired) {
    throw new Error(`calibration fired ball-id accounting mismatch: ${caseKey(run)}`);
  }
  const firedIdSet = new Set(run.firedBallIds);
  if (Object.keys(run.firedBallAt).length !== run.fired || Object.keys(run.firedBallPower).length !== run.fired || [...firedIdSet].some((ballId) => run.firedBallAt[ballId] === undefined || run.firedBallPower[ballId] === undefined)) {
    throw new Error(`calibration fired event correlation mismatch: ${caseKey(run)}`);
  }
  for (const [ballId, firedAt] of Object.entries(run.firedBallAt)) {
    finiteNumber(firedAt, `firedBallAt.${ballId}`);
    const power = run.firedBallPower[ballId];
    if (power === undefined) throw new Error(`calibration fired power correlation missing: ${caseKey(run)}`);
    finiteNumber(power, `firedBallPower.${ballId}`);
  }
  const powerCounts = new Map<string, number>();
  for (const power of Object.values(run.firedBallPower)) {
    const key = power.toFixed(2);
    powerCounts.set(key, (powerCounts.get(key) ?? 0) + 1);
  }
  if (stableJson(sortedRecord(powerCounts)) !== stableJson(run.firedByPower)) throw new Error(`calibration fired power totals mismatch: ${caseKey(run)}`);
  if (Object.keys(run.eventBallIds).some((ballId) => !run.firedBallIds.includes(ballId))) {
    throw new Error(`calibration terminal ball-id correlation mismatch: ${caseKey(run)}`);
  }
  if (Object.keys(run.terminalBallAt).length !== terminalTotal || Object.keys(run.terminalBallTypes).length !== terminalTotal || Object.keys(run.terminalDelaySeconds).length !== terminalTotal) {
    throw new Error(`calibration terminal timing correlation mismatch: ${caseKey(run)}`);
  }
  for (const [ballId, terminalAt] of Object.entries(run.terminalBallAt)) {
    finiteNumber(terminalAt, `terminalBallAt.${ballId}`);
    const firedAt = run.firedBallAt[ballId];
    const delay = run.terminalDelaySeconds[ballId];
    const terminalType = run.terminalBallTypes[ballId];
    if (firedAt === undefined || delay === undefined || terminalType === undefined || !["start-entry", "side-entry", "attacker-entry", "drain", "reclaimed"].includes(terminalType) || terminalAt < firedAt - EPSILON || Math.abs(delay - (terminalAt - firedAt)) > EPSILON) {
      throw new Error(`calibration fired-terminal timing mismatch: ${caseKey(run)}`);
    }
  }
  if (terminalTotal !== run.fired || Object.values(run.eventBallIds).some((count) => count !== 1)) {
    throw new Error(`calibration ball-id accounting mismatch: ${caseKey(run)}`);
  }
  if (run.invariantViolations.length > 0) throw new Error(`calibration invariant violation: ${caseKey(run)} ${run.invariantViolations[0]}`);
  for (const interval of run.openIntervals) {
    const intervalNumbers: Readonly<Record<string, number>> = {
      round: interval.round,
      openedAt: interval.openedAt,
      postOpenFired: interval.postOpenFired,
      postOpenAttackerHits: interval.postOpenAttackerHits,
      postDueFired: interval.postDueFired,
      postDueAttackerHits: interval.postDueAttackerHits,
    };
    for (const [label, value] of Object.entries(intervalNumbers)) finiteNumber(value, `openIntervals.${label}`);
    for (const [label, value] of Object.entries({ postOpenFired: interval.postOpenFired, postOpenAttackerHits: interval.postOpenAttackerHits, postDueFired: interval.postDueFired, postDueAttackerHits: interval.postDueAttackerHits })) {
      if (!Number.isInteger(value) || value < 0) throw new Error(`calibration open counter invalid: ${caseKey(run)} ${label}`);
    }
    for (const [label, value] of [["closedAt", interval.closedAt], ["observedAt", interval.observedAt], ["actionDueAt", interval.actionDueAt], ["actionAppliedAt", interval.actionAppliedAt], ["actionCancelledAt", interval.actionCancelledAt], ["dueBallsRemaining", interval.dueBallsRemaining], ["duePower", interval.duePower], ["firstPostDueAttackerAt", interval.firstPostDueAttackerAt]] as const) {
      if (value !== null) finiteNumber(value, `openIntervals.${label}`);
    }
    if (interval.closedAt !== null && interval.closedAt < interval.openedAt - EPSILON) throw new Error(`calibration open interval order invalid: ${caseKey(run)}`);
    if (interval.closedAt !== null && interval.closedAt > run.resultAt + EPSILON) throw new Error(`calibration open interval after result: ${caseKey(run)}`);
    if (interval.observedAt !== null && interval.observedAt < interval.openedAt - EPSILON) throw new Error(`calibration observation before open: ${caseKey(run)}`);
    if (interval.actionDueAt !== null && interval.actionDueAt < interval.openedAt - EPSILON) throw new Error(`calibration action due before open: ${caseKey(run)}`);
    if (interval.actionDueAt !== null && interval.closedAt !== null && interval.actionDueAt > interval.closedAt + EPSILON) throw new Error(`calibration action due after close: ${caseKey(run)}`);
    if (interval.actionAppliedAt !== null && interval.actionDueAt !== null && interval.actionAppliedAt < interval.actionDueAt - EPSILON) throw new Error(`calibration action applied before due: ${caseKey(run)}`);
    if (interval.actionCancelledAt !== null && interval.actionDueAt !== null && interval.actionCancelledAt >= interval.actionDueAt - EPSILON) throw new Error(`calibration action cancellation after due: ${caseKey(run)}`);
    if (interval.actionCancelledAt !== null && interval.actionAppliedAt !== null) throw new Error(`calibration action cancelled and applied: ${caseKey(run)}`);
    if (interval.actionCancelledAt !== null && interval.closedAt !== null && interval.actionCancelledAt > interval.closedAt + EPSILON) throw new Error(`calibration action cancellation after close: ${caseKey(run)}`);
    if (interval.firstPostDueAttackerAt !== null && interval.closedAt !== null && interval.firstPostDueAttackerAt > interval.closedAt + EPSILON) throw new Error(`calibration attacker after close: ${caseKey(run)}`);
    if (interval.actionDueAt !== null && interval.observedAt !== null && Math.abs((interval.actionDueAt - interval.observedAt) - run.delaySeconds) > 1e-6) throw new Error(`calibration action delay mismatch: ${caseKey(run)}`);
    if (interval.postOpenFired !== interval.postOpenBallIds.length || new Set(interval.postOpenBallIds).size !== interval.postOpenBallIds.length || interval.postOpenBallIds.some((ballId) => {
      const firedAt = run.firedBallAt[ballId];
      return firedAt === undefined || firedAt < interval.openedAt - EPSILON;
    })) throw new Error(`calibration post-open ball accounting mismatch: ${caseKey(run)}`);
    if (interval.postDueFired !== interval.postDueBallIds.length || new Set(interval.postDueBallIds).size !== interval.postDueBallIds.length) throw new Error(`calibration post-due ball accounting mismatch: ${caseKey(run)}`);
    const actionDueAt = interval.actionDueAt;
    if (actionDueAt === null) {
      if (interval.actionAppliedAt !== null || interval.dueOpen || interval.dueBallsRemaining !== null || interval.dueEligible || interval.dueFiring !== null || interval.duePower !== null || interval.postDueBallIds.length > 0 || interval.postDueAttackerBallIds.length > 0) throw new Error(`calibration missing due state is inconsistent: ${caseKey(run)}`);
    } else {
      if (interval.observedAt === null || interval.actionAppliedAt === null || interval.dueBallsRemaining === null || interval.dueFiring === null || interval.duePower === null || interval.actionCancelledAt !== null) throw new Error(`calibration due state is incomplete: ${caseKey(run)}`);
      if (interval.dueEligible !== (interval.dueOpen && interval.dueBallsRemaining > 0 && interval.dueFiring)) throw new Error(`calibration due eligibility mismatch: ${caseKey(run)}`);
    }
    if (actionDueAt !== null && interval.postDueBallIds.some((ballId) => (run.firedBallAt[ballId] ?? Number.NEGATIVE_INFINITY) < actionDueAt - EPSILON)) throw new Error(`calibration post-due fired timing mismatch: ${caseKey(run)}`);
    if (interval.postDueAttackerHits !== interval.postDueAttackerBallIds.length || new Set(interval.postDueAttackerBallIds).size !== interval.postDueAttackerBallIds.length || interval.postDueAttackerBallIds.some((ballId) => !interval.postDueBallIds.includes(ballId))) throw new Error(`calibration post-due attacker IDs mismatch: ${caseKey(run)}`);
    if (interval.postDueAttackerBallIds.some((ballId) => run.terminalBallTypes[ballId] !== "attacker-entry" || interval.actionDueAt === null || (run.firedBallAt[ballId] ?? Number.NEGATIVE_INFINITY) < interval.actionDueAt - EPSILON || (run.terminalBallAt[ballId] ?? Number.POSITIVE_INFINITY) > (interval.closedAt ?? Number.POSITIVE_INFINITY) + EPSILON)) throw new Error(`calibration post-due attacker correlation mismatch: ${caseKey(run)}`);
    if (interval.postDueAttackerHits > interval.postDueFired || interval.postDueAttackerHits < 0) throw new Error(`calibration post-due attacker accounting mismatch: ${caseKey(run)}`);
    if (interval.successful !== (interval.dueEligible && interval.postDueAttackerHits > 0)) throw new Error(`calibration BONUS success mismatch: ${caseKey(run)}`);
  }
}

function expectedConditionsForReport(report: CalibrationReport): readonly CalibrationCondition[] {
  const candidates = [...new Set(report.conditions.filter((condition) => isDynamicPolicy(condition.policy)).map((condition) => condition.policy))];
  return conditionsForCohort(report.cohort, candidates);
}

function validateReportEnvelope(report: CalibrationReport): CalibrationManifest {
  const manifest = createCalibrationManifest(report.gameCommit);
  if (report.schemaVersion !== CALIBRATION_SCHEMA_VERSION || report.version !== CALIBRATION_VERSION || report.manifestChecksum !== manifest.configChecksum || report.configChecksum !== manifest.configChecksum || report.seedSetChecksum !== manifest.seedSetChecksum) {
    throw new Error("calibration report manifest mismatch");
  }
  const canonicalConditions = expectedConditionsForReport(report);
  validateConditions(report.conditions, canonicalConditions);
  if (report.conditionsChecksum !== sha256Hex(stableJson(report.conditions))) throw new Error("calibration condition checksum mismatch");
  if (report.cohort === "holdout-v1" && report.candidateChecksum === null) throw new Error("holdout report is missing candidate manifest checksum");
  if (report.cohort !== "holdout-v1" && report.candidateChecksum !== null) throw new Error("non-holdout report has a candidate manifest checksum");
  return manifest;
}

export function mergeCalibrationReports(reports: readonly CalibrationReport[], expectedGameCommit?: string): CalibrationReport {
  if (reports.length === 0) throw new Error("merge requires at least one report");
  const first = reports[0];
  if (first === undefined) throw new Error("merge requires at least one report");
  if (expectedGameCommit !== undefined && first.gameCommit !== expectedGameCommit) throw new Error("calibration report commit does not match requested commit");
  const manifest = validateReportEnvelope(first);
  const unique = new Map<string, CalibrationRun>();
  for (const report of reports) {
    validateReportEnvelope(report);
    if (report.schemaVersion !== first.schemaVersion || report.version !== first.version || report.cohort !== first.cohort || report.manifestChecksum !== first.manifestChecksum || report.configChecksum !== first.configChecksum || report.gameCommit !== first.gameCommit || report.seedSetChecksum !== first.seedSetChecksum || report.conditionsChecksum !== first.conditionsChecksum || report.candidateChecksum !== first.candidateChecksum) {
      throw new Error("calibration report manifest mismatch");
    }
    validateConditions(report.conditions, first.conditions);
    const conditionsByKey = new Map(report.conditions.map((condition) => [conditionKey(condition), condition]));
    for (const run of report.runs) {
      const expectedCondition = conditionsByKey.get(conditionKey(run));
      if (expectedCondition === undefined || run.cohort !== first.cohort || run.conditionsChecksum !== first.conditionsChecksum) throw new Error(`calibration run manifest mismatch: ${caseKey(run)}`);
      validateCalibrationRun(run, manifest, expectedCondition);
      const key = caseKey(run);
      if (unique.has(key)) throw new Error(`duplicate calibration run: ${key}`);
      unique.set(key, run);
    }
  }
  const expected = casesForCohort(first.cohort, first.conditions.filter((condition) => isDynamicPolicy(condition.policy)).map((condition) => condition.policy));
  const expectedKeys = new Set(expected.map((item) => `${item.seed}:${conditionKey(item.condition)}`));
  const actualKeys = new Set([...unique.values()].map((run) => `${run.seed}:${run.policy}:${run.delaySeconds.toFixed(1)}`));
  if (actualKeys.size !== expectedKeys.size || [...expectedKeys].some((key) => !actualKeys.has(key)) || [...actualKeys].some((key) => !expectedKeys.has(key))) {
    throw new Error(`calibration merge is incomplete: expected ${expectedKeys.size}, got ${actualKeys.size}`);
  }
  const runs = [...unique.values()].sort((left, right) => {
    if (left.seed !== right.seed) return left.seed - right.seed;
    const leftOrder = first.conditions.findIndex((condition) => conditionKey(condition) === conditionKey(left));
    const rightOrder = first.conditions.findIndex((condition) => conditionKey(condition) === conditionKey(right));
    return leftOrder - rightOrder;
  });
  return {
    schemaVersion: first.schemaVersion,
    version: first.version,
    manifestChecksum: first.manifestChecksum,
    gameCommit: first.gameCommit,
    configChecksum: first.configChecksum,
    seedSetChecksum: first.seedSetChecksum,
    conditionsChecksum: first.conditionsChecksum,
    candidateChecksum: first.candidateChecksum,
    cohort: first.cohort,
    shard: { index: 1, count: 1 },
    conditions: first.conditions,
    runs,
  };
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}

export function quantile(values: readonly number[], probability: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const p = Math.min(1, Math.max(0, probability));
  const position = (sorted.length - 1) * p;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower] ?? 0;
  const lowerValue = sorted[lower] ?? 0;
  const upperValue = sorted[upper] ?? lowerValue;
  return lowerValue + (upperValue - lowerValue) * (position - lower);
}

export function iqr(values: readonly number[]): number {
  return quantile(values, 0.75) - quantile(values, 0.25);
}

export function wilsonLowerBound(positive: number, total: number, z = 1.959963984540054): number {
  if (total <= 0) return 0;
  const proportion = positive / total;
  const denominator = 1 + (z * z) / total;
  const center = proportion + (z * z) / (2 * total);
  const spread = z * Math.sqrt((proportion * (1 - proportion) + (z * z) / (4 * total)) / total);
  return (center - spread) / denominator;
}

/** Deterministic paired score summary used before any holdout is opened. */
export function pairedScoreSummary(
  candidate: readonly Pick<CalibrationRun, "seed" | "finalScore">[],
  baseline: readonly Pick<CalibrationRun, "seed" | "finalScore">[],
): {
  readonly matched: number;
  readonly deltas: readonly number[];
  readonly medianDelta: number;
  readonly positive: number;
  readonly positiveRate: number;
  readonly positiveWilsonLower: number;
  readonly q10Candidate: number;
  readonly q10Baseline: number;
  readonly q10Delta: number;
  readonly deltaIqr: number;
  readonly rawInputChecksum: string;
  readonly bootstrap95CiLower: number;
  readonly bootstrap95CiUpper: number;
} {
  const pairs = pairedScoreInputs(candidate, baseline);
  const deltas = pairs.map((pair) => pair.delta).sort((left, right) => left - right);
  const positive = deltas.filter((delta) => delta > 0).length;
  const candidateScores = candidate.map((run) => run.finalScore);
  const baselineScores = baseline.map((run) => run.finalScore);
  const bootstrap = bootstrapMedianDeltaCI(pairs);
  return {
    matched: deltas.length,
    deltas,
    medianDelta: median(deltas),
    positive,
    positiveRate: deltas.length === 0 ? 0 : positive / deltas.length,
    positiveWilsonLower: wilsonLowerBound(positive, deltas.length),
    q10Candidate: quantile(candidateScores, 0.1),
    q10Baseline: quantile(baselineScores, 0.1),
    q10Delta: quantile(candidateScores, 0.1) - quantile(baselineScores, 0.1),
    deltaIqr: iqr(deltas),
    rawInputChecksum: bootstrap.rawInputChecksum,
    bootstrap95CiLower: bootstrap.lower,
    bootstrap95CiUpper: bootstrap.upper,
  };
}

interface PairedScoreInput {
  readonly seed: number;
  readonly candidate: number;
  readonly baseline: number;
  readonly delta: number;
}

export interface BootstrapMedianDeltaCI {
  readonly rawInputChecksum: string;
  readonly seed: number;
  readonly resamples: number;
  readonly lower: number;
  readonly upper: number;
}

function pairedScoreInputs(
  candidate: readonly Pick<CalibrationRun, "seed" | "finalScore">[],
  baseline: readonly Pick<CalibrationRun, "seed" | "finalScore">[],
): readonly PairedScoreInput[] {
  const baselineBySeed = new Map(baseline.map((run) => [run.seed, run]));
  return candidate
    .flatMap((run) => {
      const paired = baselineBySeed.get(run.seed);
      return paired === undefined
        ? []
        : [{ seed: run.seed, candidate: run.finalScore, baseline: paired.finalScore, delta: run.finalScore - paired.finalScore }];
    })
    .sort((left, right) => left.seed - right.seed);
}

function bootstrapRandom(seed: number): () => number {
  let state = (seed >>> 0) || 0x6d2b79f5;
  return () => {
    let value = state;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    state = value >>> 0;
    return state / 0x1_0000_0000;
  };
}

export function bootstrapMedianDeltaCI(
  pairs: readonly PairedScoreInput[],
  resamples = CALIBRATION_GATE_THRESHOLDS.bootstrapResamples,
): BootstrapMedianDeltaCI {
  const rawInputChecksum = sha256Hex(stableJson(pairs));
  const seed = createHash("sha256").update(rawInputChecksum, "utf8").digest().readUInt32BE(0) || 1;
  if (pairs.length === 0) {
    return { rawInputChecksum, seed, resamples, lower: 0, upper: 0 };
  }
  const random = bootstrapRandom(seed);
  const medians: number[] = [];
  for (let sample = 0; sample < resamples; sample += 1) {
    const values: number[] = [];
    for (let index = 0; index < pairs.length; index += 1) {
      const selected = pairs[Math.floor(random() * pairs.length)];
      if (selected !== undefined) values.push(selected.delta);
    }
    medians.push(median(values));
  }
  medians.sort((left, right) => left - right);
  return {
    rawInputChecksum,
    seed,
    resamples,
    lower: medians[Math.floor(medians.length * 0.025)] ?? 0,
    upper: medians[Math.min(medians.length - 1, Math.floor(medians.length * 0.975))] ?? 0,
  };
}

export interface TuningPolicySummary {
  readonly policy: CalibrationPolicy;
  readonly primaryAt03: boolean;
  readonly primaryAt06Safety: boolean;
  readonly bonusOpenCount: number;
  readonly bonusSuccessRate: number | null;
  readonly bonusGate: "pass" | "fail" | "indeterminate";
  readonly scoreAt03: ReturnType<typeof pairedScoreSummary>;
  readonly scoreAt06: ReturnType<typeof pairedScoreSummary>;
  readonly scoreSummaryAt03: DistributionSummary;
  readonly scoreSummaryAt06: DistributionSummary;
  readonly deltaQuantilesAt03: QuantileSummary;
  readonly deltaQuantilesAt06: QuantileSummary;
  readonly runSummaryAt03: CalibrationRunSummary;
  readonly runSummaryAt06: CalibrationRunSummary;
}

export interface QuantileSummary {
  readonly q10: number;
  readonly q25: number;
  readonly q50: number;
  readonly q75: number;
  readonly q90: number;
}

export interface DistributionSummary extends QuantileSummary {
  readonly count: number;
  readonly mean: number;
  readonly standardDeviation: number;
}

export interface CalibrationRunSummary {
  readonly score: DistributionSummary;
  readonly firstAcceptedStartSeconds: DistributionSummary | null;
  readonly resultAt: DistributionSummary;
  readonly settlementSeconds: DistributionSummary;
  readonly pendingFullNormalSeconds: DistributionSummary;
  readonly pendingFullBonusSeconds: DistributionSummary;
  readonly pendingFullSettlingSeconds: DistributionSummary;
  readonly rejectedFull: DistributionSummary;
  readonly rejectedDeadline: DistributionSummary;
  readonly fired: DistributionSummary;
  readonly firedToEntryDelaySeconds: DistributionSummary | null;
  readonly actionDueToAttackerDelaySeconds: DistributionSummary | null;
}

export interface CalibrationConditionSummary {
  readonly policy: CalibrationPolicy;
  readonly delaySeconds: CalibrationDelaySeconds;
  readonly runSummary: CalibrationRunSummary;
}

export interface TuningEvaluation {
  readonly manifestVersion: typeof CALIBRATION_VERSION;
  readonly runCount: number;
  readonly fixedEntry: Readonly<Record<string, {
    readonly within10Seconds: number;
    readonly within30Seconds: number;
    readonly requiredWithin10Seconds: number;
    readonly requiredWithin30Seconds: number;
    readonly passed: boolean;
  }>>;
  readonly policies: readonly TuningPolicySummary[];
  readonly conditionSummaries: readonly CalibrationConditionSummary[];
  readonly primary: CalibrationPolicy | null;
  readonly secondary: CalibrationPolicy | null;
  readonly holdoutAllowed: boolean;
  readonly secondaryIndeterminate: boolean;
}

export function selectCalibrationCandidates(policies: readonly TuningPolicySummary[]): {
  readonly primary: CalibrationPolicy | null;
  readonly secondary: CalibrationPolicy | null;
} {
  const eligiblePrimary = policies
    .filter((summary) => summary.primaryAt03 && summary.primaryAt06Safety)
    .sort((left, right) => right.scoreAt03.medianDelta - left.scoreAt03.medianDelta || right.scoreAt03.q10Candidate - left.scoreAt03.q10Candidate || right.scoreAt03.positiveRate - left.scoreAt03.positiveRate || left.policy.localeCompare(right.policy));
  const eligibleSecondary = policies
    .filter((summary) => (summary.policy === "bonus50" || summary.policy === "bonus80") && summary.bonusOpenCount >= CALIBRATION_GATE_THRESHOLDS.bonusOpenMin && (summary.bonusSuccessRate ?? 0) >= CALIBRATION_GATE_THRESHOLDS.bonusSuccessRateMin)
    .sort((left, right) => (right.bonusSuccessRate ?? 0) - (left.bonusSuccessRate ?? 0) || right.scoreAt03.medianDelta - left.scoreAt03.medianDelta || left.policy.localeCompare(right.policy));
  const primary = eligiblePrimary[0]?.policy ?? null;
  const primarySummary = primary === null ? undefined : policies.find((summary) => summary.policy === primary);
  const secondary = primarySummary !== undefined && primarySummary.bonusGate === "pass" && (primary === "bonus50" || primary === "bonus80")
    ? primary
    : eligibleSecondary[0]?.policy ?? null;
  return { primary, secondary };
}

function fixedEntryCount(runs: readonly CalibrationRun[], maxSeconds: number): number {
  return runs.filter((run) => run.firstAcceptedStartSeconds !== null && run.firstAcceptedStartSeconds <= maxSeconds + EPSILON).length;
}

function dynamicRuns(runs: readonly CalibrationRun[], policy: CalibrationPolicy, delaySeconds: CalibrationDelaySeconds): readonly CalibrationRun[] {
  return runs.filter((run) => run.policy === policy && run.delaySeconds === delaySeconds);
}

function quantileSummary(values: readonly number[]): QuantileSummary {
  return {
    q10: quantile(values, 0.1),
    q25: quantile(values, 0.25),
    q50: quantile(values, 0.5),
    q75: quantile(values, 0.75),
    q90: quantile(values, 0.9),
  };
}

function distributionSummary(values: readonly number[]): DistributionSummary {
  const count = values.length;
  const mean = count === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / count;
  const variance = count === 0 ? 0 : values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / count;
  return { count, mean, standardDeviation: Math.sqrt(variance), ...quantileSummary(values) };
}

function optionalDistributionSummary(values: readonly (number | null)[]): DistributionSummary | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length === 0 ? null : distributionSummary(present);
}

function runSummary(runs: readonly CalibrationRun[]): CalibrationRunSummary {
  const resultAt = runs.map((run) => run.resultAt).filter((value): value is number => value !== null);
  const settlementSeconds = runs.map((run) => run.settlementSeconds).filter((value): value is number => value !== null);
  if (resultAt.length !== runs.length || settlementSeconds.length !== runs.length) throw new Error("calibration summary has missing result timing");
  const attackerDelays = runs.flatMap((run) => run.openIntervals.flatMap((interval) =>
    interval.actionDueAt !== null && interval.firstPostDueAttackerAt !== null
      ? [interval.firstPostDueAttackerAt - interval.actionDueAt]
      : []));
  const firedToEntryDelays = runs.flatMap((run) => Object.entries(run.terminalBallAt).flatMap(([ballId, terminalAt]) => {
    const type = run.terminalBallTypes[ballId];
    const firedAt = run.firedBallAt[ballId];
    return (type === "start-entry" || type === "side-entry" || type === "attacker-entry") && firedAt !== undefined
      ? [terminalAt - firedAt]
      : [];
  }));
  return {
    score: distributionSummary(runs.map((run) => run.finalScore)),
    firstAcceptedStartSeconds: optionalDistributionSummary(runs.map((run) => run.firstAcceptedStartSeconds)),
    resultAt: distributionSummary(resultAt),
    settlementSeconds: distributionSummary(settlementSeconds),
    pendingFullNormalSeconds: distributionSummary(runs.map((run) => run.pendingFullNormalSeconds)),
    pendingFullBonusSeconds: distributionSummary(runs.map((run) => run.pendingFullBonusSeconds)),
    pendingFullSettlingSeconds: distributionSummary(runs.map((run) => run.pendingFullSettlingSeconds)),
    rejectedFull: distributionSummary(runs.map((run) => run.rejectedFull)),
    rejectedDeadline: distributionSummary(runs.map((run) => run.rejectedDeadline)),
    fired: distributionSummary(runs.map((run) => run.fired)),
    firedToEntryDelaySeconds: optionalDistributionSummary(firedToEntryDelays),
    actionDueToAttackerDelaySeconds: optionalDistributionSummary(attackerDelays),
  };
}

function assertCompleteRunSet(
  runs: readonly CalibrationRun[],
  cohort: CalibrationCohort,
  candidates: readonly CalibrationPolicy[],
): void {
  const expected = casesForCohort(cohort, candidates);
  const expectedKeys = new Set(expected.map((item) => `${item.seed}:${conditionKey(item.condition)}`));
  const actualKeys = new Set<string>();
  for (const run of runs) {
    if (run.cohort !== cohort) throw new Error(`calibration evaluation cohort mismatch: ${caseKey(run)}`);
    const key = caseKey(run);
    if (actualKeys.has(key)) throw new Error(`duplicate calibration run: ${key}`);
    actualKeys.add(key);
  }
  if (actualKeys.size !== expectedKeys.size || [...expectedKeys].some((key) => !actualKeys.has(key)) || [...actualKeys].some((key) => !expectedKeys.has(key))) {
    throw new Error(`calibration evaluation is incomplete: expected ${expectedKeys.size}, got ${actualKeys.size}`);
  }
}

export function evaluateTuning(runs: readonly CalibrationRun[]): TuningEvaluation {
  assertCompleteRunSet(runs, "tuning-v1", []);
  const fixedEntry = Object.fromEntries(CALIBRATION_FIXED_POLICIES.map((policy) => {
    const selected = runs.filter((run) => run.policy === policy && run.delaySeconds === 0);
    const within10Seconds = fixedEntryCount(selected, 10);
    const within30Seconds = fixedEntryCount(selected, 30);
    const requiredWithin10Seconds = policy === "fixed95" ? CALIBRATION_GATE_THRESHOLDS.fixed95Within10Seconds : 0;
    const requiredWithin30Seconds = policy === "fixed95"
      ? CALIBRATION_GATE_THRESHOLDS.fixed95Within30Seconds
      : CALIBRATION_GATE_THRESHOLDS.fixedPresetWithin30Seconds;
    return [policy, {
      within10Seconds,
      within30Seconds,
      requiredWithin10Seconds,
      requiredWithin30Seconds,
      passed: within10Seconds >= requiredWithin10Seconds && within30Seconds >= requiredWithin30Seconds,
    }];
  }));
  const baseline = dynamicRuns(runs, "fixed95", 0);
  const policies = CALIBRATION_DYNAMIC_POLICIES.map((policy) => {
    const at03 = dynamicRuns(runs, policy, 0.3);
    const at06 = dynamicRuns(runs, policy, 0.6);
    const scoreAt03 = pairedScoreSummary(at03, baseline);
    const scoreAt06 = pairedScoreSummary(at06, baseline);
    const medianMinimum = Math.max(
      CALIBRATION_GATE_THRESHOLDS.primaryMedianMinPoints,
      median(baseline.map((run) => run.finalScore)) * CALIBRATION_GATE_THRESHOLDS.primaryMedianMinFraction,
    );
    const primaryAt03 = scoreAt03.matched === baseline.length &&
      scoreAt03.medianDelta >= medianMinimum &&
      scoreAt03.positive >= CALIBRATION_GATE_THRESHOLDS.primaryPositiveMinCount &&
      scoreAt03.deltaIqr <= CALIBRATION_GATE_THRESHOLDS.primaryIqrMultiplier * Math.max(scoreAt03.medianDelta, 0) &&
      scoreAt03.bootstrap95CiLower > 0 &&
      scoreAt03.positiveWilsonLower > CALIBRATION_GATE_THRESHOLDS.positiveWilsonLowerMin &&
      scoreAt03.q10Delta >= CALIBRATION_GATE_THRESHOLDS.q10FloorPoints;
    const primaryAt06Safety = scoreAt06.matched === baseline.length && scoreAt06.q10Delta >= CALIBRATION_GATE_THRESHOLDS.q10FloorPoints;
    const opens = at03.flatMap((run) => run.openIntervals);
    const eligibleOpens = opens.filter((interval) => interval.dueEligible);
    const successes = eligibleOpens.filter((interval) => interval.successful).length;
    const bonusSuccessRate = eligibleOpens.length === 0 ? null : successes / eligibleOpens.length;
    const bonusGate = eligibleOpens.length < CALIBRATION_GATE_THRESHOLDS.bonusOpenMin
      ? "indeterminate" as const
      : (bonusSuccessRate ?? 0) >= CALIBRATION_GATE_THRESHOLDS.bonusSuccessRateMin ? "pass" as const : "fail" as const;
    return {
      policy,
      primaryAt03,
      primaryAt06Safety,
      bonusOpenCount: eligibleOpens.length,
      bonusSuccessRate,
      bonusGate,
      scoreAt03,
      scoreAt06,
      scoreSummaryAt03: distributionSummary(at03.map((run) => run.finalScore)),
      scoreSummaryAt06: distributionSummary(at06.map((run) => run.finalScore)),
      deltaQuantilesAt03: quantileSummary(scoreAt03.deltas),
      deltaQuantilesAt06: quantileSummary(scoreAt06.deltas),
      runSummaryAt03: runSummary(at03),
      runSummaryAt06: runSummary(at06),
    };
  });
  const fixedEntryPassed = Object.values(fixedEntry).every((entry) => entry.passed);
  const conditionSummaries = tuningConditions().map((condition) => ({
    policy: condition.policy,
    delaySeconds: condition.delaySeconds,
    runSummary: runSummary(runs.filter((run) => run.policy === condition.policy && run.delaySeconds === condition.delaySeconds)),
  }));
  const selectedCandidates = selectCalibrationCandidates(policies);
  const { primary, secondary } = selectedCandidates;
  const secondaryIndeterminate = policies.some((summary) => (summary.policy === "bonus50" || summary.policy === "bonus80") && summary.bonusGate === "indeterminate");
  return {
    manifestVersion: CALIBRATION_VERSION,
    runCount: runs.length,
    fixedEntry,
    policies,
    conditionSummaries,
    primary,
    secondary,
    holdoutAllowed: fixedEntryPassed && primary !== null && secondary !== null,
    secondaryIndeterminate,
  };
}

export function evaluateCalibrationReport(report: CalibrationReport, expectedGameCommit?: string): TuningEvaluation {
  if (expectedGameCommit !== undefined && report.gameCommit !== expectedGameCommit) throw new Error("calibration report commit does not match requested commit");
  const manifest = validateReportEnvelope(report);
  if (report.cohort !== "tuning-v1") throw new Error("tuning evaluation requires a tuning-v1 report");
  assertCompleteRunSet(report.runs, "tuning-v1", []);
  const conditionByKey = new Map(report.conditions.map((condition) => [conditionKey(condition), condition]));
  for (const run of report.runs) {
    const condition = conditionByKey.get(conditionKey(run));
    if (condition === undefined) throw new Error(`calibration report condition missing: ${caseKey(run)}`);
    validateCalibrationRun(run, manifest, condition);
  }
  return evaluateTuning(report.runs);
}

export interface HoldoutEvaluation {
  readonly manifestVersion: typeof CALIBRATION_VERSION;
  readonly runCount: number;
  readonly candidate: CalibrationCandidateManifest;
  readonly fixedEntry: TuningEvaluation["fixedEntry"];
  readonly policies: readonly TuningPolicySummary[];
  readonly conditionSummaries: readonly CalibrationConditionSummary[];
  readonly primaryPassed: boolean;
  readonly secondaryPassed: boolean | null;
  readonly secondaryIndeterminate: boolean;
  readonly passed: boolean;
  readonly indeterminate: boolean;
}

export function evaluateHoldoutReport(report: CalibrationReport, candidate: CalibrationCandidateManifest, expectedGameCommit?: string): HoldoutEvaluation {
  if (expectedGameCommit !== undefined && report.gameCommit !== expectedGameCommit) throw new Error("calibration report commit does not match requested commit");
  const manifest = validateReportEnvelope(report);
  if (report.cohort !== "holdout-v1") throw new Error("holdout evaluation requires a holdout-v1 report");
  validateCandidateManifest(candidate, manifest);
  if (report.candidateChecksum !== candidate.candidateChecksum) throw new Error("holdout report candidate manifest mismatch");
  const policies = [...new Set([candidate.primary, ...(candidate.secondary === null ? [] : [candidate.secondary])])];
  assertCompleteRunSet(report.runs, "holdout-v1", policies);
  const conditionByKey = new Map(report.conditions.map((condition) => [conditionKey(condition), condition]));
  for (const run of report.runs) {
    const condition = conditionByKey.get(conditionKey(run));
    if (condition === undefined) throw new Error(`holdout report condition missing: ${caseKey(run)}`);
    validateCalibrationRun(run, manifest, condition);
  }
  const fixedEntry = Object.fromEntries(CALIBRATION_FIXED_POLICIES.map((policy) => {
    const selected = report.runs.filter((run) => run.policy === policy && run.delaySeconds === 0);
    const within10Seconds = fixedEntryCount(selected, 10);
    const within30Seconds = fixedEntryCount(selected, 30);
    const requiredWithin10Seconds = policy === "fixed95" ? CALIBRATION_GATE_THRESHOLDS.fixed95Within10Seconds : 0;
    const requiredWithin30Seconds = policy === "fixed95" ? CALIBRATION_GATE_THRESHOLDS.fixed95Within30Seconds : CALIBRATION_GATE_THRESHOLDS.fixedPresetWithin30Seconds;
    return [policy, { within10Seconds, within30Seconds, requiredWithin10Seconds, requiredWithin30Seconds, passed: within10Seconds >= requiredWithin10Seconds && within30Seconds >= requiredWithin30Seconds }];
  })) as TuningEvaluation["fixedEntry"];
  const baseline = dynamicRuns(report.runs, "fixed95", 0);
  const summaries = policies.map((policy) => {
    const at03 = dynamicRuns(report.runs, policy, 0.3);
    const at06 = dynamicRuns(report.runs, policy, 0.6);
    const scoreAt03 = pairedScoreSummary(at03, baseline);
    const scoreAt06 = pairedScoreSummary(at06, baseline);
    const medianMinimum = Math.max(CALIBRATION_GATE_THRESHOLDS.primaryMedianMinPoints, median(baseline.map((run) => run.finalScore)) * CALIBRATION_GATE_THRESHOLDS.primaryMedianMinFraction);
    const primaryAt03 = scoreAt03.matched === baseline.length && scoreAt03.medianDelta >= medianMinimum && scoreAt03.positive >= CALIBRATION_GATE_THRESHOLDS.primaryPositiveMinCount && scoreAt03.deltaIqr <= CALIBRATION_GATE_THRESHOLDS.primaryIqrMultiplier * Math.max(scoreAt03.medianDelta, 0) && scoreAt03.bootstrap95CiLower > 0 && scoreAt03.positiveWilsonLower > CALIBRATION_GATE_THRESHOLDS.positiveWilsonLowerMin && scoreAt03.q10Delta >= CALIBRATION_GATE_THRESHOLDS.q10FloorPoints;
    const primaryAt06Safety = scoreAt06.matched === baseline.length && scoreAt06.q10Delta >= CALIBRATION_GATE_THRESHOLDS.q10FloorPoints;
    const eligibleOpens = at03.flatMap((run) => run.openIntervals).filter((interval) => interval.dueEligible);
    const successes = eligibleOpens.filter((interval) => interval.successful).length;
    const bonusSuccessRate = eligibleOpens.length === 0 ? null : successes / eligibleOpens.length;
    const bonusGate = eligibleOpens.length < CALIBRATION_GATE_THRESHOLDS.bonusOpenMin
      ? "indeterminate" as const
      : (bonusSuccessRate ?? 0) >= CALIBRATION_GATE_THRESHOLDS.bonusSuccessRateMin ? "pass" as const : "fail" as const;
    return {
      policy,
      primaryAt03,
      primaryAt06Safety,
      bonusOpenCount: eligibleOpens.length,
      bonusSuccessRate,
      bonusGate,
      scoreAt03,
      scoreAt06,
      scoreSummaryAt03: distributionSummary(at03.map((run) => run.finalScore)),
      scoreSummaryAt06: distributionSummary(at06.map((run) => run.finalScore)),
      deltaQuantilesAt03: quantileSummary(scoreAt03.deltas),
      deltaQuantilesAt06: quantileSummary(scoreAt06.deltas),
      runSummaryAt03: runSummary(at03),
      runSummaryAt06: runSummary(at06),
    };
  });
  const primarySummary = summaries.find((summary) => summary.policy === candidate.primary);
  const secondarySummary = candidate.secondary === null ? undefined : summaries.find((summary) => summary.policy === candidate.secondary);
  const primaryPassed = Object.values(fixedEntry).every((entry) => entry.passed) && primarySummary !== undefined && primarySummary.primaryAt03 && primarySummary.primaryAt06Safety;
  const secondaryPassed = candidate.secondary === null ? null : secondarySummary !== undefined && secondarySummary.bonusOpenCount >= CALIBRATION_GATE_THRESHOLDS.bonusOpenMin && (secondarySummary.bonusSuccessRate ?? 0) >= CALIBRATION_GATE_THRESHOLDS.bonusSuccessRateMin;
  const secondaryIndeterminate = secondarySummary?.bonusGate === "indeterminate";
  const conditionSummaries = report.conditions.map((condition) => ({
    policy: condition.policy,
    delaySeconds: condition.delaySeconds,
    runSummary: runSummary(report.runs.filter((run) => run.policy === condition.policy && run.delaySeconds === condition.delaySeconds)),
  }));
  return {
    manifestVersion: CALIBRATION_VERSION,
    runCount: report.runs.length,
    candidate,
    fixedEntry,
    policies: summaries,
    conditionSummaries,
    primaryPassed,
    secondaryPassed,
    passed: primaryPassed && secondaryPassed === true,
    secondaryIndeterminate,
    indeterminate: secondaryIndeterminate,
  };
}

export function createCandidateManifest(report: CalibrationReport, evaluation: TuningEvaluation): CalibrationCandidateManifest {
  if (report.cohort !== "tuning-v1" || report.runs.length !== 256 * 15 || !evaluation.holdoutAllowed || evaluation.primary === null || evaluation.secondary === null) {
    throw new Error("candidate manifest requires a complete passing tuning report");
  }
  const manifest = createCalibrationManifest(report.gameCommit);
  const candidates = [evaluation.primary, ...(evaluation.secondary === null ? [] : [evaluation.secondary])];
  const conditions = conditionsForCohort("holdout-v1", candidates);
  const body = {
    schemaVersion: CALIBRATION_SCHEMA_VERSION,
    version: CALIBRATION_VERSION,
    kind: "holdout-candidate" as const,
    gameCommit: report.gameCommit,
    configChecksum: manifest.configChecksum,
    seedSetChecksum: manifest.seedSetChecksum,
    tuningReportChecksum: sha256Hex(stableJson(report)),
    tuningRunChecksum: sha256Hex(stableJson(report.runs)),
    primary: evaluation.primary,
    secondary: evaluation.secondary,
    conditions,
    conditionsChecksum: sha256Hex(stableJson(conditions)),
  };
  return Object.freeze({ ...body, candidateChecksum: sha256Hex(stableJson(body)) });
}

export function validateCandidateManifest(candidate: CalibrationCandidateManifest, manifest: CalibrationManifest): void {
  if (candidate.schemaVersion !== CALIBRATION_SCHEMA_VERSION || candidate.version !== CALIBRATION_VERSION || candidate.kind !== "holdout-candidate") throw new Error("invalid candidate manifest schema");
  if (candidate.gameCommit !== manifest.gameCommit || candidate.configChecksum !== manifest.configChecksum || candidate.seedSetChecksum !== manifest.seedSetChecksum) throw new Error("candidate manifest game/config/seed mismatch");
  if (!/^[0-9a-f]{64}$/u.test(candidate.tuningReportChecksum) || !/^[0-9a-f]{64}$/u.test(candidate.tuningRunChecksum)) throw new Error("candidate tuning checksums are invalid");
  const policies = [candidate.primary, ...(candidate.secondary === null ? [] : [candidate.secondary])];
  if (!isDynamicPolicy(candidate.primary) || policies.some((policy) => !isDynamicPolicy(policy))) throw new Error("candidate manifest policies are invalid");
  if (candidate.secondary === null) throw new Error("candidate secondary is required for holdout");
  if (candidate.secondary !== "bonus50" && candidate.secondary !== "bonus80") throw new Error("candidate secondary must be bonus50 or bonus80");
  const conditions = conditionsForCohort("holdout-v1", policies);
  validateConditions(candidate.conditions, conditions);
  if (candidate.conditionsChecksum !== sha256Hex(stableJson(candidate.conditions))) throw new Error("candidate condition checksum mismatch");
  const { candidateChecksum, ...body } = candidate;
  if (candidateChecksum !== sha256Hex(stableJson(body))) throw new Error("candidate manifest checksum mismatch");
}
