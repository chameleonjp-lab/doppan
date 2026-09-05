import * as planck from "planck";
import {
  PACHI_BALL_LIFETIME_SECONDS,
  PACHI_BOARD_HEIGHT,
  PACHI_BOARD_WIDTH,
  PACHI_DEFAULT_GEOMETRY,
  PACHI_FIXED_HZ,
  PACHI_LAUNCH_CAP_ANGLE,
  PACHI_LAUNCH_RELEASE_GAP_HEIGHT,
  PACHI_LAUNCH_RELEASE_ANGLE,
  PACHI_LAUNCH_RELEASE_Y,
  PACHI_MAX_BALLS,
  PACHI_PHYSICS_SCALE,
} from "../game/pachi-types";
import type {
  PachiBallSnapshot,
  PachiBoardGeometry,
  PachiPocketRole,
  PachiWorldEvent,
  PachiWorldOptions,
  PachiWorldSnapshot,
} from "../game/pachi-types";

const SCALE = PACHI_PHYSICS_SCALE;
const FIXED_DT = 1 / PACHI_FIXED_HZ;
const BALL_RADIUS_PX = PACHI_DEFAULT_GEOMETRY.ballRadius;
const BALL_RADIUS = BALL_RADIUS_PX / SCALE;
const MAX_STEP_SECONDS = 0.5;

const CATEGORY_BALL = 0x0001;
const CATEGORY_RAIL = 0x0002;
const CATEGORY_NAIL = 0x0004;
const CATEGORY_SENSOR = 0x0008;

type FixtureKind = "rail" | "nail" | "sensor" | "ball";

interface FixtureData {
  readonly id: string;
  readonly kind: FixtureKind;
  readonly role?: Exclude<PachiPocketRole, "reclaim">;
}

interface BallRuntime {
  readonly id: string;
  readonly body: planck.Body;
  readonly fixture: planck.Fixture;
  age: number;
  stillTime: number;
  lastX: number;
  lastY: number;
  captured: boolean;
}

interface PendingCapture {
  readonly ball: BallRuntime;
  readonly role: Exclude<PachiPocketRole, "reclaim">;
  readonly pocketId: string;
}

type PachiWorldEventInput = PachiWorldEvent extends infer Event
  ? Event extends { readonly id: number }
    ? Omit<Event, "id">
    : never
  : never;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function copyGeometry(geometry: PachiBoardGeometry): PachiBoardGeometry {
  return {
    width: PACHI_BOARD_WIDTH,
    height: PACHI_BOARD_HEIGHT,
    scale: SCALE,
    ballRadius: geometry.ballRadius,
    launch: { ...geometry.launch },
    launchRail: geometry.launchRail.map((point) => ({ ...point })),
    launchGuide: { ...geometry.launchGuide },
    screen: { ...geometry.screen },
    nails: geometry.nails.map((point) => ({ ...point })),
    start: { ...geometry.start },
    sideLeft: { ...geometry.sideLeft },
    sideRight: { ...geometry.sideRight },
    attacker: { ...geometry.attacker },
    drain: { ...geometry.drain },
  };
}

function createGeometry(input: PachiBoardGeometry | undefined): PachiBoardGeometry {
  const source = input ?? PACHI_DEFAULT_GEOMETRY;
  if (source.width !== PACHI_BOARD_WIDTH || source.height !== PACHI_BOARD_HEIGHT) {
    throw new RangeError(`pachi geometry must be ${PACHI_BOARD_WIDTH}x${PACHI_BOARD_HEIGHT}`);
  }
  const screen = source.screen;
  const nails = (source.nails.length > 0 ? source.nails : defaultNails()).filter(
    (point) =>
      point.x < screen.x - 8 ||
      point.x > screen.x + screen.width + 8 ||
      point.y < screen.y - 8 ||
      point.y > screen.y + screen.height + 8,
  );
  return {
    ...copyGeometry(source),
    nails: nails.map((point) => ({ x: point.x, y: point.y })),
  };
}

function defaultNails(): readonly { readonly x: number; readonly y: number }[] {
  const nails: { x: number; y: number }[] = [];
  // A staggered field leaves clear visual pockets while giving the ball a
  // natural sequence of small, high speed deflections.
  const rows = [
    { y: 168, from: 226, to: 494, offset: 0 },
    { y: 207, from: 202, to: 518, offset: 23 },
    { y: 246, from: 226, to: 494, offset: 0 },
    { y: 285, from: 186, to: 534, offset: 23 },
    { y: 326, from: 208, to: 512, offset: 0 },
    { y: 367, from: 180, to: 540, offset: 23 },
    { y: 410, from: 210, to: 510, offset: 0 },
    { y: 584, from: 190, to: 530, offset: 0 },
    { y: 624, from: 220, to: 500, offset: 22 },
    { y: 670, from: 190, to: 530, offset: 0 },
  ];
  for (const row of rows) {
    for (let x = row.from; x <= row.to; x += 42) {
      const candidate = { x: x + row.offset, y: row.y };
      const inScreen =
        candidate.x > 181 &&
        candidate.x < 539 &&
        candidate.y > 165 &&
        candidate.y < 393;
      const inStart = candidate.x > 285 && candidate.x < 435 && candidate.y > 450 && candidate.y < 510;
      const inAttacker = candidate.x > 270 && candidate.x < 450 && candidate.y > 705 && candidate.y < 780;
      if (!inScreen && !inStart && !inAttacker && candidate.x < 640) nails.push(candidate);
    }
  }
  return nails;
}

function metadata(fixture: planck.Fixture): FixtureData | null {
  const value = fixture.getUserData();
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as { id?: unknown; kind?: unknown; role?: unknown };
  if (typeof candidate.id !== "string" || typeof candidate.kind !== "string") return null;
  if (candidate.kind !== "rail" && candidate.kind !== "nail" && candidate.kind !== "sensor" && candidate.kind !== "ball") {
    return null;
  }
  const role = candidate.role;
  if (
    role !== undefined &&
    role !== "start" &&
    role !== "side" &&
    role !== "attacker" &&
    role !== "drain"
  ) {
    return null;
  }
  return {
    id: candidate.id,
    kind: candidate.kind,
    ...(role === undefined ? {} : { role }),
  };
}

function bodyBall(body: planck.Body): BallRuntime | null {
  const value = body.getUserData();
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as { ball?: unknown };
  return candidate.ball instanceof Object ? (candidate.ball as BallRuntime) : null;
}

/**
 * Planck-backed pachinko board.  All public positions are 720x900 pixels;
 * Planck receives metres through the fixed 100 px/m conversion.  The world
 * owns the complete ball lifetime and only emits copied plain events after a
 * step, so a caller never retains a Planck object.
 */
export class PachiWorld {
  public readonly world: planck.World;
  public readonly geometry: PachiBoardGeometry;

  private readonly random: () => number;
  private readonly maxBalls: number;
  private readonly balls = new Map<string, BallRuntime>();
  private readonly sensors = new Map<string, { readonly fixture: planck.Fixture; readonly role: Exclude<PachiPocketRole, "reclaim"> }>();
  private readonly eventQueue: PachiWorldEvent[] = [];
  private readonly pendingCaptures = new Map<string, PendingCapture>();
  private readonly fixtureFilters = new Map<string, { groupIndex: number; categoryBits: number; maskBits: number }>();
  private readonly attackerLid: planck.Fixture;
  private stepAccumulator = 0;
  private stepIdValue = 0;
  private nextBallNumber = 1;
  private nextEventId = 1;
  private attackerOpenValue = false;
  private destroyedValue = false;

  public constructor(options: PachiWorldOptions = {}) {
    this.geometry = createGeometry(options.geometry);
    this.random = options.random ?? (() => 0.5);
    this.maxBalls = Number.isInteger(options.maxBalls) && (options.maxBalls as number) > 0
      ? (options.maxBalls as number)
      : PACHI_MAX_BALLS;
    this.world = new planck.World({
      gravity: planck.Vec2(0, 9.8),
      allowSleep: false,
      continuousPhysics: true,
    });
    this.buildBoard();
    this.attackerLid = this.buildAttackerLid();
    this.world.on("begin-contact", (contact) => this.onBeginContact(contact));
  }

  public get physicsStep(): number {
    return this.stepIdValue;
  }

  public get physicsStepHz(): typeof PACHI_FIXED_HZ {
    return PACHI_FIXED_HZ;
  }

  public get ballCount(): number {
    return this.balls.size;
  }

  public get attackerOpen(): boolean {
    return this.attackerOpenValue;
  }

  public get destroyed(): boolean {
    return this.destroyedValue;
  }

  /** Adds a ball at the real launcher and returns its stable id. */
  public launch(power: number): string | null {
    this.assertAlive();
    if (!finite(power)) throw new RangeError("pachi launch power must be finite");
    if (this.balls.size >= this.maxBalls) return null;
    const p = clamp(power, 0, 1);
    const id = `pachi-ball-${this.nextBallNumber}`;
    this.nextBallNumber += 1;
    const launch = this.geometry.launch;
    const body = this.world.createDynamicBody({
      position: planck.Vec2(launch.x / SCALE, launch.y / SCALE),
      linearDamping: 0.015,
      angularDamping: 0.15,
    });
    body.setBullet(true);
    body.setSleepingAllowed(false);
    const fixture = body.createFixture(planck.Circle(BALL_RADIUS), {
      density: 1,
      friction: 0.035,
      restitution: 0.66,
      filterCategoryBits: CATEGORY_BALL,
      filterMaskBits: CATEGORY_RAIL | CATEGORY_NAIL | CATEGORY_SENSOR,
    });
    const ball: BallRuntime = {
      id,
      body,
      fixture,
      age: 0,
      stillTime: 0,
      lastX: launch.x / SCALE,
      lastY: launch.y / SCALE,
      captured: false,
    };
    body.setUserData({ id, kind: "ball", ball });
    fixture.setUserData({ id, kind: "ball" } satisfies FixtureData);
    this.balls.set(id, ball);

    // Power changes both the vertical climb and the horizontal entry angle.
    // The tiny seeded spread keeps repeated launches from following one exact
    // line while preserving deterministic playback for a given seed.
    const randomValue = this.random();
    const spread = (clamp(finite(randomValue) ? randomValue : 0.5, 0, 1) - 0.5) * (0.6 + p * 0.9);
    // The inner guide carries every power setting nearly vertically first;
    // the release vane then sends the ball left into the nail field.  Keep a
    // 12..13.5 m/s upward band so low power still reaches the release.
    const speedX = spread;
    const speedY = -(12 + p * 1.5) - spread * 0.05;
    body.setLinearVelocity(planck.Vec2(speedX, speedY));
    this.pushEvent({
      type: "fired",
      ballId: id,
      x: launch.x,
      y: launch.y,
      power: p,
      physicsStep: this.stepIdValue,
    });
    return id;
  }

  public launchBall(power: number): string | null {
    return this.launch(power);
  }

  /** Alias useful to renderer diagnostics and physics tests. */
  public spawnBall(power = 0.5): string | null {
    return this.launch(power);
  }

  /** Open or close the six-second attacker. The closed lid blocks the pocket. */
  public setAttackerOpen(open: boolean): void {
    this.assertAlive();
    if (this.attackerOpenValue === open) return;
    this.attackerOpenValue = open;
    const original = this.fixtureFilters.get("attacker-lid");
    if (original !== undefined) {
      this.attackerLid.setFilterData(
        open ? { groupIndex: 0, categoryBits: 0, maskBits: 0 } : original,
      );
    }
  }

  public clearBalls(reason: "drain" | "lifetime" | "stuck" | "overflow" = "overflow"): void {
    this.assertAlive();
    for (const ball of [...this.balls.values()]) this.removeBall(ball, reason);
  }

  public step(deltaSeconds = FIXED_DT): void {
    this.assertAlive();
    if (!finite(deltaSeconds) || deltaSeconds < 0 || deltaSeconds > MAX_STEP_SECONDS) {
      throw new RangeError(`pachi world delta must be in [0, ${MAX_STEP_SECONDS}] seconds`);
    }
    this.stepAccumulator += deltaSeconds;
    // An epsilon keeps 1/60 and 1000/120 callers on the same fixed boundary.
    while (this.stepAccumulator + 1e-12 >= FIXED_DT) {
      this.stepAccumulator -= FIXED_DT;
      this.stepFixed();
    }
  }

  public stepFixed(): void {
    this.assertAlive();
    this.stepFixedInternal();
  }

  public drainEvents(): readonly PachiWorldEvent[] {
    const events = this.eventQueue.map((event) => ({ ...event }));
    this.eventQueue.length = 0;
    return events;
  }

  public snapshot(): PachiWorldSnapshot {
    this.assertAlive();
    return {
      physicsStep: this.stepIdValue,
      balls: [...this.balls.values()].map((ball) => this.snapshotBall(ball)),
      attackerOpen: this.attackerOpenValue,
      geometry: copyGeometry(this.geometry),
    };
  }

  public getSnapshot(): PachiWorldSnapshot {
    return this.snapshot();
  }

  public destroy(): void {
    if (this.destroyedValue) return;
    for (const ball of [...this.balls.values()]) this.world.destroyBody(ball.body);
    this.balls.clear();
    this.pendingCaptures.clear();
    this.eventQueue.length = 0;
    this.world.clearForces();
    this.destroyedValue = true;
  }

  private buildBoard(): void {
    // A low-friction outer shell, with a central drain opening.  The right
    // lane is kept as a visible rail and releases the ball into the nail field.
    this.addBox("wall-left", 28, 450, 16, 900, 0.72);
    this.addBox("wall-right", 692, 450, 16, 900, 0.72);
    this.addBox("wall-top", 360, 16, 664, 16, 0.68);
    this.addBox("floor-left", 125, 884, 230, 16, 0.58);
    this.addBox("floor-right", 595, 884, 230, 16, 0.58);
    this.addBox("rail-right", 666, 470, 12, 720, 0.08, 0, 0.02);
    this.addBox("rail-release", 626, 92, 92, 12, 0.05, PACHI_LAUNCH_CAP_ANGLE, 0.02);
    const guide = this.geometry.launchGuide;
    const guideLowerY = guide.y + PACHI_LAUNCH_RELEASE_GAP_HEIGHT;
    const guideLowerHeight = guide.y + guide.height - guideLowerY;
    // The right edge is the existing outer lane rail.  This inner edge keeps
    // the launch ball in a real vertical channel until the upper release.
    this.addBox(
      "launch-guide-left",
      guide.x,
      guideLowerY + guideLowerHeight / 2,
      8,
      guideLowerHeight,
      0.05,
      0,
      0.02,
    );
    // A positively angled release vane reflects an upward ball down-left,
    // away from the LCD island and into the first nail rows.
    this.addBox(
      "launch-guide-release",
      guide.x + guide.width / 2,
      PACHI_LAUNCH_RELEASE_Y,
      guide.width + 20,
      8,
      0.05,
      PACHI_LAUNCH_RELEASE_ANGLE,
      0.02,
    );
    // The display is an island in the physical board. Balls cannot pass
    // behind the renderer's reel layer; the opening beneath it feeds START.
    const screen = this.geometry.screen;
    this.addBox("screen-top", screen.x + screen.width / 2, screen.y, screen.width, 10, 0.58);
    this.addBox("screen-bottom", screen.x + screen.width / 2, screen.y + screen.height, screen.width, 10, 0.58);
    this.addBox("screen-left", screen.x, screen.y + screen.height / 2, 10, screen.height, 0.58);
    this.addBox("screen-right", screen.x + screen.width, screen.y + screen.height / 2, 10, screen.height, 0.58);

    for (let i = 0; i < this.geometry.nails.length; i += 1) {
      const point = this.geometry.nails[i];
      if (point === undefined) continue;
      const body = this.world.createBody({ type: "static", position: planck.Vec2(point.x / SCALE, point.y / SCALE) });
      const fixture = body.createFixture(planck.Circle(4.6 / SCALE), {
        friction: 0.08,
        restitution: 0.82,
        filterCategoryBits: CATEGORY_NAIL,
        filterMaskBits: CATEGORY_BALL,
      });
      fixture.setUserData({ id: `nail-${i}`, kind: "nail" } satisfies FixtureData);
    }

    this.addSensor("start", "start", this.geometry.start);
    this.addSensor("side-left", "side", this.geometry.sideLeft);
    this.addSensor("side-right", "side", this.geometry.sideRight);
    this.addSensor("attacker", "attacker", this.geometry.attacker);
    this.addSensor("drain", "drain", this.geometry.drain);
  }

  private addBox(
    id: string,
    x: number,
    y: number,
    width: number,
    height: number,
    restitution: number,
    angle = 0,
    friction = 0.24,
  ): void {
    const body = this.world.createBody({ type: "static" });
    const fixture = body.createFixture(
      planck.Box(width / 2 / SCALE, height / 2 / SCALE, planck.Vec2(x / SCALE, y / SCALE), angle),
      {
        friction,
        restitution,
        filterCategoryBits: CATEGORY_RAIL,
        filterMaskBits: CATEGORY_BALL,
      },
    );
    fixture.setUserData({ id, kind: "rail" } satisfies FixtureData);
  }

  private addSensor(id: string, role: Exclude<PachiPocketRole, "reclaim">, rect: { x: number; y: number; width: number; height: number }): void {
    const body = this.world.createBody({ type: "static" });
    const fixture = body.createFixture(
      planck.Box(rect.width / 2 / SCALE, rect.height / 2 / SCALE, planck.Vec2((rect.x + rect.width / 2) / SCALE, (rect.y + rect.height / 2) / SCALE)),
      {
        isSensor: true,
        filterCategoryBits: CATEGORY_SENSOR,
        filterMaskBits: CATEGORY_BALL,
      },
    );
    fixture.setUserData({ id, kind: "sensor", role } satisfies FixtureData);
    this.sensors.set(id, { fixture, role });
  }

  private buildAttackerLid(): planck.Fixture {
    const body = this.world.createBody({ type: "static" });
    const rect = this.geometry.attacker;
    const fixture = body.createFixture(
      planck.Box((rect.width / 2 + 16) / SCALE, 5 / SCALE, planck.Vec2((rect.x + rect.width / 2) / SCALE, (rect.y + rect.height + 8) / SCALE), -0.08),
      {
        friction: 0.12,
        restitution: 0.45,
        filterCategoryBits: CATEGORY_RAIL,
        filterMaskBits: CATEGORY_BALL,
      },
    );
    fixture.setUserData({ id: "attacker-lid", kind: "rail" } satisfies FixtureData);
    this.fixtureFilters.set("attacker-lid", {
      groupIndex: fixture.getFilterGroupIndex(),
      categoryBits: fixture.getFilterCategoryBits(),
      maskBits: fixture.getFilterMaskBits(),
    });
    return fixture;
  }

  private onBeginContact(contact: planck.Contact): void {
    const first = contact.getFixtureA();
    const second = contact.getFixtureB();
    const dataA = metadata(first);
    const dataB = metadata(second);
    if (dataA === null || dataB === null) return;
    const ballFixture = dataA.kind === "ball" ? first : dataB.kind === "ball" ? second : null;
    const sensorData = dataA.kind === "sensor" ? dataA : dataB.kind === "sensor" ? dataB : null;
    if (ballFixture === null || sensorData?.role === undefined) return;
    const ball = bodyBall(ballFixture.getBody());
    if (ball === null || ball.captured) return;
    if (sensorData.role === "attacker" && !this.attackerOpenValue) return;
    if (sensorData.role !== "drain" && ball.body.getLinearVelocity().y <= 0) return;
    const point = ball.body.getPosition();
    this.queueCapture({ ball, role: sensorData.role, pocketId: sensorData.id, x: point.x, y: point.y });
  }

  private queueCapture(capture: PendingCapture & { readonly x: number; readonly y: number }): void {
    const previous = this.pendingCaptures.get(capture.ball.id);
    if (previous !== undefined) {
      const priority = (role: PendingCapture["role"]): number => role === "start" ? 4 : role === "attacker" ? 3 : role === "side" ? 2 : 1;
      if (priority(previous.role) >= priority(capture.role)) return;
    }
    this.pendingCaptures.set(capture.ball.id, capture);
  }

  private stepFixedInternal(): void {
    this.stepIdValue += 1;
    for (const ball of this.balls.values()) {
      ball.age += FIXED_DT;
    }
    this.world.step(FIXED_DT, 8, 3);
    this.processPendingCaptures();
    this.sweepInvalidBalls();
  }

  private processPendingCaptures(): void {
    for (const capture of this.pendingCaptures.values()) {
      if (!this.balls.has(capture.ball.id) || capture.ball.captured) continue;
      capture.ball.captured = true;
      const position = capture.ball.body.getPosition();
      this.removeBodyOnly(capture.ball);
      this.pushEvent({
        type: "pocket",
        ballId: capture.ball.id,
        x: position.x * SCALE,
        y: position.y * SCALE,
        role: capture.role,
        pocketId: capture.pocketId,
        physicsStep: this.stepIdValue,
      });
    }
    this.pendingCaptures.clear();
  }

  private sweepInvalidBalls(): void {
    const remove: { ball: BallRuntime; reason: "drain" | "lifetime" | "stuck" | "overflow" }[] = [];
    for (const ball of this.balls.values()) {
      const position = ball.body.getPosition();
      const velocity = ball.body.getLinearVelocity();
      const speed = Math.hypot(velocity.x, velocity.y);
      if (!finite(position.x) || !finite(position.y) || !finite(velocity.x) || !finite(velocity.y)) {
        remove.push({ ball, reason: "overflow" });
        continue;
      }
      if (position.y > (PACHI_BOARD_HEIGHT + 34) / SCALE || position.x < -0.2 || position.x > (PACHI_BOARD_WIDTH + 20) / SCALE) {
        remove.push({ ball, reason: "drain" });
        continue;
      }
      if (ball.age >= PACHI_BALL_LIFETIME_SECONDS) {
        remove.push({ ball, reason: "lifetime" });
        continue;
      }
      if (speed < 0.09 && Math.hypot(position.x - ball.lastX, position.y - ball.lastY) < 0.0006) {
        ball.stillTime += FIXED_DT;
        if (ball.stillTime >= 2.4) remove.push({ ball, reason: "stuck" });
      } else {
        ball.stillTime = 0;
      }
      ball.lastX = position.x;
      ball.lastY = position.y;
    }
    for (const entry of remove) {
      if (this.balls.has(entry.ball.id)) this.removeBall(entry.ball, entry.reason);
    }
  }

  private removeBall(ball: BallRuntime, reason: "drain" | "lifetime" | "stuck" | "overflow"): void {
    if (!this.balls.has(ball.id)) return;
    const point = ball.body.getPosition();
    this.removeBodyOnly(ball);
    this.pushEvent({
      type: "reclaimed",
      ballId: ball.id,
      x: point.x * SCALE,
      y: point.y * SCALE,
      role: "reclaim",
      reason,
      physicsStep: this.stepIdValue,
    });
  }

  private removeBodyOnly(ball: BallRuntime): void {
    this.pendingCaptures.delete(ball.id);
    this.balls.delete(ball.id);
    this.world.destroyBody(ball.body);
  }

  private snapshotBall(ball: BallRuntime): PachiBallSnapshot {
    const position = ball.body.getPosition();
    const velocity = ball.body.getLinearVelocity();
    return {
      id: ball.id,
      x: position.x * SCALE,
      y: position.y * SCALE,
      vx: velocity.x * SCALE,
      vy: velocity.y * SCALE,
      age: ball.age,
      bullet: true,
    };
  }

  private pushEvent(event: PachiWorldEventInput): void {
    this.eventQueue.push({ id: this.nextEventId, ...event });
    this.nextEventId += 1;
  }

  private assertAlive(): void {
    if (this.destroyedValue) throw new Error("PachiWorld has been destroyed");
  }
}

export function createPachiWorld(options: PachiWorldOptions = {}): PachiWorld {
  return new PachiWorld(options);
}
