import { describe, expect, it } from "vitest";
import { PachiSession } from "../../src/game/pachi-session";
import type { PachiSessionEvent, PachiSessionSnapshot } from "../../src/game/pachi-types";

const FRAME_MS = 1000 / 60;

function startFiring(session: PachiSession): void {
  session.start();
  session.setPower(0.95);
  session.setFiring(true);
}

function stepUntil(
  session: PachiSession,
  predicate: (snapshot: PachiSessionSnapshot) => boolean,
  maxFrames = 50 * 60,
): PachiSessionSnapshot {
  for (let frame = 0; frame < maxFrames; frame += 1) {
    const snapshot = session.step(FRAME_MS);
    if (predicate(snapshot)) return snapshot;
  }
  throw new Error("PachiSession predicate was not reached");
}

function runUntilResult(session: PachiSession, maxFrames = 90 * 60): PachiSessionSnapshot {
  for (let frame = 0; frame < maxFrames; frame += 1) {
    const snapshot = session.step(FRAME_MS);
    if (snapshot.phase === "result") return snapshot;
  }
  throw new Error("PachiSession did not reach result");
}

function comparableEvents(events: readonly PachiSessionEvent[]): readonly unknown[] {
  return events
    .filter((event) => event.type !== "spin-push")
    .map((event) => {
      const { id, ...withoutId } = event;
      void id;
      return withoutId;
    });
}

describe("PachiSession PUSH acknowledgement", () => {
  it("starts and resets at the calibrated 95 power", () => {
    const session = new PachiSession({ seed: 1, durationSeconds: 10 });
    expect(session.snapshot().power).toBe(0.95);
    expect(session.acknowledgePush()).toBe(false);
    session.setPower(0.5);
    session.reset();
    expect(session.snapshot().power).toBe(0.95);
    session.destroy();
  });

  it("is presentation-only: push and no-push have identical result and reveal timing", () => {
    const noPush = new PachiSession({ seed: 77, durationSeconds: 30 });
    const withPush = new PachiSession({ seed: 77, durationSeconds: 30 });
    startFiring(noPush);
    startFiring(withPush);

    let reach: PachiSessionSnapshot | undefined;
    let noPushReach: PachiSessionSnapshot | undefined;
    for (let frame = 0; frame < 50 * 60; frame += 1) {
      noPushReach = noPush.step(FRAME_MS);
      reach = withPush.step(FRAME_MS);
      if (reach.spin.pushState === "ready") break;
    }
    if (reach === undefined || noPushReach === undefined) throw new Error("reach was not reached");
    expect(noPushReach.spin.ticket).toBe(reach.spin.ticket);
    expect(noPushReach.spin.pushState).toBe("ready");
    const ticket = reach.spin.ticket;
    expect(ticket).not.toBeNull();
    expect(withPush.acknowledgePush(ticket ?? undefined)).toBe(true);
    expect(withPush.snapshot().spin.pushState).toBe("accepted");
    expect(withPush.acknowledgePush(ticket ?? undefined)).toBe(false);

    const pushedResult = runUntilResult(withPush);
    const allPushedEvents = withPush.drainEvents();
    const pushEvent = allPushedEvents.find((event) => event.type === "spin-push");
    expect(pushEvent).toBeDefined();
    expect(pushEvent?.win).toBeUndefined();
    expect(pushEvent?.digits).toBeUndefined();
    expect(allPushedEvents.some((event) => event.type === "spin-reveal" && event.win === false)).toBe(true);

    const plainResult = runUntilResult(noPush);
    expect(pushedResult).toMatchObject({
      score: plainResult.score,
      scoreParts: plainResult.scoreParts,
      ballsRemaining: plainResult.ballsRemaining,
      pending: plainResult.pending,
      stats: plainResult.stats,
    });
    expect(pushedResult.timeRemaining).toBe(plainResult.timeRemaining);

    const pushedEvents = comparableEvents(allPushedEvents);
    const plainEvents = comparableEvents(noPush.drainEvents());
    expect(pushedEvents).toEqual(plainEvents);
    expect(
      pushedEvents.filter((event) => (event as PachiSessionEvent).type === "spin-reveal"),
    ).toEqual(plainEvents.filter((event) => (event as PachiSessionEvent).type === "spin-reveal"));
    noPush.destroy();
    withPush.destroy();
  });

  it("keeps the guaranteed revival timing and payout unchanged", () => {
    const noPush = new PachiSession({ seed: 3, durationSeconds: 30 });
    const withPush = new PachiSession({ seed: 3, durationSeconds: 30 });
    for (const session of [noPush, withPush]) {
      session.start();
      session.setPower(0.8);
      session.setFiring(true);
    }

    let guaranteed: PachiSessionSnapshot | undefined;
    for (let frame = 0; frame < 30 * 60; frame += 1) {
      const plain = noPush.step(FRAME_MS);
      const pushed = withPush.step(FRAME_MS);
      if (pushed.spin.pushState === "ready" && pushed.spin.cue === "guaranteed") {
        guaranteed = pushed;
        expect(plain.spin.ticket).toBe(pushed.spin.ticket);
        expect(plain.spin.pushState).toBe("ready");
        break;
      }
    }
    expect(guaranteed).toBeDefined();
    const ticket = guaranteed?.spin.ticket;
    expect(withPush.acknowledgePush(ticket ?? undefined)).toBe(true);

    let plainRevival: PachiSessionSnapshot | undefined;
    let pushedRevival: PachiSessionSnapshot | undefined;
    for (let frame = 0; frame < 5 * 60; frame += 1) {
      plainRevival = noPush.step(FRAME_MS);
      pushedRevival = withPush.step(FRAME_MS);
      if (pushedRevival.spin.stage === "revival") break;
    }
    expect(plainRevival?.spin.stage).toBe("revival");
    expect(pushedRevival?.spin.stage).toBe("revival");
    expect(pushedRevival?.spin.elapsed).toBeGreaterThanOrEqual(3.1);
    expect(pushedRevival?.spin.elapsed).toBeLessThan(3.1 + 1 / 60);
    expect(pushedRevival?.spin.elapsed).toBe(plainRevival?.spin.elapsed);
    expect(pushedRevival?.scoreParts.jackpot).toBe(plainRevival?.scoreParts.jackpot);

    const plainJackpot = stepUntil(noPush, (snapshot) => snapshot.stats.jackpotCount > 0, 2 * 60);
    const pushedJackpot = stepUntil(withPush, (snapshot) => snapshot.stats.jackpotCount > 0, 2 * 60);
    expect(pushedJackpot.spin.elapsed).toBeGreaterThanOrEqual(3.75);
    expect(pushedJackpot.spin.elapsed).toBeLessThan(3.75 + 1 / 60);
    expect(pushedJackpot.spin.elapsed).toBe(plainJackpot.spin.elapsed);
    expect(pushedJackpot.scoreParts.jackpot).toBe(1500);
    expect(pushedJackpot.stats.jackpotCount).toBe(1);
    expect(pushedJackpot.scoreParts.jackpot).toBe(plainJackpot.scoreParts.jackpot);
    noPush.destroy();
    withPush.destroy();
  });

  it("accepts a reach that remains active during settling", () => {
    const session = new PachiSession({ seed: 3, durationSeconds: 19 });
    session.start();
    session.setPower(0.8);
    session.setFiring(true);
    let accepted = false;
    for (let frame = 0; frame < 40 * 60; frame += 1) {
      const snapshot = session.step(FRAME_MS);
      if (snapshot.phase === "settling" && snapshot.spin.pushState === "ready") {
        accepted = session.acknowledgePush(snapshot.spin.ticket ?? undefined);
        break;
      }
      if (snapshot.phase === "result") break;
    }
    expect(accepted).toBe(true);
    session.destroy();
  });

  it("keeps manual finish settlement identical after PUSH", () => {
    const noPush = new PachiSession({ seed: 77, durationSeconds: 30 });
    const withPush = new PachiSession({ seed: 77, durationSeconds: 30 });
    startFiring(noPush);
    startFiring(withPush);
    let ready: PachiSessionSnapshot | undefined;
    for (let frame = 0; frame < 50 * 60; frame += 1) {
      const plain = noPush.step(FRAME_MS);
      const pushed = withPush.step(FRAME_MS);
      if (pushed.spin.pushState === "ready") {
        ready = pushed;
        expect(plain.spin.ticket).toBe(pushed.spin.ticket);
        break;
      }
    }
    expect(ready).toBeDefined();
    expect(withPush.acknowledgePush(ready?.spin.ticket ?? undefined)).toBe(true);
    noPush.finish();
    withPush.finish();
    expect(withPush.snapshot()).toMatchObject({
      phase: "result",
      score: noPush.snapshot().score,
      scoreParts: noPush.snapshot().scoreParts,
      stats: noPush.snapshot().stats,
      ballsRemaining: noPush.snapshot().ballsRemaining,
    });
    expect(comparableEvents(withPush.drainEvents())).toEqual(comparableEvents(noPush.drainEvents()));
    noPush.destroy();
    withPush.destroy();
  });

  it("rejects stale, paused, late, and cross-ticket acknowledgements", () => {
    const session = new PachiSession({ seed: 77, durationSeconds: 30 });
    startFiring(session);
    const ready = stepUntil(session, (snapshot) => snapshot.spin.pushState === "ready");
    const ticket = ready.spin.ticket;
    expect(ticket).not.toBeNull();
    expect(session.acknowledgePush((ticket ?? 0) + 1)).toBe(false);
    expect(session.snapshot().spin.pushState).toBe("ready");

    session.setPaused(true);
    expect(session.acknowledgePush(ticket ?? undefined)).toBe(false);
    const pausedBefore = session.snapshot();
    const pausedAfter = session.step(5000);
    expect(pausedAfter.spin.pushState).toBe("ready");
    expect(pausedAfter.spin.elapsed).toBe(pausedBefore.spin.elapsed);
    expect(pausedAfter.timeRemaining).toBe(pausedBefore.timeRemaining);
    session.setPaused(false);
    expect(session.acknowledgePush(ticket ?? undefined)).toBe(true);
    expect(session.acknowledgePush(ticket ?? undefined)).toBe(false);

    const late = new PachiSession({ seed: 77, durationSeconds: 30 });
    startFiring(late);
    const lateReady = stepUntil(late, (snapshot) => snapshot.spin.pushState === "ready");
    const lateTicket = lateReady.spin.ticket;
    const revealed = stepUntil(late, (snapshot) => snapshot.spin.ticket === lateTicket && snapshot.spin.reveal !== "none");
    expect(revealed.spin.pushState).toBe("hidden");
    expect(late.acknowledgePush(lateTicket ?? undefined)).toBe(false);
    session.destroy();
    late.destroy();
  });

  it("does not accept PUSH after manual finish", () => {
    const session = new PachiSession({ seed: 77, durationSeconds: 30 });
    startFiring(session);
    const ready = stepUntil(session, (snapshot) => snapshot.spin.pushState === "ready");
    const ticket = ready.spin.ticket;
    session.finish();
    expect(session.snapshot().phase).toBe("result");
    expect(session.snapshot().spin.pushState).toBe("hidden");
    expect(session.acknowledgePush(ticket ?? undefined)).toBe(false);
    expect(session.drainEvents().some((event) => event.type === "spin-push")).toBe(false);
    session.destroy();
  });
});
