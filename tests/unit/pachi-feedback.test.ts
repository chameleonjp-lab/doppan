import { describe, expect, it } from "vitest";
import { PachiSession } from "../../src/game/pachi-session";
import type { PachiSessionEvent, PachiSessionSnapshot, PachiSpinSnapshot } from "../../src/game/pachi-types";
import {
  applyPachiFeedbackEvent,
  createPachiFeedbackState,
  getPachiChargeText,
  getPachiMissFeedbackText,
  getPachiVisualState,
  syncPachiFeedback,
} from "../../src/presentation/pachi-feedback";

const seedSession = new PachiSession({ seed: 1, durationSeconds: 30 });
const seedSnapshot = seedSession.snapshot();
seedSession.destroy();

type SnapshotOverrides = Omit<Partial<PachiSessionSnapshot>, "spin"> & { spin?: Partial<PachiSpinSnapshot> };

function snapshot(overrides: SnapshotOverrides = {}): PachiSessionSnapshot {
  return {
    ...seedSnapshot,
    ...overrides,
    spin: { ...seedSnapshot.spin, ...(overrides.spin ?? {}) },
  };
}

function event(
  type: PachiSessionEvent["type"],
  values: Partial<Omit<PachiSessionEvent, "id" | "type" | "at">> = {},
): PachiSessionEvent {
  return { id: 1, type, at: 0, ...values };
}

describe("Pachi visual focus and feedback", () => {
  it("uses only public presentation state for target priority", () => {
    expect(getPachiVisualState(snapshot())).toEqual({ target: "none", stage: "normal" });
    expect(getPachiVisualState(snapshot({ phase: "playing", pending: 0 }))).toEqual({ target: "start", stage: "normal" });
    expect(getPachiVisualState(snapshot({ phase: "playing", pending: 4 }))).toEqual({ target: "none", stage: "normal" });
    expect(getPachiVisualState(snapshot({ phase: "playing", pending: 1, spin: { stage: "preview" } }))).toEqual({ target: "start", stage: "preview" });
    expect(getPachiVisualState(snapshot({ phase: "playing", pending: 1, spin: { stage: "spinning" } }))).toEqual({ target: "start", stage: "spinning" });
    expect(getPachiVisualState(snapshot({ phase: "playing", spin: { stage: "reach" } }))).toEqual({ target: "none", stage: "reach" });
    expect(getPachiVisualState(snapshot({ phase: "playing", spin: { stage: "revival" } }))).toEqual({ target: "none", stage: "revival" });
    expect(getPachiVisualState(snapshot({ phase: "settling", pending: 1 }))).toEqual({ target: "none", stage: "normal" });
    expect(getPachiVisualState(snapshot({ phase: "playing", pending: 4, jackpotRemaining: 2, rushStage: "open" }))).toEqual({ target: "attacker", stage: "jackpot" });
  });

  it("keeps paused focus identical and hides both possible judge results", () => {
    const active = snapshot({ phase: "playing", pending: 1, paused: false, spin: { stage: "spinning" } });
    const paused = snapshot({ ...active, paused: true });
    expect(getPachiVisualState(paused)).toEqual(getPachiVisualState(active));

    const judgeContinue = snapshot({ phase: "playing", rushStage: "judge", rushResult: "continue", rushRound: 1 });
    const judgeEnd = snapshot({ phase: "playing", rushStage: "judge", rushResult: "end", rushRound: 1 });
    expect(getPachiVisualState(judgeContinue)).toEqual({ target: "none", stage: "judge" });
    expect(getPachiVisualState(judgeEnd)).toEqual(getPachiVisualState(judgeContinue));
    const trueAnnouncement = applyPachiFeedbackEvent(createPachiFeedbackState(), event("rush-judge"), judgeContinue);
    const falseAnnouncement = applyPachiFeedbackEvent(createPachiFeedbackState(), event("rush-judge"), judgeEnd);
    expect(trueAnnouncement).toMatchObject({ text: "継続判定中。結果を待とう。", guard: "judge" });
    expect(falseAnnouncement).toEqual(trueAnnouncement);
    let judging = trueAnnouncement;
    judging = applyPachiFeedbackEvent(judging, event("start-entry", { accepted: true }), judgeEnd);
    judging = applyPachiFeedbackEvent(judging, event("reclaimed"), judgeEnd);
    expect(judging.text).toBe("継続判定中。結果を待とう。");
    const continued = applyPachiFeedbackEvent(
      judging,
      event("rush-continue"),
      snapshot({ phase: "playing", rushStage: "open", jackpotRemaining: 3 }),
    );
    expect(continued.text).toContain("RUSH継続");
    const ended = applyPachiFeedbackEvent(
      judging,
      event("rush-end"),
      snapshot({ phase: "playing", rushStage: "idle", jackpotRemaining: 0 }),
    );
    expect(ended.text).toContain("RUSH終了");
    expect(getPachiVisualState(snapshot({ phase: "result", rushStage: "judge", rushResult: "continue" }))).toEqual({ target: "none", stage: "result" });
  });

  it("does not mutate a snapshot while deriving visual state", () => {
    const input = snapshot({ phase: "playing", pending: 1, jackpotRemaining: 2, rushStage: "open", spin: { stage: "spinning" } });
    const before = structuredClone(input);
    getPachiVisualState(input);
    expect(input).toEqual(before);
  });

  it("protects reach and PUSH from incidental pocket events until disclosure", () => {
    const reach = snapshot({ phase: "playing", pending: 1, spin: { stage: "reach", ticket: 7, reach: true } });
    let state = createPachiFeedbackState();
    state = applyPachiFeedbackEvent(state, event("spin-reach"), reach);
    state = applyPachiFeedbackEvent(state, event("start-entry", { accepted: true }), reach);
    state = applyPachiFeedbackEvent(state, event("side-entry"), reach);
    state = applyPachiFeedbackEvent(state, event("reclaimed"), reach);
    expect(state.text).toContain("リーチ");

    state = applyPachiFeedbackEvent(state, event("spin-push"), reach);
    expect(state.text).toBe("PUSH受付！ 結果を待とう。");
    state = applyPachiFeedbackEvent(state, event("start-entry", { accepted: true }), reach);
    expect(state.text).toBe("PUSH受付！ 結果を待とう。");

    const reveal = snapshot({ phase: "playing", pending: 1, spin: { stage: "reveal", ticket: 7, reveal: "miss" } });
    state = applyPachiFeedbackEvent(state, event("spin-reveal", { win: false }), reveal);
    expect(state.text).toContain("はずれ");
  });

  it("keeps a revealed miss and its current charge through incidental events", () => {
    const reveal = snapshot({
      phase: "playing",
      pending: 1,
      charge: 4,
      spin: { stage: "reveal", ticket: 7, reveal: "miss" },
    });
    expect(getPachiVisualState(reveal)).toEqual({ target: "none", stage: "reveal" });
    expect(getPachiMissFeedbackText(reveal)).toBe("はずれ。チャージ 4 / 5。");

    let state = applyPachiFeedbackEvent(createPachiFeedbackState(), event("spin-reveal", { win: false }), reveal);
    expect(state).toMatchObject({ text: "はずれ。チャージ 4 / 5。", guard: "miss", ticket: 7, spinStage: "reveal" });
    for (const incidental of [
      event("start-entry", { accepted: true }),
      event("side-entry"),
      event("reclaimed"),
      event("fired"),
      event("drain"),
    ]) {
      state = applyPachiFeedbackEvent(state, incidental, reveal);
    }
    expect(state.text).toBe("はずれ。チャージ 4 / 5。");

    const settlingReveal = snapshot({
      phase: "settling",
      pending: 1,
      charge: 4,
      spin: { stage: "reveal", ticket: 7, reveal: "miss" },
    });
    state = applyPachiFeedbackEvent(state, event("deadline", { reason: "time" }), settlingReveal);
    expect(state).toMatchObject({ text: "はずれ。チャージ 4 / 5。", guard: "miss", phase: "settling" });
    expect(syncPachiFeedback(state, { ...settlingReveal, paused: true })).toMatchObject({ guard: "miss", text: "はずれ。チャージ 4 / 5。" });

    const reset = snapshot({ phase: "idle" });
    expect(syncPachiFeedback(state, reset)).toMatchObject({ text: "", guard: "none", phase: "idle" });
    const result = snapshot({ phase: "result" });
    expect(syncPachiFeedback(state, result)).toMatchObject({ text: "", guard: "none", phase: "result" });
    expect(applyPachiFeedbackEvent(state, event("result"), result)).toMatchObject({
      text: "今回の結果を確認しよう。",
      guard: "result",
      phase: "result",
    });
  });

  it("reports the fifth revealed miss as the next guaranteed win", () => {
    const fifthMiss = snapshot({
      phase: "playing",
      pending: 1,
      charge: 5,
      spin: { stage: "reveal", ticket: 7, reveal: "miss" },
    });
    expect(getPachiChargeText(fifthMiss)).toBe("チャージ 5 / 5 · 次は大当たり");
    expect(getPachiMissFeedbackText(fifthMiss)).toBe("はずれ。チャージ 5 / 5 · 次は大当たり。");
    const state = applyPachiFeedbackEvent(createPachiFeedbackState(), event("spin-reveal", { win: false }), fifthMiss);
    expect(state.text).toBe("はずれ。チャージ 5 / 5 · 次は大当たり。");
  });

  it("releases the miss guard before a newer ticket, including a fired event first", () => {
    const reveal = snapshot({ phase: "playing", pending: 1, charge: 4, spin: { stage: "reveal", ticket: 7, reveal: "miss" } });
    let state = applyPachiFeedbackEvent(createPachiFeedbackState(), event("spin-reveal", { win: false }), reveal);
    const nextTicket = snapshot({ phase: "playing", pending: 1, charge: 4, spin: { stage: "spinning", ticket: 8, reveal: "none" } });
    state = applyPachiFeedbackEvent(state, event("fired"), nextTicket);
    expect(state).toMatchObject({ text: "", guard: "none", ticket: 8, spinStage: "spinning" });
    state = applyPachiFeedbackEvent(state, event("spin-start"), nextTicket);
    expect(state.text).toBe("図柄が回りはじめた。");

    const oldRevealEventAfterAdvance = applyPachiFeedbackEvent(
      state,
      event("spin-reveal", { win: false }),
      nextTicket,
    );
    expect(oldRevealEventAfterAdvance.text).not.toContain("はずれ");
    expect(oldRevealEventAfterAdvance.guard).toBe("none");
  });

  it("does not derive a reveal or miss text from unrevealed outcome fields", () => {
    const hiddenMiss = snapshot({
      phase: "playing",
      pending: 1,
      charge: 4,
      pendingCues: ["guaranteed"],
      spin: { stage: "spinning", ticket: 7, reveal: "miss", cue: "guaranteed" },
    });
    expect(getPachiVisualState(hiddenMiss)).toEqual({ target: "start", stage: "spinning" });
    expect(getPachiMissFeedbackText(hiddenMiss)).toBeNull();
    expect(getPachiVisualState(snapshot({
      phase: "playing",
      pending: 1,
      spin: { stage: "reveal", ticket: 7, reveal: "none" },
    }))).toEqual({ target: "start", stage: "normal" });
  });

  it("allows only reward events to replace an open BONUS announcement", () => {
    const open = snapshot({ phase: "playing", pending: 1, jackpotRemaining: 3, rushStage: "open" });
    let state = applyPachiFeedbackEvent(createPachiFeedbackState(), event("jackpot-start", { opened: true }), open);
    expect(state.text).toContain("大当たり");
    for (const incidental of [
      event("start-entry", { accepted: true }),
      event("side-entry"),
      event("reclaimed"),
      event("spin-start"),
    ]) {
      state = applyPachiFeedbackEvent(state, incidental, open);
    }
    expect(state.text).toContain("大当たり");
    state = applyPachiFeedbackEvent(state, event("attacker-entry"), open);
    expect(state.text).toBe("得点口に入賞！ ＋100点・5玉。");
  });

  it("keeps rush-end visible through same-step events, then clears at the next stage", () => {
    const sameStep = snapshot({
      phase: "playing",
      spin: { stage: "spinning", ticket: 8 },
      rushStage: "idle",
      jackpotRemaining: 0,
    });
    let state = applyPachiFeedbackEvent(createPachiFeedbackState(), event("rush-end"), sameStep);
    state = applyPachiFeedbackEvent(state, event("spin-start"), sameStep);
    state = applyPachiFeedbackEvent(state, event("side-entry"), sameStep);
    expect(state.text).toBe("RUSH終了。残った保留へ進みます。");

    const nextStage = snapshot({ phase: "playing", spin: { stage: "reach", ticket: 8 } });
    state = applyPachiFeedbackEvent(state, event("fired"), nextStage);
    state = applyPachiFeedbackEvent(state, event("side-entry"), nextStage);
    expect(syncPachiFeedback(state, nextStage)).toMatchObject({ guard: "none" });
    expect(syncPachiFeedback(state, nextStage).text).toContain("副入賞");
  });

  it("clears a protected cue on reset/result lifecycle changes", () => {
    const reach = snapshot({ phase: "playing", spin: { stage: "reach", ticket: 2 } });
    let state = applyPachiFeedbackEvent(createPachiFeedbackState(), event("spin-reach"), reach);
    const reset = snapshot({ phase: "idle" });
    state = syncPachiFeedback(state, reset);
    expect(state).toMatchObject({ text: "", guard: "none", phase: "idle" });
    const result = snapshot({ phase: "result" });
    expect(syncPachiFeedback(state, result)).toMatchObject({ text: "", guard: "none", phase: "result" });
  });
});
