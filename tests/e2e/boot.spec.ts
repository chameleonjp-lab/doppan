import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

const pageErrors = new WeakMap<Page, string[]>();

async function readG1B(page: Page) {
  return page.evaluate(() => {
    const api = window.__DOPPAN_G1B__;
    if (api === undefined) {
      throw new Error("window.__DOPPAN_G1B__ is not available");
    }
    return {
      loop: api.getLoopDiagnostics(),
      pixi: api.getPixiDiagnostics(),
      prototype: api.getPrototypeDiagnostics(),
      snapshot: api.getSnapshot(),
    };
  });
}

async function waitForG1B(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => window.__DOPPAN_G1B__ !== undefined))
    .toBe(true);
  await expect(page.locator("[data-canvas-host] canvas")).toHaveCount(1);
  await expect
    .poll(async () => (await readG1B(page)).pixi?.rendererName ?? null)
    .toBe("webgl");
}

function resourceCounts(observation: Awaited<ReturnType<typeof readG1B>>) {
  return {
    bodyCount: observation.prototype.physics.bodyCount,
    fixtureCount: observation.prototype.physics.fixtureCount,
    jointCount: observation.prototype.physics.jointCount,
  };
}

function assertSingleRuntime(
  observation: Awaited<ReturnType<typeof readG1B>>,
): void {
  expect(observation.loop.running).toBe(true);
  expect(observation.loop.activeLoopCount).toBe(1);
  expect(observation.pixi?.rendererName).toBe("webgl");
  expect(observation.pixi?.tickerPresent).toBe(false);
  expect(observation.pixi?.tickerAutoStart).toBe(false);
  expect(observation.pixi?.tickerStarted).toBe(false);
}

test.describe("G2 graybox boot surface", () => {
  test.beforeEach(({ page }) => {
    const errors: string[] = [];
    pageErrors.set(page, errors);
    page.on("pageerror", (error) => errors.push(error.message));
  });

  test.afterEach(({ page }) => {
    expect(pageErrors.get(page) ?? []).toEqual([]);
  });

  test("auto-starts one loop with Pixi ticker disabled", async ({ page }) => {
    await page.goto("/");
    await waitForG1B(page);

    const boot = await readG1B(page);
    assertSingleRuntime(boot);
    expect(boot.snapshot.baseState).toBe("LaunchReady");
    expect(boot.snapshot.suspensionState).toBe("None");
    expect(boot.prototype.inputOwners).toBe(0);
    expect(boot.prototype.physics.safeStopped).toBe(false);
    expect(boot.pixi?.renderCount).toBeGreaterThanOrEqual(1);
    await expect(page.locator("[data-graybox='target']")).toHaveText("L0 / R0");
    await expect(page.locator("[data-graybox='progress']")).toHaveText("0 / 5");
    expect(await page.evaluate(() => window.localStorage.length)).toBe(0);
    await expect(page.locator("[data-status]")).toHaveText("実行中");
    await expect(page.locator("[data-build-environment]")).toHaveText(
      /development-preview|production|test/,
    );
  });

  test("routes a fully charged Space launch into the main board", async ({ page }) => {
    // This scenario verifies input -> fixed-step -> Planck routing, not the
    // performance of a traced CI worker. Playwright's clock keeps RAF,
    // performance, timers, and event timestamps on the same deterministic
    // timeline while the production dropped-frame policy remains unchanged.
    await page.clock.install({ time: new Date("2026-08-11T00:00:00.000Z") });
    await page.clock.pauseAt(new Date("2026-08-11T00:00:01.000Z"));
    await page.goto("/");
    await waitForG1B(page);

    await page.keyboard.down("Space");
    await page.clock.runFor(1_200);
    expect((await readG1B(page)).prototype.launchCharge).toBeGreaterThanOrEqual(0.9);
    await page.keyboard.up("Space");
    // Two 16 ms clock frames guarantee at least one 60 Hz fixed step after
    // release; a single clock frame is shorter than the 16.667 ms step.
    await page.clock.runFor(34);

    expect((await readG1B(page)).snapshot.baseState).toBe("Playing");
    await page.clock.runFor(1_100);
    const routed = await readG1B(page);
    expect(routed.snapshot.ball.position.x).toBeLessThan(6.64);
    expect(routed.snapshot.suspensionState).toBe("None");
    expect(routed.prototype.runIntegrity).toBe("valid");
    expect(routed.prototype.physics.safeStopped).toBe(false);
    expect(routed.prototype.inputLatency.inputToPhysics.sampleCount).toBeGreaterThan(0);
    expect(routed.prototype.inputLatency.inputToDraw.sampleCount).toBeGreaterThan(0);
  });

  test("routes keyboard and touch input, including release", async ({ page }) => {
    await page.goto("/");
    await waitForG1B(page);

    await page.keyboard.down("z");
    await expect
      .poll(async () =>
        (await readG1B(page)).snapshot.flippers.find((flipper) => flipper.side === "left")?.active ??
        false,
      )
      .toBe(true);
    await page.keyboard.up("z");
    await expect
      .poll(async () =>
        (await readG1B(page)).snapshot.flippers.find((flipper) => flipper.side === "left")?.active ??
        false,
      )
      .toBe(false);

    const rightFlipper = page.locator("[data-input-action='rightFlipper']");
    await rightFlipper.evaluate((element) => {
      // Synthetic pointer events do not have a browser pointer capture slot.
      // Keep the binding test focused on ownership and release semantics.
      element.setPointerCapture = () => undefined;
    });
    await rightFlipper.dispatchEvent("pointerdown", {
      pointerId: 41,
      pointerType: "touch",
      isPrimary: true,
      buttons: 1,
    });
    await expect
      .poll(async () => (await readG1B(page)).prototype.inputOwners)
      .toBe(1);
    await expect
      .poll(async () =>
        (await readG1B(page)).snapshot.flippers.find((flipper) => flipper.side === "right")?.active ??
        false,
      )
      .toBe(true);

    await rightFlipper.dispatchEvent("pointerup", {
      pointerId: 41,
      pointerType: "touch",
      isPrimary: true,
      buttons: 0,
    });
    await expect
      .poll(async () => (await readG1B(page)).prototype.inputOwners)
      .toBe(0);
    await expect
      .poll(async () =>
        (await readG1B(page)).snapshot.flippers.find((flipper) => flipper.side === "right")?.active ??
        false,
      )
      .toBe(false);

    // The browser commonly follows pointerup with lostpointercapture. The
    // second notification must not create a second release or resurrect input.
    await rightFlipper.dispatchEvent("lostpointercapture", {
      pointerId: 41,
      pointerType: "touch",
    });
    await expect
      .poll(async () => (await readG1B(page)).prototype.inputOwners)
      .toBe(0);

    await rightFlipper.dispatchEvent("pointerdown", {
      pointerId: 41,
      pointerType: "touch",
      isPrimary: true,
      buttons: 1,
    });
    await expect
      .poll(async () => (await readG1B(page)).prototype.inputOwners)
      .toBe(1);
    await rightFlipper.dispatchEvent("pointercancel", {
      pointerId: 41,
      pointerType: "touch",
    });
    await expect
      .poll(async () => (await readG1B(page)).prototype.inputOwners)
      .toBe(0);
  });

  test("pauses and resumes from Escape without changing the base state", async ({ page }) => {
    await page.goto("/");
    await waitForG1B(page);

    const beforeBaseState = (await readG1B(page)).snapshot.baseState;
    await page.keyboard.press("Escape");
    await expect
      .poll(async () => (await readG1B(page)).snapshot.suspensionState)
      .toBe("ManualPause");
    const paused = await readG1B(page);
    expect(paused.snapshot.baseState).toBe(beforeBaseState);
    expect(paused.loop.activeLoopCount).toBe(1);

    await page.keyboard.press("Escape");
    await expect
      .poll(async () => (await readG1B(page)).snapshot.suspensionState)
      .toBe("None");
    expect((await readG1B(page)).snapshot.baseState).toBe("LaunchReady");
  });

  test("switches deterministic physics between 60 Hz and 120 Hz", async ({ page }) => {
    await page.goto("/");
    await waitForG1B(page);

    const hz = page.locator("[data-physics-hz]");
    await expect.poll(async () => (await readG1B(page)).prototype.fixedStep.physicsStepHz).toBe(60);

    await hz.selectOption("120");
    await expect
      .poll(async () => (await readG1B(page)).prototype.fixedStep.physicsStepHz)
      .toBe(120);
    expect((await readG1B(page)).snapshot.baseState).toBe("LaunchReady");

    await hz.selectOption("60");
    await expect
      .poll(async () => (await readG1B(page)).prototype.fixedStep.physicsStepHz)
      .toBe(60);
    expect((await readG1B(page)).snapshot.baseState).toBe("LaunchReady");
    assertSingleRuntime(await readG1B(page));
  });

  test("reinitializes the renderer twenty times without changing resources or loop count", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto("/");
    await waitForG1B(page);

    const initial = await readG1B(page);
    const resources = resourceCounts(initial);
    for (let index = 0; index < 20; index += 1) {
      const initialized = await page.evaluate(async () => {
        const api = window.__DOPPAN_G1B__;
        return api === undefined ? false : await api.reinitializeRenderer();
      });
      expect(initialized).toBe(true);
      await expect(page.locator("[data-canvas-host] canvas")).toHaveCount(1);
      await expect
        .poll(async () => (await readG1B(page)).loop.activeLoopCount)
        .toBe(1);

      const observation = await readG1B(page);
      assertSingleRuntime(observation);
      expect(resourceCounts(observation)).toEqual(resources);
      expect(observation.pixi?.renderCount).toBeGreaterThanOrEqual(1);
    }
  });

  test("safe-stops when WebGL initialization is unavailable", async ({ page }) => {
    await page.addInitScript(() => {
      const descriptor = Object.getOwnPropertyDescriptor(
        HTMLCanvasElement.prototype,
        "getContext",
      );
      const original = descriptor?.value as
        | ((this: HTMLCanvasElement, type: string, ...arguments_: unknown[]) => unknown)
        | undefined;
      if (original === undefined) {
        throw new Error("HTMLCanvasElement.getContext is unavailable");
      }
      Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
        configurable: true,
        value(this: HTMLCanvasElement, type: string, ...arguments_: unknown[]) {
          if (type === "webgl" || type === "webgl2" || type === "experimental-webgl") {
            return null;
          }
          return original.call(this, type, ...arguments_);
        },
      });
    });
    await page.goto("/");

    await expect(page.locator("[data-webgl-error]")).toBeVisible();
    await expect(page.locator("[data-canvas-host] canvas")).toHaveCount(0);
    await expect.poll(async () => (await readG1B(page)).loop.activeLoopCount).toBe(0);
    const failed = await readG1B(page);
    expect(failed.loop.running).toBe(false);
    expect(failed.pixi).toBeNull();
    expect(failed.snapshot.baseState).toBe("FatalRecovery");
    expect(failed.prototype.inputOwners).toBe(0);
    expect(failed.prototype.runIntegrity).toBe("invalid");
    expect(await page.locator("button[data-input-action]").evaluateAll(
      (buttons) => buttons.every((button) => (button as HTMLButtonElement).disabled),
    )).toBe(true);
    expect(await page.evaluate(async () => window.__DOPPAN_G1B__?.reinitializeRenderer())).toBe(false);
    expect((await readG1B(page)).loop.activeLoopCount).toBe(0);
    await page.keyboard.press("Escape");
    expect((await readG1B(page)).snapshot.baseState).toBe("FatalRecovery");
  });

  test("safe-stops on WebGL context loss", async ({ page }) => {
    await page.goto("/");
    await waitForG1B(page);
    const canvas = page.locator("[data-canvas-host] canvas");

    await canvas.dispatchEvent("webglcontextlost", { cancelable: true });
    await expect(page.locator("[data-webgl-error]")).toBeVisible();
    await expect
      .poll(async () => (await readG1B(page)).snapshot.baseState)
      .toBe("FatalRecovery");
    await expect.poll(async () => (await readG1B(page)).loop.activeLoopCount).toBe(0);
    const lost = await readG1B(page);
    expect(lost.loop.running).toBe(false);
    expect(lost.pixi).toBeNull();
    expect(lost.snapshot.suspensionState).toBe("None");
    expect(lost.prototype.inputOwners).toBe(0);
    expect(lost.prototype.runIntegrity).toBe("invalid");
    expect(await page.locator("button[data-input-action]").evaluateAll(
      (buttons) => buttons.every((button) => (button as HTMLButtonElement).disabled),
    )).toBe(true);
    expect(await page.evaluate(async () => window.__DOPPAN_G1B__?.reinitializeRenderer())).toBe(false);
    expect((await readG1B(page)).loop.activeLoopCount).toBe(0);
    await page.keyboard.press("Escape");
    expect((await readG1B(page)).snapshot.baseState).toBe("FatalRecovery");
  });

  for (const width of [320, 390, 430]) {
    test(`fits ${width}px portrait width without horizontal overflow`, async ({ page }) => {
      await page.setViewportSize({ width, height: 720 });
      await page.goto("/");
      await waitForG1B(page);
      const dimensions = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
    });
  }

  test("shows landscape guidance", async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await page.goto("/");
    await expect(page.locator(".landscape-hint")).toBeVisible();
  });

  test("keeps the public root guide separate and mobile-safe", async ({ page }) => {
    const rootGuide = await readFile(
      new URL("../../pages/root/root-guide.html", import.meta.url),
      "utf8",
    );

    for (const width of [320, 390, 430]) {
      await page.setViewportSize({ width, height: 720 });
      await page.setContent(rootGuide);
      await expect(page.locator("main")).toContainText("一般公開前");
      await expect(page.locator("a")).toHaveCount(0);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
        "content",
        "noindex, nofollow, noarchive",
      );
      const dimensions = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
    }
  });
});
