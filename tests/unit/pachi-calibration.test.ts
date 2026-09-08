import { describe, expect, it } from "vitest";
import {
  CALIBRATION_DELAYS,
  casesForCohort,
  conditionsForCohort,
  createCalibrationManifest,
  createCandidateManifest,
  evaluateCalibrationReport,
  evaluateHoldoutReport,
  generateCohortSeeds,
  mergeCalibrationReports,
  pairedScoreSummary,
  quantile,
  runCalibrationShard,
  selectCalibrationCandidates,
  seedChecksum,
  sha256Hex,
  simulateCalibrationRun,
  stableJson,
  tuningConditions,
  validateCandidateManifest,
  validateCalibrationRun,
  type CalibrationCase,
  type CalibrationRun,
  type CalibrationReport,
  type TuningPolicySummary,
  type TuningEvaluation,
} from "../../scripts/pachi-calibration-v2";

function syntheticTuningFixture() {
  const manifest = createCalibrationManifest("synthetic");
  const conditions = tuningConditions();
  const conditionsChecksum = sha256Hex(stableJson(conditions));
  const template: CalibrationRun = {
    schemaVersion: manifest.schemaVersion,
    version: manifest.version,
    gameCommit: manifest.gameCommit,
    configChecksum: manifest.configChecksum,
    seedSetChecksum: manifest.seedSetChecksum,
    conditionsChecksum,
    cohort: "tuning-v1",
    index: 0,
    seed: generateCohortSeeds("tuning-v1")[0] ?? 1,
    policy: "fixed50",
    delaySeconds: 0,
    controllerTickMs: 100,
    startedAt: 0,
    phase: "result",
    timedOut: false,
    deadlineAt: 90,
    deadlineReason: "time",
    resultAt: 90,
    settlementSeconds: 0,
    finalScore: 0,
    scoreParts: { shots: 0, start: 0, side: 0, jackpot: 0, attacker: 0 },
    fired: 0,
    firedByPower: {},
    acceptedStarts: 0,
    rejectedFull: 0,
    rejectedDeadline: 0,
    firstAcceptedStartSeconds: null,
    completedSpins: 0,
    jackpots: 0,
    wins: 0,
    remainingBalls: 0,
    finalPending: 0,
    startEntries: 0,
    pendingFullNormalSeconds: 0,
    pendingFullBonusSeconds: 0,
    pendingFullSettlingSeconds: 0,
    reclaimedByReason: {},
    firedBallIds: [],
    firedBallAt: {},
    firedBallPower: {},
    terminalBallAt: {},
    terminalBallTypes: {},
    terminalDelaySeconds: {},
    eventBallIds: {},
    invariantViolations: [],
    openIntervals: [],
    openSuccesses: 0,
    postOpenFiredBalls: 0,
    postOpenAttackerHits: 0,
  };
  const runs = casesForCohort("tuning-v1").map((item) => {
    return {
      ...template,
      cohort: item.cohort,
      index: item.index,
      seed: item.seed,
      policy: item.condition.policy,
      delaySeconds: item.condition.delaySeconds,
      conditionsChecksum,
      openIntervals: [],
    };
  });
  const report: CalibrationReport = {
    schemaVersion: manifest.schemaVersion,
    version: manifest.version,
    manifestChecksum: manifest.configChecksum,
    gameCommit: manifest.gameCommit,
    configChecksum: manifest.configChecksum,
    seedSetChecksum: manifest.seedSetChecksum,
    conditionsChecksum,
    candidateChecksum: null,
    cohort: "tuning-v1",
    shard: { index: 1, count: 1 },
    conditions,
    runs,
  };
  return { manifest, conditions, conditionsChecksum, template, runs, report };
}

describe("pachi calibration manifest", () => {
  it("keeps the generated cohorts deterministic and disjoint", () => {
    const tuning = generateCohortSeeds("tuning-v1");
    const holdout = generateCohortSeeds("holdout-v1");
    expect(tuning).toHaveLength(256);
    expect(holdout).toHaveLength(256);
    expect(new Set(tuning).size).toBe(256);
    expect(new Set(holdout).size).toBe(256);
    expect(tuning.some((seed) => holdout.includes(seed))).toBe(false);
    expect(seedChecksum(tuning)).toBe(seedChecksum(generateCohortSeeds("tuning-v1")));
  });

  it("fixes the 15 tuning conditions and the holdout delay set", () => {
    const manifest = createCalibrationManifest();
    expect(manifest.tuningConditions).toHaveLength(15);
    expect(manifest.fixedConditions).toHaveLength(3);
    expect(CALIBRATION_DELAYS).toEqual([0, 0.3, 0.6]);
    expect(conditionsForCohort("holdout-v1", ["bonus50", "earlyStop"])).toHaveLength(9);
    expect(stableJson(manifest)).toBe(stableJson(createCalibrationManifest()));
  });

  it("uses the R-7 linear quantile definition", () => {
    expect(quantile([0, 10], 0.1)).toBe(1);
    expect(quantile([0, 10], 0.5)).toBe(5);
    expect(quantile([0, 10], 0.9)).toBe(9);
  });

  it("requires an explicit candidate manifest before holdout execution", () => {
    expect(() => runCalibrationShard({ cohort: "holdout-v1", shard: { index: 1, count: 1 }, gameCommit: "test-commit" })).toThrow(/candidate manifest/u);
    const manifest = createCalibrationManifest("test-commit");
    const conditions = conditionsForCohort("holdout-v1", ["bonus50"]);
    const body = {
      schemaVersion: manifest.schemaVersion,
      version: manifest.version,
      kind: "holdout-candidate" as const,
      gameCommit: manifest.gameCommit,
      configChecksum: manifest.configChecksum,
      seedSetChecksum: manifest.seedSetChecksum,
      tuningReportChecksum: "0".repeat(64),
      tuningRunChecksum: "1".repeat(64),
      primary: "bonus50" as const,
      secondary: "bonus50" as const,
      conditions,
      conditionsChecksum: sha256Hex(stableJson(conditions)),
    };
    const candidate = { ...body, candidateChecksum: sha256Hex(stableJson(body)) };
    expect(() => validateCandidateManifest({ ...candidate, configChecksum: "f".repeat(64) }, manifest)).toThrow(/config/u);
    expect(() => validateCandidateManifest(candidate, manifest)).not.toThrow();
    expect(() => validateCandidateManifest({ ...candidate, secondary: null, candidateChecksum: sha256Hex(stableJson({ ...body, secondary: null })) }, manifest)).toThrow(/secondary/u);
  });
});

describe("pachi calibration run", () => {
  it("records deterministic public-session metrics and reaction policy facts", () => {
    const input: CalibrationCase = {
      cohort: "legacy",
      index: 0,
      seed: 1,
      condition: { policy: "fixed95", delaySeconds: 0, delayApplied: false },
    };
    const first = simulateCalibrationRun(input);
    const second = simulateCalibrationRun(input);
    expect(first).toEqual(second);
    expect(first.controllerTickMs).toBe(100);
    expect(first.fired).toBeGreaterThan(0);
    expect(first.scoreParts.shots).toBe(-first.fired * 10);
    expect(first.phase).toBe("result");
    expect(first.timedOut).toBe(false);
    expect(first.deadlineAt).not.toBeNull();

    const dynamic = simulateCalibrationRun({
      cohort: "legacy",
      index: 0,
      seed: 1,
      condition: { policy: "bonus50", delaySeconds: 0.3, delayApplied: true },
    });
    expect(dynamic.phase).toBe("result");
    expect(dynamic.timedOut).toBe(false);
    expect(Object.keys(dynamic.firedByPower)).toContain("0.95");
    expect(dynamic.openIntervals.every((interval) => !interval.successful || interval.dueEligible)).toBe(true);
    expect(dynamic.openIntervals.every((interval) => interval.postDueFired === interval.postDueBallIds.length)).toBe(true);
    expect(dynamic.openIntervals.every((interval) => interval.postDueAttackerHits === interval.postDueAttackerBallIds.length && interval.postDueAttackerBallIds.every((ballId) => interval.postDueBallIds.includes(ballId)))).toBe(true);
    expect(dynamic.openIntervals.filter((interval) => interval.actionDueAt !== null && interval.observedAt !== null).every((interval) => Math.abs((interval.actionDueAt ?? 0) - (interval.observedAt ?? 0) - 0.3) < 0.100001)).toBe(true);
  }, 30_000);

  it("rejects edited due state and missing terminal ball correlation", () => {
    const manifest = createCalibrationManifest("mutation");
    const condition = { policy: "bonus50" as const, delaySeconds: 0.3 as const, delayApplied: true };
    const conditionsChecksum = sha256Hex(stableJson([condition]));
    const run = simulateCalibrationRun({ cohort: "legacy", index: 0, seed: 1, condition }, manifest, conditionsChecksum);
    expect(() => validateCalibrationRun(run, manifest, condition)).not.toThrow();
    expect(() => validateCalibrationRun({ ...run, eventBallIds: {} }, manifest, condition)).toThrow(/correlation|ball-id/u);
    const dueIndex = run.openIntervals.findIndex((interval) => interval.actionDueAt !== null);
    expect(dueIndex).toBeGreaterThanOrEqual(0);
    const editedIntervals = run.openIntervals.map((interval, index) => index === dueIndex ? { ...interval, dueOpen: false } : interval);
    expect(() => validateCalibrationRun({ ...run, openIntervals: editedIntervals }, manifest, condition)).toThrow(/eligibility|due/u);
    const appliedIndex = run.openIntervals.findIndex((interval) => interval.actionAppliedAt !== null && interval.actionDueAt !== null);
    expect(appliedIndex).toBeGreaterThanOrEqual(0);
    const canceledAndApplied = run.openIntervals.map((interval, index) => index === appliedIndex
      ? { ...interval, actionCancelledAt: (interval.actionDueAt ?? 0) - 0.01 }
      : interval);
    expect(() => validateCalibrationRun({ ...run, openIntervals: canceledAndApplied }, manifest, condition)).toThrow(/cancelled and applied/u);
    const attackerIndex = run.openIntervals.findIndex((interval) => interval.postDueBallIds.length > 0);
    expect(attackerIndex).toBeGreaterThanOrEqual(0);
    const wrongAttackerId = run.openIntervals.map((interval, index) => index === attackerIndex
      ? { ...interval, postDueAttackerBallIds: [...interval.postDueAttackerBallIds, "missing-ball"] }
      : interval);
    expect(() => validateCalibrationRun({ ...run, openIntervals: wrongAttackerId }, manifest, condition)).toThrow(/attacker|post-due/u);
  }, 30_000);

  it("pairs candidate scores by seed without treating ties as positive", () => {
    const baseline = [
      { seed: 1, finalScore: 100 },
      { seed: 2, finalScore: 200 },
      { seed: 3, finalScore: 300 },
    ] as const;
    const candidate = [
      { seed: 1, finalScore: 200 },
      { seed: 2, finalScore: 200 },
      { seed: 3, finalScore: 100 },
    ] as const;
    const summary = pairedScoreSummary(
      candidate,
      baseline,
    );
    expect(summary.deltas).toEqual([-200, 0, 100]);
    expect(summary.positive).toBe(1);
    expect(summary.matched).toBe(3);
    expect(summary.rawInputChecksum).toMatch(/^[0-9a-f]{64}$/u);
    expect(summary.bootstrap95CiLower).toBeLessThanOrEqual(summary.bootstrap95CiUpper);
  });
});

describe("pachi calibration merge", () => {
  it("rejects duplicate runs and produces a deterministic sorted report", () => {
    const conditionChecksum = sha256Hex(stableJson(conditionsForCohort("legacy")));
    const run = simulateCalibrationRun({
      cohort: "legacy",
      index: 0,
      seed: 1,
      condition: { policy: "fixed95", delaySeconds: 0, delayApplied: false },
    }, createCalibrationManifest(), conditionChecksum);
    const base: CalibrationReport = {
      schemaVersion: run.schemaVersion,
      version: run.version,
      manifestChecksum: createCalibrationManifest().configChecksum,
      gameCommit: run.gameCommit,
      configChecksum: run.configChecksum,
      seedSetChecksum: run.seedSetChecksum,
      conditionsChecksum: sha256Hex(stableJson(conditionsForCohort("legacy"))),
      candidateChecksum: null,
      cohort: "legacy",
      shard: { index: 1, count: 1 },
      conditions: conditionsForCohort("legacy"),
      runs: [run],
    };
    expect(() => mergeCalibrationReports([base, base])).toThrow(/duplicate/u);
    expect(() => mergeCalibrationReports([base])).toThrow(/incomplete/u);
  }, 30_000);

  it("keeps one-process and split-shard merges byte-identical", () => {
    const fixture = syntheticTuningFixture();
    const split = Math.floor(fixture.runs.length / 2);
    const makeReport = (runs: typeof fixture.runs, shard: { readonly index: number; readonly count: number }): CalibrationReport => ({ ...fixture.report, shard, runs });
    const mergedSingle = mergeCalibrationReports([fixture.report]);
    const mergedSplit = mergeCalibrationReports([
      makeReport(fixture.runs.slice(0, split), { index: 1, count: 2 }),
      makeReport(fixture.runs.slice(split), { index: 2, count: 2 }),
    ]);
    expect(stableJson(mergedSingle)).toBe(stableJson(mergedSplit));
  }, 30_000);

  it("rejects manifest, invariant, evaluator, and holdout boundary edits", () => {
    const fixture = syntheticTuningFixture();
    expect(() => mergeCalibrationReports([{ ...fixture.report, gameCommit: "edited-commit" }])).toThrow(/manifest/u);
    expect(() => mergeCalibrationReports([{ ...fixture.report, configChecksum: "f".repeat(64) }])).toThrow(/manifest/u);
    expect(() => mergeCalibrationReports([{ ...fixture.report, seedSetChecksum: "e".repeat(64) }])).toThrow(/manifest/u);
    const invalidRunReport: CalibrationReport = {
      ...fixture.report,
      runs: fixture.runs.map((run, index) => index === 0 ? { ...run, invariantViolations: ["edited"] } : run),
    };
    expect(() => mergeCalibrationReports([invalidRunReport])).toThrow(/invariant violation/u);
    expect(() => evaluateCalibrationReport({ ...fixture.report, runs: fixture.runs.slice(0, -1) })).toThrow(/incomplete/u);

    const holdoutManifest = createCalibrationManifest("holdout-boundary");
    const candidateConditions = conditionsForCohort("holdout-v1", ["bonus50"]);
    const candidateBody = {
      schemaVersion: holdoutManifest.schemaVersion,
      version: holdoutManifest.version,
      kind: "holdout-candidate" as const,
      gameCommit: holdoutManifest.gameCommit,
      configChecksum: holdoutManifest.configChecksum,
      seedSetChecksum: holdoutManifest.seedSetChecksum,
      tuningReportChecksum: "0".repeat(64),
      tuningRunChecksum: "1".repeat(64),
      primary: "bonus50" as const,
      secondary: "bonus50" as const,
      conditions: candidateConditions,
      conditionsChecksum: sha256Hex(stableJson(candidateConditions)),
    };
    const candidate = { ...candidateBody, candidateChecksum: sha256Hex(stableJson(candidateBody)) };
    const holdoutReport: CalibrationReport = {
      schemaVersion: holdoutManifest.schemaVersion,
      version: holdoutManifest.version,
      manifestChecksum: holdoutManifest.configChecksum,
      gameCommit: holdoutManifest.gameCommit,
      configChecksum: holdoutManifest.configChecksum,
      seedSetChecksum: holdoutManifest.seedSetChecksum,
      conditionsChecksum: sha256Hex(stableJson(candidateConditions)),
      candidateChecksum: "2".repeat(64),
      cohort: "holdout-v1",
      shard: { index: 1, count: 1 },
      conditions: candidateConditions,
      runs: [],
    };
    expect(() => evaluateHoldoutReport(holdoutReport, candidate)).toThrow(/candidate manifest mismatch/u);
  }, 30_000);

  it("prioritizes a passing BONUS primary as the shared secondary", () => {
    const summary = (policy: CalibrationRun["policy"], medianDelta: number, bonusGate: TuningPolicySummary["bonusGate"], primaryAt03: boolean): TuningPolicySummary => ({
      policy,
      primaryAt03,
      primaryAt06Safety: primaryAt03,
      bonusOpenCount: 128,
      bonusSuccessRate: 0.9,
      bonusGate,
      scoreAt03: { medianDelta, q10Candidate: medianDelta, positiveRate: 0.7 } as TuningPolicySummary["scoreAt03"],
    } as TuningPolicySummary);
    const selected = selectCalibrationCandidates([
      summary("bonus50", 3_000, "pass", true),
      summary("bonus80", 4_000, "pass", false),
      summary("fullPause", 100, "indeterminate", false),
    ]);
    expect(selected.primary).toBe("bonus50");
    expect(selected.secondary).toBe("bonus50");
  });

  it("does not open holdout when the BONUS secondary gate is absent", () => {
    const fixture = syntheticTuningFixture();
    const blocked = {
      holdoutAllowed: true,
      primary: "fullPause" as const,
      secondary: null,
    } as TuningEvaluation;
    expect(() => createCandidateManifest(fixture.report, blocked)).toThrow(/complete passing|secondary/u);
  });
});
