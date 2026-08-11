import { describe, expect, it } from "vitest";
import { GaSession } from "../../src/game";

function startBall(session: GaSession): void {
  expect(session.input.keyboardDown({ code: "Space", action: "plunger", receivedAtMs: 0 })).toBe(true);
  session.advance(1000 / 60);
  expect(session.input.keyboardUp("Space", 1)).toBe(true);
  session.advance(1000 / 60);
  expect(session.snapshot().phase).toBe("playing");
}

function completeL0(session: GaSession): void {
  for (const sensorId of ["L0-entry", "L0-checkpoint", "L0-exit"]) {
    const sensor = session.world.table.sensors.find((candidate) => candidate.id === sensorId);
    if (sensor === undefined) {
      throw new Error(`missing sensor ${sensorId}`);
    }
    session.world.ballBody.setTransform({ x: sensor.position.x, y: sensor.position.y - 0.35 }, 0);
    session.world.ballBody.setLinearVelocity({ x: 0, y: 6 });
    session.advance(1000 / 60);
    session.advance(1000 / 60);
  }
  session.advance(1000 / 60);
}

function drainBall(session: GaSession): void {
  session.world.ballBody.setTransform({ x: 4.5, y: 0.1 }, 0);
  session.world.ballBody.setLinearVelocity({ x: 0, y: -4 });
  for (let step = 0; step < 8; step += 1) {
    session.advance(1000 / 60);
    if (session.snapshot().phase === "ball-ending" || session.snapshot().phase === "result") {
      return;
    }
  }
  throw new Error("ball did not end in the expected number of steps");
}

function advanceToNextBall(session: GaSession): void {
  for (let step = 0; step < 4; step += 1) {
    session.advance(1000 / 60);
    if (session.snapshot().phase === "launch-ready") {
      return;
    }
  }
  throw new Error("next ball did not become ready");
}

describe("GaSession", () => {
  it("keeps progress across three balls, resets combo per ball, and ends with a result", () => {
    const session = new GaSession({ physicsStepHz: 60 });

    expect(session.snapshot()).toMatchObject({
      phase: "launch-ready",
      currentBall: 1,
      ballsRemaining: 3,
      completedBalls: 0,
      result: null,
    });

    startBall(session);
    completeL0(session);
    expect(session.snapshot().graybox).toMatchObject({ score: 100, progress: 1 / 5, combo: 1 });

    drainBall(session);
    expect(session.snapshot()).toMatchObject({
      phase: "ball-ending",
      currentBall: 1,
      ballsRemaining: 2,
      completedBalls: 1,
    });
    expect(session.snapshot().graybox.combo).toBe(0);

    advanceToNextBall(session);
    expect(session.snapshot()).toMatchObject({ phase: "launch-ready", currentBall: 2 });
    startBall(session);
    drainBall(session);
    advanceToNextBall(session);
    expect(session.snapshot()).toMatchObject({ phase: "launch-ready", currentBall: 3, ballsRemaining: 1 });

    startBall(session);
    drainBall(session);
    expect(session.snapshot()).toMatchObject({
      phase: "result",
      currentBall: 3,
      ballsRemaining: 0,
      completedBalls: 3,
      result: {
        score: 100,
        progress: 1 / 5,
      },
    });
    expect(session.gameState.baseState).toBe("Result");

    const report = session.playtestReport();
    expect(report).toMatchObject({
      schemaVersion: 1,
      ruleVersion: "ga-vertical-slice-1",
      totalBalls: 3,
      completedBalls: 3,
      ballsRemaining: 0,
      score: 100,
      phase: "result",
    });
    expect(report.events.filter((event) => event.type === "ball-end")).toHaveLength(3);
    expect(report.events.some((event) => event.type === "game-end")).toBe(true);
    expect(JSON.stringify(report)).not.toMatch(/localStorage|playerName|userId|playedAt/);
    expect(session.input.keyboardDown({ code: "Space", action: "plunger", receivedAtMs: 0 })).toBe(false);

    session.reset();
    expect(session.snapshot()).toMatchObject({
      phase: "launch-ready",
      currentBall: 1,
      ballsRemaining: 3,
      completedBalls: 0,
      result: null,
    });
    expect(session.snapshot().graybox).toMatchObject({ score: 0, progress: 0, combo: 0 });
    session.destroy();
  });

});
