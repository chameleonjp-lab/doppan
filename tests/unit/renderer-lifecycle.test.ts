import { describe, expect, it } from "vitest";
import { initializeWithCleanup } from "../../src/rendering/renderer-lifecycle";

describe("renderer initialization lifecycle", () => {
  it("destroys a retained renderer when initialization fails", async () => {
    const initializationError = new Error("renderer init failed after context creation");
    let cleanupCount = 0;

    await expect(
      initializeWithCleanup(
        () => Promise.reject(initializationError),
        () => {
          cleanupCount += 1;
        },
      ),
    ).rejects.toBe(initializationError);
    expect(cleanupCount).toBe(1);
  });
});
