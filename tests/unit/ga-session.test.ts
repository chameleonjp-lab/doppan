import { describe, expect, it } from "vitest";
import { GaSession } from "../../src/game";

function startBall(session: GaSession, chargeSteps = 1): void {
  expect(session.input.keyboardDown({ code: "Space", action: "plunger", receivedAtMs: 0 })).toBe(true);
  for (let step = 0; step < chargeSteps; step += 1) {
    session.advance(1000 / 60);
  }
  expect(session.input.keyboardUp("Space", 1)).toBe(true);
  session.advance(1000 / 60);
  expect(session.snapshot().phase).toBe("playing");
}

function completeL0(session: GaSession): void {
  let pressedAtStep: number | null = null;
  let released = false;
  for (let step = 0; step < 240; step += 1) {
    const before = session.snapshot();
    if (
      pressedAtStep === null &&
      before.ball.linearVelocity.y < 0 &&
      before.ball.position.x < 6.5 &&
      before.ball.position.y <= 3 &&
      before.ball.position.y > 1.5
    ) {
      pressedAtStep = step;
      expect(session.input.keyboardDown({ code: "Slash", action: "rightFlipper" })).toBe(true);
    }
    if (pressedAtStep !== null && !released && step >= pressedAtStep + 6) {
      expect(session.input.keyboardUp("Slash")).toBe(true);
      released = true;
    }
    session.advance(1000 / 60);
    if (session.snapshot().graybox.completedShotIds.includes("L0")) {
      session.advance(1000 / 60);
      return;
    }
  }
  throw new Error("L0 did not complete from player input");
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

    startBall(session, 72);
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
