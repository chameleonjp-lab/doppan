import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test.describe("G1-A boot surface", () => {
  test("starts, exposes build information, and does not create a Pixi ticker", async ({
    page,
  }) => {
    const uncaught: string[] = [];
    page.on("pageerror", (error) => uncaught.push(error.message));
    await page.goto("/");

    await expect(page.locator("[data-build-environment]")).toHaveText(
      /development-preview|production|test/,
    );
    const sha = page.locator("[data-build-sha]");
    await expect(sha).not.toHaveText("loading");
    if (process.env.CI) {
      await expect(sha).toHaveText(/^[0-9a-f]{40}$/u);
    }
    await expect(page.locator("[data-canvas-host] canvas")).toBeVisible();
    await expect(page.locator("[data-action='toggle-loop']")).toBeEnabled();
    expect(uncaught).toEqual([]);

    const initial = await page.evaluate(() =>
      window.__DOPPAN_G1A__?.getLoopDiagnostics(),
    );
    expect(initial?.running).toBe(false);
    const pixi = await page.evaluate(() =>
      window.__DOPPAN_G1A__?.getPixiDiagnostics(),
    );
    expect(pixi?.rendererName).toBe("webgl");
    expect(pixi?.tickerPresent).toBe(false);
    expect(pixi?.tickerAutoStart).toBe(false);
    expect(pixi?.tickerStarted).toBe(false);
    expect(pixi?.renderCount).toBeGreaterThanOrEqual(1);

    await page.keyboard.press("Space");
    await expect(page.locator("[data-status]")).toHaveText("実行中");
    const running = await page.evaluate(() =>
      window.__DOPPAN_G1A__?.getLoopDiagnostics(),
    );
    expect(running?.running).toBe(true);
    expect(running?.pendingFrame).toBe(true);
    expect(running?.frameCount).toBeGreaterThanOrEqual(0);
    expect(running?.activeLoopCount).toBe(1);

    await page.keyboard.press("Space");
    await expect(page.locator("[data-status]")).toHaveText("停止中");
    const stopped = await page.evaluate(() =>
      window.__DOPPAN_G1A__?.getLoopDiagnostics(),
    );
    expect(stopped?.running).toBe(false);
    expect(stopped?.pendingFrame).toBe(false);
    expect(stopped?.activeLoopCount).toBe(0);

    await page.locator("[data-action='toggle-loop']").focus();
    await page.keyboard.press("Space");
    await expect(page.locator("[data-status]")).toHaveText("実行中");
    await page.locator("[data-action='toggle-loop']").click();
    await expect(page.locator("[data-status]")).toHaveText("停止中");
    expect(uncaught).toEqual([]);
  });

  test("reinitializes the renderer twenty times without multiplying resources", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.goto("/");
    await expect(page.locator("[data-canvas-host] canvas")).toBeVisible();

    for (let index = 0; index < 20; index += 1) {
      await page.keyboard.press("Space");
      await expect(page.locator("[data-status]")).toHaveText("実行中");
      const initialized = await page.evaluate(() =>
        window.__DOPPAN_G1A__?.reinitializeRenderer(),
      );
      expect(initialized).toBe(true);
      await expect(page.locator("[data-canvas-host] canvas")).toHaveCount(1);
      const diagnostics = await page.evaluate(() => ({
        loop: window.__DOPPAN_G1A__?.getLoopDiagnostics(),
        pixi: window.__DOPPAN_G1A__?.getPixiDiagnostics(),
      }));
      expect(diagnostics.loop?.activeLoopCount).toBe(0);
      expect(diagnostics.pixi?.rendererName).toBe("webgl");
      expect(diagnostics.pixi?.tickerPresent).toBe(false);
      expect(diagnostics.pixi?.tickerAutoStart).toBe(false);
      expect(diagnostics.pixi?.tickerStarted).toBe(false);
      expect(diagnostics.pixi?.renderCount).toBeGreaterThanOrEqual(1);
      expect(diagnostics.pixi?.renderCount).toBeLessThanOrEqual(2);

      await page.keyboard.press("Space");
      await expect(page.locator("[data-status]")).toHaveText("実行中");
      const running = await page.evaluate(() =>
        window.__DOPPAN_G1A__?.getLoopDiagnostics(),
      );
      expect(running?.activeLoopCount).toBe(1);
      await page.keyboard.press("Space");
      await expect(page.locator("[data-status]")).toHaveText("停止中");
      const stopped = await page.evaluate(() =>
        window.__DOPPAN_G1A__?.getLoopDiagnostics(),
      );
      expect(stopped?.activeLoopCount).toBe(0);
    }
  });

  test("shows a non-white WebGL failure guide", async ({ page }) => {
    await page.goto("/?forceWebGLFailure=1");
    await expect(page.locator("[data-webgl-error]")).toBeVisible();
    await expect(page.locator("body")).toContainText("WebGL");
    await expect(page.locator("[data-status]")).toHaveText("WebGL案内を表示中");
    await expect(page.locator("[data-action='toggle-loop']")).toBeDisabled();
    await page.keyboard.press("Space");
    await expect(page.locator("[data-status]")).toHaveText("WebGL案内を表示中");
    const diagnostics = await page.evaluate(() =>
      window.__DOPPAN_G1A__?.getLoopDiagnostics(),
    );
    expect(diagnostics?.running).toBe(false);
    expect(diagnostics?.activeLoopCount).toBe(0);
  });

  test("refuses renderer fallback when WebGL is unavailable", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const originalGetContext = Object.getOwnPropertyDescriptor(
        HTMLCanvasElement.prototype,
        "getContext",
      )?.value as
        | ((
            this: HTMLCanvasElement,
            type: string,
            ...arguments_: unknown[]
          ) => unknown)
        | undefined;
      if (!originalGetContext) {
        throw new Error("HTMLCanvasElement.getContext is unavailable");
      }
      Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
        configurable: true,
        value(type: string, ...arguments_: unknown[]) {
          if (
            type === "webgl" ||
            type === "webgl2" ||
            type === "experimental-webgl"
          ) {
            return null;
          }
          return Reflect.apply(
            originalGetContext as (...parameters: unknown[]) => unknown,
            this,
            [type, ...arguments_],
          );
        },
      });
    });
    await page.goto("/");
    await expect(page.locator("[data-webgl-error]")).toBeVisible();
    await expect(page.locator("[data-action='toggle-loop']")).toBeDisabled();
    await expect(page.locator("[data-canvas-host] canvas")).toHaveCount(0);
    const diagnostics = await page.evaluate(() =>
      window.__DOPPAN_G1A__?.getLoopDiagnostics(),
    );
    expect(diagnostics?.activeLoopCount).toBe(0);
  });

  test("stops safely when the WebGL context is lost", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("[data-canvas-host] canvas")).toBeVisible();
    await page.keyboard.press("Space");
    await expect(page.locator("[data-status]")).toHaveText("実行中");

    await page.locator("[data-canvas-host] canvas").evaluate((canvas) => {
      canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    });

    await expect(page.locator("[data-webgl-error]")).toBeVisible();
    await expect(page.locator("[data-status]")).toHaveText("WebGL案内を表示中");
    await expect(page.locator("[data-action='toggle-loop']")).toBeDisabled();
    const diagnostics = await page.evaluate(() =>
      window.__DOPPAN_G1A__?.getLoopDiagnostics(),
    );
    expect(diagnostics?.running).toBe(false);
    expect(diagnostics?.activeLoopCount).toBe(0);
  });

  for (const width of [320, 390, 430]) {
    test(`fits ${width}px portrait width`, async ({ page }) => {
      await page.setViewportSize({ width, height: 720 });
      await page.goto("/");
      await expect(page.locator("[data-app-root]")).toBeVisible();
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      );
      expect(overflow).toBe(false);
    });
  }

  test("survives Safari-like viewport height changes", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("[data-canvas-host] canvas")).toBeVisible();
    const initialRenderCount = await page.evaluate(
      () => window.__DOPPAN_G1A__?.getPixiDiagnostics()?.renderCount ?? 0,
    );
    for (const height of [844, 667, 560, 844]) {
      await page.setViewportSize({ width: 390, height });
      await expect(page.locator("[data-app-root]")).toBeVisible();
      await expect(page.locator("[data-action='toggle-loop']")).toBeVisible();
      await expect(page.locator("[data-canvas-host]")).toBeVisible();
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      );
      expect(overflow).toBe(false);
    }
    await page.locator("[data-canvas-host]").evaluate((host) => {
      host.style.height = "240px";
    });
    await page.waitForTimeout(50);
    const resized = await page.evaluate(() =>
      window.__DOPPAN_G1A__?.getPixiDiagnostics(),
    );
    expect(resized?.renderCount).toBeGreaterThan(initialRenderCount);
    expect(resized?.tickerStarted).toBe(false);
  });

  test("shows the landscape guidance", async ({ page }) => {
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
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      );
      expect(overflow).toBe(false);
    }
  });
});
