import {
  Container,
  FillGradient,
  Graphics,
  WebGLRenderer,
  type WebGLOptions,
} from "pixi.js";
import type {
  PachiBallSnapshot,
  PachiBoardGeometry,
  PachiPoint,
  PachiRect,
  PachiSessionSnapshot,
  PachiWorldSnapshot,
} from "../game/pachi-types";
import { getPachiVisualState } from "../presentation/pachi-feedback";
import {
  PACHI_BOARD_HEIGHT,
  PACHI_BOARD_WIDTH,
  PACHI_LAUNCH_CAP_ANGLE,
  PACHI_LAUNCH_RELEASE_GAP_HEIGHT,
  PACHI_LAUNCH_RELEASE_ANGLE,
  PACHI_LAUNCH_RELEASE_Y,
} from "../game/pachi-types";
import { initializeWithCleanup } from "./renderer-lifecycle";

/** The logical area reserved for the HTML reels/title overlay. */
export const PACHI_SCREEN_RECT = Object.freeze({
  x: 187,
  y: 171,
  width: 346,
  height: 216,
});

export type PachiSnapshot = PachiSessionSnapshot | PachiWorldSnapshot;

export interface PachiRendererOptions {
  readonly host: HTMLElement;
  readonly onFatalError: (error: unknown) => void;
  readonly forceWebGLFailure?: boolean;
}

export interface PachiRenderer {
  render(snapshot: PachiSnapshot, reducedMotion: boolean): void;
  resize(): void;
  destroy(): void;
}

interface BallVisual {
  readonly node: Container;
  readonly trail: Graphics;
  readonly body: Graphics;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

type GeometryWithScreen = PachiBoardGeometry & {
  readonly screen?: PachiRect;
};

const BOARD_WIDTH = PACHI_BOARD_WIDTH;
const BOARD_HEIGHT = PACHI_BOARD_HEIGHT;
const BALL_GRADIENT = new FillGradient({
  type: "radial",
  center: { x: 0.28, y: 0.24 },
  innerRadius: 0.02,
  outerCenter: { x: 0.5, y: 0.52 },
  outerRadius: 0.78,
  textureSpace: "local",
  colorStops: [
    { offset: 0, color: 0xffffff },
    { offset: 0.18, color: 0xf6f6ff },
    { offset: 0.56, color: 0xcfd5df },
    { offset: 0.87, color: 0x7e8796 },
    { offset: 1, color: 0x313846 },
  ],
});

const BOARD_GRADIENT = new FillGradient({
  type: "linear",
  start: { x: 0, y: 0 },
  end: { x: 1, y: 1 },
  textureSpace: "local",
  colorStops: [
    { offset: 0, color: 0x4b1f2e },
    { offset: 0.34, color: 0x26101b },
    { offset: 1, color: 0x090509 },
  ],
});

const METAL_GRADIENT = new FillGradient({
  type: "linear",
  start: { x: 0, y: 0 },
  end: { x: 0, y: 1 },
  textureSpace: "local",
  colorStops: [
    { offset: 0, color: 0xffffff },
    { offset: 0.22, color: 0xdbe0e8 },
    { offset: 0.55, color: 0x7c8592 },
    { offset: 1, color: 0x343a46 },
  ],
});

const GOLD_GRADIENT = new FillGradient({
  type: "linear",
  start: { x: 0, y: 0 },
  end: { x: 0, y: 1 },
  textureSpace: "local",
  colorStops: [
    { offset: 0, color: 0xfff5b0 },
    { offset: 0.32, color: 0xf4c95d },
    { offset: 0.7, color: 0xb27625 },
    { offset: 1, color: 0x5a3019 },
  ],
});

const COLOR = {
  black: 0x080308,
  wine: 0x481729,
  wineDeep: 0x1b0813,
  silver: 0xd9dfe8,
  silverDark: 0x606a79,
  gold: 0xffd166,
  goldBright: 0xffef9a,
  start: 0x57e19d,
  side: 0x9a4b69,
  attacker: 0xf08b3e,
  reach: 0xeeb777,
  revival: 0xd3aff2,
  drain: 0x321021,
  white: 0xffffff,
} as const;

const DEFAULT_BALL_RADIUS = 6;

function viewportSize(host: HTMLElement): { width: number; height: number } {
  const bounds = host.getBoundingClientRect();
  return {
    width: Math.max(1, Math.floor(host.clientWidth || bounds.width || BOARD_WIDTH)),
    height: Math.max(1, Math.floor(host.clientHeight || bounds.height || BOARD_HEIGHT)),
  };
}

function isFinitePoint(point: PachiPoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function topLeft(rect: PachiRect): Point {
  return { x: rect.x, y: rect.y };
}

function centerOf(rect: PachiRect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

function geometryKey(geometry: PachiBoardGeometry): string {
  const rectKey = (rect: PachiRect): string =>
    [rect.x, rect.y, rect.width, rect.height].join(",");
  const pointKey = (point: PachiPoint): string => [point.x, point.y].join(",");
  return [
    geometry.width,
    geometry.height,
    geometry.scale,
    geometry.ballRadius,
    pointKey(geometry.launch),
    geometry.launchGuide.x,
    geometry.launchGuide.y,
    geometry.launchGuide.width,
    geometry.launchGuide.height,
    geometry.nails.map(pointKey).join(";"),
    rectKey(geometry.start),
    rectKey(geometry.sideLeft),
    rectKey(geometry.sideRight),
    rectKey(geometry.attacker),
    rectKey(geometry.drain),
    rectKey(getScreenRect(geometry)),
  ].join("|");
}

function getScreenRect(geometry: PachiBoardGeometry): PachiRect {
  const screen = (geometry as GeometryWithScreen).screen;
  return screen === undefined ? PACHI_SCREEN_RECT : screen;
}

function isAttackerOpen(snapshot: PachiSnapshot): boolean {
  if ("attackerOpen" in snapshot) {
    return snapshot.attackerOpen;
  }
  return snapshot.jackpotRemaining > 0;
}

function isSnapshotPaused(snapshot: PachiSnapshot): boolean {
  return "paused" in snapshot && snapshot.paused;
}

function rotated(point: Point, pivot: Point, angle: number): Point {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const x = point.x - pivot.x;
  const y = point.y - pivot.y;
  return {
    x: pivot.x + x * cosine - y * sine,
    y: pivot.y + x * sine + y * cosine,
  };
}

function drawQuad(graphics: Graphics, points: readonly Point[]): void {
  const first = points[0];
  if (!first) {
    return;
  }
  graphics.moveTo(first.x, first.y);
  for (const point of points.slice(1)) {
    graphics.lineTo(point.x, point.y);
  }
  graphics.closePath();
}

function centeredRotatedRectangle(
  center: Point,
  width: number,
  height: number,
  angle: number,
): readonly Point[] {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  return [
    rotated({ x: center.x - halfWidth, y: center.y - halfHeight }, center, angle),
    rotated({ x: center.x + halfWidth, y: center.y - halfHeight }, center, angle),
    rotated({ x: center.x + halfWidth, y: center.y + halfHeight }, center, angle),
    rotated({ x: center.x - halfWidth, y: center.y + halfHeight }, center, angle),
  ];
}

function drawRigidRail(
  graphics: Graphics,
  center: Point,
  width: number,
  height: number,
  angle: number,
): void {
  const corners = centeredRotatedRectangle(center, width, height, angle);
  const shadow = corners.map((point) => ({ x: point.x + 3, y: point.y + 4 }));
  drawQuad(graphics, shadow);
  graphics.fill({ color: COLOR.black, alpha: 0.66 });
  drawQuad(graphics, corners);
  graphics.fill(METAL_GRADIENT).stroke({ color: COLOR.silverDark, width: 1.6, alpha: 0.94 });
}

function drawPocketWell(
  graphics: Graphics,
  rect: PachiRect,
  color: number,
  alpha = 1,
): void {
  const { x, y } = topLeft(rect);
  const radius = Math.min(12, rect.height / 2);
  graphics
    .roundRect(x - 8, y - 8, rect.width + 16, rect.height + 16, radius + 8)
    .fill({ color: COLOR.black, alpha: 0.72 * alpha })
    .stroke({ color: COLOR.silverDark, width: 2, alpha: 0.82 * alpha });
  graphics
    .roundRect(x, y, rect.width, rect.height, radius)
    .fill({ color, alpha: 0.26 * alpha })
    .stroke({ color, width: 2.4, alpha: 0.95 * alpha });
  graphics
    .roundRect(x + 5, y + 5, Math.max(1, rect.width - 10), Math.max(1, rect.height - 10), Math.max(3, radius - 4))
    .fill({ color: COLOR.black, alpha: 0.38 * alpha })
    .stroke({ color: COLOR.white, width: 1, alpha: 0.22 * alpha });
}

function makeBallVisual(): BallVisual {
  const node = new Container();
  const trail = new Graphics();
  const body = new Graphics();
  node.addChild(trail, body);
  return { node, trail, body };
}

export async function createPachiRenderer(
  options: PachiRendererOptions,
): Promise<PachiRenderer> {
  if (options.forceWebGLFailure) {
    throw new Error("WebGL was intentionally disabled for the failure-path check");
  }

  const renderer = new WebGLRenderer();
  const rendererOptions: Partial<WebGLOptions> = {
    antialias: true,
    backgroundAlpha: 0,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
  };
  await initializeWithCleanup(
    () => renderer.init(rendererOptions),
    () => renderer.destroy(true),
  );

  const stage = new Container();
  const board = new Container();
  const staticBoard = new Graphics();
  const staticGeometry = new Graphics();
  const dynamicDecor = new Graphics();
  const ballLayer = new Container();
  board.addChild(staticBoard, staticGeometry, dynamicDecor, ballLayer);
  stage.addChild(board);

  const ballVisuals = new Map<string, BallVisual>();
  const ballPool: BallVisual[] = [];
  const rendererController = new AbortController();
  const resizeController = new AbortController();
  let resizeObserver: ResizeObserver | null = null;
  let geometryVersion = "";
  let destroyed = false;
  let fatal = false;
  let animationTime = 0;
  let lastRenderAt = typeof performance === "undefined" ? 0 : performance.now();

  const reportFatal = (error: unknown): void => {
    if (fatal || destroyed) {
      return;
    }
    fatal = true;
    try {
      options.onFatalError(error);
    } catch {
      // Error reporting must not cause a second renderer failure.
    }
  };

  const drawChrome = (screen: PachiRect): void => {
    staticBoard.clear();

    staticBoard
      .roundRect(4, 4, BOARD_WIDTH - 8, BOARD_HEIGHT - 8, 48)
      .fill({ color: COLOR.black, alpha: 0.94 })
      .stroke({ color: COLOR.gold, width: 8, alpha: 0.92 });
    staticBoard
      .roundRect(14, 14, BOARD_WIDTH - 28, BOARD_HEIGHT - 28, 40)
      .stroke({ color: COLOR.silver, width: 3, alpha: 0.68 });
    staticBoard
      .roundRect(28, 28, BOARD_WIDTH - 56, BOARD_HEIGHT - 56, 34)
      .fill(BOARD_GRADIENT)
      .stroke({ color: COLOR.wine, width: 5, alpha: 0.94 });

    // Inner metal rails frame the playable area and leave the middle screen clear.
    staticBoard
      .roundRect(56, 58, BOARD_WIDTH - 112, BOARD_HEIGHT - 116, 34)
      .stroke({ color: COLOR.silverDark, width: 16, alpha: 0.85 });
    staticBoard
      .roundRect(58, 58, BOARD_WIDTH - 116, BOARD_HEIGHT - 116, 30)
      .stroke({ color: COLOR.silver, width: 5, alpha: 0.8 });
    staticBoard
      .roundRect(72, 72, BOARD_WIDTH - 144, BOARD_HEIGHT - 144, 24)
      .stroke({ color: COLOR.black, width: 4, alpha: 0.75 });

    // Keep the screen readable by giving its HTML overlay a dark, framed well.
    staticBoard
      .roundRect(screen.x - 10, screen.y - 10, screen.width + 20, screen.height + 20, 24)
      .fill({ color: COLOR.black, alpha: 0.78 })
      .stroke({ color: COLOR.gold, width: 3, alpha: 0.82 });
    staticBoard
      .roundRect(screen.x, screen.y, screen.width, screen.height, 18)
      .stroke({ color: COLOR.silverDark, width: 2, alpha: 0.85 });

    // Small frame bolts are decorative and do not add collision geometry.
    for (const point of [
      { x: 48, y: 48 },
      { x: BOARD_WIDTH - 48, y: 48 },
      { x: 48, y: BOARD_HEIGHT - 48 },
      { x: BOARD_WIDTH - 48, y: BOARD_HEIGHT - 48 },
      { x: 92, y: 94 },
      { x: BOARD_WIDTH - 92, y: 94 },
    ]) {
      staticBoard.circle(point.x + 2, point.y + 3, 7).fill({ color: COLOR.black, alpha: 0.64 });
      staticBoard.circle(point.x, point.y, 7).fill(METAL_GRADIENT).stroke({ color: COLOR.black, width: 1, alpha: 0.84 });
      staticBoard.circle(point.x - 2, point.y - 2, 1.6).fill({ color: COLOR.white, alpha: 0.72 });
    }
  };

  const drawGeometry = (geometry: PachiBoardGeometry): void => {
    staticGeometry.clear();

    // These rails mirror PachiWorld.buildBoard's fixed fixtures.  Keeping their
    // centers and angles here makes the collision-critical silhouette visible;
    // decoration is layered around this exact footprint.
    drawRigidRail(staticGeometry, { x: 28, y: 450 }, 16, 900, 0);
    drawRigidRail(staticGeometry, { x: 692, y: 450 }, 16, 900, 0);
    drawRigidRail(staticGeometry, { x: 360, y: 16 }, 664, 16, 0);
    drawRigidRail(staticGeometry, { x: 125, y: 884 }, 230, 16, 0);
    drawRigidRail(staticGeometry, { x: 595, y: 884 }, 230, 16, 0);
    drawRigidRail(staticGeometry, { x: 666, y: 470 }, 12, 720, 0);
    drawRigidRail(staticGeometry, { x: 626, y: 92 }, 92, 12, PACHI_LAUNCH_CAP_ANGLE);

    // The old launchRail polyline was only a decorative approximation.  The
    // launch guide below is drawn from the same bounds and addBox dimensions
    // as PachiWorld, so the visible lane and its collision edges coincide.
    const guide = geometry.launchGuide;
    const releaseGap = Math.min(Math.max(0, PACHI_LAUNCH_RELEASE_GAP_HEIGHT), guide.height);
    const guideLowerY = guide.y + releaseGap;
    const guideLowerHeight = Math.max(0, guide.height - releaseGap);
    if (guideLowerHeight > 0) {
      // PachiWorld.addBox("launch-guide-left", guide.x, ... , 8,
      // guideLowerHeight, 0.05, 0, 0.02).
      drawRigidRail(
        staticGeometry,
        { x: guide.x, y: guideLowerY + guideLowerHeight / 2 },
        8,
        guideLowerHeight,
        0,
      );
    }
    // PachiWorld.addBox("launch-guide-release", guide.x + guide.width / 2,
    // PACHI_LAUNCH_RELEASE_Y, guide.width + 20, 8, 0.05,
    // PACHI_LAUNCH_RELEASE_ANGLE, 0.02).
    // The cap intentionally leaves the left-facing release opening clear;
    // the inner wall begins at the lower end of that opening.
    drawRigidRail(
      staticGeometry,
      { x: guide.x + guide.width / 2, y: PACHI_LAUNCH_RELEASE_Y },
      guide.width + 20,
      8,
      PACHI_LAUNCH_RELEASE_ANGLE,
    );

    // Darken the lane behind the metal so the lower launcher reads as a hole
    // between the inner edge and the existing outer rail.
    if (guideLowerHeight > 0) {
      staticGeometry
        .rect(guide.x + 8, guideLowerY, Math.max(1, guide.width - 8), guideLowerHeight)
        .fill({ color: COLOR.black, alpha: 0.42 });
    }

    // A narrow guide around the playfield gives the eye a continuous rail without
    // inventing physics fixtures; collision-critical segments remain geometry above.
    staticGeometry
      .roundRect(86, 92, BOARD_WIDTH - 172, BOARD_HEIGHT - 184, 22)
      .stroke({ color: COLOR.wine, width: 3, alpha: 0.65 });

    for (const nail of geometry.nails) {
      if (!isFinitePoint(nail)) {
        continue;
      }
      const radius = Math.max(3.4, Math.min(9, geometry.ballRadius * 0.86));
      staticGeometry.circle(nail.x + 2.2, nail.y + 3.4, radius + 1.8).fill({ color: COLOR.black, alpha: 0.68 });
      staticGeometry.circle(nail.x, nail.y, radius + 1.4).fill(METAL_GRADIENT).stroke({ color: COLOR.black, width: 1, alpha: 0.9 });
      staticGeometry.circle(nail.x - radius * 0.28, nail.y - radius * 0.3, Math.max(1.2, radius * 0.25)).fill({ color: COLOR.white, alpha: 0.8 });
    }

    // Availability belongs to the live target outline, not the fixed sensor.
    // Neutral wells keep full START and the closed attacker from promising a reward.
    drawPocketWell(staticGeometry, geometry.start, COLOR.silverDark);
    drawPocketWell(staticGeometry, geometry.sideLeft, COLOR.side);
    drawPocketWell(staticGeometry, geometry.sideRight, COLOR.side);
    drawPocketWell(staticGeometry, geometry.attacker, COLOR.silverDark);

    const drain = geometry.drain;
    staticGeometry
      .roundRect(drain.x, drain.y, drain.width, Math.max(1, drain.height), Math.min(12, drain.height / 2))
      .fill({ color: COLOR.drain, alpha: 0.84 })
      .stroke({ color: COLOR.silverDark, width: 2, alpha: 0.82 });
    staticGeometry
      .moveTo(drain.x + 12, drain.y + drain.height / 2)
      .lineTo(drain.x + drain.width - 12, drain.y + drain.height / 2)
      .stroke({ color: COLOR.wine, width: 2, alpha: 0.86 });

    const launch = geometry.launch;
    staticGeometry
      .circle(launch.x, launch.y, Math.max(13, geometry.ballRadius * 2.7))
      .fill({ color: COLOR.black, alpha: 0.78 })
      .stroke({ color: COLOR.gold, width: 2, alpha: 0.8 });
    staticGeometry.circle(launch.x, launch.y, Math.max(5, geometry.ballRadius * 1.05)).fill(METAL_GRADIENT);
  };

  const drawAttackerLid = (geometry: PachiBoardGeometry, open: boolean, reducedMotion: boolean, t: number): void => {
    const rect = geometry.attacker;
    // PachiWorld places the lid just below the attacker's sensor.  Use the
    // same center so opening is readable without visually moving the pocket.
    const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height + 8 };
    const hinge = { x: center.x - (rect.width + 32) / 2, y: center.y };
    const width = rect.width + 32;
    const thickness = Math.max(8, rect.height * 0.34);
    const restAngle = open ? -0.34 : -0.08;
    const angle = reducedMotion || !open ? restAngle : restAngle + Math.sin(t * 1.7) * 0.025;
    const local = [
      { x: hinge.x, y: hinge.y - thickness / 2 },
      { x: hinge.x + width, y: hinge.y - thickness / 2 },
      { x: hinge.x + width, y: hinge.y + thickness / 2 },
      { x: hinge.x, y: hinge.y + thickness / 2 },
    ].map((point) => rotated(point, hinge, angle));
    drawQuad(dynamicDecor, local);
    dynamicDecor.fill(open ? GOLD_GRADIENT : METAL_GRADIENT).stroke({ color: open ? COLOR.goldBright : COLOR.silver, width: 2.2, alpha: 0.96 });
    const shine = local[0];
    const shineEnd = local[1];
    if (shine && shineEnd) {
      dynamicDecor.moveTo(shine.x + 4, shine.y + 2).lineTo(shineEnd.x - 4, shineEnd.y + 2).stroke({ color: COLOR.white, width: 1.4, alpha: open ? 0.7 : 0.42 });
    }
  };

  const drawTarget = (rect: PachiRect, attacker: boolean, pulse: number): void => {
    const color = attacker ? COLOR.goldBright : COLOR.start;
    const center = centerOf(rect);
    if (!attacker) {
      dynamicDecor
        .roundRect(rect.x - 13, rect.y - 13, rect.width + 26, rect.height + 17, 18)
        .stroke({ color, width: 2.6, alpha: 0.64 + pulse * 0.16 });
    }

    // Open brackets and inward chevrons point at the real sensor from outside.
    // No fill, particle field or line through its center can obscure an entering ball.
    for (const direction of [-1, 1]) {
      const edge = center.x + direction * (rect.width / 2 + 16);
      if (attacker) {
        dynamicDecor
          .moveTo(edge - direction * 24, rect.y - 13)
          .lineTo(edge, rect.y - 13)
          .lineTo(edge, rect.y + rect.height + 13)
          .lineTo(edge - direction * 24, rect.y + rect.height + 13)
          .stroke({ color, width: 4.5, alpha: 0.9 });
        dynamicDecor
          .moveTo(edge - direction * 24, rect.y - 19)
          .lineTo(edge + direction * 6, rect.y - 19)
          .stroke({ color: COLOR.attacker, width: 2, alpha: 0.65 + pulse * 0.2 });
      }
      const count = attacker ? 2 : 1;
      for (let i = 0; i < count; i += 1) {
        const x = edge + direction * (12 + i * 16);
        const halfHeight = attacker ? 10 : 7;
        dynamicDecor
          .moveTo(x + direction * 7, center.y - halfHeight)
          .lineTo(x, center.y)
          .lineTo(x + direction * 7, center.y + halfHeight)
          .stroke({ color, width: attacker ? 4 : 2.6, alpha: 0.72 + pulse * 0.18 });
      }
    }
  };

  const drawScreenState = (
    screen: PachiRect,
    stage: ReturnType<typeof getPachiVisualState>["stage"],
    pulse: number,
  ): void => {
    const jackpot = stage === "jackpot";
    const reach = stage === "reach";
    const revival = stage === "revival";
    const judge = stage === "judge";
    const color = jackpot ? COLOR.goldBright : revival || judge ? COLOR.revival : reach ? COLOR.reach : COLOR.silverDark;
    dynamicDecor
      .roundRect(screen.x - 4, screen.y - 4, screen.width + 8, screen.height + 8, 20)
      .stroke({ color, width: jackpot || revival ? 2.4 : 1.6, alpha: jackpot ? 0.62 : reach || revival ? 0.6 + pulse * 0.12 : 0.38 });

    // These marks stay outside the HTML well. Their fixed shapes survive motion
    // reduction: paired stops for reach, four corners for revival/confirmation,
    // and paired upright wait marks throughout the complete judgment window.
    for (const direction of [-1, 1]) {
      const x = screen.x + (direction > 0 ? screen.width : 0) + direction * 6;
      if (judge || reach) {
        const y = screen.y + screen.height / 2;
        dynamicDecor
          .moveTo(x, y - 18)
          .lineTo(x, y + 18)
          .stroke({ color, width: reach ? 3 : 2, alpha: reach ? 0.8 : 0.58 });
        if (judge) {
          dynamicDecor
            .moveTo(x + direction * 4, y - 18)
            .lineTo(x + direction * 4, y + 18)
            .stroke({ color, width: 2, alpha: 0.58 });
        }
      }
      if (revival || jackpot) {
        for (const vertical of [-1, 1]) {
          const y = screen.y + (vertical > 0 ? screen.height : 0) + vertical * 6;
          dynamicDecor
            .moveTo(x, y - vertical * 28)
            .lineTo(x, y - vertical * 12)
            .lineTo(x - direction * 12, y)
            .lineTo(x - direction * 28, y)
            .stroke({ color, width: jackpot ? 3.4 : 2.8, alpha: jackpot ? 0.8 : 0.76 });
          if (jackpot) {
            dynamicDecor
              .moveTo(x - direction * 36, y)
              .lineTo(x - direction * 46, y)
              .stroke({ color, width: 3.4, alpha: 0.7 });
          }
        }
      }
    }
  };

  const drawEffects = (snapshot: PachiSnapshot, screen: PachiRect, reducedMotion: boolean, t: number): void => {
    dynamicDecor.clear();
    const geometry = snapshot.geometry;
    const open = isAttackerOpen(snapshot);
    // Raw physics previews retain their open/closed rendering contract. Session
    // presentation uses the same public-state helper as the HUD, never hidden outcomes.
    const visual: ReturnType<typeof getPachiVisualState> = "spin" in snapshot
      ? getPachiVisualState(snapshot)
      : { target: open ? "attacker" : "start", stage: open ? "jackpot" : "normal" };
    const pulse = reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(t * 2.4);
    drawScreenState(screen, visual.stage, pulse);
    if (visual.target === "start") {
      drawTarget(geometry.start, false, pulse);
    } else if (visual.target === "attacker" && open) {
      drawTarget(geometry.attacker, true, pulse);
    }
    drawAttackerLid(geometry, open, reducedMotion, t);
  };

  const updateBalls = (balls: readonly PachiBallSnapshot[], geometry: PachiBoardGeometry, reducedMotion: boolean): void => {
    const seen = new Set<string>();
    for (const ball of balls) {
      if (!Number.isFinite(ball.x) || !Number.isFinite(ball.y)) {
        continue;
      }
      seen.add(ball.id);
      let visual = ballVisuals.get(ball.id);
      if (!visual) {
        visual = ballPool.pop() ?? makeBallVisual();
        ballVisuals.set(ball.id, visual);
        ballLayer.addChild(visual.node);
      }
      const radius = Math.max(3.5, Math.min(12, geometry.ballRadius || DEFAULT_BALL_RADIUS));
      visual.node.position.set(ball.x, ball.y);
      visual.trail.clear();
      visual.body.clear();

      const speed = Math.hypot(ball.vx, ball.vy);
      if (!reducedMotion && speed > 0.2) {
        const directionX = ball.vx / speed;
        const directionY = ball.vy / speed;
        const length = Math.min(24, Math.max(5, speed * 0.018));
        for (let i = 3; i >= 1; i -= 1) {
          const ratio = i / 3;
          visual.trail.circle(-directionX * length * ratio, -directionY * length * ratio, radius * (0.24 + (1 - ratio) * 0.15)).fill({ color: COLOR.silver, alpha: 0.08 + (1 - ratio) * 0.12 });
        }
      }
      visual.body.circle(2, 3, radius + 1.2).fill({ color: COLOR.black, alpha: 0.6 });
      visual.body.circle(0, 0, radius).fill(BALL_GRADIENT).stroke({ color: COLOR.white, width: 1.1, alpha: 0.9 });
      visual.body.circle(-radius * 0.28, -radius * 0.32, Math.max(1.2, radius * 0.22)).fill({ color: COLOR.white, alpha: 0.94 });
    }

    for (const [id, visual] of ballVisuals) {
      if (!seen.has(id)) {
        ballVisuals.delete(id);
        ballLayer.removeChild(visual.node);
        ballPool.push(visual);
      }
    }
  };

  const performResize = (): void => {
    if (destroyed || fatal) {
      return;
    }
    const size = viewportSize(options.host);
    renderer.resize(size.width, size.height);
    const scale = Math.min(size.width / BOARD_WIDTH, size.height / BOARD_HEIGHT);
    board.scale.set(scale);
    board.position.set((size.width - BOARD_WIDTH * scale) / 2, (size.height - BOARD_HEIGHT * scale) / 2);
    renderer.render(stage);
  };

  const resize = (): void => {
    try {
      performResize();
    } catch (error: unknown) {
      reportFatal(error);
    }
  };

  const destroy = (): void => {
    if (destroyed) {
      return;
    }
    destroyed = true;
    rendererController.abort();
    resizeController.abort();
    resizeObserver?.disconnect();
    for (const visual of ballVisuals.values()) {
      visual.node.destroy({ children: true });
    }
    for (const visual of ballPool) {
      visual.node.destroy({ children: true });
    }
    ballVisuals.clear();
    ballPool.length = 0;
    let stageError: unknown;
    let rendererError: unknown;
    try {
      stage.destroy({
        children: true,
        texture: true,
        textureSource: true,
        context: true,
        style: true,
      });
    } catch (error: unknown) {
      stageError = error;
    }
    try {
      renderer.destroy(true);
    } catch (error: unknown) {
      rendererError = error;
    }
    if (stageError !== undefined || rendererError !== undefined) {
      throw new AggregateError(
        [stageError, rendererError].filter((error) => error !== undefined),
        "Pachi renderer cleanup failed",
      );
    }
  };

  try {
    if (renderer.name !== "webgl") {
      throw new Error(`Unexpected renderer selected: ${renderer.name}`);
    }
    const canvas = renderer.canvas;
    canvas.dataset.renderer = "pixi-pachi";
    canvas.dataset.testid = "pachi-canvas";
    options.host.replaceChildren(canvas);

    canvas.addEventListener(
      "webglcontextlost",
      (event) => {
        event.preventDefault();
        reportFatal(new Error("WebGL context was lost; reload or reinitialize the renderer."));
      },
      { signal: rendererController.signal },
    );

    resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    if (resizeObserver) {
      resizeObserver.observe(options.host);
    } else {
      window.addEventListener("resize", resize, { signal: resizeController.signal });
    }
    performResize();

    const render = (snapshot: PachiSnapshot, reducedMotion: boolean): void => {
      if (destroyed || fatal) {
        return;
      }
      try {
        const key = geometryKey(snapshot.geometry);
        if (key !== geometryVersion) {
          geometryVersion = key;
          const screen = getScreenRect(snapshot.geometry);
          drawChrome(screen);
          drawGeometry(snapshot.geometry);
        }
        const now = typeof performance === "undefined" ? 0 : performance.now();
        const paused = isSnapshotPaused(snapshot);
        const delta = paused
          ? 0
          : now > 0 && lastRenderAt > 0
            ? Math.min(0.1, Math.max(0, (now - lastRenderAt) / 1000))
            : 1 / 60;
        lastRenderAt = now;
        if (!paused) {
          animationTime += delta;
        }
        drawEffects(snapshot, getScreenRect(snapshot.geometry), reducedMotion, animationTime);
        updateBalls(snapshot.balls, snapshot.geometry, reducedMotion);
        renderer.render(stage);
      } catch (error: unknown) {
        reportFatal(error);
      }
    };

    return { render, resize, destroy };
  } catch (error: unknown) {
    try {
      destroy();
    } catch {
      // Preserve the original initialization failure.
    }
    throw error;
  }
}
