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
  readonly rushStage: string | undefined;
  readonly rushRound: string | undefined;
  readonly focusTarget: string | undefined;
  readonly presentationStage: string | undefined;
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
    rushStage: element.getAttribute("data-rush-stage") ?? undefined,
    rushRound: element.getAttribute("data-rush-round") ?? undefined,
    focusTarget: element.getAttribute("data-focus-target") ?? undefined,
    presentationStage: element.getAttribute("data-presentation-stage") ?? undefined,
    startEntries: element.getAttribute("data-start-entries") ?? undefined,
    jackpots: element.getAttribute("data-jackpots") ?? undefined,
    attackerEntries: element.getAttribute("data-attacker-entries") ?? undefined,
  }));
}

async function readMouthLayout(page: Page) {
  return page.evaluate(() => [...document.querySelectorAll<HTMLElement>("[data-mouth-label]")].map((label) => {
    const rect = label.getBoundingClientRect();
    return {
      name: label.dataset.mouthLabel ?? "",
      text: label.textContent?.trim() ?? "",
      scrollWidth: label.scrollWidth,
      clientWidth: label.clientWidth,
      left: rect.left,
      right: rect.right,
    };
  }));
}

async function expectMouthLayoutInViewport(page: Page): Promise<void> {
  const layout = await readMouthLayout(page);
  expect(layout).toHaveLength(2);
  for (const label of layout) {
    expect(label.text).not.toBe("");
    expect(label.scrollWidth).toBeLessThanOrEqual(label.clientWidth);
    expect(label.left).toBeGreaterThanOrEqual(0);
    expect(label.right).toBeLessThanOrEqual(await page.evaluate(() => document.documentElement.clientWidth));
  }
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

    // The initial play state points at the ordinary START reward. The mouth
    // labels are part of the public guidance contract, so keep them in the
    // browser check alongside the root diagnostics.
    await expect(root(page)).toHaveAttribute("data-focus-target", "start");
    await expect(root(page)).toHaveAttribute("data-presentation-stage", "normal");
    await expect(page.locator("[data-mouth-label=start]")).toHaveText(/^START \+50点 \/ \+3玉$/);
    await expect(page.locator("[data-mouth-label=start]")).toHaveAttribute("data-pocket-state", "available");
    await expect(page.locator("[data-mouth-label=attacker]")).toHaveText("得点口 CLOSED");
    await expect(page.locator("[data-mouth-label=attacker]")).toHaveAttribute("data-pocket-state", "closed");
    await expectMouthLayoutInViewport(page);
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

  test("keeps each seeded miss reveal readable through incidental events and pause", async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 402, height: 874 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await installDeterministicClock(page);
    await boot(page, "/?debug=1&seed=3");
    await startGame(page);

    // Seed 3 at the calibrated 80% preset produces five actual misses before
    // the guaranteed ticket. Keep a real pointer hold active for the whole
    // sequence so every entry, spin, and incidental pocket event is natural.
    const power = page.locator("#power");
    await power.fill("1");
    await expect(power).toHaveAttribute("aria-valuetext", "80");
    await beginPointerFire(page);

    const resizeForMissEvidence = async (): Promise<void> => {
      await page.setViewportSize({ width: 320, height: 568 });
      // Let ResizeObserver and the renderer consume the resize while the
      // reveal still has more than 500 ms remaining. Keep this bounded.
      await page.clock.fastForward(20);
      const layout = await page.locator(".play-area").evaluate((playArea) => {
        const playBounds = playArea.getBoundingClientRect();
        const machine = playArea.querySelector<HTMLElement>("[data-machine]");
        if (machine === null) throw new Error("machine is missing from play area");
        const machineBounds = machine.getBoundingClientRect();
        return {
          play: { left: playBounds.left, right: playBounds.right, top: playBounds.top, bottom: playBounds.bottom },
          machine: {
            left: machineBounds.left,
            right: machineBounds.right,
            top: machineBounds.top,
            bottom: machineBounds.bottom,
            width: machineBounds.width,
            height: machineBounds.height,
          },
        };
      });
      const tolerance = 1;
      expect(layout.machine.left).toBeGreaterThanOrEqual(layout.play.left - tolerance);
      expect(layout.machine.right).toBeLessThanOrEqual(layout.play.right + tolerance);
      expect(layout.machine.top).toBeGreaterThanOrEqual(layout.play.top - tolerance);
      expect(layout.machine.bottom).toBeLessThanOrEqual(layout.play.bottom + tolerance);
      expect(Math.abs(layout.machine.width / layout.machine.height - 4 / 5)).toBeLessThanOrEqual(0.01);
      expect(await readRootDiagnostics(page)).toMatchObject({
        spinStage: "reveal",
        focusTarget: "none",
        presentationStage: "reveal",
      });
    };

    const missReveal = async (charge: number): Promise<void> => {
      await advanceUntil(
        page,
        async () => {
          const visible = await readRootDiagnostics(page);
          return visible.spinStage === "reveal" && await page.locator("[data-spin-title]").textContent() === "はずれ";
        },
        30_000,
        `seed-3 miss reveal ${charge}`,
      );

      const visible = await readRootDiagnostics(page);
      expect(visible).toMatchObject({
        spinStage: "reveal",
        focusTarget: "none",
        presentationStage: "reveal",
      });
      await expect(page.locator("[data-spin-title]")).toHaveText("はずれ");
      await expect(page.locator("[data-reel]")).toHaveCount(3);
      for (const reel of await page.locator("[data-reel]").all()) {
        await expect(reel).toHaveAttribute("data-spinning", "false");
      }
      await expect(page.locator("[data-charge]")).toHaveAttribute("value", String(charge));
      if (charge === 5) {
        // The compact HUD label may say only "次は大当たり"; the progress
        // element and event line above still expose the exact 5 / 5 state.
        await expect(page.locator("[data-charge-label]")).toContainText("次は大当たり");
        await expect(page.locator("[data-spin-detail]")).toHaveText("次は大当たり");
      } else {
        await expect(page.locator("[data-charge-label]")).toHaveText(`チャージ ${charge} / 5`);
        await expect(page.locator("[data-spin-detail]")).toHaveText(`チャージ ${charge} / 5`);
      }
      const expectedEvent = charge === 5
        ? "はずれ。チャージ 5 / 5 · 次は大当たり。"
        : `はずれ。チャージ ${charge} / 5。`;
      await expect(page.locator("[data-event]")).toHaveText(expectedEvent);
    };

    await missReveal(1);
    await screenshot(page, testInfo, "402x874-miss");
    await resizeForMissEvidence();
    await expectMouthLayoutInViewport(page);
    await screenshot(page, testInfo, "320x568-miss");
    await page.setViewportSize({ width: 402, height: 874 });
    await page.clock.fastForward(20);

    // The held pointer keeps firing while the first reveal is displayed. The
    // 200 ms step includes continued real firing and incidental activity;
    // the miss announcement and reveal focus must survive that activity.
    const firstEvent = await page.locator("[data-event]").textContent();
    const firstBefore = await readRootDiagnostics(page);
    await runClock(page, clockStepMs);
    const firstAfter = await readRootDiagnostics(page);
    expect(Number(firstAfter.fired ?? "0")).toBeGreaterThan(Number(firstBefore.fired ?? "0"));
    await expect(page.locator("[data-event]")).toHaveText(firstEvent ?? "");
    expect(firstAfter).toMatchObject({
      spinStage: "reveal",
      focusTarget: "none",
      presentationStage: "reveal",
    });

    for (const charge of [2, 3, 4] as const) {
      await advanceUntil(
        page,
        async () => (await readRootDiagnostics(page)).spinStage !== "reveal",
        2_000,
        `seed-3 next stage after charge ${charge - 1}`,
      );
      await missReveal(charge);
    }

    await advanceUntil(
      page,
      async () => (await readRootDiagnostics(page)).spinStage !== "reveal",
      2_000,
      "seed-3 next stage after charge 4",
    );
    await missReveal(5);
    await resizeForMissEvidence();
    await expectMouthLayoutInViewport(page);
    const fifthLcdLayout = await page.locator("[data-reel-display]").evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const detail = element.querySelector<HTMLElement>("[data-spin-detail]");
      const detailBounds = detail?.getBoundingClientRect();
      return {
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        detailClientWidth: detail?.clientWidth ?? 0,
        detailScrollWidth: detail?.scrollWidth ?? 0,
        bounds: { left: bounds.left, right: bounds.right },
        detailBounds: detailBounds === undefined ? null : { left: detailBounds.left, right: detailBounds.right },
      };
    });
    expect(fifthLcdLayout.scrollWidth).toBeLessThanOrEqual(fifthLcdLayout.clientWidth);
    expect(fifthLcdLayout.detailScrollWidth).toBeLessThanOrEqual(fifthLcdLayout.detailClientWidth);
    expect(fifthLcdLayout.detailBounds?.left ?? Number.NEGATIVE_INFINITY).toBeGreaterThanOrEqual(fifthLcdLayout.bounds.left);
    expect(fifthLcdLayout.detailBounds?.right ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(fifthLcdLayout.bounds.right);
    await screenshot(page, testInfo, "320x568-fifth-charge");
    await page.setViewportSize({ width: 402, height: 874 });
    await page.clock.fastForward(20);

    // Release the captured FIRE pointer before clicking PAUSE. A captured
    // pointer can retarget the pause click to the firing control.
    await page.mouse.up();
    await flushInputFrame(page);
    await expect(page.locator(fireSelector)).toHaveAttribute("data-firing", "false");
    const pausedText = await page.locator("[data-event]").textContent();
    const pausedBefore = await readRootDiagnostics(page);
    const pausedReels = await page.locator("[data-reel]").evaluateAll((reels) => reels.map((reel) => ({
      text: reel.textContent,
      spinning: reel.getAttribute("data-spinning"),
    })));
    await page.locator("[data-action=pause]").click();
    await expect(root(page)).toHaveAttribute("data-paused", "true");
    await runClock(page, 1_000);
    expect(await readRootDiagnostics(page)).toMatchObject({
      paused: "true",
      spinStage: "reveal",
      focusTarget: "none",
      presentationStage: "reveal",
      fired: pausedBefore.fired,
    });
    await expect(page.locator("[data-event]")).toHaveText(pausedText ?? "");
    expect(await page.locator("[data-reel]").evaluateAll((reels) => reels.map((reel) => ({
      text: reel.textContent,
      spinning: reel.getAttribute("data-spinning"),
    })))).toEqual(pausedReels);

    await page.locator("[data-action=resume]").click();
    await expect(root(page)).toHaveAttribute("data-paused", "false");
    await advanceUntil(
      page,
      async () => (await readRootDiagnostics(page)).spinStage !== "reveal",
      2_000,
      "seed-3 stage release after resume",
    );
    const released = await readRootDiagnostics(page);
    expect(released).toMatchObject({
      spinStage: "spinning",
      focusTarget: "start",
      presentationStage: "spinning",
    });
    await expect(page.locator("[data-event]")).not.toContainText("はずれ");
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
    let sawReachGuidance = false;
    let sawAttackerReward = false;
    let sawFullStartLabel = false;
    let sawJudgeTransition = false;
    let judgeSamples = 0;
    let previousRushStage = "idle";
    let previousAttackerEntries = 0;
    let bonusAnnouncement: "jackpot" | "attacker" | "continue" = "jackpot";
    // Observe the real sequence. A naturally losing reach is allowed before
    // the first jackpot; it must not be mistaken for a promised win.
    for (let elapsed = 0; elapsed < 60_000; elapsed += clockStepMs) {
      await runClock(page, clockStepMs);
      const visible = await readRootDiagnostics(page);
      const starts = Number(visible.startEntries ?? "0");
      const jackpots = Number(visible.jackpots ?? "0");
      const attackers = Number(visible.attackerEntries ?? "0");
      const pending = Number.parseInt((await page.locator("[data-pending-count]").textContent() ?? "0"), 10);
      const eventLine = await page.locator("[data-event]").textContent() ?? "";
      const startLabel = await page.locator("[data-mouth-label=start]").textContent() ?? "";
      const attackerLabel = await page.locator("[data-mouth-label=attacker]").textContent() ?? "";
      const startState = await page.locator("[data-mouth-label=start]").getAttribute("data-pocket-state");
      const attackerState = await page.locator("[data-mouth-label=attacker]").getAttribute("data-pocket-state");

      sawStart ||= starts > 0;
      sawReach ||= visible.spinStage === "reach";
      sawPushReady ||= visible.spinStage === "reach" && visible.pushState === "ready";
      sawPushAutoFallback ||= sawPushReady && visible.pushState === "hidden";
      sawAttacker ||= attackers > 0;

      if (pending >= 4 && visible.phase === "playing") {
        expect(startLabel.trim()).toBe("START 保留満タン");
        expect(startState).toBe("full");
        sawFullStartLabel = true;
      } else if (visible.phase === "settling") {
        expect(startLabel.trim()).toBe("START 精算中");
        expect(startState).toBe("settling");
      } else if (visible.focusTarget === "start") {
        expect(startLabel.trim()).toBe("START +50点 / +3玉");
        expect(startState).toBe("available");
      }
      if (visible.focusTarget === "attacker") {
        expect(attackerLabel.trim()).toBe("OPEN +100点 / +5玉");
        expect(attackerState).toBe("open");
      } else if (visible.phase === "settling") {
        expect(attackerLabel.trim()).toBe("得点口 精算中");
        expect(attackerState).toBe("settling");
      } else if (visible.rushStage !== "open") {
        expect(attackerLabel.trim()).toBe("得点口 CLOSED");
        expect(attackerState).toBe("closed");
      }

      if (visible.spinStage === "reach") {
        expect(visible.presentationStage).toBe("reach");
        expect(eventLine).toMatch(/リーチ|PUSH/);
        sawReachGuidance = true;
      }

      // Apply a judge transition before evaluating the new open interval. A
      // continuation and an attacker payout can be emitted in the same fixed
      // frame; the open branch below then accepts whichever is latest.
      if (previousRushStage === "judge" && visible.rushStage !== "judge") {
        sawJudgeTransition = true;
        if (visible.rushStage === "open") {
          bonusAnnouncement = "continue";
        } else {
          expect(visible.rushStage).toBe("idle");
          expect(eventLine).toMatch(/(?:RUSH|ラッシュ)終了/);
        }
      }

      if (!sawBonus && jackpots > 0 && visible.rushStage === "open") {
        sawBonus = true;
        expect(visible.focusTarget).toBe("attacker");
        expect(visible.presentationStage).toBe("jackpot");
        expect(attackerLabel.trim()).toBe("OPEN +100点 / +5玉");
        expect(eventLine).toMatch(/大当たり|得点口/);
        await expect(page.locator("[data-mode]")).toHaveText(/RUSH [1-3] \/ 3/);
        await expect(page.locator("[data-spin-detail]")).toContainText("得点口");
        await screenshot(page, testInfo, "bonus");
        await page.setViewportSize({ width: 320, height: 568 });
        await expectMouthLayoutInViewport(page);
        await screenshot(page, testInfo, "320x568-bonus");
        await page.setViewportSize({ width: 402, height: 874 });
      }
      if (visible.rushStage === "open") {
        if (attackers > previousAttackerEntries) {
          // A continuation and attacker payout may share one fixed frame;
          // either is the newest permitted BONUS announcement for that frame.
          expect(eventLine).toMatch(/得点口.*(?:100|＋100).*(?:5玉|5)|(?:RUSH|ラッシュ)継続/);
          sawAttackerReward = true;
          bonusAnnouncement = /得点口.*(?:100|＋100).*(?:5玉|5)/.test(eventLine) ? "attacker" : "continue";
        } else if (bonusAnnouncement === "attacker") {
          // START, side, drain, and reclaim notifications must not hide the
          // actionable attacker payout while BONUS remains open.
          expect(eventLine).toMatch(/得点口.*(?:100|＋100).*(?:5玉|5)/);
        } else if (bonusAnnouncement === "continue") {
          expect(eventLine).toMatch(/(?:RUSH|ラッシュ)継続/);
        } else {
          expect(eventLine).toMatch(/大当たり|得点口/);
        }
      }

      if (!sawJudge && visible.rushStage === "judge") {
        sawJudge = true;
        await expect(page.locator("[data-spin-title]")).toHaveText(/^継続判定 [1-3] \/ 3$/);
        expect(visible.presentationStage).toBe("judge");
        expect(attackerLabel.trim()).toBe("得点口 CLOSED");
        expect(eventLine).toMatch(/継続判定/);
        await screenshot(page, testInfo, "judge");
        await page.setViewportSize({ width: 320, height: 568 });
        await expectMouthLayoutInViewport(page);
        await screenshot(page, testInfo, "320x568-judge");
        await page.setViewportSize({ width: 402, height: 874 });
      }
      if (visible.rushStage === "judge") {
        // The fixed one-second decision must remain neutral until the actual
        // continuation/end event. Sampling every 200 ms catches premature
        // exposure of the pre-decided rushResult in the DOM.
        await expect(page.locator("[data-spin-title]")).toHaveText(/^継続判定 [1-3] \/ 3$/);
        expect(eventLine).toMatch(/継続判定/);
        judgeSamples += 1;
      }
      previousRushStage = visible.rushStage ?? "idle";
      previousAttackerEntries = attackers;
      if (sawStart && sawReach && sawBonus && sawAttacker && sawJudge && sawPushAutoFallback && sawJudgeTransition) break;
    }
    expect({ sawStart, sawReach, sawBonus, sawAttacker, sawJudge, sawPushReady, sawPushAutoFallback, sawReachGuidance, sawAttackerReward, sawFullStartLabel, sawJudgeTransition }).toEqual({
      sawStart: true, sawReach: true, sawBonus: true, sawAttacker: true, sawJudge: true,
      sawPushReady: true, sawPushAutoFallback: true, sawReachGuidance: true,
      sawAttackerReward: true, sawFullStartLabel: true, sawJudgeTransition: true,
    });
    expect(judgeSamples).toBeGreaterThanOrEqual(3);

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

  test("accepts PUSH through a real pointer with pause and disabled safety", async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 402, height: 874 });
    await installDeterministicClock(page);
    await boot(page, "/?debug=1&seed=77");
    await startGame(page);

    const pointerPush = page.locator("[data-action=push]");
    await expect(pointerPush).toBeDisabled();
    await expect(pointerPush).toHaveAttribute("data-push-state", "hidden");
    await beginPointerFire(page);
    await waitForPushReady(page);

    await page.mouse.up();
    await flushInputFrame(page);
    await expect(page.locator(fireSelector)).toHaveAttribute("data-firing", "false");

    // The reach window remains actionable across a real pause, while its
    // timer and pushState stay fixed under the bounded fake-clock steps.
    const readyTime = await page.locator("[data-time]").textContent();
    await page.locator("[data-action=pause]").click();
    await expect(root(page)).toHaveAttribute("data-paused", "true");
    await expect(pointerPush).toBeDisabled();
    await expect(pointerPush).toHaveAttribute("data-push-state", "ready");
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

    // A disabled native button must stay inert under real repeated clicks and
    // keyboard activation; no force-click or synthetic event is used.
    const pointerBounds = await pointerPush.boundingBox();
    if (pointerBounds === null) throw new Error("PUSH button has no layout box");
    await page.mouse.click(pointerBounds.x + pointerBounds.width / 2, pointerBounds.y + pointerBounds.height / 2);
    await flushInputFrame(page);
    expect(await readRootDiagnostics(page)).toMatchObject({ pushState: "accepted" });
    await page.keyboard.press("Enter");
    await flushInputFrame(page);
    expect(await readRootDiagnostics(page)).toMatchObject({ pushState: "accepted" });
  });

  test("accepts PUSH with Space while a real pointer hold remains active", async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 402, height: 874 });
    await installDeterministicClock(page);
    await boot(page, "/?debug=1&seed=77");
    await startGame(page);

    const fire = page.locator(fireSelector);
    const push = page.locator("[data-action=push]");
    await expect(push).toBeDisabled();
    await expect(push).toHaveAttribute("data-push-state", "hidden");
    await beginPointerFire(page);
    await waitForPushReady(page);

    // Space is native PUSH activation here, not global fire. The original
    // pointer source must remain active until pointerup below.
    const before = await readRootDiagnostics(page);
    await push.focus();
    await page.keyboard.press("Space");
    const accepted = await readRootDiagnostics(page);
    expect(accepted).toMatchObject({
      pushState: "accepted",
      spinStage: "reach",
      fired: before.fired,
      jackpots: before.jackpots,
    });
    await flushInputFrame(page);
    await expect(fire).toHaveAttribute("data-firing", "true");
    await expect(push).toBeDisabled();
    await expect(push).toHaveAttribute("data-push-state", "accepted");
    await page.mouse.up();
    await flushInputFrame(page);
    await expect(fire).toHaveAttribute("data-firing", "false");
    await expect(push).toHaveAttribute("data-push-state", "accepted");
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
      await expectMouthLayoutInViewport(page);
      for (const button of layout.visibleButtons) {
        expect(button.width).toBeGreaterThanOrEqual(44);
        expect(button.height).toBeGreaterThanOrEqual(44);
      }
    }
  });

  test("toggles sound and honors reduced-motion preferences", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => {
      class TestAudioParam {
        public setValueAtTime(value: number, when: number): void { void value; void when; }
        public linearRampToValueAtTime(value: number, when: number): void { void value; void when; }
        public exponentialRampToValueAtTime(value: number, when: number): void { void value; void when; }
      }

      class TestAudioContext {
        public state = "suspended";
        public currentTime = 0;
        public readonly destination = {};
        public starts = 0;
        public stops = 0;
        public resumeCalls = 0;
        public closeCalls = 0;

        public constructor() {
          contexts.push(this);
        }

        public createOscillator(): TestOscillator {
          return new TestOscillator(this);
        }

        public createGain(): TestGain {
          return new TestGain();
        }

        public resume(): Promise<void> {
          this.resumeCalls += 1;
          this.state = "running";
          return Promise.resolve();
        }

        public close(): Promise<void> {
          this.closeCalls += 1;
          this.state = "closed";
          return Promise.resolve();
        }
      }

      class TestGain {
        public readonly gain = new TestAudioParam();
        public connect(node: unknown): void { void node; }
        public disconnect(): void {}
      }

      class TestOscillator {
        public type: OscillatorType = "sine";
        public readonly frequency = new TestAudioParam();
        public onended: (() => void) | null = null;
        private stopped = false;

        public constructor(private readonly owner: TestAudioContext) {}

        public connect(node: unknown): void { void node; }

        public start(when?: number): void {
          void when;
          this.owner.starts += 1;
        }

        public stop(_when?: number): void {
          if (_when !== undefined && _when > this.owner.currentTime) return;
          if (this.stopped) return;
          this.stopped = true;
          this.owner.stops += 1;
          this.onended?.();
        }

        public disconnect(): void {}
      }

      const contexts: TestAudioContext[] = [];
      const probe = {
        interrupt(): void {
          const context = contexts[contexts.length - 1];
          if (context) context.state = "interrupted";
        },
        snapshot(): {
          readonly state: string;
          readonly starts: number;
          readonly stops: number;
          readonly resumeCalls: number;
          readonly closeCalls: number;
        } {
          const context = contexts[contexts.length - 1];
          if (!context) throw new Error("AudioContext was not created");
          return {
            state: context.state,
            starts: context.starts,
            stops: context.stops,
            resumeCalls: context.resumeCalls,
            closeCalls: context.closeCalls,
          };
        },
      };
      Object.defineProperty(window, "__doppanAudioProbe", { configurable: true, value: probe });
      Object.defineProperty(window, "AudioContext", { configurable: true, value: TestAudioContext });
    });
    await installDeterministicClock(page);
    await boot(page, "/?debug=1&seed=77");
    await startGame(page);

    // Reduced motion keeps the same semantic focus and reward labels; only
    // the decorative animation is reduced.
    await expect(root(page)).toHaveAttribute("data-focus-target", "start");
    await expect(root(page)).toHaveAttribute("data-presentation-stage", "normal");
    await expect(page.locator("[data-mouth-label=start]")).toHaveText(/^START \+50点 \/ \+3玉$/);
    await expect(page.locator("[data-mouth-label=start]")).toHaveAttribute("data-pocket-state", "available");
    await expect(page.locator("[data-mouth-label=attacker]")).toHaveText("得点口 CLOSED");
    await expect(page.locator("[data-mouth-label=attacker]")).toHaveAttribute("data-pocket-state", "closed");
    await expectMouthLayoutInViewport(page);

    const readAudio = () => page.evaluate(() => {
      const probe = (window as Window & {
        __doppanAudioProbe?: {
          snapshot: () => {
            readonly state: string;
            readonly starts: number;
            readonly stops: number;
            readonly resumeCalls: number;
            readonly closeCalls: number;
          };
        };
      }).__doppanAudioProbe;
      if (!probe) throw new Error("Audio probe was not installed");
      return probe.snapshot();
    });

    const sound = page.locator("[data-action=sound]");
    await expect(sound).toHaveAttribute("aria-pressed", "false");
    await sound.click();
    await expect(sound).toHaveText("音 ON");
    await expect(sound).toHaveAttribute("aria-pressed", "true");

    const enabled = await readAudio();
    expect(enabled.state).toBe("running");
    expect(enabled.resumeCalls).toBeGreaterThanOrEqual(1);

    // Exercise the real firing control and event path. The fake graph proves
    // that a tone was scheduled; it cannot prove speaker output or iOS audio.
    await beginPointerFire(page);
    await runClock(page, clockStepMs);
    const firstTone = await readAudio();
    expect(firstTone.starts).toBeGreaterThan(enabled.starts);
    await page.mouse.up();
    await flushInputFrame(page);
    await expect(page.locator(fireSelector)).toHaveAttribute("data-firing", "false");

    // A tab interruption must stop an already scheduled tone and release the
    // firing source before the pause dialog is shown.
    const beforePause = await readAudio();
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await expect(root(page)).toHaveAttribute("data-paused", "true");
    await expect(page.locator("[data-dialog=pause]")).toBeVisible();
    await expect(page.locator(fireSelector)).toBeDisabled();
    await expect(page.locator(fireSelector)).toHaveAttribute("data-firing", "false");
    const paused = await readAudio();
    expect(paused.stops).toBeGreaterThan(beforePause.stops);
    await page.mouse.up();

    // Simulate only the browser audio interruption; the game's paused state
    // remains controlled by the real blur lifecycle event above.
    await page.evaluate(() => {
      const probe = (window as Window & {
        __doppanAudioProbe?: { interrupt: () => void };
      }).__doppanAudioProbe;
      if (!probe) throw new Error("Audio probe was not installed");
      probe.interrupt();
    });
    expect((await readAudio()).state).toBe("interrupted");

    const resumeCallsBefore = paused.resumeCalls;
    await page.locator("[data-action=resume]").click();
    await expect(root(page)).toHaveAttribute("data-paused", "false");
    await expect(page.locator("[data-dialog=pause]")).toBeHidden();
    await expect.poll(async () => (await readAudio()).resumeCalls).toBeGreaterThan(resumeCallsBefore);
    await expect.poll(async () => (await readAudio()).state).toBe("running");

    // The next real firing event must schedule sound after recovery.
    const resumed = await readAudio();
    await beginPointerFire(page);
    await runClock(page, clockStepMs);
    const secondTone = await readAudio();
    expect(secondTone.starts).toBeGreaterThan(resumed.starts);
    await page.mouse.up();
    await flushInputFrame(page);
    await expect(page.locator(fireSelector)).toHaveAttribute("data-firing", "false");

    await sound.click();
    await expect(sound).toHaveText("音 OFF");
    await expect(sound).toHaveAttribute("aria-pressed", "false");
    const disabled = await readAudio();
    expect(disabled.starts).toBe(secondTone.starts);
    await beginPointerFire(page);
    await runClock(page, clockStepMs);
    const silent = await readAudio();
    expect(silent.starts).toBe(disabled.starts);
    await page.mouse.up();
    await flushInputFrame(page);
    await expect(page.locator(fireSelector)).toHaveAttribute("data-firing", "false");

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
