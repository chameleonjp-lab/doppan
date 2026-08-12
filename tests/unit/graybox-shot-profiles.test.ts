import { describe, expect, it } from "vitest";
import { createGrayboxTableDefinition } from "../../src/table";

describe("graybox shot readability profiles", () => {
  it("gives safe, core, and danger shots different target widths and time windows", () => {
    const table = createGrayboxTableDefinition();
    const byId = new Map(table.shots.map((shot) => [shot.id, shot]));
    const sensorById = new Map(table.sensors.map((sensor) => [sensor.id, sensor]));

    const widthOf = (shotId: string): number => {
      const shot = byId.get(shotId);
      if (shot === undefined) {
        throw new Error("missing shot " + shotId);
      }
      const sensor = sensorById.get(shot.entrySensorId);
      if (sensor === undefined) {
        throw new Error("missing entry sensor " + shot.entrySensorId);
      }
      return sensor.width;
    };

    expect(widthOf("L0")).toBeGreaterThan(widthOf("L1"));
    expect(widthOf("L1")).toBeGreaterThan(widthOf("L2"));
    expect(byId.get("L0")?.maxDurationSteps).toBeGreaterThan(byId.get("L1")?.maxDurationSteps ?? 0);
    expect(byId.get("L1")?.maxDurationSteps).toBeGreaterThan(byId.get("L2")?.maxDurationSteps ?? 0);
    expect(widthOf("R0")).toBe(widthOf("L0"));
    expect(widthOf("R1")).toBe(widthOf("L1"));
    expect(widthOf("R2")).toBe(widthOf("L2"));
  });
});
