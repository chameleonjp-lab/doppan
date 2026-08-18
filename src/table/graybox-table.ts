import { createG1BTableDefinition } from "./g1b-table";
import type {
  TableDefinition,
  TableFixtureDefinition,
  TablePoint,
  TableSensorDefinition,
  TableShotDefinition,
} from "./types";

export const GRAYBOX_TABLE_VERSION = "graybox-alpha-2";

const point = (x: number, y: number): TablePoint => ({ x, y });

const fixture = (
  id: string,
  kind: TableFixtureDefinition["kind"],
  bodyId: string,
  x: number,
  y: number,
  width: number,
  height: number,
  sensorId: string | null = null,
  angle = 0,
): TableFixtureDefinition => ({
  id,
  kind,
  bodyId,
  position: point(x, y),
  width,
  height,
  angle,
  sensorId,
});

interface GrayboxShotPlacement {
  readonly id: string;
  readonly sensorPositions: readonly [TablePoint, TablePoint, TablePoint];
  readonly expectedDirection: TablePoint;
}

const verticalSensorPositions = (
  x: number,
  y: number,
): readonly [TablePoint, TablePoint, TablePoint] => [
  point(x, y),
  point(x, y + 0.72),
  point(x, y + 1.44),
];

const descendingSensorPositions = (
  x: number,
  y: number,
): readonly [TablePoint, TablePoint, TablePoint] => [
  point(x, y),
  point(x, y - 0.5),
  point(x, y - 1.0),
];

const grayboxShots = [
  // The opening safe shots follow trajectories produced by the real right
  // flipper.  L0 catches the fast leftward return after the divider rebound;
  // R0 catches the higher, slower arc.  Neither path overlaps the launch lane.
  {
    id: "L0",
    sensorPositions: [point(5.4, 2.85), point(3.9, 2.85), point(2.4, 2.85)],
    expectedDirection: point(-1, 0.25),
  },
  {
    id: "R0",
    sensorPositions: [point(6.65, 1.8), point(6.65, 2.52), point(6.65, 3.24)],
    expectedDirection: point(0, 1),
  },
  // The first core shots live on the real safe-return lanes.  They are
  // intentionally descending cross-return sequences: after R0 the ball
  // drops through the right return lane into L1, and after L0 it drops
  // through the left return lane into R1.  Keeping these sensors on the
  // measured trajectory makes the second decision playable before we add
  // the higher-risk upper-board rails.
  { id: "L1", sensorPositions: descendingSensorPositions(6.2, 2.4), expectedDirection: point(0, -1) },
  { id: "R1", sensorPositions: descendingSensorPositions(1.6, 2.0), expectedDirection: point(0, -1) },
  { id: "L2", sensorPositions: verticalSensorPositions(1.45, 11.05), expectedDirection: point(0, 1) },
  { id: "R2", sensorPositions: verticalSensorPositions(7.55, 11.05), expectedDirection: point(0, 1) },
  { id: "C0", sensorPositions: verticalSensorPositions(4.5, 10.0), expectedDirection: point(0, 1) },
  { id: "C1", sensorPositions: verticalSensorPositions(4.5, 13.75), expectedDirection: point(0, 1) },
] as const satisfies readonly GrayboxShotPlacement[];

type GrayboxShotId = (typeof grayboxShots)[number]["id"];

interface GrayboxShotProfile {
  readonly sensorWidth: number;
  readonly sensorHeight: number;
  readonly maxDurationSteps: number;
}

const SHOT_PROFILES: Readonly<Record<GrayboxShotId, GrayboxShotProfile>> = {
  L0: { sensorWidth: 1.22, sensorHeight: 0.5, maxDurationSteps: 300 },
  R0: { sensorWidth: 1.22, sensorHeight: 0.5, maxDurationSteps: 300 },
  L1: { sensorWidth: 0.92, sensorHeight: 0.44, maxDurationSteps: 220 },
  R1: { sensorWidth: 0.92, sensorHeight: 0.44, maxDurationSteps: 220 },
  L2: { sensorWidth: 0.68, sensorHeight: 0.38, maxDurationSteps: 150 },
  R2: { sensorWidth: 0.68, sensorHeight: 0.38, maxDurationSteps: 150 },
  C0: { sensorWidth: 0.82, sensorHeight: 0.42, maxDurationSteps: 180 },
  C1: { sensorWidth: 1.05, sensorHeight: 0.5, maxDurationSteps: 240 },
};

const shotSensors = grayboxShots.flatMap(({ id, sensorPositions }) => {
  const profile = SHOT_PROFILES[id];
  const entrySensorId = `${id}-entry`;
  const checkpointSensorId = `${id}-checkpoint`;
  const exitSensorId = `${id}-exit`;
  const [entryPosition, checkpointPosition, exitPosition] = sensorPositions;
  const sensorRows: readonly TableSensorDefinition[] = [
    {
      id: entrySensorId,
      fixtureId: `sensor-${entrySensorId}`,
      purpose: "safe-shot",
      position: entryPosition,
      width: profile.sensorWidth,
      height: profile.sensorHeight,
    },
    {
      id: checkpointSensorId,
      fixtureId: `sensor-${checkpointSensorId}`,
      purpose: "safe-shot",
      position: checkpointPosition,
      width: profile.sensorWidth,
      height: profile.sensorHeight,
    },
    {
      id: exitSensorId,
      fixtureId: `sensor-${exitSensorId}`,
      purpose: "safe-shot",
      position: exitPosition,
      width: profile.sensorWidth,
      height: profile.sensorHeight,
    },
  ];
  return sensorRows;
});

const shotDefinitions: readonly TableShotDefinition[] = grayboxShots.map(({ id, expectedDirection }) => ({
  id,
  entrySensorId: `${id}-entry`,
  checkpointSensorId: `${id}-checkpoint`,
  exitSensorId: `${id}-exit`,
  maxDurationSteps: SHOT_PROFILES[id].maxDurationSteps,
  expectedDirection,
}));

const gateFixtures: readonly TableFixtureDefinition[] = [
  fixture("gate-return-neutral", "lane", "body-gate-return-neutral", 4.5, 3.45, 2.4, 0.18),
  // This gate is opened on the neutral/left routes and closed only after R0.
  // Closing it gives the right-side return a shallow catcher without changing
  // the launch-only path.
  fixture("gate-return-r0-catcher", "lane", "body-gate-return-r0-catcher", 6.5, 1.3, 0.75, 0.1, null, -0.5),
  fixture("gate-return-left-safe", "lane", "body-gate-return-left-safe", 3.0, 6.55, 1.65, 0.18),
  fixture("gate-return-right-safe", "lane", "body-gate-return-right-safe", 6.0, 6.55, 1.65, 0.18),
  fixture("gate-return-left-cross", "lane", "body-gate-return-left-cross", 2.55, 9.45, 1.9, 0.18, null, 0.18),
  fixture("gate-return-right-cross", "lane", "body-gate-return-right-cross", 6.45, 9.45, 1.9, 0.18, null, -0.18),
  fixture("gate-return-short", "lane", "body-gate-return-short", 4.5, 11.85, 2.1, 0.18),
  fixture("gate-return-central", "lane", "body-gate-return-central", 4.5, 13.05, 2.5, 0.18),
  fixture("gate-return-climax", "lane", "body-gate-return-climax", 4.5, 14.8, 3.1, 0.18),
];

const sensorFixtures: readonly TableFixtureDefinition[] = shotSensors.map((sensor) =>
  fixture(
    sensor.fixtureId,
    "sensor",
    `body-${sensor.fixtureId}`,
    sensor.position.x,
    sensor.position.y,
    sensor.width,
    sensor.height,
    sensor.id,
  ),
);

/**
 * G2's deliberately plain vertical slice. It keeps the G1-B launch and
 * flipper foundation, then adds only the sensors and gate geometry needed to
 * prove that a successful shot changes the next target and the return route.
 */
export function createGrayboxTableDefinition(): TableDefinition {
  const base = createG1BTableDefinition();
  const removedSensorIds = new Set([
    "safe-shot-entry",
    "safe-shot-checkpoint",
    "safe-shot-exit",
  ]);
  const baseFixtures = base.fixtures.filter(
    (definition) => definition.sensorId === null || !removedSensorIds.has(definition.sensorId),
  );
  const baseSensors = base.sensors.filter((sensor) => !removedSensorIds.has(sensor.id));
  const baseShots = base.shots.filter((shot) => shot.id !== "safe-shot");
  const baseRoutes = base.routes.filter((route) => route.id !== "safe-shot-route");

  return {
    ...base,
    tableVersion: GRAYBOX_TABLE_VERSION,
    fixtures: [...baseFixtures, ...gateFixtures, ...sensorFixtures],
    sensors: [...baseSensors, ...shotSensors],
    shots: [...baseShots, ...shotDefinitions],
    routes: [
      ...baseRoutes,
      ...grayboxShots.map(({ id }) => ({
        id: `route-${id}`,
        sensorIds: [`${id}-entry`, `${id}-checkpoint`, `${id}-exit`],
      })),
    ],
  };
}
