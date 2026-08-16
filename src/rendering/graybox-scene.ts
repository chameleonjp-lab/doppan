import { Container, FillGradient, Graphics } from "pixi.js";
import type { GrayboxAlphaSnapshot } from "../graybox";
import { PhysicsViewport } from "../table";

const COLOR = {
  board: 0x0b1425,
  border: 0x79e2c2,
  wall: 0x6f89ff,
  lane: 0x66738f,
  floor: 0xa7b4cc,
  ball: 0xffdf76,
  ballEdge: 0xfff4c2,
  activeFlipper: 0xff7aa2,
  idleFlipper: 0xd7dfef,
  safe: 0x79e2c2,
  launch: 0xffb45d,
  drain: 0xff6b6b,
  target: 0xf6c76e,
  completed: 0x8292ae,
  gateOpen: 0x79e2c2,
  gateClosed: 0xe37979,
  playerRail: 0x38526f,
  playerRoute: 0x79e2c2,
  playerTarget: 0xffdf76,
  playerTargetEdge: 0xfff4c2,
} as const;

// PixiJS gradients keep the board readable while giving the player a glossy,
// arcade-like material instead of a flat diagnostic diagram.
const GRADIENTS = {
  board: new FillGradient({
    type: "linear",
    start: { x: 0, y: 0 },
    end: { x: 1, y: 1 },
    textureSpace: "local",
    colorStops: [
      { offset: 0, color: 0x203d70 },
      { offset: 0.28, color: 0x10274d },
      { offset: 1, color: 0x050b18 },
    ],
  }),
  rail: new FillGradient({
    type: "linear",
    start: { x: 0, y: 0 },
    end: { x: 0, y: 1 },
    textureSpace: "local",
    colorStops: [
      { offset: 0, color: 0x9ae8ff },
      { offset: 0.16, color: 0x4c85bd },
      { offset: 0.55, color: 0x183761 },
      { offset: 1, color: 0x08172e },
    ],
  }),
  route: new FillGradient({
    type: "linear",
    start: { x: 0, y: 0 },
    end: { x: 1, y: 1 },
    textureSpace: "local",
    colorStops: [
      { offset: 0, color: 0xe8fff8 },
      { offset: 0.2, color: 0x78e6cc },
      { offset: 0.62, color: 0x218d91 },
      { offset: 1, color: 0x0b334d },
    ],
  }),
  flipperIdle: new FillGradient({
    type: "linear",
    start: { x: 0, y: 0 },
    end: { x: 1, y: 1 },
    textureSpace: "local",
    colorStops: [
      { offset: 0, color: 0xffffff },
      { offset: 0.2, color: 0x8fa7d4 },
      { offset: 0.58, color: 0x435c94 },
      { offset: 1, color: 0x18294d },
    ],
  }),
  flipperActive: new FillGradient({
    type: "linear",
    start: { x: 0, y: 0 },
    end: { x: 1, y: 1 },
    textureSpace: "local",
    colorStops: [
      { offset: 0, color: 0xfff5d0 },
      { offset: 0.18, color: 0xffc66f },
      { offset: 0.55, color: 0xf15b86 },
      { offset: 1, color: 0x6e1f68 },
    ],
  }),
  target: new FillGradient({
    type: "linear",
    start: { x: 0, y: 0 },
    end: { x: 0, y: 1 },
    textureSpace: "local",
    colorStops: [
      { offset: 0, color: 0xffffef },
      { offset: 0.24, color: 0xffdf76 },
      { offset: 0.7, color: 0xf28e3d },
      { offset: 1, color: 0x71334d },
    ],
  }),
  ball: new FillGradient({
    type: "radial",
    center: { x: 0.28, y: 0.24 },
    innerRadius: 0.04,
    outerCenter: { x: 0.5, y: 0.52 },
    outerRadius: 0.76,
    textureSpace: "local",
    colorStops: [
      { offset: 0, color: 0xffffff },
      { offset: 0.18, color: 0xfff3a8 },
      { offset: 0.55, color: 0xffb84e },
      { offset: 0.86, color: 0xd85a36 },
      { offset: 1, color: 0x5c2340 },
    ],
  }),
} as const;

const TARGET_IDS = ["L0", "R0", "L1", "R1", "L2", "R2", "C0", "C1"] as const;

export type GrayboxSceneMode = "player" | "diagnostic";

export interface GrayboxSceneOptions {
  readonly mode?: GrayboxSceneMode;
}

export interface GrayboxScene {
  readonly container: Container;
  resize(width: number, height: number): void;
  update(snapshot: GrayboxAlphaSnapshot): void;
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

function drawCenteredRectangle(
  graphics: Graphics,
  viewport: PhysicsViewport,
  center: Point,
  width: number,
  height: number,
  angle: number,
  color: number,
  alpha: number,
): void {
  if (Math.abs(angle) > 1e-9) {
    const corners = centeredRotatedRectangle(center, width, height, angle).map((point) =>
      viewport.worldToScreen(point),
    );
    graphics.moveTo(corners[0]?.x ?? 0, corners[0]?.y ?? 0);
    for (const corner of corners.slice(1)) {
      graphics.lineTo(corner.x, corner.y);
    }
    graphics.closePath().fill({ color, alpha });
    return;
  }

  const topLeft = viewport.worldToScreen({
    x: center.x - width / 2,
    y: center.y + height / 2,
  });
  graphics
    .rect(topLeft.x, topLeft.y, width * viewport.scale, height * viewport.scale)
    .fill({ color, alpha });
}

function drawDiagnosticTargetMarker(graphics: Graphics, center: Point, size: number): void {
  const radius = Math.max(8, size * 0.9);
  graphics
    .circle(center.x, center.y, radius)
    .stroke({ color: COLOR.target, width: 2.4, alpha: 0.98 });
  graphics
    .moveTo(center.x, center.y - radius * 1.85)
    .lineTo(center.x - radius * 0.55, center.y - radius * 1.15)
    .lineTo(center.x + radius * 0.55, center.y - radius * 1.15)
    .closePath()
    .fill({ color: COLOR.target, alpha: 0.92 });
}

function targetIdFromSensor(sensorId: string): (typeof TARGET_IDS)[number] | null {
  const prefix = sensorId.split("-", 1)[0];
  return TARGET_IDS.includes(prefix as (typeof TARGET_IDS)[number])
    ? (prefix as (typeof TARGET_IDS)[number])
    : null;
}

function drawCenteredGradientRectangle(
  graphics: Graphics,
  viewport: PhysicsViewport,
  center: Point,
  width: number,
  height: number,
  angle: number,
  gradient: FillGradient,
  strokeColor: number,
  strokeWidth: number,
  strokeAlpha: number,
): void {
  if (Math.abs(angle) > 1e-9) {
    const corners = centeredRotatedRectangle(center, width, height, angle).map((point) =>
      viewport.worldToScreen(point),
    );
    graphics.moveTo(corners[0]?.x ?? 0, corners[0]?.y ?? 0);
    for (const corner of corners.slice(1)) graphics.lineTo(corner.x, corner.y);
    graphics
      .closePath()
      .fill(gradient)
      .stroke({ color: strokeColor, width: strokeWidth, alpha: strokeAlpha });
    return;
  }

  const topLeft = viewport.worldToScreen({
    x: center.x - width / 2,
    y: center.y + height / 2,
  });
  graphics
    .roundRect(topLeft.x, topLeft.y, width * viewport.scale, height * viewport.scale, Math.min(8, height * viewport.scale * 0.25))
    .fill(gradient)
    .stroke({ color: strokeColor, width: strokeWidth, alpha: strokeAlpha });
}

function drawPolygon(
  graphics: Graphics,
  corners: readonly Point[],
  viewport: PhysicsViewport,
  fill: FillGradient,
  strokeColor: number,
  strokeWidth: number,
  strokeAlpha: number,
): readonly Point[] {
  const screenCorners = corners.map((point) => viewport.worldToScreen(point));
  graphics.moveTo(screenCorners[0]?.x ?? 0, screenCorners[0]?.y ?? 0);
  for (const corner of screenCorners.slice(1)) graphics.lineTo(corner.x, corner.y);
  graphics
    .closePath()
    .fill(fill)
    .stroke({ color: strokeColor, width: strokeWidth, alpha: strokeAlpha });
  return screenCorners;
}

function drawPlayerBoardChrome(graphics: Graphics, viewport: PhysicsViewport): void {
  const offset = viewport.boardOffset;
  const board = viewport.boardPixelSize;
  const radius = Math.min(22, board.width * 0.045);

  graphics
    .roundRect(offset.x - 7, offset.y - 7, board.width + 14, board.height + 14, radius + 7)
    .fill({ color: 0x00030c, alpha: 0.7 })
    .stroke({ color: COLOR.playerTarget, width: 7, alpha: 0.08 });
  graphics
    .roundRect(offset.x, offset.y, board.width, board.height, radius)
    .fill(GRADIENTS.board)
    .stroke({ color: COLOR.border, width: 2.2, alpha: 0.9 });
  graphics
    .roundRect(offset.x + 6, offset.y + 6, board.width - 12, board.height - 12, Math.max(10, radius - 4))
    .stroke({ color: 0x9cf4ff, width: 1.2, alpha: 0.2 });
  graphics
    .roundRect(offset.x + 13, offset.y + 13, board.width - 26, board.height - 26, Math.max(8, radius - 8))
    .stroke({ color: 0x142c50, width: 3.5, alpha: 0.68 });
  graphics
    .moveTo(offset.x + board.width * 0.13, offset.y + board.height * 0.045)
    .lineTo(offset.x + board.width * 0.74, offset.y + board.height * 0.045)
    .stroke({ color: 0xffffff, width: 2.5, alpha: 0.16 });
  graphics
    .moveTo(offset.x + board.width * 0.18, offset.y + board.height * 0.064)
    .lineTo(offset.x + board.width * 0.48, offset.y + board.height * 0.064)
    .stroke({ color: COLOR.playerTargetEdge, width: 1.2, alpha: 0.2 });
}

function drawPlayerTargetMarker(
  graphics: Graphics,
  center: Point,
  width: number,
  height: number,
  pulse: number,
  completed: boolean,
): void {
  const markerWidth = Math.max(34, Math.min(58, width * 1.35));
  const markerHeight = Math.max(19, Math.min(29, height * 1.7));
  const glow = completed ? 0.08 : 0.14 + pulse * 0.12;
  const left = center.x - markerWidth / 2;
  const top = center.y - markerHeight / 2;
  graphics
    .roundRect(left - 12, top - 12, markerWidth + 24, markerHeight + 24, 15)
    .fill({ color: completed ? COLOR.completed : COLOR.playerTarget, alpha: glow });
  graphics
    .roundRect(left - 5, top - 5, markerWidth + 10, markerHeight + 10, 11)
    .stroke({ color: completed ? COLOR.completed : COLOR.playerTargetEdge, width: 2.2, alpha: completed ? 0.28 : 0.32 + pulse * 0.28 });
  graphics
    .roundRect(left, top, markerWidth, markerHeight, Math.min(10, markerHeight / 2))
    .fill(completed ? GRADIENTS.route : GRADIENTS.target)
    .stroke({ color: completed ? COLOR.playerRoute : COLOR.playerTargetEdge, width: 2.2, alpha: completed ? 0.62 : 0.98 });
  graphics
    .moveTo(center.x, top - 9)
    .lineTo(center.x - 7, top + 1)
    .lineTo(center.x + 7, top + 1)
    .closePath()
    .fill({ color: completed ? COLOR.playerRoute : COLOR.playerTarget, alpha: completed ? 0.55 : 0.98 });
  if (!completed) {
    graphics.circle(center.x, center.y, Math.max(4, markerHeight * 0.16)).fill({ color: 0xffffff, alpha: 0.7 });
  }
}

function drawPlayerLaunchAndDrainWells(graphics: Graphics, viewport: PhysicsViewport): void {
  const launch = viewport.worldToScreen({ x: 8.05, y: 0.8 });
  const drain = viewport.worldToScreen({ x: 4.5, y: 0.2 });
  graphics
    .circle(launch.x, launch.y, Math.max(16, viewport.scale * 0.36))
    .fill({ color: COLOR.launch, alpha: 0.1 })
    .stroke({ color: COLOR.launch, width: 2.5, alpha: 0.45 });
  graphics
    .circle(launch.x, launch.y, Math.max(7, viewport.scale * 0.2))
    .stroke({ color: 0xfff0bb, width: 1.5, alpha: 0.72 });
  graphics
    .ellipse(drain.x, drain.y, Math.max(19, viewport.scale * 0.55), Math.max(7, viewport.scale * 0.18))
    .fill({ color: 0x6c2c63, alpha: 0.34 })
    .stroke({ color: 0xff799d, width: 2, alpha: 0.4 });
}

function drawFlippersAndBall(
  graphics: Graphics,
  viewport: PhysicsViewport,
  snapshot: GrayboxAlphaSnapshot,
): void {
  for (const flipper of snapshot.flippers) {
    const corners = rotatedRectangle(flipper.position, flipper.angle, flipper.length, flipper.thickness);
    const screenCorners = corners.map((point) => viewport.worldToScreen(point));
    const shadowCorners = screenCorners.map((point) => ({ x: point.x + 2, y: point.y + 5 }));
    graphics.moveTo(shadowCorners[0]?.x ?? 0, shadowCorners[0]?.y ?? 0);
    for (const corner of shadowCorners.slice(1)) graphics.lineTo(corner.x, corner.y);
    graphics.closePath().fill({ color: 0x00030c, alpha: 0.52 });

    if (flipper.active) {
      const pivot = viewport.worldToScreen(flipper.position);
      graphics.circle(pivot.x, pivot.y, flipper.length * viewport.scale * 0.62).fill({ color: COLOR.activeFlipper, alpha: 0.1 });
    }
    const fill = flipper.active ? GRADIENTS.flipperActive : GRADIENTS.flipperIdle;
    const drawnCorners = drawPolygon(
      graphics,
      corners,
      viewport,
      fill,
      flipper.active ? 0xfff0c4 : 0xe9f3ff,
      flipper.active ? 2.4 : 1.7,
      0.95,
    );
    graphics
      .moveTo(drawnCorners[0]?.x ?? 0, drawnCorners[0]?.y ?? 0)
      .lineTo(drawnCorners[1]?.x ?? 0, drawnCorners[1]?.y ?? 0)
      .stroke({ color: 0xffffff, width: 2.2, alpha: flipper.active ? 0.82 : 0.55 });
    const pivot = viewport.worldToScreen(flipper.position);
    graphics
      .circle(pivot.x, pivot.y, Math.max(8, viewport.scale * 0.24))
      .fill({ color: 0x132344, alpha: 0.95 })
      .stroke({ color: flipper.active ? COLOR.launch : COLOR.playerTargetEdge, width: 2, alpha: 0.9 });
    graphics
      .circle(pivot.x, pivot.y, Math.max(3, viewport.scale * 0.1))
      .fill({ color: flipper.active ? 0xfff3bd : 0x8ed5eb, alpha: 0.95 });
  }

  const speed = Math.hypot(snapshot.ball.linearVelocity.x, snapshot.ball.linearVelocity.y);
  const ball = viewport.worldToScreen(snapshot.ball.position);
  const radius = snapshot.ball.radius * viewport.scale;
  if (speed > 1) {
    const trailPoint = viewport.worldToScreen({
      x: snapshot.ball.position.x - snapshot.ball.linearVelocity.x * 0.075,
      y: snapshot.ball.position.y - snapshot.ball.linearVelocity.y * 0.075,
    });
    graphics
      .moveTo(trailPoint.x, trailPoint.y)
      .lineTo(ball.x, ball.y)
      .stroke({ color: COLOR.ball, width: Math.max(2, radius * 0.58), alpha: Math.min(0.42, speed / 35) });
  }
  graphics
    .circle(ball.x, ball.y, radius * 3.1)
    .fill({ color: COLOR.ball, alpha: 0.06 })
    .circle(ball.x, ball.y, radius * 2.05)
    .fill({ color: COLOR.ball, alpha: 0.1 })
    .circle(ball.x, ball.y, radius)
    .fill(GRADIENTS.ball)
    .stroke({ color: COLOR.ballEdge, width: Math.max(1.5, radius * 0.16), alpha: 0.96 });
  graphics
    .circle(ball.x - radius * 0.33, ball.y - radius * 0.38, Math.max(1.5, radius * 0.22))
    .fill({ color: 0xffffff, alpha: 0.82 });
}

function drawDiagnosticGeometry(
  graphics: Graphics,
  viewport: PhysicsViewport,
  snapshot: GrayboxAlphaSnapshot,
): void {
  const activeTargets = new Set(snapshot.graybox.activeTargetIds);
  const completedTargets = new Set(snapshot.graybox.completedShotIds);

  for (const fixture of snapshot.staticGeometry) {
    const isGate = fixture.id.startsWith("gate-return-");
    const gateOpen = snapshot.graybox.gateStates[fixture.id] === true;
    const fillColor = isGate
      ? gateOpen
        ? COLOR.gateOpen
        : COLOR.gateClosed
      : fixture.kind === "wall"
        ? COLOR.wall
        : fixture.kind === "lane"
          ? COLOR.lane
          : COLOR.floor;
    const alpha = isGate ? (gateOpen ? 0.78 : 0.9) : fixture.kind === "lane" ? 0.72 : 0.92;
    drawCenteredRectangle(
      graphics,
      viewport,
      fixture.position,
      fixture.width,
      fixture.height,
      fixture.angle,
      fillColor,
      alpha,
    );
  }

  for (const sensor of snapshot.sensors) {
    const targetId = targetIdFromSensor(sensor.id);
    const isActive = targetId !== null && activeTargets.has(targetId);
    const isCompleted = targetId !== null && completedTargets.has(targetId);
    const color =
      targetId === null
        ? sensor.purpose === "drain"
          ? COLOR.drain
          : sensor.purpose === "launch-band"
            ? COLOR.launch
            : COLOR.safe
        : isActive
          ? COLOR.target
          : isCompleted
            ? COLOR.completed
            : COLOR.safe;
    drawCenteredRectangle(
      graphics,
      viewport,
      sensor.position,
      sensor.width,
      sensor.height,
      0,
      color,
      isActive ? 0.34 : 0.1,
    );
    const topLeft = viewport.worldToScreen({
      x: sensor.position.x - sensor.width / 2,
      y: sensor.position.y + sensor.height / 2,
    });
    graphics
      .rect(topLeft.x, topLeft.y, sensor.width * viewport.scale, sensor.height * viewport.scale)
      .stroke({ color, width: isActive ? 2.2 : 1, alpha: isActive ? 0.98 : 0.6 });
    if (isActive && sensor.id.endsWith("-entry")) {
      const center = viewport.worldToScreen(sensor.position);
      drawDiagnosticTargetMarker(graphics, center, sensor.width * viewport.scale);
    }
    if (isActive && sensor.id.endsWith("-checkpoint")) {
      const center = viewport.worldToScreen(sensor.position);
      graphics
        .circle(center.x, center.y, Math.max(3, sensor.width * viewport.scale * 0.7))
        .stroke({ color: COLOR.target, width: 1, alpha: 0.65 });
    }
  }

  if (snapshot.lastSafeBallState !== null) {
    const safe = viewport.worldToScreen(snapshot.lastSafeBallState.position);
    graphics
      .circle(safe.x, safe.y, snapshot.ball.radius * viewport.scale * 1.55)
      .stroke({ color: COLOR.safe, width: 1, alpha: 0.45 });
  }
}

function drawPlayerGeometry(
  graphics: Graphics,
  viewport: PhysicsViewport,
  snapshot: GrayboxAlphaSnapshot,
): void {
  for (const fixture of snapshot.staticGeometry) {
    if (fixture.kind === "sensor") continue;
    const isBoundary = fixture.id.startsWith("wall-") || fixture.id.startsWith("floor-");
    const isGate = fixture.id.startsWith("gate-return-");
    const isVisibleRouteRail = fixture.kind === "lane" && !isGate;
    const gateOpen = snapshot.graybox.gateStates[fixture.id] === true;
    if (!isBoundary && !isVisibleRouteRail && !gateOpen) continue;

    const routePiece = isGate || fixture.kind === "floor";
    drawCenteredGradientRectangle(
      graphics,
      viewport,
      fixture.position,
      fixture.width,
      fixture.height,
      fixture.angle,
      routePiece ? GRADIENTS.route : GRADIENTS.rail,
      routePiece ? COLOR.playerTargetEdge : 0x7ebbe4,
      routePiece ? 1.8 : 1.35,
      isGate ? 0.85 : isBoundary ? 0.72 : 0.48,
    );
    if (isGate || isVisibleRouteRail) {
      const center = viewport.worldToScreen(fixture.position);
      graphics
        .circle(center.x, center.y, Math.max(3, Math.min(10, viewport.scale * 0.12)))
        .fill({ color: COLOR.playerTargetEdge, alpha: fixture.id.includes("divider") ? 0.55 : 0.32 });
    }
  }

  const completedTargets = new Set(snapshot.graybox.completedShotIds);
  const activeTargets = new Set(snapshot.graybox.activeTargetIds);
  const pulse = 0.5 + 0.5 * Math.sin(snapshot.physicsStepId * 0.11);
  for (const sensor of snapshot.sensors) {
    const targetId = targetIdFromSensor(sensor.id);
    if (targetId === null || !sensor.id.endsWith("-entry")) continue;
    if (!activeTargets.has(targetId) && !completedTargets.has(targetId)) continue;
    const center = viewport.worldToScreen(sensor.position);
    drawPlayerTargetMarker(
      graphics,
      center,
      sensor.width * viewport.scale,
      sensor.height * viewport.scale,
      activeTargets.has(targetId) ? pulse : 0,
      completedTargets.has(targetId),
    );
  }

  drawPlayerLaunchAndDrainWells(graphics, viewport);
}

/** Draws the G2 graybox in player or diagnostic mode. */
export function createGrayboxScene(options: GrayboxSceneOptions = {}): GrayboxScene {
  const mode = options.mode ?? "player";
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

  const update = (snapshot: GrayboxAlphaSnapshot): void => {
    if (
      snapshot.tableBounds.width !== viewport.worldBounds.width ||
      snapshot.tableBounds.height !== viewport.worldBounds.height
    ) {
      throw new Error("graybox render snapshot does not match the fixed table bounds");
    }
    graphics.clear();

    const offset = viewport.boardOffset;
    const board = viewport.boardPixelSize;
    if (mode === "player") {
      drawPlayerBoardChrome(graphics, viewport);
    } else {
      graphics
        .roundRect(offset.x, offset.y, board.width, board.height, Math.min(18, board.width * 0.04))
        .fill({ color: COLOR.board, alpha: 0.98 })
        .stroke({ color: COLOR.border, width: 2, alpha: 0.82 });
    }

    if (mode === "diagnostic") {
      drawDiagnosticGeometry(graphics, viewport, snapshot);
    } else {
      drawPlayerGeometry(graphics, viewport, snapshot);
    }

    drawFlippersAndBall(graphics, viewport, snapshot);
  };

  resize(width, height);
  return { container, resize, update };
}
