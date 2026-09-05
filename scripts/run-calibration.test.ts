import { it } from "vitest";
import { formatCalibration, simulatePachiCalibration } from "./simulate-pachi";

it("runs the requested calibration", () => {
  console.log(formatCalibration(simulatePachiCalibration()));
});
