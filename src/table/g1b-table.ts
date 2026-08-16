import type {
  TableDefinition,
  TableFixtureDefinition,
  TablePoint,
  TableRuntimeState,
} from "./types";

export const G1B_TABLE_WIDTH = 9;
export const G1B_TABLE_HEIGHT = 16;
export const G1B_TABLE_VERSION = "g1b-prototype-1";

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

/**
 * The smallest playable G1-B table.  The data is deliberately plain and
 * Planck-independent so it can be validated before a world is constructed.
 */
export function createG1BTableDefinition(): TableDefinition {
  const sensors = [
    {
      id: "drain",
      fixtureId: "sensor-drain",
      purpose: "drain" as const,
      position: point(4.5, -0.15),
      width: 9,
      height: 0.35,
    },
    {
      id: "launch-low",
      fixtureId: "sensor-launch-low",
      purpose: "launch-band" as const,
      position: point(8.05, 2.2),
      width: 1.35,
      height: 0.45,
    },
    {
      id: "launch-medium",
      fixtureId: "sensor-launch-medium",
      purpose: "launch-band" as const,
      position: point(8.05, 5.2),
      width: 1.35,
      height: 0.45,
    },
    {
      id: "launch-high",
      fixtureId: "sensor-launch-high",
      purpose: "launch-band" as const,
      position: point(8.05, 8.2),
      width: 1.35,
      height: 0.45,
    },
    {
      id: "safe-shot-entry",
      fixtureId: "sensor-safe-shot-entry",
      purpose: "safe-shot" as const,
      position: point(3.15, 9.2),
      width: 0.9,
      height: 0.55,
    },
    {
      id: "safe-shot-checkpoint",
      fixtureId: "sensor-safe-shot-checkpoint",
      purpose: "safe-shot" as const,
      position: point(3.15, 11.2),
      width: 0.9,
      height: 0.55,
    },
    {
      id: "safe-shot-exit",
      fixtureId: "sensor-safe-shot-exit",
      purpose: "safe-shot" as const,
      position: point(3.15, 13.2),
      width: 0.9,
      height: 0.55,
    },
  ];

  const fixtures: TableFixtureDefinition[] = [
    fixture("wall-left", "wall", "body-wall-left", 0.15, 8, 0.3, 16),
    fixture("wall-right", "wall", "body-wall-right", 8.85, 8, 0.3, 16),
    fixture("wall-top", "wall", "body-wall-top", 4.5, 15.85, 9, 0.3),
    fixture("floor-left", "floor", "body-floor-left", 1.65, 0.15, 3.3, 0.3),
    // Keep a short support under the right flipper, but leave the launch lane
    // as a real drain opening once the launch cradle is released.
    fixture("floor-right", "floor", "body-floor-right", 6.35, 0.15, 1.3, 0.3),
    fixture("launch-cradle", "floor", "body-launch-cradle", 7.95, 0.15, 1.4, 0.3),
    // The divider stops below the high-launch guide.  This leaves a real
    // Planck opening (including BALL_RADIUS clearance) for the guide to feed
    // the ball into the main board instead of trapping it in the lane.
    fixture("lane-divider", "lane", "body-lane-divider", 7.05, 2.55, 0.22, 3.9),
    fixture("launch-guide", "lane", "body-launch-guide", 7.75, 9.6, 2.1, 0.22, null, 2.0),
    fixture("safe-route-left", "lane", "body-safe-route-left", 2.45, 11.2, 0.18, 4.0),
    fixture("safe-route-right", "lane", "body-safe-route-right", 3.85, 11.2, 0.18, 4.0),
    fixture("sensor-drain", "sensor", "body-sensor-drain", 4.5, -0.15, 9, 0.35, "drain"),
    fixture("sensor-launch-low", "sensor", "body-sensor-launch-low", 8.05, 2.2, 1.35, 0.45, "launch-low"),
    fixture(
      "sensor-launch-medium",
      "sensor",
      "body-sensor-launch-medium",
      8.05,
      5.2,
      1.35,
      0.45,
      "launch-medium",
    ),
    fixture("sensor-launch-high", "sensor", "body-sensor-launch-high", 8.05, 8.2, 1.35, 0.45, "launch-high"),
    fixture(
      "sensor-safe-shot-entry",
      "sensor",
      "body-sensor-safe-shot-entry",
      3.15,
      9.2,
      0.9,
      0.55,
      "safe-shot-entry",
    ),
    fixture(
      "sensor-safe-shot-checkpoint",
      "sensor",
      "body-sensor-safe-shot-checkpoint",
      3.15,
      11.2,
      0.9,
      0.55,
      "safe-shot-checkpoint",
    ),
    fixture(
      "sensor-safe-shot-exit",
      "sensor",
      "body-sensor-safe-shot-exit",
      3.15,
      13.2,
      0.9,
      0.55,
      "safe-shot-exit",
    ),
  ];

  return {
    schemaVersion: 1,
    tableVersion: G1B_TABLE_VERSION,
    physicsScale: 1,
    bounds: { width: G1B_TABLE_WIDTH, height: G1B_TABLE_HEIGHT },
    spawnPoints: [{ id: "launch", position: point(8.05, 0.8) }],
    fixtures,
    joints: [
      {
        id: "joint-flipper-left",
        bodyId: "body-flipper-left",
        side: "left",
        anchor: point(3.2, 1.25),
        lowerAngle: -0.3,
        upperAngle: 0.75,
      },
      {
        id: "joint-flipper-right",
        bodyId: "body-flipper-right",
        side: "right",
        anchor: point(5.8, 1.25),
        lowerAngle: -0.75,
        upperAngle: 0.3,
      },
    ],
    sensors,
    shots: [
      {
        id: "safe-shot",
        entrySensorId: "safe-shot-entry",
        checkpointSensorId: "safe-shot-checkpoint",
        exitSensorId: "safe-shot-exit",
        maxDurationSteps: 180,
        expectedDirection: point(0, 1),
      },
    ],
    routes: [
      {
        id: "safe-shot-route",
        sensorIds: ["safe-shot-entry", "safe-shot-checkpoint", "safe-shot-exit"],
      },
    ],
  };
}

export function createTableRuntimeState(table: TableDefinition = createG1BTableDefinition()): TableRuntimeState {
  const gateStates = new Map<string, boolean>();
  for (const fixtureDefinition of table.fixtures) {
    if (fixtureDefinition.kind === "lane") {
      gateStates.set(fixtureDefinition.id, false);
    }
  }
  return {
    connectedRoutes: new Set(table.routes.map((route) => route.id)),
    gateStates,
    enabledShots: new Set(table.shots.map((shot) => shot.id)),
    chargeValues: new Map(),
    awakeningStage: 0,
    activeRuntimeComponents: new Set(),
  };
}

export interface TableValidationError {
  readonly file: string;
  readonly id: string;
  readonly field: string;
  readonly reason: string;
}

const finite = (value: number): boolean => Number.isFinite(value);

function pushDuplicateErrors(
  errors: TableValidationError[],
  values: readonly { readonly id: string }[],
  field: string,
): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value.id)) {
      errors.push({ file: "g1b-table", id: value.id, field, reason: "duplicate id" });
    }
    seen.add(value.id);
  }
}

/** Validates static table data before any Planck objects are created. */
export function validateTableDefinition(table: TableDefinition): readonly TableValidationError[] {
  const errors: TableValidationError[] = [];
  if (table.schemaVersion !== 1) {
    errors.push({ file: "g1b-table", id: "table", field: "schemaVersion", reason: "unsupported schema version" });
  }
  if (!finite(table.physicsScale) || table.physicsScale <= 0) {
    errors.push({ file: "g1b-table", id: "table", field: "physicsScale", reason: "must be finite and positive" });
  }
  if (!finite(table.bounds.width) || table.bounds.width <= 0) {
    errors.push({ file: "g1b-table", id: "table", field: "bounds.width", reason: "must be finite and positive" });
  }
  if (!finite(table.bounds.height) || table.bounds.height <= 0) {
    errors.push({ file: "g1b-table", id: "table", field: "bounds.height", reason: "must be finite and positive" });
  }
  pushDuplicateErrors(errors, table.fixtures, "fixtures");
  pushDuplicateErrors(errors, table.joints, "joints");
  pushDuplicateErrors(errors, table.sensors, "sensors");
  pushDuplicateErrors(errors, table.shots, "shots");
  pushDuplicateErrors(errors, table.routes, "routes");

  for (const fixtureDefinition of table.fixtures) {
    const values = [
      fixtureDefinition.position.x,
      fixtureDefinition.position.y,
      fixtureDefinition.width,
      fixtureDefinition.height,
      fixtureDefinition.angle,
    ];
    if (values.some((value) => !finite(value))) {
      errors.push({ file: "g1b-table", id: fixtureDefinition.id, field: "geometry", reason: "non-finite geometry" });
    }
    if (fixtureDefinition.width <= 0 || fixtureDefinition.height <= 0) {
      errors.push({ file: "g1b-table", id: fixtureDefinition.id, field: "geometry", reason: "size must be positive" });
    }
    if (fixtureDefinition.kind !== "sensor") {
      const withinX = fixtureDefinition.position.x + fixtureDefinition.width / 2 >= 0;
      const withinRight = fixtureDefinition.position.x - fixtureDefinition.width / 2 <= table.bounds.width;
      const withinY = fixtureDefinition.position.y + fixtureDefinition.height / 2 >= 0;
      const withinTop = fixtureDefinition.position.y - fixtureDefinition.height / 2 <= table.bounds.height;
      if (!(withinX && withinRight && withinY && withinTop)) {
        errors.push({ file: "g1b-table", id: fixtureDefinition.id, field: "geometry", reason: "fixture outside table bounds" });
      }
    }
  }

  const sensorIds = new Set(table.sensors.map((sensor) => sensor.id));
  const fixtureIds = new Set(table.fixtures.map((fixtureDefinition) => fixtureDefinition.id));
  for (const spawn of table.spawnPoints) {
    if (!finite(spawn.position.x) || !finite(spawn.position.y)) {
      errors.push({ file: "g1b-table", id: spawn.id, field: "position", reason: "non-finite spawn position" });
      continue;
    }
    if (
      spawn.position.x < 0 ||
      spawn.position.x > table.bounds.width ||
      spawn.position.y < 0 ||
      spawn.position.y > table.bounds.height
    ) {
      errors.push({ file: "g1b-table", id: spawn.id, field: "position", reason: "spawn outside table bounds" });
    }
    for (const fixtureDefinition of table.fixtures) {
      if (fixtureDefinition.kind === "sensor") {
        continue;
      }
      const overlaps =
        Math.abs(spawn.position.x - fixtureDefinition.position.x) <= fixtureDefinition.width / 2 + 0.15 &&
        Math.abs(spawn.position.y - fixtureDefinition.position.y) <= fixtureDefinition.height / 2 + 0.15;
      if (overlaps) {
        errors.push({ file: "g1b-table", id: spawn.id, field: "position", reason: `overlaps fixture ${fixtureDefinition.id}` });
      }
    }
  }
  for (const sensor of table.sensors) {
    if (!fixtureIds.has(sensor.fixtureId)) {
      errors.push({ file: "g1b-table", id: sensor.id, field: "fixtureId", reason: "unknown fixture" });
    }
  }
  for (const fixtureDefinition of table.fixtures) {
    if (fixtureDefinition.sensorId !== null && !sensorIds.has(fixtureDefinition.sensorId)) {
      errors.push({ file: "g1b-table", id: fixtureDefinition.id, field: "sensorId", reason: "unknown sensor" });
    }
    if (fixtureDefinition.kind === "sensor" && fixtureDefinition.sensorId === null) {
      errors.push({ file: "g1b-table", id: fixtureDefinition.id, field: "sensorId", reason: "sensor fixture needs sensorId" });
    }
  }
  for (const joint of table.joints) {
    if (
      !finite(joint.anchor.x) ||
      !finite(joint.anchor.y) ||
      !finite(joint.lowerAngle) ||
      !finite(joint.upperAngle) ||
      joint.lowerAngle >= joint.upperAngle
    ) {
      errors.push({ file: "g1b-table", id: joint.id, field: "limits", reason: "invalid joint anchor or angle limits" });
    }
  }
  for (const shot of table.shots) {
    const ids = [shot.entrySensorId, shot.checkpointSensorId, shot.exitSensorId];
    if (ids.some((id) => !sensorIds.has(id))) {
      errors.push({ file: "g1b-table", id: shot.id, field: "sensors", reason: "unknown shot sensor" });
    }
    if (!Number.isInteger(shot.maxDurationSteps) || shot.maxDurationSteps <= 0) {
      errors.push({ file: "g1b-table", id: shot.id, field: "maxDurationSteps", reason: "must be a positive integer" });
    }
    if (!finite(shot.expectedDirection.x) || !finite(shot.expectedDirection.y)) {
      errors.push({ file: "g1b-table", id: shot.id, field: "expectedDirection", reason: "non-finite direction" });
    }
  }
  for (const route of table.routes) {
    if (route.sensorIds.length === 0 || route.sensorIds.some((id) => !sensorIds.has(id))) {
      errors.push({ file: "g1b-table", id: route.id, field: "sensorIds", reason: "route references unknown sensor" });
    }
  }
  if (!table.sensors.some((sensor) => sensor.purpose === "drain")) {
    errors.push({ file: "g1b-table", id: "table", field: "sensors", reason: "drain sensor is required" });
  }
  if (!table.spawnPoints.some((spawn) => spawn.id === "launch")) {
    errors.push({ file: "g1b-table", id: "table", field: "spawnPoints", reason: "launch spawn is required" });
  }
  return errors;
}
