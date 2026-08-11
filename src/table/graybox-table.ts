import { createG1BTableDefinition } from "./g1b-table";
import type {
  TableDefinition,
  TableFixtureDefinition,
  TablePoint,
  TableSensorDefinition,
  TableShotDefinition,
} from "./types";

export const GRAYBOX_TABLE_VERSION = "graybox-alpha-1";

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

const grayboxShots = [
  { id: "L0", x: 1.45, y: 5.05 },
  { id: "R0", x: 7.55, y: 5.05 },
  { id: "L1", x: 2.2, y: 8.05 },
  { id: "R1", x: 6.8, y: 8.05 },
  { id: "L2", x: 1.45, y: 11.05 },
  { id: "R2", x: 7.55, y: 11.05 },
  { id: "C0", x: 4.5, y: 10.0 },
  { id: "C1", x: 4.5, y: 13.75 },
] as const;

const shotSensors = grayboxShots.flatMap(({ id, x, y }) => {
  const entrySensorId = `${id}-entry`;
  const checkpointSensorId = `${id}-checkpoint`;
  const exitSensorId = `${id}-exit`;
  const sensorRows: readonly TableSensorDefinition[] = [
    {
      id: entrySensorId,
      fixtureId: `sensor-${entrySensorId}`,
      purpose: "safe-shot",
      position: point(x, y),
      width: 0.95,
      height: 0.42,
    },
    {
      id: checkpointSensorId,
      fixtureId: `sensor-${checkpointSensorId}`,
      purpose: "safe-shot",
      position: point(x, y + 0.72),
      width: 0.95,
      height: 0.42,
    },
    {
      id: exitSensorId,
      fixtureId: `sensor-${exitSensorId}`,
      purpose: "safe-shot",
      position: point(x, y + 1.44),
      width: 0.95,
      height: 0.42,
    },
  ];
  return sensorRows;
});

const shotDefinitions: readonly TableShotDefinition[] = grayboxShots.map(({ id }) => ({
  id,
  entrySensorId: `${id}-entry`,
  checkpointSensorId: `${id}-checkpoint`,
  exitSensorId: `${id}-exit`,
  maxDurationSteps: 240,
  expectedDirection: point(0, 1),
}));

const gateFixtures: readonly TableFixtureDefinition[] = [
  fixture("gate-return-neutral", "lane", "body-gate-return-neutral", 4.5, 3.45, 2.4, 0.18),
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
