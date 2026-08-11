import type * as planck from "planck";
import type { TablePoint } from "../table/types";

export type FixtureMetadataKind = "ball" | "wall" | "floor" | "lane" | "flipper" | "sensor";

/** Metadata copied onto fixtures at construction time; contact callbacks only read it. */
export interface FixtureMetadata {
  readonly id: string;
  readonly kind: FixtureMetadataKind;
  readonly sensorId: string | null;
  readonly ballId: string | null;
}

export interface SensorTransitionEvent {
  readonly eventId: number;
  readonly physicsStepId: number;
  readonly ballId: string;
  readonly sensorId: string;
  readonly phase: "entered" | "exited";
  readonly direction: TablePoint;
  readonly position: TablePoint;
}

export interface ImpactEvent {
  readonly eventId: number;
  readonly physicsStepId: number;
  readonly ballId: string;
  readonly fixtureId: string;
  readonly position: TablePoint;
  readonly normal: TablePoint;
  readonly relativeSpeed: number;
  readonly normalImpulse: number;
}

export interface ContactOccupancy {
  readonly ballId: string;
  readonly fixturePair: string;
  readonly beganStepId: number;
  readonly lastSeenStepId: number;
  readonly active: boolean;
}

export interface ContactBatch {
  readonly physicsStepId: number;
  readonly sensorTransitions: readonly SensorTransitionEvent[];
  readonly impacts: readonly ImpactEvent[];
  readonly occupancies: readonly ContactOccupancy[];
  readonly overflowed: boolean;
}

interface MutableOccupancy {
  ballId: string;
  fixturePair: string;
  beganStepId: number;
  lastSeenStepId: number;
  active: boolean;
}

const isMetadata = (value: unknown): value is FixtureMetadata => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as { id?: unknown; kind?: unknown; sensorId?: unknown; ballId?: unknown };
  return (
    typeof candidate.id === "string" &&
    typeof candidate.kind === "string" &&
    (typeof candidate.sensorId === "string" || candidate.sensorId === null) &&
    (typeof candidate.ballId === "string" || candidate.ballId === null)
  );
};

const copyPoint = (value: { x: number; y: number }): TablePoint => ({ x: value.x, y: value.y });

function fixtureMetadata(fixture: planck.Fixture): FixtureMetadata | null {
  const value = fixture.getUserData();
  return isMetadata(value) ? value : null;
}

function ballAndOther(
  fixtureA: planck.Fixture,
  fixtureB: planck.Fixture,
): { readonly ball: FixtureMetadata; readonly other: FixtureMetadata; readonly ballFixture: planck.Fixture } | null {
  const metadataA = fixtureMetadata(fixtureA);
  const metadataB = fixtureMetadata(fixtureB);
  if (metadataA === null || metadataB === null) {
    return null;
  }
  if (metadataA.kind === "ball" && metadataA.ballId !== null) {
    return { ball: metadataA, other: metadataB, ballFixture: fixtureA };
  }
  if (metadataB.kind === "ball" && metadataB.ballId !== null) {
    return { ball: metadataB, other: metadataA, ballFixture: fixtureB };
  }
  return null;
}

function safeWorldPoint(contact: planck.Contact): TablePoint {
  const manifold = contact.getWorldManifold(null);
  const firstPoint = manifold?.points[0];
  if (firstPoint !== undefined && Number.isFinite(firstPoint.x) && Number.isFinite(firstPoint.y)) {
    return copyPoint(firstPoint);
  }
  const bodyA = contact.getFixtureA().getBody().getPosition();
  const bodyB = contact.getFixtureB().getBody().getPosition();
  return { x: (bodyA.x + bodyB.x) / 2, y: (bodyA.y + bodyB.y) / 2 };
}

function normalFromContact(contact: planck.Contact, ballFixture: planck.Fixture): TablePoint {
  const manifold = contact.getWorldManifold(null);
  const normal = manifold?.normal;
  if (normal === undefined || !Number.isFinite(normal.x) || !Number.isFinite(normal.y)) {
    return { x: 0, y: 0 };
  }
  const fixtureA = contact.getFixtureA();
  return fixtureA === ballFixture ? copyPoint(normal) : { x: -normal.x, y: -normal.y };
}

function velocityDifference(contact: planck.Contact): number {
  const bodyA = contact.getFixtureA().getBody();
  const bodyB = contact.getFixtureB().getBody();
  const a = bodyA.getLinearVelocity();
  const b = bodyB.getLinearVelocity();
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Copies all values needed by game logic out of Planck callbacks.  No Contact,
 * Fixture, Body, Vec2, or manifold object is retained after a callback returns.
 */
export class ContactBuffer {
  private readonly maxEventsPerStep: number;
  private readonly sensorTransitions: SensorTransitionEvent[] = [];
  private readonly impacts: ImpactEvent[] = [];
  private readonly occupancies = new Map<string, MutableOccupancy>();
  private nextEventId = 1;
  private currentStepId = 0;
  private overflowed = false;

  public constructor(maxEventsPerStep = 1024) {
    if (!Number.isInteger(maxEventsPerStep) || maxEventsPerStep <= 0) {
      throw new RangeError("ContactBuffer maxEventsPerStep must be a positive integer");
    }
    this.maxEventsPerStep = maxEventsPerStep;
  }

  public attach(world: planck.World): void {
    world.on("begin-contact", (contact) => {
      this.recordBegin(contact);
    });
    world.on("end-contact", (contact) => {
      this.recordEnd(contact);
    });
    world.on("post-solve", (contact, impulse) => {
      this.recordImpact(contact, impulse);
    });
  }

  public beginStep(physicsStepId: number): void {
    if (!Number.isInteger(physicsStepId) || physicsStepId < 0) {
      throw new RangeError("physicsStepId must be a non-negative integer");
    }
    this.currentStepId = physicsStepId;
    this.sensorTransitions.length = 0;
    this.impacts.length = 0;
    this.overflowed = false;
    for (const occupancy of this.occupancies.values()) {
      if (occupancy.active) {
        occupancy.lastSeenStepId = physicsStepId - 1;
      }
    }
  }

  public begin(physicsStepId: number): void {
    this.beginStep(physicsStepId);
  }

  public flushStep(physicsStepId = this.currentStepId): ContactBatch {
    const occupancies = [...this.occupancies.values()].map((occupancy) => ({ ...occupancy }));
    const batch: ContactBatch = {
      physicsStepId,
      sensorTransitions: this.sensorTransitions.map((event) => ({ ...event, direction: { ...event.direction }, position: { ...event.position } })),
      impacts: this.impacts.map((event) => ({ ...event, position: { ...event.position }, normal: { ...event.normal } })),
      occupancies: occupancies.map((occupancy) => ({ ...occupancy })),
      overflowed: this.overflowed,
    };
    this.sensorTransitions.length = 0;
    this.impacts.length = 0;
    for (const [key, occupancy] of this.occupancies) {
      if (!occupancy.active) {
        this.occupancies.delete(key);
      }
    }
    return batch;
  }

  public flush(physicsStepId = this.currentStepId): ContactBatch {
    return this.flushStep(physicsStepId);
  }

  public getActiveOccupancies(): readonly ContactOccupancy[] {
    return [...this.occupancies.values()]
      .filter((occupancy) => occupancy.active)
      .map((occupancy) => ({ ...occupancy }));
  }

  public get pendingEventCount(): number {
    return this.sensorTransitions.length + this.impacts.length;
  }

  public hasPendingSensorTransition(sensorId: string, phase: SensorTransitionEvent["phase"], ballId: string): boolean {
    return this.sensorTransitions.some(
      (event) => event.sensorId === sensorId && event.phase === phase && event.ballId === ballId,
    );
  }

  /** Adds a copied transition for a bounded fallback sensor (never a Planck ref). */
  public recordSyntheticSensorTransition(
    ballId: string,
    sensorId: string,
    phase: SensorTransitionEvent["phase"],
    position: TablePoint,
    direction: TablePoint,
  ): void {
    this.pushSensorTransition({
      eventId: this.allocateEventId(),
      physicsStepId: this.currentStepId,
      ballId,
      sensorId,
      phase,
      position: { ...position },
      direction: { ...direction },
    });
  }

  private recordBegin(contact: planck.Contact): void {
    const pair = ballAndOther(contact.getFixtureA(), contact.getFixtureB());
    if (pair === null) {
      return;
    }
    const { ball, other, ballFixture } = pair;
    const ballBody = ballFixture.getBody();
    const velocity = ballBody.getLinearVelocity();
    const speed = Math.hypot(velocity.x, velocity.y);
    const direction = speed > 1e-9 ? { x: velocity.x / speed, y: velocity.y / speed } : { x: 0, y: 0 };
    if (other.kind === "sensor" && other.sensorId !== null) {
      this.pushSensorTransition({
        eventId: this.allocateEventId(),
        physicsStepId: this.currentStepId,
        ballId: ball.ballId as string,
        sensorId: other.sensorId,
        phase: "entered",
        direction,
        position: copyPoint(ballBody.getPosition()),
      });
    }
    if (other.kind !== "sensor") {
      this.updateOccupancy(ball.ballId as string, other.id, true);
    }
  }

  private recordEnd(contact: planck.Contact): void {
    const pair = ballAndOther(contact.getFixtureA(), contact.getFixtureB());
    if (pair === null) {
      return;
    }
    const { ball, other, ballFixture } = pair;
    const ballBody = ballFixture.getBody();
    const velocity = ballBody.getLinearVelocity();
    const speed = Math.hypot(velocity.x, velocity.y);
    const direction = speed > 1e-9 ? { x: velocity.x / speed, y: velocity.y / speed } : { x: 0, y: 0 };
    if (other.kind === "sensor" && other.sensorId !== null) {
      this.pushSensorTransition({
        eventId: this.allocateEventId(),
        physicsStepId: this.currentStepId,
        ballId: ball.ballId as string,
        sensorId: other.sensorId,
        phase: "exited",
        direction,
        position: copyPoint(ballBody.getPosition()),
      });
    }
    if (other.kind !== "sensor") {
      this.updateOccupancy(ball.ballId as string, other.id, false);
    }
  }

  private recordImpact(contact: planck.Contact, impulse: planck.ContactImpulse): void {
    const pair = ballAndOther(contact.getFixtureA(), contact.getFixtureB());
    if (pair === null || pair.other.kind === "sensor") {
      return;
    }
    this.updateOccupancy(pair.ball.ballId as string, pair.other.id, true);
    const normalImpulses = impulse.normalImpulses;
    let normalImpulse = 0;
    for (const value of normalImpulses) {
      if (Number.isFinite(value)) {
        normalImpulse += Math.max(0, value);
      }
    }
    this.pushImpact({
      eventId: this.allocateEventId(),
      physicsStepId: this.currentStepId,
      ballId: pair.ball.ballId as string,
      fixtureId: pair.other.id,
      position: safeWorldPoint(contact),
      normal: normalFromContact(contact, pair.ballFixture),
      relativeSpeed: velocityDifference(contact),
      normalImpulse,
    });
  }

  private updateOccupancy(ballId: string, fixtureId: string, active: boolean): void {
    const fixturePair = `${ballId}:${fixtureId}`;
    const existing = this.occupancies.get(fixturePair);
    if (active) {
      if (existing === undefined || !existing.active) {
        this.occupancies.set(fixturePair, {
          ballId,
          fixturePair,
          beganStepId: this.currentStepId,
          lastSeenStepId: this.currentStepId,
          active: true,
        });
      } else {
        existing.lastSeenStepId = this.currentStepId;
      }
      return;
    }
    if (existing !== undefined) {
      existing.lastSeenStepId = this.currentStepId;
      existing.active = false;
    }
  }

  private allocateEventId(): number {
    return this.nextEventId++;
  }

  private pushSensorTransition(event: SensorTransitionEvent): void {
    if (this.pendingEventCount >= this.maxEventsPerStep) {
      this.overflowed = true;
      return;
    }
    this.sensorTransitions.push(event);
  }

  private pushImpact(event: ImpactEvent): void {
    if (this.pendingEventCount >= this.maxEventsPerStep) {
      this.overflowed = true;
      return;
    }
    this.impacts.push(event);
  }
}
