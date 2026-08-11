import { Container, Graphics } from "pixi.js";
import type { PinballSnapshot } from "../physics";
import { PhysicsViewport } from "../table";

const COLOR = {
  board: 0x0e1728,
  border: 0x7ae6c4,
  wall: 0x6f89ff,
  lane: 0x66738f,
  floor: 0xa7b4cc,
  ball: 0xffdf76,
  ballEdge: 0xfff4c2,
  activeFlipper: 0xff7aa2,
  idleFlipper: 0xd7dfef,
  safe: 0x7ae6c4,
  launch: 0xffb45d,
  drain: 0xff6b6b,
} as const;

export interface G1BScene {
  readonly container: Container;
  resize(width: number, height: number): void;
  update(snapshot: PinballSnapshot): void;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

function rotatedRectangle(
  origin: Point,
  angle: number,
  length: number,
  thickness: number,
): readonly Point[] {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const transform = (x: number, y: number): Point => ({
    x: origin.x + x * cosine - y * sine,
    y: origin.y + x * sine + y * cosine,
  });
  return [
    transform(0, -thickness / 2),
    transform(length, -thickness / 2),
    transform(length, thickness / 2),
    transform(0, thickness / 2),
  ];
}

function centeredRotatedRectangle(
  center: Point,
  width: number,
  height: number,
  angle: number,
): readonly Point[] {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const transform = (x: number, y: number): Point => ({
    x: center.x + x * cosine - y * sine,
    y: center.y + x * sine + y * cosine,
  });
  return [
    transform(-width / 2, -height / 2),
    transform(width / 2, -height / 2),
    transform(width / 2, height / 2),
    transform(-width / 2, height / 2),
  ];
}

/** Draws plain G1-B geometry from Planck-independent snapshots. */
export function createG1BScene(): G1BScene {
  const container = new Container();
  const graphics = new Graphics();
  container.addChild(graphics);
  const viewport = new PhysicsViewport({ width: 9, height: 16 }, { width: 1, height: 1 });
  let width = 1;
  let height = 1;

  const resize = (nextWidth: number, nextHeight: number): void => {
    width = Math.max(1, nextWidth);
    height = Math.max(1, nextHeight);
    viewport.resize({ width, height });
  };

  const update = (snapshot: PinballSnapshot): void => {
    if (
      snapshot.tableBounds.width !== viewport.worldBounds.width ||
      snapshot.tableBounds.height !== viewport.worldBounds.height
    ) {
      throw new Error("G1-B render snapshot does not match the fixed table bounds");
    }
    graphics.clear();

    const offset = viewport.boardOffset;
    const board = viewport.boardPixelSize;
    graphics
      .roundRect(offset.x, offset.y, board.width, board.height, Math.min(18, board.width * 0.04))
      .fill({ color: COLOR.board, alpha: 0.98 })
      .stroke({ color: COLOR.border, width: 2, alpha: 0.82 });

    for (const fixture of snapshot.staticGeometry) {
      if (Math.abs(fixture.angle) > 1e-9) {
        const corners = centeredRotatedRectangle(
          fixture.position,
          fixture.width,
          fixture.height,
          fixture.angle,
        ).map((point) => viewport.worldToScreen(point));
        graphics.moveTo(corners[0]?.x ?? 0, corners[0]?.y ?? 0);
        for (const corner of corners.slice(1)) {
          graphics.lineTo(corner.x, corner.y);
        }
        graphics
          .closePath()
          .fill({ color: COLOR.lane, alpha: 0.72 });
        continue;
      }
      const topLeft = viewport.worldToScreen({
        x: fixture.position.x - fixture.width / 2,
        y: fixture.position.y + fixture.height / 2,
      });
      const fixtureWidth = fixture.width * viewport.scale;
      const fixtureHeight = fixture.height * viewport.scale;
      const color =
        fixture.kind === "wall"
          ? COLOR.wall
          : fixture.kind === "lane"
            ? COLOR.lane
            : COLOR.floor;
      graphics
        .rect(topLeft.x, topLeft.y, fixtureWidth, fixtureHeight)
        .fill({ color, alpha: fixture.kind === "lane" ? 0.72 : 0.92 });
    }

    for (const sensor of snapshot.sensors) {
      const topLeft = viewport.worldToScreen({
        x: sensor.position.x - sensor.width / 2,
        y: sensor.position.y + sensor.height / 2,
      });
      const color =
        sensor.purpose === "drain"
          ? COLOR.drain
          : sensor.purpose === "launch-band"
            ? COLOR.launch
            : COLOR.safe;
      graphics
        .rect(topLeft.x, topLeft.y, sensor.width * viewport.scale, sensor.height * viewport.scale)
        .fill({ color, alpha: 0.1 })
        .stroke({ color, width: 1, alpha: 0.65 });
    }

    if (snapshot.lastSafeBallState !== null) {
      const safe = viewport.worldToScreen(snapshot.lastSafeBallState.position);
      graphics
        .circle(safe.x, safe.y, snapshot.ball.radius * viewport.scale * 1.55)
        .stroke({ color: COLOR.safe, width: 1, alpha: 0.45 });
    }

    for (const flipper of snapshot.flippers) {
      const corners = rotatedRectangle(
        flipper.position,
        flipper.angle,
        flipper.length,
        flipper.thickness,
      ).map((point) => viewport.worldToScreen(point));
      graphics.moveTo(corners[0]?.x ?? 0, corners[0]?.y ?? 0);
      for (const corner of corners.slice(1)) {
        graphics.lineTo(corner.x, corner.y);
      }
      graphics
        .closePath()
        .fill({ color: flipper.active ? COLOR.activeFlipper : COLOR.idleFlipper, alpha: 0.98 })
        .stroke({ color: COLOR.board, width: 1.5, alpha: 0.9 });
    }

    const ball = viewport.worldToScreen(snapshot.ball.position);
    graphics
      .circle(ball.x, ball.y, snapshot.ball.radius * viewport.scale)
      .fill({ color: COLOR.ball, alpha: 1 })
      .stroke({ color: COLOR.ballEdge, width: 1.5, alpha: 1 });
  };

  resize(width, height);
  return { container, resize, update };
}
