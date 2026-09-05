import { describe, expect, it } from "vitest";
import { PachiSession } from "../../src/game/pachi-session";

function run(session: PachiSession, seconds: number): void {
  const frames = Math.ceil(seconds * 60);
  for (let frame = 0; frame < frames; frame += 1) session.step(1000 / 60);
}

describe("PachiSession", () => {
  it("connects real launches, START, spin, jackpot, attacker, and result", () => {
    const session = new PachiSession({ seed: 1, durationSeconds: 40 });
    session.start();
    session.setPower(0.95);
    session.setFiring(true);
    run(session, 100);

    const snapshot = session.snapshot();
    const events = session.drainEvents();
    expect(snapshot.phase).toBe("result");
    expect(snapshot.stats.fired).toBeGreaterThan(0);
    expect(snapshot.stats.startEntries).toBeGreaterThan(0);
    expect(snapshot.stats.jackpotCount).toBeGreaterThan(0);
    expect(snapshot.stats.attackerEntries).toBeGreaterThan(0);
    expect(snapshot.scoreParts.shots).toBeLessThan(0);
    expect(snapshot.scoreParts.start).toBeGreaterThan(0);
    expect(snapshot.scoreParts.jackpot).toBeGreaterThan(0);
    expect(events.some((event) => event.type === "jackpot-start")).toBe(true);
    expect(events.some((event) => event.type === "jackpot-end")).toBe(true);
    expect(events.some((event) => event.type === "result")).toBe(true);
    expect(snapshot.balls.length).toBe(0);
  });

  it("makes launch power affect real START/side entry distribution", () => {
    const low = new PachiSession({ seed: 1, durationSeconds: 30 });
    const high = new PachiSession({ seed: 1, durationSeconds: 30 });
    low.start();
    high.start();
    low.setPower(0);
    high.setPower(0.95);
    low.setFiring(true);
    high.setFiring(true);
    run(low, 30);
    run(high, 30);

    expect(low.snapshot().stats.fired).toBeGreaterThan(0);
    expect(high.snapshot().stats.fired).toBeGreaterThan(0);
    expect(low.snapshot().stats.startEntries + low.snapshot().stats.sideEntries).toBeGreaterThan(0);
    expect(high.snapshot().stats.startEntries).toBeGreaterThan(low.snapshot().stats.startEntries);
  });

  it("stops firing at the deadline, pauses every clock, and is frame partition invariant", () => {
    const oneFrame = new PachiSession({ seed: 42, durationSeconds: 20 });
    const splitFrames = new PachiSession({ seed: 42, durationSeconds: 20 });
    for (const session of [oneFrame, splitFrames]) {
      session.start();
      session.setPower(0.8);
      session.setFiring(true);
    }
    oneFrame.step(5000);
    for (let i = 0; i < 300; i += 1) splitFrames.step(1000 / 60);
    expect(oneFrame.snapshot().score).toBe(splitFrames.snapshot().score);
    expect(oneFrame.snapshot().stats).toEqual(splitFrames.snapshot().stats);

    const beforePause = oneFrame.snapshot();
    oneFrame.setPaused(true);
    oneFrame.step(5000);
    const paused = oneFrame.snapshot();
    expect(paused.paused).toBe(true);
    expect(paused.timeRemaining).toBe(beforePause.timeRemaining);
    expect(paused.score).toBe(beforePause.score);
    expect(paused.stats).toEqual(beforePause.stats);
    oneFrame.setPaused(false);
    oneFrame.finish();
    expect(oneFrame.snapshot().timeRemaining).toBe(0);
    expect(oneFrame.snapshot().firing).toBe(false);
    run(oneFrame, 70);
    expect(oneFrame.snapshot().phase).toBe("result");
  });

  it("fully resets the in-memory game and deterministic stream", () => {
    const session = new PachiSession({ seed: 7, durationSeconds: 10 });
    session.start();
    session.setFiring(true);
    run(session, 2);
    expect(session.snapshot().stats.fired).toBeGreaterThan(0);
    session.reset();
    const reset = session.snapshot();
    expect(reset.phase).toBe("idle");
    expect(reset.ballsRemaining).toBe(80);
    expect(reset.score).toBe(0);
    expect(reset.pending).toBe(0);
    expect(reset.balls).toHaveLength(0);
    expect(session.drainEvents()).toHaveLength(0);
  });
});
