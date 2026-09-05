/**
 * Shared, Planck independent contracts for the DOPPAN pachinko core.
 *
 * The renderer consumes these plain values.  Keeping the public model here
 * means neither the UI nor the session has to know about Planck bodies or
 * fixtures.
 */

export const PACHI_BOARD_WIDTH = 720 as const;
export const PACHI_BOARD_HEIGHT = 900 as const;
export const PACHI_PHYSICS_SCALE = 100 as const;
/** Shared release window for the inner launch lane (board pixels). */
export const PACHI_LAUNCH_RELEASE_Y = 112 as const;
export const PACHI_LAUNCH_RELEASE_GAP_HEIGHT = 124 as const;
/** Collision/rendering angles for the outer cap and inner release vane. */
export const PACHI_LAUNCH_CAP_ANGLE = 0.28 as const;
export const PACHI_LAUNCH_RELEASE_ANGLE = 0.7 as const;
export const PACHI_FIXED_HZ = 120 as const;
export const PACHI_FIXED_STEP_MS = 1000 / PACHI_FIXED_HZ;
export const PACHI_INITIAL_BALLS = 80 as const;
export const PACHI_MAX_PENDING = 4 as const;
export const PACHI_MAX_BALLS = 24 as const;
export const PACHI_BALL_LIFETIME_SECONDS = 8 as const;
export const PACHI_FIRE_INTERVAL_SECONDS = 0.2 as const;
/** Time reserved to show the newly accepted ticket before its reels move. */
export const PACHI_PREVIEW_SECONDS = 0.36 as const;
export const PACHI_DEFAULT_DURATION_SECONDS = 90 as const;
export const PACHI_JACKPOT_SECONDS = 6 as const;
export const PACHI_MAX_SETTLE_SECONDS = 8 as const;
/** Hard upper bound for resolving four queued tickets after the deadline. */
export const PACHI_MAX_SESSION_SETTLE_SECONDS = 60 as const;

export type PachiPhase = "idle" | "playing" | "settling" | "result";
export type PachiPocketRole = "start" | "side" | "attacker" | "drain" | "reclaim";

export interface PachiPoint {
  readonly x: number;
  readonly y: number;
}

export interface PachiRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Coordinates are top-left-origin pixels and are shared by physics output and Pixi. */
export interface PachiBoardGeometry {
  readonly width: typeof PACHI_BOARD_WIDTH;
  readonly height: typeof PACHI_BOARD_HEIGHT;
  readonly scale: typeof PACHI_PHYSICS_SCALE;
  readonly ballRadius: number;
  readonly launch: PachiPoint;
  readonly launchRail: readonly PachiPoint[];
  /** Inner left edge and bounds of the vertical launch lane. */
  readonly launchGuide: PachiRect;
  /** LCD/reel island. Its four edges are real static colliders. */
  readonly screen: PachiRect;
  readonly nails: readonly PachiPoint[];
  readonly start: PachiRect;
  readonly sideLeft: PachiRect;
  readonly sideRight: PachiRect;
  readonly attacker: PachiRect;
  readonly drain: PachiRect;
}

export interface PachiBallSnapshot {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly age: number;
  readonly bullet: true;
}

export interface PachiWorldEventBase {
  readonly id: number;
  readonly type: "fired" | "pocket" | "reclaimed";
  readonly ballId: string;
  readonly x: number;
  readonly y: number;
  readonly physicsStep: number;
}

export interface PachiFiredEvent extends PachiWorldEventBase {
  readonly type: "fired";
  readonly power: number;
}

export interface PachiPocketEvent extends PachiWorldEventBase {
  readonly type: "pocket";
  readonly role: Exclude<PachiPocketRole, "reclaim">;
  readonly pocketId: string;
}

export interface PachiReclaimedEvent extends PachiWorldEventBase {
  readonly type: "reclaimed";
  readonly role: "reclaim";
  readonly reason: "drain" | "lifetime" | "stuck" | "overflow";
}

export type PachiWorldEvent = PachiFiredEvent | PachiPocketEvent | PachiReclaimedEvent;

export interface PachiWorldOptions {
  /** One stream owned by PachiSession; omitted means deterministic zero jitter. */
  readonly random?: () => number;
  readonly maxBalls?: number;
  readonly geometry?: PachiBoardGeometry;
}

export interface PachiWorldSnapshot {
  readonly physicsStep: number;
  readonly balls: readonly PachiBallSnapshot[];
  readonly attackerOpen: boolean;
  readonly geometry: PachiBoardGeometry;
}

export interface PachiScoreParts {
  readonly shots: number;
  readonly start: number;
  readonly side: number;
  readonly jackpot: number;
  readonly attacker: number;
}

export type PachiSpinStage = "idle" | "preview" | "spinning" | "reach" | "reveal" | "revival" | "jackpot";
export type PachiSpinReveal = "none" | "miss" | "win" | "復活";
export type PachiTicketCue = "normal" | "chance" | "guaranteed";
/** PUSH is a presentation acknowledgement, not a result-changing input. */
export type PachiPushState = "hidden" | "ready" | "accepted";
/** A stopped reel has a digit; an unrevealed reel stays masked. */
export type PachiDisplayDigits = readonly [number | null, number | null, number | null];
export type PachiRushStage = "idle" | "open" | "judge";
export type PachiRushResult = "continue" | "end" | null;

export interface PachiSpinSnapshot {
  readonly stage: PachiSpinStage;
  readonly elapsed: number;
  readonly finalDigits: PachiDisplayDigits | null;
  readonly stopped: readonly [boolean, boolean, boolean];
  readonly reveal: PachiSpinReveal;
  readonly title: string;
  readonly ticket: number | null;
  readonly cue?: PachiTicketCue;
  readonly reach: boolean;
  readonly win: boolean;
  readonly revival?: boolean;
  /** Available only during an active reach before the fixed reveal boundary. */
  readonly pushState: PachiPushState;
}

export interface PachiStatsSnapshot {
  readonly fired: number;
  readonly startEntries: number;
  readonly sideEntries: number;
  readonly jackpotCount: number;
  readonly attackerEntries: number;
  readonly rushContinuations: number;
  readonly reclaimedBalls: number;
  readonly completedSpins: number;
  readonly missesSinceWin: number;
}

export interface PachiSessionSnapshot {
  readonly phase: PachiPhase;
  readonly paused: boolean;
  readonly timeRemaining: number;
  readonly ballsRemaining: number;
  readonly score: number;
  readonly scoreParts: PachiScoreParts;
  readonly power: number;
  readonly firing: boolean;
  readonly balls: readonly PachiBallSnapshot[];
  /** Number of queued START tickets (at most four). */
  readonly pending: number;
  readonly pendingCues: readonly PachiTicketCue[];
  readonly spin: PachiSpinSnapshot;
  /** Current finite BONUS interval: 0 outside BONUS, 1..3 while open/judging. */
  readonly rushRound: number;
  readonly rushStage: PachiRushStage;
  /** Seconds remaining in the one-second continuation decision window. */
  readonly judgeRemaining: number;
  /** The already-determined continuation result, exposed during judgment only. */
  readonly rushResult: PachiRushResult;
  readonly rushRemaining: number;
  /** 0..5, where five means the next queued ticket is guaranteed. */
  readonly charge: number;
  /** Seconds remaining in the six-second attacker opening. */
  readonly jackpotRemaining: number;
  readonly stats: PachiStatsSnapshot;
  readonly geometry: PachiBoardGeometry;
  /** Alias for consumers that call the render contract "board". */
  readonly board?: PachiBoardGeometry;
}

export type PachiSessionEventType =
  | "started"
  | "fired"
  | "start-entry"
  | "side-entry"
  | "drain"
  | "reclaimed"
  | "spin-start"
  | "spin-reach"
  | "spin-push"
  | "spin-reveal"
  | "jackpot-start"
  | "attacker-entry"
  | "jackpot-end"
  | "rush-start"
  | "rush-judge"
  | "rush-continue"
  | "rush-end"
  | "deadline"
  | "result";

export interface PachiSessionEvent {
  readonly id: number;
  readonly type: PachiSessionEventType;
  readonly at: number;
  readonly ballId?: string;
  readonly score?: number;
  /** `false` is a post-terminal jackpot payout with no attacker opening. */
  readonly opened?: boolean;
  readonly pending?: number;
  /** Whether this START entry created a new queued ticket. */
  readonly accepted?: boolean;
  readonly win?: boolean;
  readonly digits?: readonly [number, number, number];
  readonly cue?: PachiTicketCue;
  readonly rushRemaining?: number;
  readonly rushRound?: number;
  readonly reason?: string;
}

export interface PachiSessionOptions {
  readonly seed?: number;
  readonly durationSeconds?: number;
}

export const PACHI_DEFAULT_GEOMETRY: PachiBoardGeometry = Object.freeze({
  width: PACHI_BOARD_WIDTH,
  height: PACHI_BOARD_HEIGHT,
  scale: PACHI_PHYSICS_SCALE,
  ballRadius: 6,
  launch: Object.freeze({ x: 646, y: 834 }),
  launchRail: Object.freeze([
    Object.freeze({ x: 673, y: 850 }),
    Object.freeze({ x: 673, y: 120 }),
    Object.freeze({ x: 620, y: 75 }),
  ]),
  launchGuide: Object.freeze({ x: 624, y: PACHI_LAUNCH_RELEASE_Y, width: 40, height: 708 }),
  screen: Object.freeze({ x: 187, y: 171, width: 346, height: 216 }),
  nails: Object.freeze([]),
  start: Object.freeze({ x: 270, y: 465, width: 180, height: 28 }),
  sideLeft: Object.freeze({ x: 66, y: 556, width: 36, height: 28 }),
  sideRight: Object.freeze({ x: 618, y: 556, width: 36, height: 28 }),
  attacker: Object.freeze({ x: 230, y: 730, width: 260, height: 30 }),
  drain: Object.freeze({ x: 0, y: 888, width: 720, height: 24 }),
});

/** Short alias used by renderers and diagnostics. */
export const PACHI_GEOMETRY = PACHI_DEFAULT_GEOMETRY;
