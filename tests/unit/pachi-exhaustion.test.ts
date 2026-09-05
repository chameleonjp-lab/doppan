import { expect, it } from "vitest";
import { PachiSession } from "../../src/game/pachi-session";

it("ends when every ball and pending chance is gone instead of waiting out the clock", () => {
  const session = new PachiSession({ seed: 1 });
  session.start();
  session.setPower(0);
  session.setFiring(true);
  for (let frame = 0; frame < 600 && session.snapshot().phase !== "result"; frame += 1) session.step(100);
  const result = session.snapshot();
  expect(result.phase).toBe("result");
  expect(result.ballsRemaining).toBe(0);
  expect(result.balls).toHaveLength(0);
  expect(result.pending).toBe(0);
  expect(result.rushStage).toBe("idle");
  const events = session.drainEvents();
  const deadline = events.find((event) => event.type === "deadline");
  expect(deadline?.reason).toBe("balls-exhausted");
  expect(deadline?.at).toBeLessThan(60);
  expect(events.filter((event) => event.type === "result")).toHaveLength(1);
  expect(session.step(5000)).toEqual(result);
  session.destroy();
});
