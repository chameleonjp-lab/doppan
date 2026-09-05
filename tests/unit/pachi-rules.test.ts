import { describe, expect, it } from "vitest";
import { PachiSession } from "../../src/game/pachi-session";
import type { PachiSessionEvent, PachiSessionSnapshot } from "../../src/game/pachi-types";

const FRAME_MS = 1000 / 60;

function stepUntil(
  session: PachiSession,
  predicate: (snapshot: PachiSessionSnapshot) => boolean,
  maxFrames: number,
): PachiSessionSnapshot | undefined {
  for (let frame = 0; frame < maxFrames; frame += 1) {
    const snapshot = session.step(FRAME_MS);
    if (predicate(snapshot)) return snapshot;
  }
  return undefined;
}

function runUntilResult(session: PachiSession, maxFrames = 80 * 60): PachiSessionSnapshot {
  for (let frame = 0; frame < maxFrames; frame += 1) {
    const snapshot = session.step(FRAME_MS);
    if (snapshot.phase === "result") return snapshot;
  }
  return session.snapshot();
}

function startFiring(session: PachiSession, power = 0.8): void {
  session.start();
  session.setPower(power);
  session.setFiring(true);
}

function latestEvent(events: readonly PachiSessionEvent[], type: PachiSessionEvent["type"]): PachiSessionEvent | undefined {
  return [...events].reverse().find((event) => event.type === type);
}

describe("PachiSession rule boundaries", () => {
  it("keeps tickets FIFO, caps pending at four, and awards each revealed win once", () => {
    const session = new PachiSession({ seed: 5, durationSeconds: 30 });
    startFiring(session, 0.95);

    const activeTicketIds: number[] = [];
    let maxPending = 0;
    for (let frame = 0; frame < 15 * 60; frame += 1) {
      const snapshot = session.step(FRAME_MS);
      maxPending = Math.max(maxPending, snapshot.pending);
      const ticket = snapshot.spin.ticket;
      if (ticket !== null && activeTicketIds.at(-1) !== ticket) activeTicketIds.push(ticket);
    }
    const result = runUntilResult(session);
    const events = session.drainEvents();

    expect(result.phase).toBe("result");
    expect(maxPending).toBe(4);
    expect(activeTicketIds.length).toBeGreaterThan(1);
    expect(new Set(activeTicketIds).size).toBe(activeTicketIds.length);
    expect(activeTicketIds).toEqual([...activeTicketIds].sort((left, right) => left - right));

    const winningReveals = events.filter((event) => event.type === "spin-reveal" && event.win === true);
    const jackpotStarts = events.filter((event) => event.type === "jackpot-start");
    expect(winningReveals.length).toBeGreaterThan(0);
    expect(jackpotStarts.length).toBe(winningReveals.length);
    expect(result.stats.jackpotCount).toBe(winningReveals.length);
    expect(result.scoreParts.jackpot).toBe(winningReveals.length * 1500);
  });

  it("does not reward rejected START entries at a full queue or after T90", () => {
    const fullQueue = new PachiSession({ seed: 5, durationSeconds: 30 });
    startFiring(fullQueue, 0.95);
    let fullQueueReached = false;
    let rejectedWhilePlaying: PachiSessionEvent | undefined;

    for (let frame = 0; frame < 20 * 60 && rejectedWhilePlaying === undefined; frame += 1) {
      const before = fullQueue.snapshot();
      fullQueue.drainEvents();
      const after = fullQueue.step(FRAME_MS);
      const events = fullQueue.drainEvents();
      if (after.pending === 4 || events.some((event) => event.type === "start-entry" && event.pending === 4)) {
        fullQueueReached = true;
      }
      const startEvents = events.filter((event) => event.type === "start-entry");
      const rejected = startEvents.find((event) => event.accepted === false);
      if (rejected === undefined || !fullQueueReached) continue;

      const acceptedStarts = startEvents.filter((event) => event.accepted === true).length;
      const fired = events.filter((event) => event.type === "fired").length;
      const sideEntries = events.filter((event) => event.type === "side-entry").length;
      const attackerEntries = events.filter((event) => event.type === "attacker-entry").length;
      expect(rejected.pending).toBe(4);
      expect(after.phase).toBe("playing");
      expect(after.firing).toBe(true);
      expect(after.scoreParts.start).toBe(before.scoreParts.start + acceptedStarts * 50);
      expect(after.ballsRemaining).toBe(
        before.ballsRemaining - fired + acceptedStarts * 3 + sideEntries * 2 + attackerEntries * 5,
      );
      expect(after.stats.startEntries - before.stats.startEntries).toBe(startEvents.length);
      rejectedWhilePlaying = rejected;
    }

    expect(rejectedWhilePlaying).toBeDefined();

    const naturalDeadline = new PachiSession({ seed: 5, durationSeconds: 10 });
    startFiring(naturalDeadline, 0.95);
    let deadlineAt: number | undefined;
    let rejectedAfterDeadline: PachiSessionEvent | undefined;
    for (let frame = 0; frame < 80 * 60 && naturalDeadline.snapshot().phase !== "result"; frame += 1) {
      const before = naturalDeadline.snapshot();
      naturalDeadline.drainEvents();
      const after = naturalDeadline.step(FRAME_MS);
      const events = naturalDeadline.drainEvents();
      const deadline = events.find((event) => event.type === "deadline");
      if (deadline !== undefined) deadlineAt = deadline.at;
      if (deadlineAt === undefined) continue;
      const knownDeadlineAt = deadlineAt;

      const startEvents = events.filter((event) => event.type === "start-entry");
      const rejected = startEvents.find((event) => event.accepted === false && event.at > knownDeadlineAt);
      if (rejected === undefined) continue;
      const acceptedStarts = startEvents.filter((event) => event.accepted === true).length;
      const fired = events.filter((event) => event.type === "fired").length;
      const sideEntries = events.filter((event) => event.type === "side-entry").length;
      const attackerEntries = events.filter((event) => event.type === "attacker-entry").length;
      expect(after.phase).toBe("settling");
      expect(after.scoreParts.start).toBe(before.scoreParts.start + acceptedStarts * 50);
      expect(after.ballsRemaining).toBe(
        before.ballsRemaining - fired + acceptedStarts * 3 + sideEntries * 2 + attackerEntries * 5,
      );
      rejectedAfterDeadline = rejected;
    }

    expect(deadlineAt).toBeDefined();
    expect(rejectedAfterDeadline).toBeDefined();
    expect(rejectedAfterDeadline?.at).toBeGreaterThan(deadlineAt ?? Number.POSITIVE_INFINITY);
  });

  it("shows five misses before the guarantee, pauses revival, and commits one award", () => {
    const session = new PachiSession({ seed: 3, durationSeconds: 30 });
    startFiring(session);

    const guaranteed = stepUntil(
      session,
      (snapshot) => snapshot.spin.stage === "spinning" && snapshot.spin.cue === "guaranteed",
      30 * 60,
    );
    expect(guaranteed).toBeDefined();
    expect(guaranteed?.charge).toBe(5);
    expect(guaranteed?.spin.win).toBe(false);

    const beforeRevivalEvents = session.drainEvents();
    expect(beforeRevivalEvents.filter((event) => event.type === "spin-reveal" && event.win === false)).toHaveLength(5);

    const revival = stepUntil(session, (snapshot) => snapshot.spin.stage === "revival", 5 * 60);
    expect(revival).toBeDefined();
    expect(revival?.spin.reveal).toBe("復活");
    expect(revival?.spin.win).toBe(false);
    expect(revival?.stats.jackpotCount).toBe(0);

    const scoreBeforePause = revival?.score ?? 0;
    session.drainEvents();
    session.setPaused(true);
    const paused = session.step(5000);
    expect(paused.spin.stage).toBe("revival");
    expect(paused.score).toBe(scoreBeforePause);
    expect(paused.stats.jackpotCount).toBe(0);
    expect(session.drainEvents()).toHaveLength(0);

    session.setPaused(false);
    const jackpot = stepUntil(session, (snapshot) => snapshot.spin.stage === "jackpot", 2 * 60);
    expect(jackpot).toBeDefined();
    expect(jackpot?.scoreParts.jackpot).toBe(1500);
    expect(jackpot?.stats.jackpotCount).toBe(1);

    const awardEvents = session.drainEvents().filter((event) => event.type === "jackpot-start");
    expect(awardEvents).toHaveLength(1);
    runUntilResult(session);
    expect(session.snapshot().stats.jackpotCount).toBe(1);
  });

  it("does not expose outcome or reach before the visible reel stage", () => {
    const session = new PachiSession({ seed: 3, durationSeconds: 30 });
    startFiring(session);

    let spinning: PachiSessionSnapshot | undefined;
    for (let frame = 0; frame < 30 * 60; frame += 1) {
      const snapshot = session.step(FRAME_MS);
      if (snapshot.charge < 5) expect(snapshot.pendingCues).not.toContain("guaranteed");
      if (snapshot.spin.stage === "spinning" && snapshot.spin.cue === "guaranteed") {
        spinning = snapshot;
        break;
      }
    }
    expect(spinning).toBeDefined();
    expect(spinning?.spin.win).toBe(false);
    expect(spinning?.spin.reach).toBe(false);
    expect(spinning?.spin.reveal).toBe("none");
    const finalDigits = spinning?.spin.finalDigits;
    if (finalDigits !== null && finalDigits !== undefined) {
      expect(finalDigits.every((digit) => digit === null)).toBe(true);
    }

    const startEvents = session.drainEvents().filter((event) => event.type === "spin-start");
    const guaranteedStart = [...startEvents].reverse().find((event) => event.cue === "guaranteed");
    expect(guaranteedStart).toBeDefined();
    expect(guaranteedStart?.win).toBeUndefined();
    expect(guaranteedStart?.digits).toBeUndefined();

    const reach = stepUntil(session, (snapshot) => snapshot.spin.stage === "reach", 3 * 60);
    expect(reach).toBeDefined();
    expect(reach?.spin.reach).toBe(true);
    expect(reach?.spin.win).toBe(false);
    const reachEvent = latestEvent(session.drainEvents(), "spin-reach");
    expect(reachEvent).toBeDefined();
    expect(reachEvent?.win).toBeUndefined();
  });

  it("preserves an accepted winning ticket through manual finish", () => {
    const session = new PachiSession({ seed: 3, durationSeconds: 30 });
    startFiring(session);

    const accepted = stepUntil(
      session,
      (snapshot) => snapshot.spin.stage === "spinning" && snapshot.spin.cue === "guaranteed",
      30 * 60,
    );
    expect(accepted).toBeDefined();
    const scoreBeforeFinish = session.snapshot().scoreParts.jackpot;

    session.setFiring(false);
    session.finish();
    expect(["settling", "result"]).toContain(session.snapshot().phase);
    const result = session.snapshot().phase === "result" ? session.snapshot() : runUntilResult(session);
    const events = session.drainEvents();

    expect(result.phase).toBe("result");
    expect(result.scoreParts.jackpot).toBeGreaterThan(scoreBeforeFinish);
    expect(result.stats.jackpotCount).toBeGreaterThan(0);
    expect(events.some((event) => event.type === "result")).toBe(true);
  });

  it("preserves a winning ticket accepted immediately before the natural deadline", () => {
    const session = new PachiSession({ seed: 3, durationSeconds: 19 });
    startFiring(session, 0.8);

    let accepted = false;
    for (let frame = 0; frame < 23 * 60; frame += 1) {
      const snapshot = session.step(FRAME_MS);
      accepted ||= snapshot.spin.stage === "spinning" && snapshot.spin.cue === "guaranteed";
    }
    expect(accepted).toBe(true);
    expect(session.snapshot().phase).toBe("settling");

    const result = runUntilResult(session);
    const events = session.drainEvents();
    const deadline = latestEvent(events, "deadline");
    const jackpot = latestEvent(events, "jackpot-start");
    const finished = latestEvent(events, "result");

    expect(result.phase).toBe("result");
    expect(result.stats.jackpotCount).toBeGreaterThan(0);
    expect(result.scoreParts.jackpot).toBeGreaterThan(0);
    expect(deadline).toBeDefined();
    expect(jackpot).toBeDefined();
    expect(finished).toBeDefined();
    expect(deadline?.at).toBeLessThan(jackpot?.at ?? Number.POSITIVE_INFINITY);
    expect(jackpot?.at).toBeLessThan(finished?.at ?? Number.POSITIVE_INFINITY);
  });

  it("keeps the finite BONUS visible, pauses FIFO, and ends after at most three rounds", () => {
    const session = new PachiSession({ seed: 19, durationSeconds: 40 });
    startFiring(session, 0.95);

    const bonusSnapshots: PachiSessionSnapshot[] = [];
    let bonusStarted = false;
    let pendingAtBonusStart = -1;
    let bonusEnded = false;
    for (let frame = 0; frame < 40 * 60; frame += 1) {
      const snapshot = session.step(FRAME_MS);
      if (!bonusStarted && snapshot.rushStage === "open") {
        bonusStarted = true;
        pendingAtBonusStart = snapshot.pending;
        session.setFiring(false);
      }
      if (bonusStarted && snapshot.rushStage !== "idle") bonusSnapshots.push(snapshot);
      if (bonusStarted && snapshot.rushStage === "idle") {
        bonusEnded = true;
        break;
      }
    }

    expect(bonusStarted).toBe(true);
    expect(bonusEnded).toBe(true);
    expect(pendingAtBonusStart).toBe(4);
    expect(bonusSnapshots.length).toBeGreaterThan(0);
    expect(Math.max(...bonusSnapshots.map((snapshot) => snapshot.rushRound))).toBe(3);
    expect(new Set(bonusSnapshots.map((snapshot) => snapshot.rushRound))).toEqual(new Set([1, 2, 3]));
    expect(session.snapshot().stats.rushContinuations).toBe(2);

    for (const snapshot of bonusSnapshots) {
      expect(snapshot.pending).toBe(pendingAtBonusStart);
      expect(snapshot.scoreParts.jackpot).toBe(1500);
      expect(snapshot.rushRemaining).toBe(3 - snapshot.rushRound);
      if (snapshot.rushStage === "open") expect(snapshot.jackpotRemaining).toBeGreaterThan(0);
      if (snapshot.rushStage === "judge") expect(snapshot.jackpotRemaining).toBe(0);
    }
    expect(session.snapshot().rushStage).toBe("idle");
  });

  it("counts real attacker entries only while open and never scores the closed gate", () => {
    const open = new PachiSession({ seed: 1, durationSeconds: 20 });
    startFiring(open);

    let attackerSnapshot: PachiSessionSnapshot | undefined;
    for (let frame = 0; frame < 20 * 60; frame += 1) {
      const snapshot = open.step(FRAME_MS);
      const events = open.drainEvents();
      if (events.some((event) => event.type === "attacker-entry")) {
        attackerSnapshot = snapshot;
        break;
      }
    }

    expect(attackerSnapshot).toBeDefined();
    expect(attackerSnapshot?.jackpotRemaining).toBeGreaterThan(0);
    expect(attackerSnapshot?.stats.attackerEntries).toBeGreaterThan(0);
    expect(attackerSnapshot?.scoreParts.attacker).toBe((attackerSnapshot?.stats.attackerEntries ?? 0) * 100);

    const closed = new PachiSession({ seed: 3, durationSeconds: 4 });
    startFiring(closed);
    for (let frame = 0; frame < 4 * 60; frame += 1) closed.step(FRAME_MS);
    const closedSnapshot = closed.snapshot();
    expect(closedSnapshot.stats.fired).toBeGreaterThan(0);
    expect(closed.world.snapshot().attackerOpen).toBe(false);
    expect(closedSnapshot.stats.attackerEntries).toBe(0);
    expect(closedSnapshot.scoreParts.attacker).toBe(0);
  });
});
