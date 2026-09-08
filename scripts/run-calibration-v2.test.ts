import { execFile as execFileCallback } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import {
  conditionsForCohort,
  createCandidateManifest,
  createCalibrationManifest,
  evaluateCalibrationReport,
  evaluateHoldoutReport,
  mergeCalibrationReports,
  runCalibrationShard,
  stableJson,
  validateCandidateManifest,
  type CalibrationCohort,
  type CalibrationCandidateManifest,
  type CalibrationReport,
} from "./pachi-calibration-v2";

const execFile = promisify(execFileCallback);

function parseShard(value: string): { readonly index: number; readonly count: number } {
  const match = /^(\d+)\/(\d+)$/u.exec(value);
  if (match === null) throw new Error(`invalid DOPPAN_CALIBRATION_SHARD: ${value}`);
  return { index: Number(match[1]), count: Number(match[2]) };
}

it("runs the v2 calibration harness when explicitly enabled", async () => {
  const enabled = process.env.DOPPAN_CALIBRATION_RUN === "1";
  if (!enabled) {
    expect(createCalibrationManifest("test").tuningConditions).toHaveLength(15);
    return;
  }
  const gameCommit = process.env.DOPPAN_CALIBRATION_COMMIT;
  if (gameCommit === undefined || gameCommit.length === 0 || gameCommit === "unknown" || gameCommit === "uncommitted") {
    throw new Error("DOPPAN_CALIBRATION_COMMIT must be an explicit game commit SHA");
  }
  const actualCommit = (await execFile("git", ["rev-parse", "HEAD"])).stdout.trim();
  if (actualCommit !== gameCommit) throw new Error(`DOPPAN_CALIBRATION_COMMIT does not match HEAD: ${actualCommit}`);
  const dirty = (await execFile("git", ["status", "--porcelain", "--untracked-files=no"])).stdout.trim();
  if (dirty.length > 0) throw new Error("calibration requires a clean tracked worktree");
  const cohort = (process.env.DOPPAN_CALIBRATION_COHORT ?? "tuning-v1") as CalibrationCohort;
  const shard = parseShard(process.env.DOPPAN_CALIBRATION_SHARD ?? "1/1");
  if (process.env.DOPPAN_CALIBRATION_MANIFEST === "1") {
    console.log(JSON.stringify(createCalibrationManifest(gameCommit), null, 2));
    return;
  }
  const candidatePath = process.env.DOPPAN_CALIBRATION_CANDIDATE_MANIFEST;
  if (cohort === "holdout-v1" && candidatePath === undefined) throw new Error("holdout-v1 requires DOPPAN_CALIBRATION_CANDIDATE_MANIFEST");
  if (cohort !== "holdout-v1" && candidatePath !== undefined) throw new Error("candidate manifest is only valid for holdout-v1");
  const candidate = candidatePath === undefined ? undefined : JSON.parse(await readFile(resolve(candidatePath), "utf8")) as CalibrationCandidateManifest;
  if (candidate !== undefined) validateCandidateManifest(candidate, createCalibrationManifest(gameCommit));
  const mergePaths = process.env.DOPPAN_CALIBRATION_MERGE?.split(",").filter(Boolean) ?? [];
  const evaluatePath = process.env.DOPPAN_CALIBRATION_EVALUATE;
  if (evaluatePath !== undefined) {
    const report = JSON.parse(await readFile(resolve(evaluatePath), "utf8")) as CalibrationReport;
    const evaluation = report.cohort === "tuning-v1"
      ? evaluateCalibrationReport(report, gameCommit)
      : report.cohort === "holdout-v1" && candidate !== undefined
        ? evaluateHoldoutReport(report, candidate, gameCommit)
        : (() => { throw new Error("evaluation requires a complete tuning report or a holdout candidate manifest"); })();
    console.log(stableJson(evaluation));
    const candidateOut = process.env.DOPPAN_CALIBRATION_CANDIDATE_OUT;
    if (candidateOut !== undefined) {
      if (report.cohort !== "tuning-v1") throw new Error("candidate output requires a tuning report");
      const candidateManifest = createCandidateManifest(report, evaluateCalibrationReport(report, gameCommit));
      await mkdir(dirname(resolve(candidateOut)), { recursive: true });
      await writeFile(resolve(candidateOut), `${stableJson(candidateManifest)}\n`, "utf8");
      console.log(`candidate manifest: ${candidateOut}`);
    }
    return;
  }
  let report: CalibrationReport;
  if (mergePaths.length > 0) {
    const reports = await Promise.all(mergePaths.map(async (path) => JSON.parse(await readFile(resolve(path), "utf8")) as CalibrationReport));
    report = mergeCalibrationReports(reports, gameCommit);
  } else {
    report = candidate === undefined
      ? runCalibrationShard({ cohort, shard, gameCommit })
      : runCalibrationShard({ cohort, shard, gameCommit, candidateManifest: candidate });
  }
  const output = stableJson(report);
  const out = process.env.DOPPAN_CALIBRATION_OUT;
  if (out === undefined) console.log(output);
  else {
    await mkdir(dirname(resolve(out)), { recursive: true });
    await writeFile(resolve(out), `${output}\n`, "utf8");
    console.log(`calibration output: ${out}`);
  }
  expect(report.runs.length).toBeGreaterThan(0);
  if (cohort === "holdout-v1") expect(conditionsForCohort(cohort, [candidate?.primary ?? "fullPause", ...(candidate?.secondary === null || candidate?.secondary === undefined ? [] : [candidate.secondary])]).length).toBeGreaterThan(3);
  const candidateOut = process.env.DOPPAN_CALIBRATION_CANDIDATE_OUT;
  if (candidateOut !== undefined) {
    if (report.cohort !== "tuning-v1") throw new Error("candidate output requires a tuning report");
    const evaluation = evaluateCalibrationReport(report, gameCommit);
    const candidateManifest = createCandidateManifest(report, evaluation);
    await mkdir(dirname(resolve(candidateOut)), { recursive: true });
    await writeFile(resolve(candidateOut), `${stableJson(candidateManifest)}\n`, "utf8");
    console.log(`candidate manifest: ${candidateOut}`);
  }
});
