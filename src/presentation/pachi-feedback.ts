import type {
  PachiPhase,
  PachiSessionEvent,
  PachiSessionSnapshot,
  PachiSpinStage,
} from "../game/pachi-types";

/** The board pocket that should receive the visual focus ring. */
export type PachiFocusTarget = "start" | "attacker" | "none";

/** Presentation stage shared by the DOM labels and the Pixi renderer. */
export type PachiPresentationStage =
  | "normal"
  | "preview"
  | "spinning"
  | "reach"
  | "revival"
  | "jackpot"
  | "judge"
  | "result";

export interface PachiVisualState {
  readonly target: PachiFocusTarget;
  readonly stage: PachiPresentationStage;
}

export type PachiFeedbackGuard =
  | "none"
  | "reach"
  | "push"
  | "bonus"
  | "judge"
  | "rush-end"
  | "result";

/**
 * State for the small event line under the board.
 *
 * This module intentionally contains no timer.  An announcement is replaced
 * by a meaningful state transition or by result disclosure, rather than by a
 * wall-clock lease that can race with a same-step physics event.
 */
export interface PachiFeedbackState {
  readonly text: string;
  readonly guard: PachiFeedbackGuard;
  readonly phase: PachiPhase;
  readonly ticket: number | null;
  readonly spinStage: PachiSpinStage;
}

const EMPTY_FEEDBACK: PachiFeedbackState = Object.freeze({
  text: "",
  guard: "none",
  phase: "idle",
  ticket: null,
  spinStage: "idle",
});

/** Start a new presentation lifecycle without carrying a previous cue. */
export function createPachiFeedbackState(): PachiFeedbackState {
  return EMPTY_FEEDBACK;
}

function context(snapshot: PachiSessionSnapshot): Pick<PachiFeedbackState, "phase" | "ticket" | "spinStage"> {
  return {
    phase: snapshot.phase,
    ticket: snapshot.spin.ticket,
    spinStage: snapshot.spin.stage,
  };
}

/**
 * Derive board focus from the session snapshot only.
 *
 * It deliberately does not inspect spin.win, spin.reveal, pending cues, or
 * rushResult.  Those values disclose a result before the presentation stage
 * is allowed to do so.  `paused` likewise leaves the physical focus intact;
 * the existing renderer clock is responsible for stopping motion.
 */
export function getPachiVisualState(snapshot: PachiSessionSnapshot): PachiVisualState {
  if (snapshot.phase === "result") return { target: "none", stage: "result" };
  if (snapshot.phase === "idle") return { target: "none", stage: "normal" };
  if (snapshot.jackpotRemaining > 0) return { target: "attacker", stage: "jackpot" };
  if (snapshot.rushStage === "judge") return { target: "none", stage: "judge" };
  if (snapshot.spin.stage === "reach") return { target: "none", stage: "reach" };
  if (snapshot.spin.stage === "revival") return { target: "none", stage: "revival" };

  if (snapshot.phase === "playing" && snapshot.pending < 4) {
    if (snapshot.spin.stage === "preview") return { target: "start", stage: "preview" };
    if (snapshot.spin.stage === "spinning") return { target: "start", stage: "spinning" };
    return { target: "start", stage: "normal" };
  }

  return { target: "none", stage: "normal" };
}

const eventText = (event: PachiSessionEvent, snapshot?: PachiSessionSnapshot): string | null => {
  switch (event.type) {
    case "started":
      return "強さを調整して、中央の入賞口を狙おう。";
    case "start-entry":
      return event.accepted === false
        ? snapshot?.phase === "playing" ? "保留満タン：中央の得点・払い玉なし" : "時間終了：中央の得点・払い玉なし"
        : "中央入賞 ＋50点・3玉！ 保留がたまる。";
    case "side-entry":
      return "副入賞 ＋20点・2玉。";
    case "spin-start":
      return "図柄が回りはじめた。";
    case "spin-reach":
      return "リーチ！ 真ん中がそろえば大当たり。";
    case "spin-push":
      return "PUSH受付！ 結果を待とう。";
    case "spin-reveal":
      return event.win === false ? "はずれ。5回続くと、次は大当たり。" : "大当たり！";
    case "jackpot-start":
      return event.opened === false
        ? "保留の大当たり ＋1,500点を受け取りました。"
        : snapshot?.phase === "settling"
          ? "最後のラッシュ！ 発射して得点口を狙えます。"
        : "大当たり ＋1,500点！ 光る得点口で稼ごう。";
    case "attacker-entry":
      return "得点口に入賞！ ＋100点・5玉。";
    case "jackpot-end":
      return "得点口が閉じた。";
    case "rush-judge":
      return "継続判定中。結果を待とう。";
    case "rush-continue":
      return "RUSH継続！ 得点口がもう6秒開きます。";
    case "rush-end":
      return "RUSH終了。残った保留へ進みます。";
    case "deadline":
      return event.reason === "balls-exhausted"
        ? "持ち玉終了。今回の結果です。"
        : snapshot?.jackpotRemaining && snapshot.jackpotRemaining > 0
          ? "時間終了。最後の得点口を狙えます。"
        : "時間終了。残った玉と保留を受け取ろう。";
    case "reclaimed":
      return "止まった玉を回収しました。プレイを続けられます。";
    case "rush-start":
      return null;
    case "result":
      return "今回の結果を確認しよう。";
    case "fired":
    case "drain":
      return null;
  }
};

const isProtectedReachEvent = (event: PachiSessionEvent): boolean =>
  event.type === "spin-reach" || event.type === "spin-push";

const isBonusImportantEvent = (event: PachiSessionEvent): boolean =>
  event.type === "jackpot-start" || event.type === "rush-continue" || event.type === "attacker-entry";

const isResultDisclosureEvent = (event: PachiSessionEvent): boolean =>
  event.type === "spin-reveal" || event.type === "jackpot-start" || event.type === "rush-continue" ||
  event.type === "rush-end" || event.type === "result";

/**
 * Apply one session event to the presentation state.
 *
 * Event order is significant: session events from one fixed step are drained
 * in their original order.  Guards below ensure a START/side/reclaim event
 * cannot erase reach, PUSH, BONUS, or the one-shot rush-end cue in that list.
 */
export function applyPachiFeedbackEvent(
  state: PachiFeedbackState,
  event: PachiSessionEvent,
  snapshot: PachiSessionSnapshot,
): PachiFeedbackState {
  const values = context(snapshot);

  if (event.type === "started") {
    return { ...values, text: eventText(event, snapshot) ?? "", guard: "none" };
  }

  // The scope belongs to the snapshot that emitted rush-end.  A later event
  // may carry a newer ticket/stage; release the guard before reducing it so a
  // harmless fired/drain event cannot silently move the scope forward.
  if (state.guard === "rush-end" &&
      (state.ticket !== values.ticket || state.spinStage !== values.spinStage)) {
    state = { ...EMPTY_FEEDBACK, ...values };
  }

  if (event.type === "result") {
    return { ...values, text: eventText(event, snapshot) ?? "", guard: "result" };
  }

  if (state.guard === "result" && snapshot.phase === "result") return { ...state, ...values };

  // The one-second judge is intentionally neutral.  In particular, do not
  // read or format snapshot.rushResult while it is in this state.
  if (snapshot.rushStage === "judge" || state.guard === "judge") {
    if (event.type === "rush-judge") {
      return { ...values, text: eventText(event, snapshot) ?? "継続判定中。結果を待とう。", guard: "judge" };
    }
    if (event.type !== "rush-continue" && event.type !== "rush-end") return { ...state, ...values };
  }

  // A reach/PUSH cue survives all incidental pocket events until the result
  // is disclosed by spin-reveal or the corresponding BONUS transition.
  if ((state.guard === "reach" || state.guard === "push") && event.type !== "spin-push" &&
      !isResultDisclosureEvent(event)) {
    return { ...state, ...values };
  }

  // While the attacker is actually open, only the three meaningful reward
  // events are allowed to alter the important announcement.  The event type
  // is used as well as the snapshot because jackpot-end may share a step with
  // the last attacker entry.
  if (snapshot.jackpotRemaining > 0 && !isBonusImportantEvent(event)) {
    if (event.type !== "rush-end" && event.type !== "rush-continue") return { ...state, ...values };
  }

  // rush-end is scoped to the currently displayed ticket/stage.  A same-step
  // spin-start/side/start/reclaim therefore cannot erase it.  sync below
  // releases this guard when the next display stage really appears.
  if (state.guard === "rush-end" && event.type !== "rush-continue" && event.type !== "rush-end" &&
      event.type !== "spin-reach" && event.type !== "spin-push" && event.type !== "spin-reveal") {
    return { ...state, phase: values.phase };
  }

  const text = eventText(event, snapshot);
  if (text === null) return { ...state, ...values };

  let guard: PachiFeedbackGuard = "none";
  if (isProtectedReachEvent(event)) guard = event.type === "spin-push" ? "push" : "reach";
  else if (event.type === "jackpot-start" && event.opened !== false) guard = "bonus";
  else if (event.type === "rush-continue") guard = "bonus";
  else if (event.type === "rush-judge") guard = "judge";
  else if (event.type === "rush-end") guard = "rush-end";

  return { ...values, text, guard };
}

/**
 * Reconcile a feedback state on a snapshot-only update.
 *
 * This is intentionally conservative: normal cues may remain until another
 * event, while lifecycle changes clear stale protected cues.  No time lease
 * is involved.
 */
export function syncPachiFeedback(
  state: PachiFeedbackState,
  snapshot: PachiSessionSnapshot,
): PachiFeedbackState {
  const values = context(snapshot);
  if (snapshot.phase === "idle") return { ...EMPTY_FEEDBACK, ...values };
  if (snapshot.phase === "result" && state.guard !== "result") return { ...EMPTY_FEEDBACK, ...values };

  if (state.phase !== snapshot.phase && state.guard !== "reach" && state.guard !== "push") {
    return { ...EMPTY_FEEDBACK, ...values };
  }

  if (state.guard === "rush-end" &&
      (state.ticket !== snapshot.spin.ticket || state.spinStage !== snapshot.spin.stage)) {
    return { ...EMPTY_FEEDBACK, ...values };
  }
  if (state.guard === "bonus" && snapshot.jackpotRemaining <= 0) {
    return { ...EMPTY_FEEDBACK, ...values };
  }
  if (state.guard === "judge" && snapshot.rushStage !== "judge") {
    return { ...EMPTY_FEEDBACK, ...values };
  }
  return { ...state, ...values };
}
