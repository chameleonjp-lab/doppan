import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

const rootSelector = "[data-app-root]";
const fireSelector = "[data-action=fire]";
const pageErrors = new WeakMap<Page, string[]>();
const deterministicClockPages = new WeakSet<Page>();

type ViewportCase = {
  readonly name: string;
  readonly width: number;
  readonly height: number;
};

const viewports: readonly ViewportCase[] = [
  { name: "402x874", width: 402, height: 874 },
  { name: "320x568", width: 320, height: 568 },
  { name: "landscape844x390", width: 844, height: 390 },
];

const clockStepMs = 200;

type RootDiagnostics = {
  readonly ready: string | undefined;
  readonly phase: string | undefined;
  readonly paused: string | undefined;
  readonly fired: string | undefined;
  readonly pushState: string | undefined;
  readonly spinStage: string | undefined;
  readonly startEntries: string | undefined;
  readonly jackpots: string | undefined;
  readonly attackerEntries: string | undefined;
};

function root(page: Page) {
  return page.locator(rootSelector);
}

async function readRootDiagnostics(page: Page): Promise<RootDiagnostics> {
  return page.locator(rootSelector).evaluate((element) => ({
    ready: element.getAttribute("data-ready") ?? undefined,
    phase: element.getAttribute("data-phase") ?? undefined,
    paused: element.getAttribute("data-paused") ?? undefined,
    fired: element.getAttribute("data-fired") ?? undefined,
    pushState: element.getAttribute("data-push-state") ?? undefined,
    spinStage: element.getAttribute("data-spin-stage") ?? undefined,
    startEntries: element.getAttribute("data-start-entries") ?? undefined,
    jackpots: element.getAttribute("data-jackpots") ?? undefined,
    attackerEntries: element.getAttribute("data-attacker-entries") ?? undefined,
  }));
}

async function installDeterministicClock(page: Page): Promise<void> {
  await page.clock.install({ time: new Date("2026-09-05T00:00:00.000Z") });
  deterministicClockPages.add(page);
}

async function runClock(page: Page, durationMs: number): Promise<void> {
  // fastForward fires at most one due RAF. Keep that single frame below the
  // runtime's 250 ms stale-frame boundary while avoiding hundreds of expensive
  // renderer frames in a long deterministic path.
  for (let remaining = durationMs; remaining > 0; remaining -= clockStepMs) {
    await page.clock.fastForward(Math.min(clockStepMs, remaining));
  }
}

async function flushInputFrame(page: Page): Promise<void> {
  // Input handlers update session state synchronously; updateUi publishes
  // data-firing on the next RAF. Keep this bounded and below the stale-frame
  // pause threshold while the deterministic clock is paused.
  await page.clock.fastForward(20);
}

async function advanceUntil(
  page: Page,
  predicate: () => Promise<boolean>,
  timeoutMs: number,
  label: string,
): Promise<void> {
  for (let elapsedMs = 0; elapsedMs < timeoutMs; elapsedMs += clockStepMs) {
    await runClock(page, Math.min(clockStepMs, timeoutMs - elapsedMs));
    if (await predicate()) return;
  }
  throw new Error(`${label} was not reached within ${timeoutMs} ms`);
}

async function boot(page: Page, url = "/"): Promise<void> {
  await page.goto(url);
  await expect(root(page)).toHaveAttribute("data-ready", "true");
  await expect(page.locator("[data-canvas-host] canvas")).toHaveCount(1);
  await expect(page.locator("[data-dialog=start]")).toBeVisible();
  if (deterministicClockPages.has(page)) {
    // Keep the fake clock stopped while WebGL startup and input setup spend
    // wall time. The game is still idle, so this pause cannot hide gameplay.
    await page.clock.pauseAt(new Date("2026-09-05T01:00:00.000Z"));
  }
}

async function startGame(page: Page, name = "テストプレイヤー"): Promise<void> {
  const nameInput = page.locator("#player-name");
  await nameInput.fill(name);
  await expect(page.locator("[data-action=start]")).toBeEnabled();
  await page.locator("[data-action=start]").click();
  await expect(root(page)).toHaveAttribute("data-phase", "playing");
  await expect(page.locator("[data-dialog=start]")).toBeHidden();
  await expect(page.locator(fireSelector)).toBeEnabled();
}

async function holdFire(page: Page, durationMs = 600): Promise<number> {
  const fire = page.locator(fireSelector);
  await fire.scrollIntoViewIfNeeded();
  const bounds = await fire.boundingBox();
  if (bounds === null) throw new Error("fire button has no layout box");
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await flushInputFrame(page);
  await expect(fire).toHaveAttribute("data-firing", "true");
  await runClock(page, durationMs);
  await page.mouse.up();
  await flushInputFrame(page);
  await expect(fire).toHaveAttribute("data-firing", "false");
  // Read the counter only after pointerup has released the firing source. A
  // frame can finish between a diagnostic read and the browser input event.
  return Number((await readRootDiagnostics(page)).fired ?? "0");
}

async function beginPointerFire(page: Page): Promise<void> {
  const fire = page.locator(fireSelector);
  await fire.scrollIntoViewIfNeeded();
  const bounds = await fire.boundingBox();
  if (bounds === null) throw new Error("fire button has no layout box");
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await flushInputFrame(page);
  await expect(fire).toHaveAttribute("data-firing", "true");
}

async function waitForPushReady(page: Page, timeoutMs = 60_000): Promise<void> {
  await advanceUntil(
    page,
    async () => (await readRootDiagnostics(page)).pushState === "ready",
    timeoutMs,
    "PUSH ready",
  );
  await expect(page.locator("[data-action=push]")).toBeEnabled();
  await expect(page.locator("[data-action=push]")).toHaveAttribute("data-push-state", "ready");
}

async function screenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await mkdir(resolve("test-results"), { recursive: true });
  await page.screenshot({
    path: resolve("test-results", `pachi-${testInfo.project.name}-${name}.png`),
    fullPage: false,
  });
}

function numericTime(text: string | null): number {
  const value = Number.parseInt(text ?? "", 10);
  if (!Number.isFinite(value)) throw new Error(`Could not parse game time: ${text ?? ""}`);
  return value;
}

test.describe("90秒パチンコ体験", () => {
  test.beforeEach(({ page }) => {
    const errors: string[] = [];
    pageErrors.set(page, errors);
    page.on("pageerror", (error) => errors.push(error.message));
  });

  test.afterEach(({ page }) => {
    expect(pageErrors.get(page) ?? []).toEqual([]);
  });

  test("boots, rejects an empty name, and starts from a display name", async ({ page }) => {
    await boot(page);

    const initial = await readRootDiagnostics(page);
    expect(initial).toMatchObject({
      ready: "true",
      phase: "idle",
      paused: "false",
      fired: "0",
      pushState: "hidden",
      startEntries: "0",
      jackpots: "0",
      attackerEntries: "0",
    });
    await expect(page.locator("[data-time]")).toHaveText("90秒");
    await expect(page.locator("[data-stock]")).toHaveText("80");

    const nameInput = page.locator("#player-name");
    await nameInput.fill("");
    await page.locator("[data-action=start]").click();
    expect(await nameInput.evaluate((element) => !(element as HTMLInputElement).checkValidity())).toBe(true);
    await expect(root(page)).toHaveAttribute("data-phase", "idle");
    await expect(page.locator("[data-dialog=start]")).toBeVisible();

    await startGame(page);
    await expect(page.locator("#power")).toBeEnabled();
    await expect(page.locator("[data-action=pause]")).toBeEnabled();
    await expect(page.locator("[data-action=finish]")).toBeEnabled();
    await expect(page.locator("[data-event]")).toContainText("強さを調整");
  });

  test("uses the three calibrated power presets and native step-1 arrows", async ({ page }) => {
    await boot(page);

    const power = page.locator("#power");
    const displayedPower = page.locator("[data-power-value]");
    await expect(power).toHaveAttribute("min", "0");
    await expect(power).toHaveAttribute("max", "2");
    await expect(power).toHaveAttribute("step", "1");
    await expect(power).toHaveValue("2");
    await expect(displayedPower).toHaveText("95");
    await expect(power).toHaveAttribute("aria-valuetext", "95");

    await startGame(page);
    for (const [index, actual] of [[0, "50"], [1, "80"], [2, "95"]] as const) {
      await power.fill(String(index));
      await expect(power).toHaveValue(String(index));
      await expect(displayedPower).toHaveText(actual);
      await expect(power).toHaveAttribute("aria-valuetext", actual);
    }

    await power.focus();
    await page.keyboard.press("ArrowLeft");
    await expect(power).toHaveValue("1");
    await expect(displayedPower).toHaveText("80");
    await expect(power).toHaveAttribute("aria-valuetext", "80");
    await page.keyboard.press("ArrowLeft");
    await expect(power).toHaveValue("0");
    await expect(displayedPower).toHaveText("50");
    await expect(power).toHaveAttribute("aria-valuetext", "50");
    await page.keyboard.press("ArrowRight");
    await expect(power).toHaveValue("1");
    await expect(displayedPower).toHaveText("80");

    // The global game shortcut also advances exactly one calibrated slot when
    // focus is on the fire control (the range input's native arrows are not
    // involved in this path).
    await page.locator(fireSelector).focus();
    await page.keyboard.press("ArrowLeft");
    await expect(power).toHaveValue("0");
    await expect(displayedPower).toHaveText("50");
    await page.keyboard.press("ArrowRight");
    await expect(power).toHaveValue("1");
    await expect(displayedPower).toHaveText("80");

    // A restart resets the session while applying the currently selected UI
    // preset, rather than silently restoring the session's internal default.
    await page.locator("[data-action=finish]").click();
    await expect(root(page)).toHaveAttribute("data-phase", "result");
    await page.locator("[data-action=restart]").click();
    await expect(root(page)).toHaveAttribute("data-phase", "playing");
    await expect(power).toHaveValue("1");
    await expect(displayedPower).toHaveText("80");
    await expect(power).toHaveAttribute("aria-valuetext", "80");
  });

  test("uses a real pointer hold to fire and stops immediately on pointerup", async ({ page }) => {
    await installDeterministicClock(page);
    await boot(page, "/?debug=1&seed=77");
    await startGame(page);

    const power = page.locator("#power");
    await power.fill("1");
    await expect(page.locator("[data-power-value]")).toHaveText("80");
    await expect(power).toHaveAttribute("aria-valuetext", "80");

    const firedWhileHeld = await holdFire(page);
    expect(firedWhileHeld).toBeGreaterThan(0);
    const released = await readRootDiagnostics(page);
    expect(released.fired).toBe(String(firedWhileHeld));
    expect(released.phase).toBe("playing");

    await runClock(page, 400);
    const afterRelease = await readRootDiagnostics(page);
    expect(afterRelease.fired).toBe(released.fired);
    await expect(page.locator(fireSelector)).toHaveAttribute("data-firing", "false");
  });

  test("routes Space keydown/up and releases a real pointer on cancel and lost capture", async ({ page }) => {
    await installDeterministicClock(page);
    await boot(page, "/?debug=1&seed=77");
    await startGame(page);

    const fire = page.locator(fireSelector);
    await page.keyboard.down("Space");
    await flushInputFrame(page);
    await expect(fire).toHaveAttribute("data-firing", "true");
    await runClock(page, 500);
    await page.keyboard.up("Space");
    await flushInputFrame(page);
    await expect(fire).toHaveAttribute("data-firing", "false");
    const firedBySpace = Number((await readRootDiagnostics(page)).fired ?? "0");
    expect(firedBySpace).toBeGreaterThan(0);
    await runClock(page, 400);
    expect((await readRootDiagnostics(page)).fired).toBe(String(firedBySpace));

    const bounds = await fire.boundingBox();
    if (bounds === null) throw new Error("fire button has no layout box");
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await flushInputFrame(page);
    await expect(fire).toHaveAttribute("data-firing", "true");
    // Mouse pointer IDs are stable at 1 for the real browser pointer used by
    // page.mouse. The down event above supplies the actual capture slot;
    // dispatching cancel exercises the production release boundary.
    await fire.dispatchEvent("pointercancel", { pointerId: 1, pointerType: "mouse" });
    await flushInputFrame(page);
    await expect(fire).toHaveAttribute("data-firing", "false");
    await page.mouse.up();

    await page.mouse.down();
    await flushInputFrame(page);
    await expect(fire).toHaveAttribute("data-firing", "true");
    await fire.dispatchEvent("lostpointercapture", { pointerId: 1, pointerType: "mouse" });
    await flushInputFrame(page);
    await expect(fire).toHaveAttribute("data-firing", "false");
    await page.mouse.up();
  });

  test("shows the seed-77 START to reach, BONUS, attacker, RUSH judge, and final result path", async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    await installDeterministicClock(page);
    await page.setViewportSize({ width: 402, height: 874 });
    await boot(page, "/?debug=1&seed=77");
    await startGame(page);

    const fire = page.locator(fireSelector);
    await fire.scrollIntoViewIfNeeded();
    const bounds = await fire.boundingBox();
    if (bounds === null) throw new Error("fire button has no layout box");
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down();

    let sawStart = false;
    let sawReach = false;
    let sawBonus = false;
    let sawAttacker = false;
    let sawJudge = false;
    let sawPushReady = false;
    let sawPushAutoFallback = false;
    // Observe the real sequence. A naturally losing reach is allowed before
    // the first jackpot; it must not be mistaken for a promised win.
    for (let elapsed = 0; elapsed < 60_000; elapsed += clockStepMs) {
      await runClock(page, clockStepMs);
      const visible = await root(page).evaluate((element) => ({
        starts: Number(element.getAttribute("data-start-entries")),
        jackpots: Number(element.getAttribute("data-jackpots")),
        attackers: Number(element.getAttribute("data-attacker-entries")),
        spin: element.getAttribute("data-spin-stage"),
        rush: element.getAttribute("data-rush-stage"),
        push: element.getAttribute("data-push-state"),
      }));
      sawStart ||= visible.starts > 0;
      sawReach ||= visible.spin === "reach";
      sawPushReady ||= visible.spin === "reach" && visible.push === "ready";
      sawPushAutoFallback ||= sawPushReady && visible.push === "hidden";
      sawAttacker ||= visible.attackers > 0;
      if (!sawBonus && visible.jackpots > 0 && visible.rush === "open") {
        sawBonus = true;
        await expect(page.locator("[data-mode]")).toHaveText(/RUSH [1-3] \/ 3/);
        await expect(page.locator("[data-spin-detail]")).toContainText("得点口");
        await screenshot(page, testInfo, "bonus");
      }
      if (!sawJudge && visible.rush === "judge") {
        sawJudge = true;
        await expect(page.locator("[data-spin-title]")).toHaveText(/^(?:RUSH 継続！|RUSH 終了|継続判定 [1-3] \/ 3)$/);
        await screenshot(page, testInfo, "judge");
      }
      if (sawStart && sawReach && sawBonus && sawAttacker && sawJudge && sawPushAutoFallback) break;
    }
    expect({ sawStart, sawReach, sawBonus, sawAttacker, sawJudge, sawPushReady, sawPushAutoFallback }).toEqual({
      sawStart: true, sawReach: true, sawBonus: true, sawAttacker: true, sawJudge: true,
      sawPushReady: true, sawPushAutoFallback: true,
    });

    await page.mouse.up();
    await flushInputFrame(page);
    await expect(fire).toHaveAttribute("data-firing", "false");
    await page.locator("[data-action=finish]").click();
    await advanceUntil(page, async () => (await readRootDiagnostics(page)).phase === "result", 30_000, "final result");
    await expect(root(page)).toHaveAttribute("data-phase", "result");
    await expect(page.locator("[data-dialog=result]")).toBeVisible();
    const final = await readRootDiagnostics(page);
    expect(Number(final.startEntries ?? "0")).toBeGreaterThan(0);
    expect(Number(final.jackpots ?? "0")).toBeGreaterThan(0);
    expect(Number(final.attackerEntries ?? "0")).toBeGreaterThan(0);
  });

  test("accepts PUSH through real pointer and native keyboard activation without firing", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 402, height: 874 });
    const keyboardPage = await page.context().newPage();
    const keyboardErrors: string[] = [];
    pageErrors.set(keyboardPage, keyboardErrors);
    keyboardPage.on("pageerror", (error) => keyboardErrors.push(error.message));
    await keyboardPage.setViewportSize({ width: 402, height: 874 });

    try {
      await installDeterministicClock(page);
      await installDeterministicClock(keyboardPage);
      const url = "/?debug=1&seed=77";
      await Promise.all([boot(page, url), boot(keyboardPage, url)]);
      await Promise.all([startGame(page), startGame(keyboardPage)]);

      const pointerPush = page.locator("[data-action=push]");
      const keyboardPush = keyboardPage.locator("[data-action=push]");
      await expect(pointerPush).toBeDisabled();
      await expect(pointerPush).toHaveAttribute("data-push-state", "hidden");
      await expect(keyboardPush).toBeDisabled();
      await expect(keyboardPush).toHaveAttribute("data-push-state", "hidden");

      await beginPointerFire(page);
      await beginPointerFire(keyboardPage);
      await expect(keyboardPage.locator(fireSelector)).toHaveAttribute("data-firing", "true");
      await Promise.all([waitForPushReady(page), waitForPushReady(keyboardPage)]);

      // Release the first pointer before its actual pointer click. The second
      // page keeps its pointer held so Space must not steal that firing source.
      await page.mouse.up();
      await flushInputFrame(page);
      await expect(page.locator(fireSelector)).toHaveAttribute("data-firing", "false");

      // The reach window remains actionable across a real pause, while its
      // timer and pushState stay fixed under the bounded fake-clock steps.
      const readyTime = await page.locator("[data-time]").textContent();
      await page.locator("[data-action=pause]").click();
      await expect(root(page)).toHaveAttribute("data-paused", "true");
      await expect(page.locator("[data-action=push]")).toBeDisabled();
      await expect(page.locator("[data-action=push]")).toHaveAttribute("data-push-state", "ready");
      const paused = await readRootDiagnostics(page);
      await runClock(page, 1_000);
      expect(await readRootDiagnostics(page)).toMatchObject({
        paused: "true",
        pushState: "ready",
        fired: paused.fired,
        jackpots: paused.jackpots,
      });
      expect(await page.locator("[data-time]").textContent()).toBe(readyTime);
      await page.locator("[data-action=resume]").click();
      await expect(root(page)).toHaveAttribute("data-paused", "false");
      await expect(pointerPush).toBeEnabled();

      const pointerBefore = await readRootDiagnostics(page);
      const pointerScoreBefore = await page.locator("[data-score]").textContent();
      await pointerPush.click();
      const pointerAccepted = await readRootDiagnostics(page);
      expect(pointerAccepted).toMatchObject({
        pushState: "accepted",
        spinStage: "reach",
        fired: pointerBefore.fired,
        jackpots: pointerBefore.jackpots,
      });
      await expect(pointerPush).toBeDisabled();
      await expect(pointerPush).toHaveAttribute("data-push-state", "accepted");
      expect(await page.locator("[data-score]").textContent()).toBe(pointerScoreBefore);
      await flushInputFrame(page);
      await expect(pointerPush).toHaveAttribute("data-push-state", "accepted");
      await screenshot(page, testInfo, "402x874-push-accepted");

      // A disabled native button must stay inert under a real repeated click.
      const pointerBounds = await pointerPush.boundingBox();
      if (pointerBounds === null) throw new Error("PUSH button has no layout box");
      await page.mouse.click(pointerBounds.x + pointerBounds.width / 2, pointerBounds.y + pointerBounds.height / 2);
      await flushInputFrame(page);
      expect(await readRootDiagnostics(page)).toMatchObject({
        pushState: "accepted",
      });
      await page.keyboard.press("Enter");
      await flushInputFrame(page);
      expect(await readRootDiagnostics(page)).toMatchObject({
        pushState: "accepted",
      });

      // Space activates the native PUSH control while the original pointer is
      // still held. No global firing source may be added or removed.
      const keyboardBefore = await readRootDiagnostics(keyboardPage);
      await keyboardPush.focus();
      await keyboardPage.keyboard.press("Space");
      const keyboardAccepted = await readRootDiagnostics(keyboardPage);
      expect(keyboardAccepted).toMatchObject({
        pushState: "accepted",
        spinStage: "reach",
        fired: keyboardBefore.fired,
        jackpots: keyboardBefore.jackpots,
      });
      await flushInputFrame(keyboardPage);
      await expect(keyboardPage.locator(fireSelector)).toHaveAttribute("data-firing", "true");
      await expect(keyboardPush).toBeDisabled();
      await expect(keyboardPush).toHaveAttribute("data-push-state", "accepted");
      await keyboardPage.mouse.up();
      await flushInputFrame(keyboardPage);
      await expect(keyboardPage.locator(fireSelector)).toHaveAttribute("data-firing", "false");
      expect(await readRootDiagnostics(keyboardPage)).toMatchObject({
        pushState: "accepted",
      });
      await expect(keyboardPage.locator(fireSelector)).toHaveAttribute("data-firing", "false");
    } finally {
      expect(keyboardErrors).toEqual([]);
      if (!keyboardPage.isClosed()) await keyboardPage.close();
    }
  });

  test("accepts a ready PUSH with Enter and releases Space after focus moves", async ({ page }) => {
    test.setTimeout(60_000);
    await installDeterministicClock(page);
    await page.setViewportSize({ width: 402, height: 874 });
    await boot(page, "/?debug=1&seed=77");
    await startGame(page);

    await beginPointerFire(page);
    await waitForPushReady(page);
    await page.mouse.up();
    await flushInputFrame(page);
    await expect(page.locator(fireSelector)).toHaveAttribute("data-firing", "false");

    const fire = page.locator(fireSelector);
    const push = page.locator("[data-action=push]");
    await fire.focus();
    await page.keyboard.down("Space");
    await flushInputFrame(page);
    await expect(fire).toHaveAttribute("data-firing", "true");
    await page.keyboard.press("Tab");
    await expect(push).toBeFocused();
    await page.keyboard.up("Space");
    await flushInputFrame(page);
    await expect(fire).toHaveAttribute("data-firing", "false");
    await expect(push).toBeEnabled();
    await expect(push).toHaveAttribute("data-push-state", "ready");

    const before = await readRootDiagnostics(page);
    await page.keyboard.press("Enter");
    const accepted = await readRootDiagnostics(page);
    expect(accepted).toMatchObject({
      pushState: "accepted",
      spinStage: "reach",
      fired: before.fired,
      jackpots: before.jackpots,
    });
    await expect(push).toBeDisabled();
    await expect(push).toHaveAttribute("data-push-state", "accepted");
    await flushInputFrame(page);
    await expect(fire).toHaveAttribute("data-firing", "false");
  });

  test("stops all play on a tab interruption and resumes from the pause dialog", async ({ page }) => {
    await installDeterministicClock(page);
    await boot(page, "/?debug=1&seed=77");
    await startGame(page);

    const fire = page.locator(fireSelector);
    await fire.scrollIntoViewIfNeeded();
    const bounds = await fire.boundingBox();
    if (bounds === null) throw new Error("fire button has no layout box");
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await runClock(page, 300);
    expect(Number((await readRootDiagnostics(page)).fired ?? "0")).toBeGreaterThan(0);

    // This is the browser lifecycle signal used by the app when a tab loses
    // focus. It exercises the public event boundary instead of changing state.
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await expect(root(page)).toHaveAttribute("data-paused", "true");
    await expect(page.locator("[data-dialog=pause]")).toBeVisible();
    await expect(fire).toBeDisabled();
    await expect(fire).toHaveAttribute("data-firing", "false");
    const pausedBaseline = await readRootDiagnostics(page);
    const timePaused = numericTime(await page.locator("[data-time]").textContent());

    await runClock(page, 700);
    const whilePaused = await readRootDiagnostics(page);
    expect(whilePaused.fired).toBe(pausedBaseline.fired);
    expect(numericTime(await page.locator("[data-time]").textContent())).toBe(timePaused);
    await page.mouse.up();

    await page.locator("[data-action=resume]").click();
    await expect(root(page)).toHaveAttribute("data-paused", "false");
    await expect(page.locator("[data-dialog=pause]")).toBeHidden();
    await expect(page.locator("#power")).toBeEnabled();
    await runClock(page, 1_200);
    expect(numericTime(await page.locator("[data-time]").textContent())).toBeLessThan(timePaused);
  });

  test("finishes reliably and restarts with a fresh zeroed session", async ({ page }) => {
    await boot(page, "/?debug=1&seed=77");
    await startGame(page);

    await page.locator("[data-action=finish]").click();
    await expect(root(page)).toHaveAttribute("data-phase", "result");
    await expect(page.locator("[data-dialog=result]")).toBeVisible();
    await expect(page.locator("[data-result-player]")).toHaveText("テストプレイヤーさん");
    await expect(page.locator("[data-result-score]")).toHaveText("0");

    await page.locator("[data-action=restart]").click();
    await expect(root(page)).toHaveAttribute("data-phase", "playing");
    await expect(page.locator("[data-dialog=result]")).toBeHidden();
    await expect(page.locator("[data-score]")).toHaveText("0");
    await expect(page.locator("[data-stock]")).toHaveText("80");
    expect(await readRootDiagnostics(page)).toMatchObject({
      fired: "0",
      startEntries: "0",
      jackpots: "0",
      attackerEntries: "0",
    });
  });

  test("fits every required viewport, keeps controls tappable, and records visual artifacts", async ({ page }, testInfo) => {
    test.setTimeout(120_000);

    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await boot(page, "/?debug=1&seed=77");
      if (viewport.name === "402x874") await screenshot(page, testInfo, "402x874-before");

      await startGame(page);
      if (viewport.name === "402x874") await screenshot(page, testInfo, "402x874-after");
      if (viewport.name !== "402x874") await screenshot(page, testInfo, viewport.name);

      const layout = await page.evaluate(() => {
        const visibleButtons = [...document.querySelectorAll("button")]
          .map((button) => {
            const rect = button.getBoundingClientRect();
            return { width: rect.width, height: rect.height, visible: rect.width > 0 && rect.height > 0 };
          })
          .filter((button) => button.visible);
        const canvas = document.querySelector("[data-canvas-host]")?.getBoundingClientRect();
        const reel = document.querySelector<HTMLElement>("[data-reel-display]");
        const push = document.querySelector<HTMLButtonElement>("[data-action=push]")?.getBoundingClientRect();
        return {
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
          canvas: canvas === undefined ? null : { left: canvas.left, right: canvas.right, top: canvas.top, bottom: canvas.bottom },
          lcd: reel === null ? null : { clientHeight: reel.clientHeight, scrollHeight: reel.scrollHeight },
          push: push === undefined ? null : { width: push.width, height: push.height },
          visibleButtons,
        };
      });

      expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
      expect(layout.canvas).not.toBeNull();
      expect(layout.canvas?.left ?? -1).toBeGreaterThanOrEqual(0);
      expect(layout.canvas?.right ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(layout.clientWidth);
      expect(layout.lcd).not.toBeNull();
      expect(layout.lcd?.scrollHeight ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(layout.lcd?.clientHeight ?? -1);
      expect(layout.push).not.toBeNull();
      expect(layout.push?.width ?? 0).toBeGreaterThanOrEqual(44);
      expect(layout.push?.height ?? 0).toBeGreaterThanOrEqual(44);
      for (const button of layout.visibleButtons) {
        expect(button.width).toBeGreaterThanOrEqual(44);
        expect(button.height).toBeGreaterThanOrEqual(44);
      }
    }
  });

  test("toggles sound and honors reduced-motion preferences", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => {
      class TestAudioContext {
        public state: AudioContextState = "suspended";
        public currentTime = 0;
        public readonly destination = {};

        public resume(): Promise<void> {
          this.state = "running";
          return Promise.resolve();
        }

        public close(): Promise<void> {
          this.state = "closed";
          return Promise.resolve();
        }
      }
      Object.defineProperty(window, "AudioContext", { configurable: true, value: TestAudioContext });
    });
    await boot(page);
    await startGame(page);

    const sound = page.locator("[data-action=sound]");
    await expect(sound).toHaveAttribute("aria-pressed", "false");
    await sound.click();
    await expect(sound).toHaveText("音 ON");
    await expect(sound).toHaveAttribute("aria-pressed", "true");
    await sound.click();
    await expect(sound).toHaveText("音 OFF");
    await expect(sound).toHaveAttribute("aria-pressed", "false");

    await page.locator("[data-action=help]").click();
    await expect(page.locator("[data-dialog=help]")).toBeVisible();
    const reduced = page.locator("[data-reduced-motion]");
    await expect(reduced).toBeChecked();
    await reduced.uncheck();
    await expect.poll(() => page.evaluate(() => localStorage.getItem("doppan:pachi:reduced-motion"))).toBe("false");
    await reduced.check();
    await expect.poll(() => page.evaluate(() => localStorage.getItem("doppan:pachi:reduced-motion"))).toBe("true");
  });

  test("renders historical ranking values as text and never submits a new score", async ({ page }) => {
    const rankingUrl = "https://mlpnjgezrnhdxsxolyzj.supabase.co/rest/v1/rpc/get_best_score_ranking";
    const rankingRequests: { method: string; body: string | null; url: string }[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/rest/v1/")) {
        rankingRequests.push({ method: request.method(), body: request.postData(), url: request.url() });
      }
    });
    const corsHeaders = {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "apikey, content-type",
    };
    await page.route(rankingUrl, async (route) => {
      if (route.request().method() !== "POST") {
        await route.fulfill({ status: 204, headers: corsHeaders });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: corsHeaders,
        body: JSON.stringify([
          { display_name: '<img>x</img>\u0001', best_score: 1234, is_active: false },
          { display_name: "壊れた点数", best_score: "not-a-number" },
        ]),
      });
    });

    await boot(page);
    await startGame(page);
    await page.locator("[data-action=finish]").click();
    await expect(page.locator("[data-dialog=result]")).toBeVisible();

    await page.locator(".ranking-details summary").click();
    const rankingList = page.locator("[data-ranking-list]");
    await expect(rankingList.locator("li")).toHaveCount(1);
    await expect(rankingList.locator("li").first()).toHaveText('<img>x</img>：1,234点');
    await expect(rankingList.locator("img")).toHaveCount(0);
    await expect(page.locator("[data-ranking-status]")).toContainText("旧3球ルール");

    const postRequests = rankingRequests.filter((request) => request.url.includes("get_best_score_ranking"));
    expect(postRequests).toHaveLength(1);
    expect(postRequests[0]?.method).toBe("POST");
    expect(JSON.parse(postRequests[0]?.body ?? "{}")).toEqual({ p_game_slug: "doppan", p_limit: 10 });
    expect(rankingRequests.every((request) => request.url.includes("get_best_score_ranking"))).toBe(true);
  });

  test("shows a meaningful recovery surface when WebGL is disabled", async ({ page }) => {
    await page.goto("/?webgl=off");
    await expect(page.locator('[role="alert"][data-error]')).toBeVisible();
    await expect(page.locator("[data-error-text]")).toHaveText("盤面を表示できませんでした。読み込み直してください。");
    await expect(page.locator("[data-canvas-host] canvas")).toHaveCount(0);
    await expect(root(page)).toHaveAttribute("data-error", "true");
    await expect(root(page)).not.toHaveAttribute("data-ready", "true");
    await expect(page.locator("[data-action=reload]")).toBeEnabled();
    await expect(page.locator(fireSelector)).toBeDisabled();
    await expect(page.locator("[data-action=start]")).toBeDisabled();
  });
});
