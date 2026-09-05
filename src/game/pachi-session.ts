import { PachiWorld } from "../physics/pachi-world";
import { PACHI_DEFAULT_POWER } from "./pachi-power";
import {
  PACHI_DEFAULT_DURATION_SECONDS,
  PACHI_DEFAULT_GEOMETRY,
  PACHI_FIRE_INTERVAL_SECONDS,
  PACHI_FIXED_HZ,
  PACHI_FIXED_STEP_MS,
  PACHI_INITIAL_BALLS,
  PACHI_JACKPOT_SECONDS,
  PACHI_MAX_PENDING,
  PACHI_MAX_SETTLE_SECONDS,
  PACHI_MAX_SESSION_SETTLE_SECONDS,
  PACHI_PREVIEW_SECONDS,
} from "./pachi-types";
import type {
  PachiPhase,
  PachiScoreParts,
  PachiSessionEvent,
  PachiSessionEventType,
  PachiSessionOptions,
  PachiSessionSnapshot,
  PachiSpinSnapshot,
  PachiStatsSnapshot,
  PachiTicketCue,
  PachiDisplayDigits,
  PachiPushState,
  PachiRushResult,
  PachiRushStage,
} from "./pachi-types";

const SPIN_LEFT_STOP = 0.85;
const SPIN_RIGHT_STOP = 1.55;
const SPIN_MIDDLE_STOP = 2.25;
const SPIN_REACH_REVEAL = 3.1;
const SPIN_PLAIN_REVEAL = 2.35;
const REVEAL_HOLD = 0.72;
const REVIVAL_FAKE_STOP_SECONDS = 0.25;
const REVIVAL_RESTART_SECONDS = 0.4;

interface Ticket {
  readonly id: number;
  readonly win: boolean;
  readonly digits: readonly [number, number, number];
  readonly reach: boolean;
  readonly cue: PachiTicketCue;
  /** Two continuation draws, fixed when this winning ticket is accepted. */
  readonly rushDecisions: readonly [boolean, boolean];
}

interface ActiveSpin {
  readonly ticket: Ticket;
  elapsed: number;
  stage: PachiSpinSnapshot["stage"];
  stopped: [boolean, boolean, boolean];
  reveal: PachiSpinSnapshot["reveal"];
  title: string;
  holdRemaining: number;
  reachEventSent: boolean;
  revealEventSent: boolean;
  revival: boolean;
  pushState: PachiPushState;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

function normalizeSeed(seed: number | undefined): number {
  if (seed === undefined || !Number.isFinite(seed)) return 0x6d2b79f5;
  const normalized = (Math.trunc(seed) >>> 0) || 0x6d2b79f5;
  return normalized;
}

/**
 * A single deterministic stream serves both launch spread and lottery.  The
 * renderer never calls Math.random, so a replay with the same seed has the
 * same pocket and result sequence.
 */
class SeededRandom {
  private state: number;

  public constructor(private readonly initial: number) {
    this.state = initial;
  }

  public reset(): void {
    this.state = this.initial;
  }

  public next(): number {
    let value = this.state;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.state = value >>> 0;
    return this.state / 0x100000000;
  }
}

/**
 * Owns one in-memory pachinko play.  It is intentionally independent from
 * browser time: callers provide frame deltas and all timers advance on the
 * same fixed 120 Hz boundary as the Planck world.
 */
export class PachiSession {
  private readonly seed: number;
  private readonly durationSeconds: number;
  private random: SeededRandom;
  private worldValue: PachiWorld;
  private phaseValue: PachiPhase = "idle";
  private pausedValue = false;
  private powerValue: number = PACHI_DEFAULT_POWER;
  private firingValue = false;
  private timeRemainingValue: number;
  private elapsedValue = 0;
  private settleElapsed = 0;
  private fireTimer = 0;
  private previewRemainingValue = 0;
  private ballsRemainingValue: number = PACHI_INITIAL_BALLS;
  private scoreValue = 0;
  private scorePartsValue: PachiScoreParts = {
    shots: 0,
    start: 0,
    side: 0,
    jackpot: 0,
    attacker: 0,
  };
  private pendingTickets: Ticket[] = [];
  private nextTicketId = 1;
  private spinValue: ActiveSpin | null = null;
  private rushRoundValue = 0;
  private rushStageValue: PachiRushStage = "idle";
  private rushJudgeRemainingValue = 0;
  private rushResultValue: PachiRushResult = null;
  private rushRemainingValue = 0;
  private activeJackpotTicket: Ticket | null = null;
  /** Once a post-deadline BONUS has been used, later wins only pay base points. */
  private settlingBonusClaimedValue = false;
  /** Hidden reservation count used by the strict five-miss guarantee. */
  private missesSinceWinValue = 0;
  /** Only revealed losses are shown in the chance/charge meter. */
  private displayedMissesValue = 0;
  private jackpotRemainingValue = 0;
  private deadlineReached = false;
  private ballCollectionSettled = false;
  private eventSequence = 1;
  private readonly events: PachiSessionEvent[] = [];
  private statsValue: PachiStatsSnapshot = {
    fired: 0,
    startEntries: 0,
    sideEntries: 0,
    jackpotCount: 0,
    attackerEntries: 0,
    rushContinuations: 0,
    reclaimedBalls: 0,
    completedSpins: 0,
    missesSinceWin: 0,
  };
  private destroyedValue = false;

  public constructor(options: PachiSessionOptions = {}) {
    this.seed = normalizeSeed(options.seed);
    const requestedDuration = options.durationSeconds ?? PACHI_DEFAULT_DURATION_SECONDS;
    if (!Number.isFinite(requestedDuration) || requestedDuration <= 0) {
      throw new RangeError("durationSeconds must be finite and positive");
    }
    this.durationSeconds = requestedDuration;
    this.timeRemainingValue = requestedDuration;
    this.random = new SeededRandom(this.seed);
    this.worldValue = this.createWorld();
  }

  public get world(): PachiWorld {
    this.assertAlive();
    return this.worldValue;
  }

  public get phase(): PachiPhase {
    return this.phaseValue;
  }

  public get physicsStepHz(): typeof PACHI_FIXED_HZ {
    return PACHI_FIXED_HZ;
  }

  public start(): void {
    this.assertAlive();
    if (this.phaseValue !== "idle") return;
    this.phaseValue = "playing";
    this.emit("started");
  }

  public reset(): void {
    this.assertAlive();
    this.worldValue.destroy();
    this.random.reset();
    this.worldValue = this.createWorld();
    this.phaseValue = "idle";
    this.pausedValue = false;
    this.powerValue = PACHI_DEFAULT_POWER;
    this.firingValue = false;
    this.timeRemainingValue = this.durationSeconds;
    this.elapsedValue = 0;
    this.settleElapsed = 0;
    this.fireTimer = 0;
    this.previewRemainingValue = 0;
    this.frameRemainderMs = 0;
    this.ballsRemainingValue = PACHI_INITIAL_BALLS;
    this.scoreValue = 0;
    this.scorePartsValue = { shots: 0, start: 0, side: 0, jackpot: 0, attacker: 0 };
    this.pendingTickets = [];
    this.nextTicketId = 1;
    this.spinValue = null;
    this.rushRoundValue = 0;
    this.rushStageValue = "idle";
    this.rushJudgeRemainingValue = 0;
    this.rushResultValue = null;
    this.rushRemainingValue = 0;
    this.activeJackpotTicket = null;
    this.settlingBonusClaimedValue = false;
    this.missesSinceWinValue = 0;
    this.displayedMissesValue = 0;
    this.jackpotRemainingValue = 0;
    this.deadlineReached = false;
    this.ballCollectionSettled = false;
    this.eventSequence = 1;
    this.events.length = 0;
    this.statsValue = {
      fired: 0,
      startEntries: 0,
      sideEntries: 0,
      jackpotCount: 0,
      attackerEntries: 0,
      rushContinuations: 0,
      reclaimedBalls: 0,
      completedSpins: 0,
      missesSinceWin: 0,
    };
  }

  public setPower(power: number): void {
    this.assertAlive();
    if (!Number.isFinite(power)) throw new RangeError("power must be finite");
    this.powerValue = clamp(power, 0, 1);
  }

  public setFiring(firing: boolean): void {
    this.assertAlive();
    if (!firing) {
      this.firingValue = false;
      return;
    }
    // After the deadline the handle is accepted only while the six-second
    // attacker is open; this makes the exception explicit in the API.
    if (this.phaseValue === "playing" || (this.phaseValue === "settling" && this.jackpotRemainingValue > 0)) {
      this.firingValue = true;
    }
  }

  /**
   * Acknowledge the currently active reach without changing its outcome.
   *
   * PUSH is deliberately accepted only in the short, visible reach window.
   * The optional ticket id lets a delayed UI event prove that it still refers
   * to the same ticket; omitting it is safe for direct controls that read the
   * current snapshot immediately before calling this method.
   */
  public acknowledgePush(expectedTicketId?: number): boolean {
    this.assertAlive();
    const spin = this.spinValue;
    if (
      this.pausedValue ||
      (this.phaseValue !== "playing" && this.phaseValue !== "settling") ||
      spin === null ||
      !spin.ticket.reach ||
      !spin.reachEventSent ||
      spin.revealEventSent ||
      spin.elapsed >= SPIN_REACH_REVEAL ||
      spin.pushState !== "ready"
    ) return false;
    if (expectedTicketId !== undefined && (!Number.isSafeInteger(expectedTicketId) || expectedTicketId !== spin.ticket.id)) return false;
    spin.pushState = "accepted";
    this.emit("spin-push");
    return true;
  }

  public setPaused(paused: boolean): void {
    this.assertAlive();
    this.pausedValue = paused;
  }

  public finish(): void {
    this.assertAlive();
    if (this.phaseValue === "result") return;
    if (this.phaseValue === "idle") {
      this.deadlineReached = true;
      this.timeRemainingValue = 0;
      this.firingValue = false;
      this.phaseValue = "result";
      this.emit("deadline");
      this.emit("result");
      return;
    }
    this.deadlineReached = true;
    this.timeRemainingValue = 0;
    this.firingValue = false;
    // Manual finish is an explicit boundary: close the current BONUS and
    // resolve every accepted ticket without opening a new one.
    this.settlingBonusClaimedValue = true;
    this.phaseValue = "settling";
    this.settleElapsed = 0;
    this.emit("deadline");
    this.finishImmediately();
  }

  /** Advances with frame deltas; physics and game timers are fixed at 120Hz. */
  public step(deltaMs: number): PachiSessionSnapshot {
    this.assertAlive();
    if (!Number.isFinite(deltaMs) || deltaMs < 0) throw new RangeError("deltaMs must be finite and non-negative");
    if (this.pausedValue || this.phaseValue === "idle" || this.phaseValue === "result") return this.snapshot();
    let remainingMs = deltaMs;
    // A frame may be larger than one second in background tabs. Splitting it
    // preserves the same fixed-step ordering while keeping each world call in
    // its documented range.
    while (remainingMs > 0) {
      const chunk = Math.min(remainingMs, 1000);
      this.advanceFrameChunk(chunk);
      remainingMs -= chunk;
    }
    return this.snapshot();
  }

  public snapshot(): PachiSessionSnapshot {
    this.assertAlive();
    const spin = this.snapshotSpin();
    const world = this.worldValue.snapshot();
    return {
      phase: this.phaseValue,
      paused: this.pausedValue,
      timeRemaining: Math.max(0, this.timeRemainingValue),
      ballsRemaining: this.ballsRemainingValue,
      score: this.scoreValue,
      scoreParts: { ...this.scorePartsValue },
      power: this.powerValue,
      firing: this.firingValue,
      balls: world.balls,
      pending: this.pendingTickets.length,
      // A guaranteed ticket is reserved internally at the fifth loss, but it
      // becomes a visible promise only once the public charge has reached 5.
      pendingCues: this.pendingTickets.map((ticket) =>
        ticket.cue === "guaranteed" && this.displayedMissesValue < 5 ? "normal" : ticket.cue,
      ),
      spin,
      rushRound: this.rushRoundValue,
      rushStage: this.rushStageValue,
      judgeRemaining: Math.max(0, this.rushJudgeRemainingValue),
      // Keep the one-second judgment suspenseful; reveal its fixed result
      // only for the final quarter-second before the next state.
      rushResult: this.rushStageValue === "judge" && this.rushJudgeRemainingValue <= 0.25
        ? this.rushResultValue
        : null,
      rushRemaining: this.rushRemainingValue,
      charge: Math.min(5, this.displayedMissesValue),
      jackpotRemaining: Math.max(0, this.jackpotRemainingValue),
      stats: { ...this.statsValue, missesSinceWin: this.displayedMissesValue },
      geometry: world.geometry,
      board: world.geometry,
    };
  }

  public drainEvents(): readonly PachiSessionEvent[] {
    this.assertAlive();
    const drained = this.events.map((event) => ({ ...event }));
    this.events.length = 0;
    return drained;
  }

  public destroy(): void {
    if (this.destroyedValue) return;
    this.worldValue.destroy();
    this.destroyedValue = true;
    this.events.length = 0;
  }

  private createWorld(): PachiWorld {
    return new PachiWorld({
      geometry: PACHI_DEFAULT_GEOMETRY,
      random: () => this.random.next(),
    });
  }

  private advanceFrameChunk(deltaMs: number): void {
    let remainingMs = deltaMs;
    while (remainingMs + 1e-9 >= PACHI_FIXED_STEP_MS) {
      this.advanceFixed();
      remainingMs -= PACHI_FIXED_STEP_MS;
    }
    // The session deliberately does not run a partial physics step. Keep the
    // fractional frame in a tiny accumulator so 1x100ms and 10x10ms match.
    this.frameRemainderMs += Math.max(0, remainingMs);
    while (this.frameRemainderMs + 1e-9 >= PACHI_FIXED_STEP_MS) {
      this.frameRemainderMs -= PACHI_FIXED_STEP_MS;
      this.advanceFixed();
    }
  }

  private frameRemainderMs = 0;

  private advanceFixed(): void {
    if (this.pausedValue || this.phaseValue === "result" || this.phaseValue === "idle") return;
    this.elapsedValue += 1 / PACHI_FIXED_HZ;
    if (!this.deadlineReached) {
      this.timeRemainingValue = Math.max(0, this.timeRemainingValue - 1 / PACHI_FIXED_HZ);
      if (this.timeRemainingValue <= 1e-9) this.enterDeadline();
    } else {
      this.settleElapsed += 1 / PACHI_FIXED_HZ;
    }

    this.tryFire();
    this.worldValue.stepFixed();
    this.consumeWorldEvents();
    this.advanceSpin(1 / PACHI_FIXED_HZ);
    this.advanceJackpot(1 / PACHI_FIXED_HZ);
    this.maybeStartSpin();
    if (!this.deadlineReached && this.ballsRemainingValue === 0 && this.worldValue.ballCount === 0 &&
      this.pendingTickets.length === 0 && this.spinValue === null && this.rushStageValue === "idle") {
      this.enterDeadline("balls-exhausted");
    }
    this.maybeFinishSettling();
  }

  private tryFire(): void {
    if (!this.firingValue || !this.canFireNow()) return;
    this.fireTimer -= 1 / PACHI_FIXED_HZ;
    if (this.fireTimer > 1e-9) return;
    const id = this.worldValue.launch(this.powerValue);
    this.fireTimer = PACHI_FIRE_INTERVAL_SECONDS;
    if (id === null) return;
    this.ballsRemainingValue -= 1;
    this.scorePartsValue = { ...this.scorePartsValue, shots: this.scorePartsValue.shots - 10 };
    this.scoreValue -= 10;
    this.statsValue = { ...this.statsValue, fired: this.statsValue.fired + 1 };
    this.emit("fired", { ballId: id, score: this.scoreValue });
    // launch() emits its own physics event, which is intentionally drained
    // below with the same fixed-step boundary.
  }

  private canFireNow(): boolean {
    if (this.phaseValue === "playing") return !this.deadlineReached && this.ballsRemainingValue > 0;
    return this.phaseValue === "settling" && this.jackpotRemainingValue > 0 && this.ballsRemainingValue > 0;
  }

  private consumeWorldEvents(): void {
    for (const event of this.worldValue.drainEvents()) {
      if (event.type === "pocket") {
        if (event.role === "start") this.onStart(event.ballId);
        else if (event.role === "side") this.onSide(event.ballId);
        else if (event.role === "attacker") this.onAttacker(event.ballId);
        else if (event.role === "drain") {
          this.statsValue = { ...this.statsValue, reclaimedBalls: this.statsValue.reclaimedBalls + 1 };
          this.emit("drain", { ballId: event.ballId });
        }
      } else if (event.type === "reclaimed") {
        this.statsValue = { ...this.statsValue, reclaimedBalls: this.statsValue.reclaimedBalls + 1 };
        this.emit("reclaimed", { ballId: event.ballId, reason: event.reason });
      }
    }
  }

  private onStart(ballId: string): void {
    this.statsValue = { ...this.statsValue, startEntries: this.statsValue.startEntries + 1 };
    const wasEmpty = this.pendingTickets.length === 0;
    const accepted = !this.deadlineReached && this.pendingTickets.length < PACHI_MAX_PENDING;
    if (accepted) {
      this.pendingTickets.push(this.createTicket());
      this.addScore("start", 50);
      this.ballsRemainingValue += 3;
    }
    this.emit("start-entry", {
      ballId,
      score: this.scoreValue,
      pending: this.pendingTickets.length,
      accepted,
    });
    if (!accepted) return;
    // Keep a newly accepted ticket visible as a real pending item for a few
    // fixed steps.  This makes the START -> pending -> spinning transition
    // observable even when the entry and rule update share one physics step.
    if (wasEmpty && this.spinValue === null && this.rushStageValue === "idle") {
      this.previewRemainingValue = PACHI_PREVIEW_SECONDS;
    }
  }

  private onSide(ballId: string): void {
    this.statsValue = { ...this.statsValue, sideEntries: this.statsValue.sideEntries + 1 };
    this.addScore("side", 20);
    this.ballsRemainingValue += 2;
    this.emit("side-entry", { ballId, score: this.scoreValue });
  }

  private onAttacker(ballId: string): void {
    if (this.jackpotRemainingValue <= 0) return;
    this.statsValue = { ...this.statsValue, attackerEntries: this.statsValue.attackerEntries + 1 };
    this.addScore("attacker", 100);
    this.ballsRemainingValue += 5;
    this.emit("attacker-entry", { ballId, score: this.scoreValue });
  }

  private createTicket(): Ticket {
    const ticketId = this.nextTicketId;
    this.nextTicketId += 1;
    const missesBefore = this.missesSinceWinValue;
    const forced = missesBefore >= 5;
    // RUSH is a visible finite BONUS continuation state, so it does not
    // silently change the odds of a later START ticket.  The only special
    // ticket cue is the strict five-loss guarantee.
    const win = forced || this.random.next() < 0.2;
    const cue: PachiTicketCue = forced ? "guaranteed" : "normal";
    if (win) this.missesSinceWinValue = 0;
    else this.missesSinceWinValue += 1;
    const left = Math.floor(this.random.next() * 10);
    let middle = Math.floor(this.random.next() * 10);
    let right = Math.floor(this.random.next() * 10);
    if (win) {
      const digit = Math.floor(this.random.next() * 10);
      const rushDecisions: [boolean, boolean] = [this.random.next() < 0.5, this.random.next() < 0.5];
      return { id: ticketId, win: true, digits: [digit, digit, digit], reach: true, cue, rushDecisions };
    }
    // Three independent digits. A loss never displays a false triple; a
    // naturally equal left/right pair remains a genuine reach/ガセリーチ.
    if (left === right && middle === left) middle = (middle + 1) % 10;
    if (left === right && middle === left) right = (right + 1) % 10;
    return { id: ticketId, win: false, digits: [left, middle, right], reach: left === right, cue, rushDecisions: [false, false] };
  }

  private maybeStartSpin(): void {
    if (
      this.spinValue !== null ||
      this.pendingTickets.length === 0 ||
      this.jackpotRemainingValue > 0 ||
      this.rushStageValue !== "idle"
    ) return;
    if (this.previewRemainingValue > 0) {
      this.previewRemainingValue = Math.max(0, this.previewRemainingValue - 1 / PACHI_FIXED_HZ);
      return;
    }
    if (this.phaseValue !== "playing" && this.phaseValue !== "settling") return;
    const ticket = this.pendingTickets.shift();
    if (ticket === undefined) return;
    this.spinValue = {
      ticket,
      elapsed: 0,
      stage: "spinning",
      stopped: [false, false, false],
      reveal: "none",
      title: "変動中",
      holdRemaining: 0,
      reachEventSent: false,
      revealEventSent: false,
      revival: false,
      pushState: "hidden",
    };
    this.emit("spin-start", {
      pending: this.pendingTickets.length,
      cue: ticket.cue,
    });
  }

  private advanceSpin(deltaSeconds: number): void {
    const spin = this.spinValue;
    if (spin === null) return;
    spin.elapsed += deltaSeconds;

    // A guaranteed winning ticket may show a short, explicit revival state.
    // The ticket and final digits remain unchanged; only the presentation
    // waits before the one and only jackpot award is committed.
    if (spin.stage === "revival") {
      spin.holdRemaining -= deltaSeconds;
      // First hold the virtual mismatched stop, then restart the middle reel
      // before the final reveal.  The two windows are 0.25s and 0.4s.
      if (spin.holdRemaining <= REVIVAL_RESTART_SECONDS && spin.stopped[1]) {
        spin.stopped[1] = false;
        spin.title = "復活！";
      }
      if (spin.holdRemaining <= 0) {
        spin.stopped[1] = true;
        this.finalizeSpin(spin);
      }
      return;
    }

    if (!spin.stopped[0] && spin.elapsed >= SPIN_LEFT_STOP) spin.stopped[0] = true;
    if (!spin.stopped[2] && spin.elapsed >= SPIN_RIGHT_STOP) spin.stopped[2] = true;
    if (spin.ticket.reach && !spin.reachEventSent && spin.elapsed >= SPIN_RIGHT_STOP) {
      spin.reachEventSent = true;
      spin.stage = "reach";
      spin.title = "リーチ";
      spin.pushState = "ready";
      this.emit("spin-reach");
    }
    const revealAt = spin.ticket.reach ? SPIN_REACH_REVEAL : SPIN_PLAIN_REVEAL;
    if (!spin.stopped[1] && spin.elapsed >= (spin.ticket.reach ? SPIN_REACH_REVEAL : SPIN_MIDDLE_STOP)) {
      spin.stopped[1] = true;
    }
    if (!spin.revealEventSent && spin.elapsed >= revealAt) {
      spin.revealEventSent = true;
      // A reach that was not acknowledged is no longer actionable once the
      // fixed reveal boundary is reached. An accepted acknowledgement remains
      // visible for this ticket until the next spin or terminal result.
      if (spin.pushState === "ready") spin.pushState = "hidden";
      // Revival is reserved for the explicitly guaranteed ticket.  A
      // naturally winning ticket proceeds directly to its final reveal.
      spin.revival = spin.ticket.win && spin.ticket.cue === "guaranteed";
      if (spin.revival) {
        spin.reveal = "復活";
        spin.stage = "revival";
        spin.title = "…まだ？";
        spin.holdRemaining = REVIVAL_FAKE_STOP_SECONDS + REVIVAL_RESTART_SECONDS;
        spin.stopped[1] = true;
      } else {
        this.finalizeSpin(spin);
      }
    }
    if (!spin.ticket.win && spin.revealEventSent) {
      spin.holdRemaining -= deltaSeconds;
      if (spin.holdRemaining <= 0) this.spinValue = null;
    }
  }

  private finalizeSpin(spin: ActiveSpin): void {
    spin.stopped = [true, true, true];
    spin.reveal = spin.ticket.win ? "win" : "miss";
    spin.title = spin.ticket.win ? "大当り" : "はずれ";
    spin.stage = spin.ticket.win ? "jackpot" : "reveal";
    spin.holdRemaining = spin.ticket.win ? PACHI_JACKPOT_SECONDS : REVEAL_HOLD;
    this.statsValue = { ...this.statsValue, completedSpins: this.statsValue.completedSpins + 1 };
    this.displayedMissesValue = spin.ticket.win ? 0 : Math.min(5, this.displayedMissesValue + 1);
    this.statsValue = { ...this.statsValue, missesSinceWin: this.displayedMissesValue };
    this.emit("spin-reveal", { digits: spin.ticket.digits, win: spin.ticket.win });
    if (spin.ticket.win) {
      this.startJackpot(spin.ticket);
      // A post-deadline ticket after the terminal BONUS still receives its
      // fixed jackpot award, but cannot open a second physical BONUS.
      if (this.rushStageValue === "idle") this.spinValue = null;
    }
  }

  private startJackpot(ticket: Ticket): void {
    this.awardJackpot();
    const canOpenBonus = !this.deadlineReached || !this.settlingBonusClaimedValue;
    if (!canOpenBonus) {
      this.rushRemainingValue = 0;
      this.rushRoundValue = 0;
      this.rushStageValue = "idle";
      this.rushJudgeRemainingValue = 0;
      this.rushResultValue = null;
      this.activeJackpotTicket = null;
      this.jackpotRemainingValue = 0;
      this.worldValue.setAttackerOpen(false);
      this.emit("jackpot-start", { score: this.scoreValue, opened: false });
      return;
    }
    if (this.deadlineReached) this.settlingBonusClaimedValue = true;
    this.activeJackpotTicket = ticket;
    this.rushRemainingValue = 2;
    this.rushRoundValue = 1;
    this.rushStageValue = "open";
    this.rushJudgeRemainingValue = 0;
    this.rushResultValue = null;
    this.jackpotRemainingValue = PACHI_JACKPOT_SECONDS;
    this.worldValue.setAttackerOpen(true);
    this.emit("jackpot-start", { score: this.scoreValue, opened: true });
    this.emit("rush-start", { rushRemaining: this.rushRemainingValue });
  }

  private advanceJackpot(deltaSeconds: number): void {
    if (this.rushStageValue === "open") {
      this.jackpotRemainingValue = Math.max(0, this.jackpotRemainingValue - deltaSeconds);
      if (this.jackpotRemainingValue > 0) return;
      this.worldValue.setAttackerOpen(false);
      if (this.spinValue?.ticket.win) this.spinValue = null;
      this.emit("jackpot-end");
      if (this.rushRoundValue < 3) {
        const decision = this.activeJackpotTicket?.rushDecisions[this.rushRoundValue - 1] ?? false;
        this.rushStageValue = "judge";
        this.rushJudgeRemainingValue = 1;
        this.rushResultValue = decision ? "continue" : "end";
        this.emit("rush-judge", { rushRemaining: this.rushRemainingValue, rushRound: this.rushRoundValue });
      } else {
        this.endRush();
      }
      return;
    }
    if (this.rushStageValue !== "judge") return;
    this.rushJudgeRemainingValue = Math.max(0, this.rushJudgeRemainingValue - deltaSeconds);
    if (this.rushJudgeRemainingValue > 0) return;
    if (this.rushResultValue === "continue" && this.rushRoundValue < 3 && this.activeJackpotTicket !== null) {
      this.rushRemainingValue = Math.max(0, this.rushRemainingValue - 1);
      this.rushRoundValue += 1;
      this.rushStageValue = "open";
      this.rushJudgeRemainingValue = 0;
      this.rushResultValue = null;
      this.jackpotRemainingValue = PACHI_JACKPOT_SECONDS;
      this.worldValue.setAttackerOpen(true);
      this.statsValue = { ...this.statsValue, rushContinuations: this.statsValue.rushContinuations + 1 };
      this.emit("rush-continue", { rushRemaining: this.rushRemainingValue, rushRound: this.rushRoundValue });
      return;
    }
    this.endRush();
  }

  private endRush(): void {
    this.worldValue.setAttackerOpen(false);
    this.jackpotRemainingValue = 0;
    this.rushStageValue = "idle";
    this.rushRoundValue = 0;
    this.rushJudgeRemainingValue = 0;
    this.rushResultValue = null;
    this.rushRemainingValue = 0;
    this.activeJackpotTicket = null;
    this.emit("rush-end");
  }

  private awardJackpot(): void {
    this.addScore("jackpot", 1500);
    this.ballsRemainingValue += 30;
    this.statsValue = { ...this.statsValue, jackpotCount: this.statsValue.jackpotCount + 1 };
  }

  private enterDeadline(reason: "time" | "balls-exhausted" = "time"): void {
    if (this.deadlineReached) return;
    this.deadlineReached = true;
    this.timeRemainingValue = 0;
    this.firingValue = false;
    if (this.rushStageValue !== "idle") this.settlingBonusClaimedValue = true;
    this.phaseValue = "settling";
    this.settleElapsed = 0;
    this.emit("deadline", { reason });
  }

  private finishImmediately(): void {
    if (this.rushStageValue !== "idle") this.endRush();
    const spin = this.spinValue;
    if (spin !== null) {
      if (spin.reveal !== "win" && spin.reveal !== "miss") this.completeTicketWithoutBonus(spin.ticket);
      this.spinValue = null;
    }
    for (const ticket of this.pendingTickets) this.completeTicketWithoutBonus(ticket);
    this.pendingTickets = [];
    this.previewRemainingValue = 0;
    this.worldValue.clearBalls("lifetime");
    this.consumeWorldEvents();
    this.firingValue = false;
    this.phaseValue = "result";
    this.emit("result", { score: this.scoreValue });
  }

  private completeTicketWithoutBonus(ticket: Ticket): void {
    this.statsValue = { ...this.statsValue, completedSpins: this.statsValue.completedSpins + 1 };
    if (ticket.win) {
      this.awardJackpot();
      this.emit("jackpot-start", { score: this.scoreValue, opened: false });
      this.displayedMissesValue = 0;
    } else {
      this.displayedMissesValue = Math.min(5, this.displayedMissesValue + 1);
    }
    this.statsValue = { ...this.statsValue, missesSinceWin: this.displayedMissesValue };
  }

  private maybeFinishSettling(): void {
    if (this.phaseValue !== "settling") return;
    // Ball recovery has its own eight-second bound.  Clearing the physical
    // board here does not discard already queued tickets or their animations;
    // those are still allowed to finish and award their already-determined
    // jackpot exactly once.
    if (!this.ballCollectionSettled && this.settleElapsed >= PACHI_MAX_SETTLE_SECONDS) {
      this.ballCollectionSettled = true;
      this.worldValue.clearBalls("lifetime");
      this.consumeWorldEvents();
    }
    const worldEmpty = this.worldValue.ballCount === 0;
    const spinDone = this.spinValue === null;
    if (
      (worldEmpty && spinDone && this.pendingTickets.length === 0 && this.rushStageValue === "idle") ||
      this.settleElapsed >= PACHI_MAX_SESSION_SETTLE_SECONDS
    ) {
      if (this.settleElapsed >= PACHI_MAX_SESSION_SETTLE_SECONDS) {
        this.finishImmediately();
        return;
      }
      this.firingValue = false;
      this.phaseValue = "result";
      this.emit("result", { score: this.scoreValue });
    }
  }

  private addScore(part: keyof PachiScoreParts, points: number): void {
    this.scorePartsValue = { ...this.scorePartsValue, [part]: this.scorePartsValue[part] + points };
    this.scoreValue += points;
  }

  private snapshotSpin(): PachiSpinSnapshot {
    const spin = this.spinValue;
    if (spin === null) {
      const pending = this.pendingTickets[0];
      if (pending !== undefined && this.previewRemainingValue > 0) {
        return {
          stage: "preview",
          elapsed: Math.max(0, PACHI_PREVIEW_SECONDS - this.previewRemainingValue),
          finalDigits: null,
          stopped: [false, false, false],
          reveal: "none",
          title: "保留確認",
          ticket: pending.id,
          cue: pending.cue,
          reach: false,
          win: false,
          revival: false,
          pushState: "hidden",
        };
      }
      return {
        stage: "idle",
        elapsed: 0,
        finalDigits: null,
        stopped: [false, false, false],
        reveal: "none",
        title: "",
        ticket: null,
        cue: "normal",
        reach: false,
        win: false,
        revival: false,
        pushState: "hidden",
      };
    }
    let finalDigits: PachiDisplayDigits = [
      spin.stopped[0] ? spin.ticket.digits[0] : null,
      spin.stopped[1] ? spin.ticket.digits[1] : null,
      spin.stopped[2] ? spin.ticket.digits[2] : null,
    ];
    if (spin.stage === "revival") {
      // The ticket remains the same winning triple.  This temporary display
      // is a presentation-only near miss: the middle reel restarts before
      // the single final reveal and no loss is recorded here.
      const digit = spin.ticket.digits[0];
      finalDigits = [digit, (digit + 1) % 10, digit];
    }
    return {
      stage: spin.stage,
      elapsed: spin.elapsed,
      finalDigits,
      stopped: [...spin.stopped] as [boolean, boolean, boolean],
      reveal: spin.reveal,
      title: spin.title,
      ticket: spin.ticket.id,
      cue: spin.ticket.cue,
      // Reach is a visible state only after the right reel has stopped and
      // the corresponding event has been emitted.
      reach: spin.reachEventSent,
      // The ticket is fixed when accepted, while the public win flag waits
      // for the reveal so the renderer cannot flash jackpot art early.
      win: spin.reveal === "win",
      revival: spin.revival,
      pushState: spin.pushState,
    };
  }

  private emit(type: PachiSessionEventType, values: Omit<PachiSessionEvent, "id" | "type" | "at"> = {}): void {
    this.events.push({ id: this.eventSequence, type, at: this.elapsedValue, ...values });
    this.eventSequence += 1;
  }

  private assertAlive(): void {
    if (this.destroyedValue) throw new Error("PachiSession has been destroyed");
  }
}
