import * as planck from "planck";
import { ContactBuffer } from "./contact-buffer";
import type {
  ContactBatch,
  FixtureMetadata,
  ImpactEvent,
  SensorTransitionEvent,
} from "./contact-buffer";
import {
  PhysicsCommandQueue,
  PhysicsCommandSafetyError,
} from "./physics-command-queue";
import type { PhysicsCommand, PhysicsCommandInput, PhysicsCommandPayload } from "./physics-command-queue";
import {
  createG1BTableDefinition,
  createTableRuntimeState,
} from "../table/g1b-table";
import type {
  TableDefinition,
  TableFixtureDefinition,
  TablePoint,
  TableRuntimeState,
} from "../table/types";
import { GameState } from "../game";
import type {
  BaseGameState as BaseState,
  PendingTerminalEvent,
  SuspensionState,
} from "../game";
import { ShotStateMachine } from "../shots/shot-state-machine";
import type {
  GameEvent,
  ScoringEvent,
  ShotProgress,
} from "../shots/shot-state-machine";

export const BALL_RADIUS = 0.15;
export const DEFAULT_VELOCITY_CAP = 28;
export const DEFAULT_PHYSICS_STEP_HZ: PhysicsStepHz = 60;
export const BALL_ID = "ball-1";

export type PhysicsStepHz = 60 | 120;

const CATEGORY_BALL = 0x0001;
const CATEGORY_WALL = 0x0002;
const CATEGORY_FLIPPER = 0x0004;
const CATEGORY_SENSOR = 0x0008;

export type LaunchBand = "low" | "medium" | "high";
export type LaunchStrengthInput = LaunchBand | number;

export interface LaunchProfile {
  readonly band: LaunchBand;
  readonly normalizedStrength: number;
  readonly speed: number;
  readonly impulse: TablePoint;
}

export interface FlipperInput {
  readonly left?: boolean;
  readonly right?: boolean;
}

export interface PinballStepInput extends FlipperInput {
  readonly launch?: LaunchStrengthInput;
}

export interface BallSnapshot {
  readonly id: string;
  readonly position: TablePoint;
  readonly linearVelocity: TablePoint;
  readonly angle: number;
  readonly angularVelocity: number;
  readonly radius: number;
  readonly bullet: boolean;
}

export interface FlipperSnapshot {
  readonly side: "left" | "right";
  readonly position: TablePoint;
  readonly angle: number;
  readonly angularVelocity: number;
  readonly length: number;
  readonly thickness: number;
  readonly active: boolean;
}

export interface StaticGeometrySnapshot {
  readonly id: string;
  readonly kind: TableFixtureDefinition["kind"];
  readonly position: TablePoint;
  readonly width: number;
  readonly height: number;
  readonly angle: number;
}

export interface SensorSnapshot {
  readonly id: string;
  readonly purpose: "drain" | "launch-band" | "safe-shot";
  readonly position: TablePoint;
  readonly width: number;
  readonly height: number;
}

export interface PinballSnapshot {
  readonly physicsStepId: number;
  readonly tableBounds: { readonly width: number; readonly height: number };
  readonly ball: BallSnapshot;
  readonly flippers: readonly FlipperSnapshot[];
  readonly staticGeometry: readonly StaticGeometrySnapshot[];
  readonly sensors: readonly SensorSnapshot[];
  readonly baseState: BaseState;
  readonly suspensionState: SuspensionState;
  readonly pendingTerminalEvents: readonly PendingTerminalEvent[];
  readonly lastSafeBallState: LastSafeBallState | null;
  readonly shotProgress: readonly ShotProgress[];
}

export interface LastSafeBallState {
  readonly position: TablePoint;
  readonly linearVelocity: TablePoint;
  readonly angle: number;
  readonly angularVelocity: number;
  readonly physicsStepId: number;
  readonly routeContext: string | null;
}

export interface PhysicsDiagnostics {
  readonly physicsStepHz: PhysicsStepHz;
  readonly physicsStepId: number;
  readonly velocityCap: number;
  readonly ballSpeed: number;
  readonly bodyCount: number;
  readonly fixtureCount: number;
  readonly jointCount: number;
  readonly contactCount: number;
  readonly queuedCommandCount: number;
  readonly contactEventCount: number;
  readonly droppedSimulationMs: number;
  readonly droppedSimulationCount: number;
  readonly runIntegrity: "valid" | "invalid";
  readonly safeStopped: boolean;
  readonly destroyed: boolean;
}

export interface PinballStepResult {
  readonly physicsStepId: number;
  readonly dtSeconds: number;
  readonly suspended: boolean;
  readonly contacts: ContactBatch;
  readonly impacts: readonly ImpactEvent[];
  readonly sensorTransitions: readonly SensorTransitionEvent[];
  readonly gameEvents: readonly GameEvent[];
  readonly scoringEvents: readonly ScoringEvent[];
  readonly executedCommands: readonly PhysicsCommand[];
  readonly safeStateUpdated: boolean;
  readonly drained: boolean;
  readonly recovered: boolean;
}

interface FlipperRuntime {
  readonly side: "left" | "right";
  readonly body: planck.Body;
  readonly joint: planck.RevoluteJoint;
  readonly fixture: planck.Fixture;
  readonly restAngle: number;
  readonly length: number;
  readonly thickness: number;
  active: boolean;
}

interface BodyMetadata {
  readonly id: string;
  readonly kind: string;
}

const copyPoint = (value: { x: number; y: number }): TablePoint => ({ x: value.x, y: value.y });

const finitePoint = (value: { x: number; y: number }): boolean =>
  Number.isFinite(value.x) && Number.isFinite(value.y);

function metadataFor(
  id: string,
  kind: FixtureMetadata["kind"],
  sensorId: string | null = null,
  ballId: string | null = null,
): FixtureMetadata {
  return { id, kind, sensorId, ballId };
}

function readVector(payload: PhysicsCommandPayload, key: string): TablePoint | null {
  const value = payload[key];
  if (typeof value !== "object" || value === null || !("x" in value) || !("y" in value)) {
    return null;
  }
  const candidate = value as { x?: unknown; y?: unknown };
  if (typeof candidate.x !== "number" || typeof candidate.y !== "number") {
    return null;
  }
  return { x: candidate.x, y: candidate.y };
}

function readNumber(payload: PhysicsCommandPayload, key: string): number | null {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Maps a normalized pull distance into one of three deterministic launch bands. */
export function resolveLaunchStrength(strength: LaunchStrengthInput): LaunchProfile {
  let normalizedStrength: number;
  let band: LaunchBand;
  if (typeof strength === "string") {
    band = strength;
    normalizedStrength = band === "low" ? 0 : band === "medium" ? 0.5 : 1;
  } else {
    if (!Number.isFinite(strength)) {
      throw new RangeError("launch strength must be finite");
    }
    normalizedStrength = Math.min(1, Math.max(0, strength));
    band = normalizedStrength < 1 / 3 ? "low" : normalizedStrength < 2 / 3 ? "medium" : "high";
  }
  const speed = band === "low" ? 8 : band === "medium" ? 12 : 16;
  return {
    band,
    normalizedStrength,
    speed,
    impulse: { x: 0, y: speed },
  };
}

export interface PinballWorldOptions {
  readonly table?: TableDefinition;
  readonly physicsStepHz?: PhysicsStepHz;
  readonly velocityCap?: number;
  readonly gravityY?: number;
  /** Bounded callback-event capacity; overflow is a fatal safety stop. */
  readonly maxContactEventsPerStep?: number;
}

/**
 * G1-B Planck world.  The class intentionally owns only physics and plain
 * snapshots; rendering can consume getSnapshot() without importing Planck.
 */
export class PinballWorld {
  public readonly table: TableDefinition;
  public readonly tableRuntime: TableRuntimeState;
  public readonly world: planck.World;
  public readonly ballBody: planck.Body;
  public readonly ballFixture: planck.Fixture;
  public readonly contactBuffer: ContactBuffer;
  public readonly commandQueue: PhysicsCommandQueue;
  public readonly gameState: GameState;
  private readonly groundBody: planck.Body;

  private readonly velocityCap: number;
  private readonly bodies = new Map<string, planck.Body>();
  private readonly fixtures = new Map<string, planck.Fixture>();
  private readonly flippers = new Map<"left" | "right", FlipperRuntime>();
  private readonly joints = new Map<string, planck.Joint>();
  private readonly originalFilters = new Map<string, { groupIndex: number; categoryBits: number; maskBits: number }>();
  private readonly shotStateMachine: ShotStateMachine;
  private readonly disabledFixtures = new Set<string>();
  private lastSafeStateValue: LastSafeBallState | null = null;
  private safeStepStreak = 0;
  private safeStateInvalidationCount = 0;
  private lastFailedSafePosition: TablePoint | null = null;
  private lastContactBatch: ContactBatch = {
    physicsStepId: 0,
    sensorTransitions: [],
    impacts: [],
    occupancies: [],
    overflowed: false,
  };
  private physicsStepIdValue = 0;
  private destroyedValue = false;
  private safeStoppedValue = false;
  private safetyError: Error | null = null;
  private drainedValue = false;
  private routeContext: string | null = null;
  private readonly launchPosition: TablePoint;

  public constructor(options: PinballWorldOptions = {}) {
    this.table = options.table ?? createG1BTableDefinition();
    this.tableRuntime = createTableRuntimeState(this.table);
    const physicsStepHz = options.physicsStepHz ?? DEFAULT_PHYSICS_STEP_HZ;
    if (physicsStepHz !== 60 && physicsStepHz !== 120) {
      throw new RangeError("physicsStepHz must be 60 or 120");
    }
    this.physicsStepHzValue = physicsStepHz;
    this.velocityCap = options.velocityCap ?? DEFAULT_VELOCITY_CAP;
    if (!Number.isFinite(this.velocityCap) || this.velocityCap <= 0) {
      throw new RangeError("velocityCap must be finite and positive");
    }
    const gravityY = options.gravityY ?? -9.8;
    if (!Number.isFinite(gravityY)) {
      throw new RangeError("gravityY must be finite");
    }
    this.world = new planck.World({ gravity: planck.Vec2(0, gravityY), allowSleep: false, continuousPhysics: true });
    this.contactBuffer = new ContactBuffer(options.maxContactEventsPerStep ?? 1024);
    this.contactBuffer.attach(this.world);
    this.commandQueue = new PhysicsCommandQueue();
    this.gameState = new GameState({ initialBaseState: "LaunchReady" });
    this.groundBody = this.world.createBody({ type: "static" });
    this.groundBody.setUserData({ id: "body-ground", kind: "ground" } satisfies BodyMetadata);
    this.buildStaticGeometry();
    const launchSpawn = this.table.spawnPoints.find((spawn) => spawn.id === "launch");
    if (launchSpawn === undefined) {
      throw new Error("table is missing launch spawn");
    }
    this.launchPosition = { ...launchSpawn.position };
    const ball = this.world.createDynamicBody({
      position: planck.Vec2(this.launchPosition.x, this.launchPosition.y),
      linearDamping: 0.01,
      angularDamping: 0.01,
    });
    ball.setUserData({ id: BALL_ID, kind: "ball" } satisfies BodyMetadata);
    ball.setBullet(true);
    ball.setSleepingAllowed(false);
    this.ballBody = ball;
    this.ballFixture = ball.createFixture(planck.Circle(BALL_RADIUS), {
      density: 1,
      friction: 0.08,
      restitution: 0.6,
      filterCategoryBits: CATEGORY_BALL,
      filterMaskBits: CATEGORY_WALL | CATEGORY_FLIPPER | CATEGORY_SENSOR,
    });
    this.ballFixture.setUserData(metadataFor(BALL_ID, "ball", null, BALL_ID));
    this.registerFixture(BALL_ID, this.ballFixture);
    this.bodies.set(BALL_ID, ball);
    this.createFlipper("left");
    this.createFlipper("right");
    this.shotStateMachine = new ShotStateMachine(BALL_ID, this.table.shots);
  }

  private readonly physicsStepHzValue: PhysicsStepHz;

  public get physicsStepId(): number {
    return this.physicsStepIdValue;
  }

  public get physicsStepHz(): PhysicsStepHz {
    return this.physicsStepHzValue;
  }

  public get stepSeconds(): number {
    return 1 / this.physicsStepHzValue;
  }

  public get velocityLimit(): number {
    return this.velocityCap;
  }

  public get lastSafeBallState(): LastSafeBallState | null {
    return this.copySafeState(this.lastSafeStateValue);
  }

  public get safeStopped(): boolean {
    return this.safeStoppedValue;
  }

  public get destroyed(): boolean {
    return this.destroyedValue;
  }

  public get baseState(): BaseState {
    return this.gameState.baseState;
  }

  public get suspensionState(): SuspensionState {
    return this.gameState.suspensionState;
  }

  public get pendingTerminalEvents(): readonly PendingTerminalEvent[] {
    return this.gameState.pendingTerminalEvents;
  }

  public setSuspension(state: SuspensionState): void {
    this.assertAlive();
    if (state === "None") {
      this.gameState.resume();
    } else {
      this.gameState.suspend(state);
    }
  }

  public setFlipperInput(input: FlipperInput): void {
    this.assertAlive();
    const left = this.flippers.get("left");
    const right = this.flippers.get("right");
    if (left !== undefined && input.left !== undefined) {
      left.active = input.left;
    }
    if (right !== undefined && input.right !== undefined) {
      right.active = input.right;
    }
  }

  public getFlipperJointAngle(side: "left" | "right"): number {
    this.assertAlive();
    const flipper = this.flippers.get(side);
    if (flipper === undefined) {
      throw new RangeError(`unknown flipper ${side}`);
    }
    return flipper.joint.getJointAngle();
  }

  public enqueueCommand(input: PhysicsCommandInput): PhysicsCommand {
    this.assertAlive();
    try {
      return this.commandQueue.enqueue({
        ...input,
        stepId: input.stepId ?? this.physicsStepIdValue + 1,
      });
    } catch (error) {
      this.safeStoppedValue = true;
      this.safetyError = error instanceof Error ? error : new Error(String(error));
      this.gameState.enterFatalRecovery();
      throw error;
    }
  }

  /** Queue a deterministic launch; the impulse is applied at the next step boundary. */
  public launch(strength: LaunchStrengthInput): LaunchProfile {
    this.assertAlive();
    const profile = resolveLaunchStrength(strength);
    this.enqueueCommand({
      type: "launchBall",
      targetId: BALL_ID,
      stepId: this.physicsStepIdValue + 1,
      payload: { velocity: profile.impulse, band: profile.band },
    });
    return profile;
  }

  public launchBall(strength: LaunchStrengthInput): LaunchProfile {
    return this.launch(strength);
  }

  /** Advances exactly one fixed physics step. dt is in seconds. */
  public step(dtSeconds = this.stepSeconds, input: PinballStepInput = {}): PinballStepResult {
    this.assertAlive();
    if (!Number.isFinite(dtSeconds) || dtSeconds <= 0 || dtSeconds > 0.25) {
      throw new RangeError("dtSeconds must be finite and in (0, 0.25]");
    }
    this.setFlipperInput(input);
    if (input.launch !== undefined) {
      this.launch(input.launch);
    }
    const nextStepId = this.physicsStepIdValue + 1;
    if (this.gameState.suspensionState !== "None") {
      const emptyContacts: ContactBatch = {
        physicsStepId: nextStepId,
        sensorTransitions: [],
        impacts: [],
        occupancies: this.contactBuffer.getActiveOccupancies(),
        overflowed: false,
      };
      const suspendedResult: PinballStepResult = {
        physicsStepId: this.physicsStepIdValue,
        dtSeconds,
        suspended: true,
        contacts: emptyContacts,
        impacts: [],
        sensorTransitions: [],
        gameEvents: [],
        scoringEvents: [],
        executedCommands: [],
        safeStateUpdated: false,
        drained: this.drainedValue,
        recovered: false,
      };
      return suspendedResult;
    }
    this.physicsStepIdValue = nextStepId;
    this.contactBuffer.beginStep(nextStepId);

    // Ball-ending is a terminal event, not an immediate state mutation that
    // can be lost while the page is hidden. Consume it on the first active
    // step after suspension and leave the ball at a clean launch boundary.
    // Commands already queued for this same boundary (notably an explicit
    // launch) are still applied deterministically below.
    const terminalEvents = this.gameState.drainPendingTerminalEvents();
    if (terminalEvents.length > 0) {
      this.resetBallToLaunch();
      const contacts = this.contactBuffer.flushStep(nextStepId);
      this.lastContactBatch = contacts;
      const executedCommands = this.executeCommands(nextStepId);
      if (executedCommands.some((command) => command.type === "launchBall")) {
        this.drainedValue = false;
        this.ballBody.setActive(true);
        this.gameState.transitionBase("Playing");
      }
      return {
        physicsStepId: nextStepId,
        dtSeconds,
        suspended: false,
        contacts,
        impacts: [],
        sensorTransitions: [],
        gameEvents: [],
        scoringEvents: [],
        executedCommands,
        safeStateUpdated: false,
        drained: false,
        recovered: false,
      };
    }

    this.updateFlipperMotors();
    const recoveredBeforeStep = this.ensureBallFinite();
    this.clampBallVelocity();
    this.world.step(dtSeconds, 8, 3);
    this.enforceFlipperLimits();
    this.clampBallVelocity();
    this.ensureDrainSensorFallback(nextStepId);
    const contacts = this.contactBuffer.flushStep(nextStepId);
    this.lastContactBatch = contacts;
    if (contacts.overflowed) {
      this.stopForSafety(new Error(`Contact buffer exceeded its bounded per-step capacity at step ${nextStepId}`));
    }
    const drained = contacts.sensorTransitions.some(
      (event) => event.sensorId === "drain" && event.phase === "entered" && event.ballId === BALL_ID,
    );
    if (drained) {
      this.drainedValue = true;
      this.clearBallLifetimeSafetyState();
      this.gameState.transitionBase("BallEnding");
      this.gameState.queueTerminalEvent({ type: "ball-drained", payload: { ballId: BALL_ID } }, nextStepId);
      this.shotStateMachine.onBallEnded(nextStepId);
      this.ballBody.setActive(false);
    }
    // A terminal drain owns the whole boundary. Sensor transitions copied in
    // the same callback batch cannot restart or score a shot after ball end.
    const gameEvents = drained
      ? []
      : this.shotStateMachine.consumeSensorEvents(contacts.sensorTransitions, nextStepId);
    const scoringEvents = this.shotStateMachine.toScoringEvents(gameEvents);
    this.shotStateMachine.advance(nextStepId);
    const safeStateUpdated = !drained && this.updateLastSafeBallState(nextStepId);
    const executedCommands = this.executeCommands(nextStepId);
    if (executedCommands.some((command) => command.type === "launchBall")) {
      this.drainedValue = false;
      this.ballBody.setActive(true);
      this.gameState.transitionBase("Playing");
    }
    const result: PinballStepResult = {
      physicsStepId: nextStepId,
      dtSeconds,
      suspended: false,
      contacts,
      impacts: contacts.impacts,
      sensorTransitions: contacts.sensorTransitions,
      gameEvents,
      scoringEvents,
      executedCommands,
      safeStateUpdated,
      drained,
      recovered: recoveredBeforeStep,
    };
    return result;
  }

  /** Queues and applies a recovery at a safe step boundary. */
  public recoverBall(): boolean {
    this.assertAlive();
    const candidate = this.lastSafeStateValue;
    if (candidate === null) {
      this.resetBallToLaunch();
      return false;
    }

    if (this.samePoint(candidate.position, this.lastFailedSafePosition)) {
      this.safeStateInvalidationCount += 1;
    } else {
      this.safeStateInvalidationCount = 1;
      this.lastFailedSafePosition = { ...candidate.position };
    }
    if (this.safeStateInvalidationCount >= 2) {
      this.lastSafeStateValue = null;
      this.resetBallToLaunch();
      return false;
    }

    if (this.canOccupy(candidate.position)) {
      this.ballBody.setActive(true);
      this.ballBody.setTransform(planck.Vec2(candidate.position.x, candidate.position.y), candidate.angle);
      this.ballBody.setLinearVelocity(planck.Vec2(candidate.linearVelocity.x, candidate.linearVelocity.y));
      this.ballBody.setAngularVelocity(candidate.angularVelocity);
      this.ballBody.setAwake(true);
      this.drainedValue = false;
      this.gameState.transitionBase("Playing");
      return true;
    }
    this.resetBallToLaunch();
    return false;
  }

  public getSnapshot(): PinballSnapshot {
    this.assertNotDestroyed();
    const ballPosition = this.ballBody.getPosition();
    const ballVelocity = this.ballBody.getLinearVelocity();
    const flippers = [...this.flippers.values()]
      .filter((flipper) => !this.disabledFixtures.has(`flipper-${flipper.side}`))
      .sort((left, right) => (left.side === "left" ? -1 : 1) - (right.side === "left" ? -1 : 1))
      .map((flipper) => ({
        side: flipper.side,
        position: copyPoint(flipper.body.getPosition()),
        angle: flipper.body.getAngle(),
        angularVelocity: flipper.body.getAngularVelocity(),
        length: flipper.length,
        thickness: flipper.thickness,
        active: flipper.active,
      }));
    return {
      physicsStepId: this.physicsStepIdValue,
      tableBounds: { ...this.table.bounds },
      ball: {
        id: BALL_ID,
        position: copyPoint(ballPosition),
        linearVelocity: copyPoint(ballVelocity),
        angle: this.ballBody.getAngle(),
        angularVelocity: this.ballBody.getAngularVelocity(),
        radius: BALL_RADIUS,
        bullet: this.ballBody.isBullet(),
      },
      flippers,
      staticGeometry: this.table.fixtures
        .filter(
          (fixture) =>
            fixture.kind !== "sensor" &&
            this.fixtures.has(fixture.id) &&
            !this.disabledFixtures.has(fixture.id),
        )
        .map((fixture) => ({
          id: fixture.id,
          kind: fixture.kind,
          position: { ...fixture.position },
          width: fixture.width,
          height: fixture.height,
          angle: fixture.angle,
        })),
      sensors: this.table.sensors
        .filter(
          (sensor) =>
            this.fixtures.has(sensor.fixtureId) &&
            !this.disabledFixtures.has(sensor.fixtureId),
        )
        .map((sensor) => ({
          id: sensor.id,
          purpose: sensor.purpose,
          position: { ...sensor.position },
          width: sensor.width,
          height: sensor.height,
        })),
      baseState: this.gameState.baseState,
      suspensionState: this.gameState.suspensionState,
      pendingTerminalEvents: this.gameState.pendingTerminalEvents,
      lastSafeBallState: this.copySafeState(this.lastSafeStateValue),
      shotProgress: this.shotStateMachine.snapshot(),
    };
  }

  public diagnostics(): PhysicsDiagnostics {
    this.assertNotDestroyed();
    const velocity = this.ballBody.getLinearVelocity();
    return {
      physicsStepHz: this.physicsStepHz,
      physicsStepId: this.physicsStepIdValue,
      velocityCap: this.velocityCap,
      ballSpeed: finitePoint(velocity) ? Math.hypot(velocity.x, velocity.y) : Number.NaN,
      bodyCount: this.world.getBodyCount(),
      fixtureCount: this.fixtures.size,
      jointCount: this.world.getJointCount(),
      contactCount: this.world.getContactCount(),
      queuedCommandCount: this.commandQueue.size,
      contactEventCount: this.lastContactBatch.sensorTransitions.length + this.lastContactBatch.impacts.length,
      droppedSimulationMs: 0,
      droppedSimulationCount: 0,
      runIntegrity: this.safeStoppedValue ? "invalid" : "valid",
      safeStopped: this.safeStoppedValue,
      destroyed: this.destroyedValue,
    };
  }

  public destroy(): void {
    if (this.destroyedValue) {
      return;
    }
    const bodyList: planck.Body[] = [];
    for (let body = this.world.getBodyList(); body !== null; body = body.getNext()) {
      bodyList.push(body);
    }
    for (const body of bodyList) {
      this.world.destroyBody(body);
    }
    this.bodies.clear();
    this.fixtures.clear();
    this.joints.clear();
    this.flippers.clear();
    this.commandQueue.clear();
    this.destroyedValue = true;
  }

  private buildStaticGeometry(): void {
    for (const definition of this.table.fixtures) {
      const body = this.world.createBody({ type: "static" });
      body.setUserData({ id: definition.bodyId, kind: definition.kind });
      const isSensor = definition.kind === "sensor";
      const categoryBits = isSensor ? CATEGORY_SENSOR : CATEGORY_WALL;
      const maskBits = isSensor ? CATEGORY_BALL : CATEGORY_BALL | CATEGORY_FLIPPER;
      const fixture = body.createFixture(
        planck.Box(
          definition.width / 2,
          definition.height / 2,
          planck.Vec2(definition.position.x, definition.position.y),
          definition.angle,
        ),
        {
        isSensor,
        friction: 0.25,
        // The inclined high-launch guide is the deterministic lane exit. A
        // slightly livelier response keeps its reflected trajectory inside
        // the playable main board at both fixed-step rates.
        restitution: isSensor ? 0 : definition.id === "launch-guide" ? 0.9 : 0.55,
        filterCategoryBits: categoryBits,
        filterMaskBits: maskBits,
        },
      );
      fixture.setUserData(metadataFor(definition.id, definition.kind, definition.sensorId));
      this.registerFixture(definition.id, fixture);
      this.bodies.set(definition.bodyId, body);
    }
  }

  private createFlipper(side: "left" | "right"): void {
    const isLeft = side === "left";
    const jointDefinition = this.table.joints.find((definition) => definition.side === side);
    if (jointDefinition === undefined) {
      throw new Error(`table is missing ${side} flipper joint definition`);
    }
    const pivot = planck.Vec2(jointDefinition.anchor.x, jointDefinition.anchor.y);
    const restAngle = isLeft ? 0.15 : Math.PI - 0.15;
    const bodyId = `body-flipper-${side}`;
    const body = this.world.createDynamicBody({ position: pivot, angle: restAngle, angularDamping: 8, linearDamping: 3 });
    body.setUserData({ id: bodyId, kind: "flipper" } satisfies BodyMetadata);
    body.setBullet(true);
    body.setSleepingAllowed(false);
    const length = 1.65;
    const thickness = 0.28;
    const fixture = body.createFixture(planck.Box(length / 2, thickness / 2, planck.Vec2(length / 2, 0)), {
      density: 2,
      friction: 0.45,
      restitution: 0.35,
      filterCategoryBits: CATEGORY_FLIPPER,
      filterMaskBits: CATEGORY_BALL | CATEGORY_WALL,
    });
    const fixtureId = `flipper-${side}`;
    fixture.setUserData(metadataFor(fixtureId, "flipper"));
    this.registerFixture(fixtureId, fixture);
    const jointId = `joint-flipper-${side}`;
    const joint = this.world.createJoint(
      planck.RevoluteJoint({
        bodyA: this.groundBody,
        bodyB: body,
        localAnchorA: pivot,
        localAnchorB: planck.Vec2(0, 0),
        referenceAngle: restAngle,
        lowerAngle: jointDefinition.lowerAngle,
        upperAngle: jointDefinition.upperAngle,
        enableLimit: true,
        enableMotor: true,
        motorSpeed: 0,
        maxMotorTorque: 100,
      }),
    );
    if (joint === null || !(joint instanceof planck.RevoluteJoint)) {
      throw new Error(`failed to create ${jointId}`);
    }
    this.joints.set(jointId, joint);
    this.flippers.set(side, { side, body, joint, fixture, restAngle, length, thickness, active: false });
    this.bodies.set(bodyId, body);
  }

  private registerFixture(id: string, fixture: planck.Fixture): void {
    this.fixtures.set(id, fixture);
    this.originalFilters.set(id, {
      groupIndex: fixture.getFilterGroupIndex(),
      categoryBits: fixture.getFilterCategoryBits(),
      maskBits: fixture.getFilterMaskBits(),
    });
  }

  private updateFlipperMotors(): void {
    for (const flipper of this.flippers.values()) {
      const angle = flipper.joint.getJointAngle();
      const towardActive = flipper.side === "left" ? 12 : -12;
      const awayFromRest = flipper.side === "left" ? angle > 0.03 : angle < -0.03;
      const towardRest = awayFromRest ? (flipper.side === "left" ? -18 : 18) : 0;
      flipper.joint.setMotorSpeed(flipper.active ? towardActive : towardRest);
      flipper.joint.setMaxMotorTorque(flipper.active ? 140 : 80);
    }
  }

  /** Planck limits are solved numerically; clamp a tiny post-solve overshoot before exposing state. */
  private enforceFlipperLimits(): void {
    for (const flipper of this.flippers.values()) {
      const jointAngle = flipper.joint.getJointAngle();
      const boundedAngle = Math.min(
        flipper.joint.getUpperLimit(),
        Math.max(flipper.joint.getLowerLimit(), jointAngle),
      );
      if (Math.abs(jointAngle - boundedAngle) > 1e-7) {
        const bodyPosition = flipper.body.getPosition();
        flipper.body.setTransform(
          bodyPosition,
          flipper.body.getAngle() + boundedAngle - jointAngle,
        );
        flipper.body.setAngularVelocity(0);
      }
      if (!flipper.active) {
        const currentAngle = flipper.joint.getJointAngle();
        const returnCorrection = Math.max(-0.25, Math.min(0.25, -currentAngle));
        if (Math.abs(returnCorrection) > 1e-7) {
          const bodyPosition = flipper.body.getPosition();
          flipper.body.setTransform(bodyPosition, flipper.body.getAngle() + returnCorrection);
          flipper.body.setAngularVelocity(0);
        }
      }
    }
  }

  private executeCommands(stepId: number): readonly PhysicsCommand[] {
    let commands: readonly PhysicsCommand[];
    try {
      commands = this.commandQueue.drainForStep(stepId);
    } catch (error) {
      this.safeStoppedValue = true;
      this.safetyError = error instanceof Error ? error : new Error(String(error));
      this.gameState.enterFatalRecovery();
      throw error;
    }
    for (const command of commands) {
      try {
        this.executeCommand(command);
      } catch (error) {
        this.safeStoppedValue = true;
        this.safetyError = error instanceof Error ? error : new Error(String(error));
        this.gameState.enterFatalRecovery();
        throw error;
      }
    }
    return commands;
  }

  private stopForSafety(error: Error): never {
    this.safeStoppedValue = true;
    this.safetyError = error;
    this.gameState.enterFatalRecovery();
    this.ballBody.setActive(false);
    throw error;
  }

  private executeCommand(command: PhysicsCommand): void {
    if (command.type === "launchBall") {
      const velocity = readVector(command.payload, "velocity");
      if (velocity === null || !finitePoint(velocity)) {
        throw new PhysicsCommandSafetyError(command.targetId, "launchBall requires a finite velocity");
      }
      this.ballBody.setActive(true);
      this.ballBody.setTransform(planck.Vec2(this.launchPosition.x, this.launchPosition.y), this.ballBody.getAngle());
      this.ballBody.setLinearVelocity(planck.Vec2(velocity.x, velocity.y));
      this.ballBody.setAngularVelocity(0);
      this.ballBody.setAwake(true);
      this.routeContext = null;
      return;
    }
    if (command.type === "teleportBall") {
      const position = readVector(command.payload, "position");
      const velocity = readVector(command.payload, "velocity") ?? { x: 0, y: 0 };
      if (position === null || !finitePoint(position) || !finitePoint(velocity) || !this.canOccupy(position)) {
        throw new PhysicsCommandSafetyError(command.targetId, "teleportBall position is not safe");
      }
      this.ballBody.setActive(true);
      this.ballBody.setTransform(planck.Vec2(position.x, position.y), this.ballBody.getAngle());
      this.ballBody.setLinearVelocity(planck.Vec2(velocity.x, velocity.y));
      this.ballBody.setAwake(true);
      return;
    }
    if (command.type === "destroyBody") {
      const body = this.bodies.get(command.targetId);
      if (body === undefined || command.targetId === BALL_ID) {
        throw new PhysicsCommandSafetyError(command.targetId, "cannot destroy missing or protected body");
      }
      this.destroyRegisteredBody(command.targetId, body);
      return;
    }
    if (command.type === "createBody") {
      if (this.bodies.has(command.targetId)) {
        throw new PhysicsCommandSafetyError(command.targetId, "body already exists");
      }
      throw new PhysicsCommandSafetyError(command.targetId, "generic createBody is not enabled in G1-B");
    }
    if (command.type === "openGate" || command.type === "closeGate") {
      const fixture = this.fixtures.get(command.targetId);
      const definition = this.table.fixtures.find((candidate) => candidate.id === command.targetId);
      if (fixture === undefined || definition === undefined || definition.kind !== "lane") {
        throw new PhysicsCommandSafetyError(command.targetId, "gate command requires an existing lane fixture");
      }
      const open = command.type === "openGate";
      this.tableRuntime.gateStates.set(command.targetId, command.type === "openGate");
      this.setFixtureEnabled(command.targetId, fixture, !open);
      return;
    }
    if (command.type === "resetTemporaryRoute") {
      this.routeContext = null;
      return;
    }
    if (command.type === "enableFixture" || command.type === "disableFixture") {
      const fixture = this.fixtures.get(command.targetId);
      const original = this.originalFilters.get(command.targetId);
      if (fixture === undefined || original === undefined) {
        throw new PhysicsCommandSafetyError(command.targetId, "fixture does not exist");
      }
      const enabled = command.type === "enableFixture";
      this.setFixtureEnabled(command.targetId, fixture, enabled);
      return;
    }
    if (command.type === "setCollisionFilter") {
      const fixture = this.fixtures.get(command.targetId);
      if (fixture === undefined) {
        throw new PhysicsCommandSafetyError(command.targetId, "fixture does not exist");
      }
      const categoryBits = readNumber(command.payload, "categoryBits");
      const maskBits = readNumber(command.payload, "maskBits");
      const groupIndex = readNumber(command.payload, "groupIndex") ?? 0;
      if (categoryBits === null || maskBits === null) {
        throw new PhysicsCommandSafetyError(command.targetId, "setCollisionFilter requires categoryBits and maskBits");
      }
      fixture.setFilterData({ groupIndex, categoryBits, maskBits });
    }
  }

  private setFixtureEnabled(id: string, fixture: planck.Fixture, enabled: boolean): void {
    const original = this.originalFilters.get(id);
    if (original === undefined) {
      throw new PhysicsCommandSafetyError(id, "fixture has no original collision filter");
    }
    fixture.setFilterData(enabled ? original : { groupIndex: 0, categoryBits: 0, maskBits: 0 });
    if (enabled) {
      this.disabledFixtures.delete(id);
    } else {
      this.disabledFixtures.add(id);
    }
  }

  /** Removes one registered body and every runtime/presentation registration it owns. */
  private destroyRegisteredBody(bodyId: string, body: planck.Body): void {
    const fixtureIds = [...this.fixtures]
      .filter(([, fixture]) => fixture.getBody() === body)
      .map(([fixtureId]) => fixtureId);
    const jointIds = [...this.joints]
      .filter(([, joint]) => joint.getBodyA() === body || joint.getBodyB() === body)
      .map(([jointId]) => jointId);
    const flipperSides = [...this.flippers]
      .filter(([, flipper]) => flipper.body === body)
      .map(([side]) => side);
    const removedSensorIds = this.table.fixtures
      .filter((definition) => fixtureIds.includes(definition.id) && definition.sensorId !== null)
      .map((definition) => definition.sensorId as string);

    // Capture every owner before Planck invalidates the attached fixtures and
    // joints, then mutate our registries only after the physical destroy wins.
    this.world.destroyBody(body);
    this.bodies.delete(bodyId);
    for (const fixtureId of fixtureIds) {
      this.fixtures.delete(fixtureId);
      this.originalFilters.delete(fixtureId);
      this.disabledFixtures.delete(fixtureId);
      this.tableRuntime.gateStates.delete(fixtureId);
      this.tableRuntime.chargeValues.delete(fixtureId);
      this.tableRuntime.activeRuntimeComponents.delete(fixtureId);
    }
    for (const jointId of jointIds) {
      this.joints.delete(jointId);
      this.tableRuntime.activeRuntimeComponents.delete(jointId);
    }
    for (const side of flipperSides) {
      this.flippers.delete(side);
    }
    this.tableRuntime.chargeValues.delete(bodyId);
    this.tableRuntime.activeRuntimeComponents.delete(bodyId);

    if (removedSensorIds.length > 0) {
      const removedSensorSet = new Set(removedSensorIds);
      for (const shot of this.table.shots) {
        if (
          removedSensorSet.has(shot.entrySensorId) ||
          removedSensorSet.has(shot.checkpointSensorId) ||
          removedSensorSet.has(shot.exitSensorId)
        ) {
          this.tableRuntime.enabledShots.delete(shot.id);
        }
      }
      for (const route of this.table.routes) {
        if (route.sensorIds.some((sensorId) => removedSensorSet.has(sensorId))) {
          this.tableRuntime.connectedRoutes.delete(route.id);
        }
      }
      this.shotStateMachine.onBallEnded(this.physicsStepIdValue);
    }

    // A geometry mutation invalidates a safe position captured against the
    // previous fixture set. Recovery will establish a new one after 3 steps.
    this.lastSafeStateValue = null;
    this.safeStepStreak = 0;
    this.routeContext = null;
  }

  private updateLastSafeBallState(stepId: number): boolean {
    const position = this.ballBody.getPosition();
    const velocity = this.ballBody.getLinearVelocity();
    const speed = Math.hypot(velocity.x, velocity.y);
    if (
      !finitePoint(position) ||
      !finitePoint(velocity) ||
      !Number.isFinite(this.ballBody.getAngle()) ||
      !Number.isFinite(this.ballBody.getAngularVelocity()) ||
      position.x < BALL_RADIUS ||
      position.x > this.table.bounds.width - BALL_RADIUS ||
      position.y < BALL_RADIUS ||
      position.y > this.table.bounds.height - BALL_RADIUS ||
      speed > this.velocityCap + 1e-6 ||
      !this.canOccupy(position)
    ) {
      this.safeStepStreak = 0;
      return false;
    }
    this.safeStepStreak += 1;
    if (this.safeStepStreak < 3) {
      return false;
    }
    if (
      this.lastFailedSafePosition !== null &&
      !this.samePoint(position, this.lastFailedSafePosition)
    ) {
      this.lastFailedSafePosition = null;
      this.safeStateInvalidationCount = 0;
    }
    this.lastSafeStateValue = {
      position: copyPoint(position),
      linearVelocity: copyPoint(velocity),
      angle: this.ballBody.getAngle(),
      angularVelocity: this.ballBody.getAngularVelocity(),
      physicsStepId: stepId,
      routeContext: this.routeContext,
    };
    return true;
  }

  private ensureDrainSensorFallback(stepId: number): void {
    void stepId;
    const position = this.ballBody.getPosition();
    const inDrainLane =
      position.x >= 3.45 &&
      position.x <= this.table.bounds.width - 3.45 &&
      position.y <= 0.2;
    if (
      inDrainLane &&
      !this.contactBuffer.hasPendingSensorTransition("drain", "entered", BALL_ID)
    ) {
      const velocity = this.ballBody.getLinearVelocity();
      const speed = Math.hypot(velocity.x, velocity.y);
      this.contactBuffer.recordSyntheticSensorTransition(
        BALL_ID,
        "drain",
        "entered",
        copyPoint(position),
        speed > 1e-9 ? { x: velocity.x / speed, y: velocity.y / speed } : { x: 0, y: 0 },
      );
    }
  }

  private canOccupy(position: TablePoint): boolean {
    if (!finitePoint(position)) {
      return false;
    }
    const aabb = planck.AABB(
      planck.Vec2(position.x - BALL_RADIUS, position.y - BALL_RADIUS),
      planck.Vec2(position.x + BALL_RADIUS, position.y + BALL_RADIUS),
    );
    const candidateShape = new planck.CircleShape(BALL_RADIUS);
    const candidateTransform = new planck.Transform(position, 0);
    let overlap = false;
    this.world.queryAABB(aabb, (fixture) => {
      const metadata = fixture.getUserData();
      if (
        typeof metadata !== "object" ||
        metadata === null ||
        !("kind" in metadata) ||
        metadata.kind === "ball" ||
        metadata.kind === "sensor" ||
        ("id" in metadata &&
          typeof metadata.id === "string" &&
          this.disabledFixtures.has(metadata.id))
      ) {
        return true;
      }
      const shape = fixture.getShape();
      for (let childIndex = 0; childIndex < shape.getChildCount(); childIndex += 1) {
        if (
          planck.testOverlap(
            candidateShape,
            0,
            shape,
            childIndex,
            candidateTransform,
            fixture.getBody().getTransform(),
          )
        ) {
          overlap = true;
          return false;
        }
      }
      return true;
    });
    return !overlap;
  }

  private ensureBallFinite(): boolean {
    const position = this.ballBody.getPosition();
    const velocity = this.ballBody.getLinearVelocity();
    if (
      finitePoint(position) &&
      finitePoint(velocity) &&
      Number.isFinite(this.ballBody.getAngle()) &&
      Number.isFinite(this.ballBody.getAngularVelocity())
    ) {
      return false;
    }
    return this.recoverBall();
  }

  private clampBallVelocity(): void {
    const velocity = this.ballBody.getLinearVelocity();
    if (!finitePoint(velocity)) {
      return;
    }
    const speed = Math.hypot(velocity.x, velocity.y);
    if (speed > this.velocityCap) {
      const ratio = this.velocityCap / speed;
      this.ballBody.setLinearVelocity(planck.Vec2(velocity.x * ratio, velocity.y * ratio));
    }
  }

  private resetBallToLaunch(): void {
    this.ballBody.setActive(true);
    this.ballBody.setTransform(planck.Vec2(this.launchPosition.x, this.launchPosition.y), 0);
    this.ballBody.setLinearVelocity(planck.Vec2(0, 0));
    this.ballBody.setAngularVelocity(0);
    this.ballBody.setAwake(true);
    this.drainedValue = false;
    this.gameState.transitionBase("LaunchReady");
  }

  private clearBallLifetimeSafetyState(): void {
    this.lastSafeStateValue = null;
    this.safeStepStreak = 0;
    this.safeStateInvalidationCount = 0;
    this.lastFailedSafePosition = null;
    this.routeContext = null;
  }

  private copySafeState(value: LastSafeBallState | null): LastSafeBallState | null {
    if (value === null) {
      return null;
    }
    return {
      ...value,
      position: { ...value.position },
      linearVelocity: { ...value.linearVelocity },
    };
  }

  private samePoint(left: TablePoint, right: TablePoint | null): boolean {
    return right !== null && Math.hypot(left.x - right.x, left.y - right.y) <= 1e-6;
  }

  private assertAlive(): void {
    this.assertNotDestroyed();
    if (this.safeStoppedValue) {
      throw this.safetyError ?? new Error("PinballWorld is safely stopped");
    }
  }

  private assertNotDestroyed(): void {
    if (this.destroyedValue) {
      throw new Error("PinballWorld has been destroyed");
    }
  }
}

export function createPinballPrototype(options: PinballWorldOptions = {}): PinballWorld {
  return new PinballWorld(options);
}
