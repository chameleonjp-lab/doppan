import type { PinballStepResult, PinballWorld } from "../physics";

export type GrayboxTargetId = "L0" | "R0" | "L1" | "R1" | "L2" | "R2" | "C0" | "C1";
export type GrayboxReturnRouteId =
  | "neutral-return"
  | "left-safe-return"
  | "right-safe-return"
  | "left-cross-return"
  | "right-cross-return"
  | "short-return"
  | "central-return"
  | "climax-return";
export type GrayboxClimaxState = "idle" | "armed" | "active";

export interface GrayboxRuntimeSnapshot {
  readonly activeTargetIds: readonly GrayboxTargetId[];
  readonly nextTargetId: GrayboxTargetId | null;
  readonly returnRouteId: GrayboxReturnRouteId;
  readonly score: number;
  readonly combo: number;
  readonly progress: number;
  readonly completedShotIds: readonly GrayboxTargetId[];
  readonly climaxState: GrayboxClimaxState;
  readonly lastEventLabel: string | null;
  readonly lastEventPhysicsStepId: number | null;
  readonly gateStates: Readonly<Record<string, boolean>>;
}

const TARGET_IDS: readonly GrayboxTargetId[] = ["L0", "R0", "L1", "R1", "L2", "R2", "C0", "C1"];
export const GRAYBOX_PATH_LENGTH = 5;

const NEXT_TARGETS: Readonly<Record<GrayboxTargetId, readonly GrayboxTargetId[]>> = {
  L0: ["R1"],
  R0: ["L1"],
  L1: ["R2"],
  R1: ["L2"],
  L2: ["C0"],
  R2: ["C0"],
  C0: ["C1"],
  C1: [],
};

const SCORE_VALUES: Readonly<Record<GrayboxTargetId, number>> = {
  L0: 100,
  R0: 100,
  L1: 250,
  R1: 250,
  L2: 500,
  R2: 500,
  C0: 750,
  C1: 1_000,
};

const ROUTE_BY_TARGET: Readonly<Record<GrayboxTargetId, GrayboxReturnRouteId>> = {
  L0: "right-safe-return",
  R0: "left-safe-return",
  L1: "right-cross-return",
  R1: "left-cross-return",
  L2: "short-return",
  R2: "short-return",
  C0: "central-return",
  C1: "climax-return",
};

const GATE_BY_ROUTE: Readonly<Record<GrayboxReturnRouteId, string>> = {
  "neutral-return": "gate-return-neutral",
  "left-safe-return": "gate-return-left-safe",
  "right-safe-return": "gate-return-right-safe",
  "left-cross-return": "gate-return-left-cross",
  "right-cross-return": "gate-return-right-cross",
  "short-return": "gate-return-short",
  "central-return": "gate-return-central",
  "climax-return": "gate-return-climax",
};

const TARGET_LABEL: Readonly<Record<GrayboxTargetId, string>> = {
  L0: "L0 左・安全",
  R0: "R0 右・安全",
  L1: "L1 左・中核",
  R1: "R1 右・中核",
  L2: "L2 左・危険",
  R2: "R2 右・危険",
  C0: "C0 中央接続",
  C1: "C1 中枢入口",
};

const ROUTE_LABEL: Readonly<Record<GrayboxReturnRouteId, string>> = {
  "neutral-return": "中央の基本戻り",
  "left-safe-return": "左の安全戻り",
  "right-safe-return": "右の安全戻り",
  "left-cross-return": "左から中央への交差戻り",
  "right-cross-return": "右から中央への交差戻り",
  "short-return": "短い中央戻り",
  "central-return": "中央接続の戻り",
  "climax-return": "中枢からの安全戻り",
};

function isGrayboxTargetId(value: string): value is GrayboxTargetId {
  return TARGET_IDS.includes(value as GrayboxTargetId);
}

function copyGateStates(states: ReadonlyMap<string, boolean>): Readonly<Record<string, boolean>> {
  const result: Record<string, boolean> = {};
  for (const [id, enabled] of states) {
    result[id] = enabled;
  }
  return result;
}

/** Owns the G2 hypothesis without persisting any game state. */
export class GrayboxRuntime {
  private activeTargetIdsValue: GrayboxTargetId[] = ["L0", "R0"];
  private returnRouteIdValue: GrayboxReturnRouteId = "neutral-return";
  private scoreValue = 0;
  private comboValue = 0;
  private completedShotIdsValue: GrayboxTargetId[] = [];
  private climaxStateValue: GrayboxClimaxState = "idle";
  private lastEventLabelValue: string | null = "左または右の安全ショットを選ぶ";
  private lastEventPhysicsStepIdValue: number | null = null;

  public initialize(world: PinballWorld): void {
    this.queueRouteChange(world, world.physicsStepId, "neutral-return");
  }

  public consume(step: PinballStepResult, world: PinballWorld): void {
    for (const event of step.gameEvents) {
      if (event.type !== "ShotCompleted" || !isGrayboxTargetId(event.shotId)) {
        continue;
      }
      this.completeTarget(event.shotId, event.physicsStepId, world);
    }
  }

  public reset(world: PinballWorld): void {
    this.activeTargetIdsValue = ["L0", "R0"];
    this.returnRouteIdValue = "neutral-return";
    this.scoreValue = 0;
    this.comboValue = 0;
    this.completedShotIdsValue = [];
    this.climaxStateValue = "idle";
    this.lastEventLabelValue = "左または右の安全ショットを選ぶ";
    this.lastEventPhysicsStepIdValue = null;
    this.initialize(world);
  }

  /** Ends only the ball-scoped combo; game progress remains intact. */
  public onBallEnded(physicsStepId: number): void {
    this.comboValue = 0;
    this.lastEventLabelValue = "球終了。次の球で経路を続ける";
    this.lastEventPhysicsStepIdValue = physicsStepId;
  }

  public snapshot(world: PinballWorld): GrayboxRuntimeSnapshot {
    const nextTargetId = this.activeTargetIdsValue[0] ?? null;
    return {
      activeTargetIds: [...this.activeTargetIdsValue],
      nextTargetId,
      returnRouteId: this.returnRouteIdValue,
      score: this.scoreValue,
      combo: this.comboValue,
      progress: Math.min(1, this.completedShotIdsValue.length / GRAYBOX_PATH_LENGTH),
      completedShotIds: [...this.completedShotIdsValue],
      climaxState: this.climaxStateValue,
      lastEventLabel: this.lastEventLabelValue,
      lastEventPhysicsStepId: this.lastEventPhysicsStepIdValue,
      gateStates: copyGateStates(world.tableRuntime.gateStates),
    };
  }

  public targetLabel(targetId: GrayboxTargetId | null): string {
    if (targetId === null) {
      return this.climaxStateValue === "active" ? "クライマックス中" : "目標なし";
    }
    return TARGET_LABEL[targetId];
  }

  public activeTargetLabel(): string {
    if (this.activeTargetIdsValue.length === 0) {
      return this.climaxStateValue === "active" ? "クライマックス中" : "目標なし";
    }
    return this.activeTargetIdsValue.map((targetId) => TARGET_LABEL[targetId]).join(" / ");
  }

  public returnRouteLabel(): string {
    return ROUTE_LABEL[this.returnRouteIdValue];
  }

  private completeTarget(targetId: GrayboxTargetId, physicsStepId: number, world: PinballWorld): void {
    if (!this.activeTargetIdsValue.includes(targetId) || this.climaxStateValue === "active") {
      this.lastEventLabelValue = `${TARGET_LABEL[targetId]}は今の目標ではない`;
      this.lastEventPhysicsStepIdValue = physicsStepId;
      return;
    }

    const nextTargets = NEXT_TARGETS[targetId];
    this.activeTargetIdsValue = [...nextTargets];
    this.completedShotIdsValue = [...this.completedShotIdsValue, targetId];
    this.scoreValue += SCORE_VALUES[targetId];
    this.comboValue += 1;
    if (targetId === "C0") {
      this.climaxStateValue = "armed";
    }
    if (targetId === "C1") {
      this.climaxStateValue = "active";
    }

    const nextRoute = ROUTE_BY_TARGET[targetId];
    this.queueRouteChange(world, physicsStepId, nextRoute);
    const nextLabel = this.activeTargetLabel();
    this.lastEventLabelValue =
      this.climaxStateValue === "active"
        ? `${TARGET_LABEL[targetId]}成功。クライマックス開始`
        : `${TARGET_LABEL[targetId]}成功。戻りを${ROUTE_LABEL[nextRoute]}へ変更。次は${nextLabel}`;
    this.lastEventPhysicsStepIdValue = physicsStepId;
  }

  private queueRouteChange(world: PinballWorld, physicsStepId: number, routeId: GrayboxReturnRouteId): void {
    const previousGateId = GATE_BY_ROUTE[this.returnRouteIdValue];
    const nextGateId = GATE_BY_ROUTE[routeId];
    this.returnRouteIdValue = routeId;
    if (previousGateId === nextGateId) {
      world.enqueueCommand({
        type: "openGate",
        targetId: nextGateId,
        stepId: physicsStepId + 1,
      });
      return;
    }
    world.enqueueCommand({
      type: "closeGate",
      targetId: previousGateId,
      stepId: physicsStepId + 1,
    });
    world.enqueueCommand({
      type: "openGate",
      targetId: nextGateId,
      stepId: physicsStepId + 1,
    });
  }
}
