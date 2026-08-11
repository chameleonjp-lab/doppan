/** A Planck-independent, bottom-left-origin point used by table data. */
export interface TablePoint {
  readonly x: number;
  readonly y: number;
}

export interface TableBounds {
  readonly width: number;
  readonly height: number;
}

export interface TableSpawnPoint {
  readonly id: string;
  readonly position: TablePoint;
}

export type TableFixtureKind =
  | "wall"
  | "floor"
  | "lane"
  | "flipper"
  | "sensor"
  | "ball";

export interface TableFixtureDefinition {
  readonly id: string;
  readonly kind: TableFixtureKind;
  readonly bodyId: string;
  readonly position: TablePoint;
  readonly width: number;
  readonly height: number;
  /** Counter-clockwise radians in the bottom-left-origin physics frame. */
  readonly angle: number;
  readonly sensorId: string | null;
}

export type TableFlipperSide = "left" | "right";

export interface TableJointDefinition {
  readonly id: string;
  readonly bodyId: string;
  readonly side: TableFlipperSide;
  readonly anchor: TablePoint;
  readonly lowerAngle: number;
  readonly upperAngle: number;
}

export interface TableSensorDefinition {
  readonly id: string;
  readonly fixtureId: string;
  readonly purpose: "drain" | "launch-band" | "safe-shot";
  readonly position: TablePoint;
  readonly width: number;
  readonly height: number;
}

export interface TableShotDefinition {
  readonly id: string;
  readonly entrySensorId: string;
  readonly checkpointSensorId: string;
  readonly exitSensorId: string;
  readonly maxDurationSteps: number;
  readonly expectedDirection: TablePoint;
}

export interface TableRouteDefinition {
  readonly id: string;
  readonly sensorIds: readonly string[];
}

export interface TableDefinition {
  readonly schemaVersion: number;
  readonly tableVersion: string;
  readonly physicsScale: number;
  readonly bounds: TableBounds;
  readonly spawnPoints: readonly TableSpawnPoint[];
  readonly fixtures: readonly TableFixtureDefinition[];
  readonly joints: readonly TableJointDefinition[];
  readonly sensors: readonly TableSensorDefinition[];
  readonly shots: readonly TableShotDefinition[];
  readonly routes: readonly TableRouteDefinition[];
}

export interface TableRuntimeState {
  readonly connectedRoutes: Set<string>;
  readonly gateStates: Map<string, boolean>;
  readonly enabledShots: Set<string>;
  readonly chargeValues: Map<string, number>;
  readonly awakeningStage: number;
  readonly activeRuntimeComponents: Set<string>;
}
