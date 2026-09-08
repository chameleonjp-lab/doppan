import { describe, expect, it } from "vitest";
import { PachiSession } from "../../src/game/pachi-session";
import type { PachiSessionEvent, PachiSessionSnapshot } from "../../src/game/pachi-types";
import {
  applyPachiFeedbackEvent,
  createPachiFeedbackState,
  getPachiVisualState,
  syncPachiFeedback,
} from "../../src/presentation/pachi-feedback";

const FIXED_STEP_MS = 1000 / 120;
const FIXED_STEP_SECONDS = 1 / 120;

function startSeedOne(): PachiSession {
  const session = new PachiSession({ seed: 1, durationSeconds: 90 });
  session.start();
  session.setPower(0.95);
  session.setFiring(true);
  session.drainEvents();
  return session;
}

function advanceOneTick(session: PachiSession): readonly [PachiSessionSnapshot, readonly PachiSessionEvent[]] {
  const snapshot = session.step(FIXED_STEP_MS);
  return [snapshot, session.drainEvents()];
}

describe("Pachi terminal settlement", () => {
  it("does not clear young terminal-BONUS balls at T98", () => {
    const session = startSeedOne();
    let deadlineAt: number | undefined;
    const firedAt = new Map<string, number>();
    let terminalOpenCount = 0;
    let sawT98Boundary = false;
    let survivedT98 = false;

    for (let tick = 0; tick < 110 * 120; tick += 1) {
      const before = session.snapshot();
      // The terminal BONUS accepts firing again at every open interval.
      if (before.phase === "settling" && before.rushStage === "open") session.setFiring(true);
      const [snapshot, events] = advanceOneTick(session);
      const deadline = events.find((event) => event.type === "deadline");
      if (deadline !== undefined) deadlineAt = deadline.at;
      for (const event of events) {
        if (event.type === "fired" && event.ballId !== undefined) firedAt.set(event.ballId, event.at);
        if (event.type === "jackpot-start" && event.opened === true && snapshot.phase === "settling") terminalOpenCount += 1;
        if (event.type !== "reclaimed" || event.reason !== "lifetime") continue;
        if (event.ballId === undefined) throw new Error("lifetime reclaim must identify its ball");
        const fired = firedAt.get(event.ballId);
        expect(fired).toBeDefined();
        // `fired` is emitted before the world advances its fixed step, while
        // the reclaim event is emitted after that step. One fixed step is the
        // timestamp boundary; the world age itself has already reached eight
        // seconds when the lifetime sweep removes the ball.
        if (fired !== undefined) expect(event.at - fired).toBeGreaterThanOrEqual(8 - FIXED_STEP_SECONDS - 1e-8);
      }
      if (!sawT98Boundary && deadlineAt !== undefined && (tick + 1) * FIXED_STEP_SECONDS - deadlineAt >= 8) {
        sawT98Boundary = true;
        // The snapshot immediately before T98 contains shots fired during the
        // terminal BONUS. A session-wide clear would remove all of these at
        // this boundary, even though their individual age is well below 8s.
        const freshBefore = before.balls.filter((ball) => ball.age < 0.1);
        expect(freshBefore.length).toBeGreaterThan(0);
        const freshIds = new Set(freshBefore.map((ball) => ball.id));
        survivedT98 = snapshot.balls.some((ball) => freshIds.has(ball.id));
      }
      if (sawT98Boundary && survivedT98) break;
    }

    expect(deadlineAt).toBeDefined();
    expect(sawT98Boundary).toBe(true);
    expect(survivedT98).toBe(true);
    // Seed 1 reaches the first terminal BONUS. Continuation outcomes are
    // intentionally seed-dependent; this regression only needs an actual
    // terminal open to prove the T98 boundary while a younger shot exists.
    expect(terminalOpenCount).toBeGreaterThanOrEqual(1);
  });

  it("reveals a post-terminal win for 0.72 seconds before the result", () => {
    const session = startSeedOne();
    let winReveal: PachiSessionSnapshot | undefined;
    let winTicket: number | null = null;
    let winAt: number | undefined;
    let revealEndedAt: number | undefined;
    let openedFalseCount = 0;
    let jackpotCountAtReveal = 0;
    let pendingAtReveal = 0;

    for (let tick = 0; tick < 180 * 120; tick += 1) {
      const before = session.snapshot();
      if (before.phase === "settling" && before.rushStage === "open") session.setFiring(true);
      const [snapshot, events] = advanceOneTick(session);
      const openedFalse = events.find((event) => event.type === "jackpot-start" && event.opened === false);
      if (openedFalse !== undefined) {
        openedFalseCount += 1;
        winReveal = snapshot;
        winTicket = snapshot.spin.ticket;
        winAt = openedFalse.at;
        jackpotCountAtReveal = snapshot.stats.jackpotCount;
        pendingAtReveal = snapshot.pending;
        expect(snapshot.phase).toBe("settling");
        expect(snapshot.rushStage).toBe("idle");
        expect(snapshot.jackpotRemaining).toBe(0);
        expect(snapshot.spin.stage).toBe("reveal");
        expect(snapshot.spin.reveal).toBe("win");
        expect(snapshot.spin.win).toBe(true);
        const digits = snapshot.spin.finalDigits;
        expect(digits).not.toBeNull();
        expect(digits?.[0]).toBe(digits?.[1]);
        expect(digits?.[1]).toBe(digits?.[2]);
      }
      if (winAt !== undefined && revealEndedAt === undefined && snapshot.spin.ticket === winTicket &&
          snapshot.spin.stage === "reveal" && snapshot.spin.reveal === "win") {
        expect(snapshot.pending).toBe(pendingAtReveal);
      }
      if (winAt !== undefined && revealEndedAt === undefined &&
          (snapshot.spin.ticket !== winTicket || snapshot.spin.stage !== "reveal" || snapshot.spin.reveal !== "win")) {
        revealEndedAt = (tick + 1) * FIXED_STEP_SECONDS;
      }
      if (snapshot.phase === "result") break;
    }

    expect(winReveal).toBeDefined();
    expect(openedFalseCount).toBe(1);
    expect(revealEndedAt).toBeDefined();
    const visibleFor = (revealEndedAt ?? 0) - (winAt ?? 0);
    expect(visibleFor).toBeGreaterThanOrEqual(0.72 - 1e-8);
    expect(visibleFor).toBeLessThanOrEqual(0.72 + FIXED_STEP_SECONDS + 1e-8);
    expect(session.snapshot().phase).toBe("result");
    expect(session.snapshot().stats.jackpotCount).toBe(jackpotCountAtReveal);
  });

  it("keeps the opened:false win announcement through incidental events", () => {
    const source = new PachiSession({ seed: 1, durationSeconds: 30 });
    const seed = source.snapshot();
    source.destroy();
    const reveal: PachiSessionSnapshot = {
      ...seed,
      phase: "settling",
      pending: 1,
      spin: {
        ...seed.spin,
        stage: "reveal",
        reveal: "win",
        title: "大当り",
        ticket: 20,
        stopped: [true, true, true],
        finalDigits: [7, 7, 7],
        win: true,
      },
    };
    let state = applyPachiFeedbackEvent(
      createPachiFeedbackState(),
      { id: 1, type: "jackpot-start", at: 1, score: 1500, opened: false },
      reveal,
    );
    expect(state).toMatchObject({ guard: "win", ticket: 20, spinStage: "reveal" });
    for (const event of [
      { id: 2, type: "start-entry", at: 1, accepted: true },
      { id: 3, type: "side-entry", at: 1 },
      { id: 4, type: "reclaimed", at: 1 },
      { id: 5, type: "fired", at: 1 },
    ] as const) {
      state = applyPachiFeedbackEvent(state, event, reveal);
    }
    expect(state.text).toBe("保留の大当たり ＋1,500点を受け取りました。");
    expect(syncPachiFeedback(state, { ...reveal, paused: true })).toMatchObject({
      guard: "win",
      text: "保留の大当たり ＋1,500点を受け取りました。",
    });
    expect(getPachiVisualState(reveal)).toEqual({ target: "none", stage: "reveal" });
  });
});
