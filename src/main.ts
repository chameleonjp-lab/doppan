import "./styles.css";
import { BUILD_INFO, formatBuildInfoValue } from "./build-info";
import { registerGameLoopHmrDispose, type GameLoop } from "./runtime";
import { createPixiRuntime, type PixiRuntime } from "./rendering/pixi-app";
import { createSaveStorage } from "./storage/save-storage";
import { bindPrototypeInput } from "./ui/prototype-input-bindings";
import { G1BPrototype, type G1BPrototypeDiagnostics } from "./prototype";
import type { PhysicsStepHz } from "./loop/fixed-step-clock";

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`DOPPAN boot markup is missing ${selector}`);
  }
  return element;
}

const root = requiredElement<HTMLElement>("[data-app-root]");
const pauseButton = requiredElement<HTMLButtonElement>("[data-action='toggle-pause']");
const resetButton = requiredElement<HTMLButtonElement>("[data-action='reset-prototype']");
const hzSelect = requiredElement<HTMLSelectElement>("[data-physics-hz]");
const status = requiredElement<HTMLElement>("[data-status]");
const webglError = requiredElement<HTMLElement>("[data-webgl-error]");
const prototypeError = requiredElement<HTMLElement>("[data-prototype-error]");
const canvasHost = requiredElement<HTMLElement>("[data-canvas-host]");
const chargeProgress = requiredElement<HTMLProgressElement>("[data-launch-charge]");
const inputButtons = [...root.querySelectorAll<HTMLButtonElement>("button[data-input-action]")];
const diagnosticsElements = {
  hz: requiredElement<HTMLElement>("[data-diagnostic='hz']"),
  step: requiredElement<HTMLElement>("[data-diagnostic='step']"),
  queue: requiredElement<HTMLElement>("[data-diagnostic='queue']"),
  resources: requiredElement<HTMLElement>("[data-diagnostic='resources']"),
  dropped: requiredElement<HTMLElement>("[data-diagnostic='dropped']"),
  integrity: requiredElement<HTMLElement>("[data-diagnostic='integrity']"),
  shot: requiredElement<HTMLElement>("[data-diagnostic='shot']"),
  speed: requiredElement<HTMLElement>("[data-diagnostic='speed']"),
  physicsLatency: requiredElement<HTMLElement>("[data-diagnostic='physics-latency']"),
  drawLatency: requiredElement<HTMLElement>("[data-diagnostic='draw-latency']"),
};

let runtime: PixiRuntime | null = null;
const saves = createSaveStorage<Record<string, unknown>>(BUILD_INFO.environment);
const lifecycleController = new AbortController();
let disposed = false;
let runtimeGeneration = 0;
let lastDiagnosticsAt = -Infinity;

const WEBGL_ERROR_GUIDE =
  "WebGL描画を開始または継続できませんでした。ページを再読み込みするか、ブラウザのハードウェアアクセラレーションを確認してください。";
const PROTOTYPE_ERROR_GUIDE =
  "入力または物理の安全条件を保てなかったため停止しました。盤面をリセットするか、再読み込みして診断情報を確認してください。";

const prototype = new G1BPrototype({
  physicsStepHz: parsePhysicsHz(hzSelect.value),
  onFatalError: showPrototypeError,
});

function setInputDisabled(disabled: boolean): void {
  for (const button of inputButtons) {
    button.disabled = disabled;
  }
}

setInputDisabled(true);

function destroyRuntimeSafely(target: PixiRuntime | null): { error: unknown } | null {
  if (!target) {
    return null;
  }
  try {
    target.destroy();
    return null;
  } catch (error: unknown) {
    return { error };
  }
}

function disposeApplication(): void {
  if (disposed) {
    return;
  }
  disposed = true;
  runtimeGeneration += 1;
  lifecycleController.abort();
  pauseButton.disabled = true;
  resetButton.disabled = true;
  setInputDisabled(true);
  const activeRuntime = runtime;
  runtime = null;
  gameLoop.dispose();
  prototype.destroy();
  destroyRuntimeSafely(activeRuntime);
}

const gameLoop: GameLoop = registerGameLoopHmrDispose(
  (deltaMs, timestampMs) => {
    prototype.advance(deltaMs);
    runtime?.updatePrototype(prototype.snapshot());
    runtime?.step(deltaMs);
    if (runtime !== null) {
      prototype.markRendered(timestampMs);
    }
    if (timestampMs - lastDiagnosticsAt >= 100) {
      lastDiagnosticsAt = timestampMs;
      updateDiagnostics(prototype.diagnostics());
    }
  },
  import.meta.hot,
  {
    onDispose: disposeApplication,
    onError: showPrototypeError,
  },
);

const envElement = document.querySelector<HTMLElement>("[data-build-environment]");
const targetElement = document.querySelector<HTMLElement>("[data-build-target]");
const shaElement = document.querySelector<HTMLElement>("[data-build-sha]");
const buildAtElement = document.querySelector<HTMLElement>("[data-build-at]");
if (envElement) envElement.textContent = BUILD_INFO.environment;
if (targetElement) targetElement.textContent = BUILD_INFO.target;
if (shaElement) shaElement.textContent = formatBuildInfoValue(BUILD_INFO.sha);
if (buildAtElement) buildAtElement.textContent = formatBuildInfoValue(BUILD_INFO.builtAt);

function parsePhysicsHz(value: string): PhysicsStepHz {
  return value === "120" ? 120 : 60;
}

function setStatus(message: string, active: boolean): void {
  status.textContent = message;
  status.dataset.active = active ? "true" : "false";
  pauseButton.textContent = active ? "一時停止 (Esc)" : "再開 (Esc)";
  pauseButton.setAttribute("aria-pressed", String(!active));
}

function showWebglError(error: unknown): void {
  const message = error instanceof Error ? error.message : "WebGL renderer could not be started.";
  const failedRuntime = runtime;
  runtime = null;
  webglError.hidden = false;
  webglError.textContent = WEBGL_ERROR_GUIDE;
  webglError.dataset.error = message;
  canvasHost.setAttribute("aria-hidden", "true");
  pauseButton.disabled = true;
  resetButton.disabled = true;
  setInputDisabled(true);
  gameLoop.stop();
  prototype.safeStop(error, false);
  destroyRuntimeSafely(failedRuntime);
  setStatus("WebGL案内を表示中", false);
}

function showPrototypeError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  prototypeError.hidden = false;
  prototypeError.textContent = PROTOTYPE_ERROR_GUIDE;
  prototypeError.dataset.error = message;
  pauseButton.disabled = true;
  setInputDisabled(true);
  gameLoop.stop();
  prototype.safeStop(error, false);
  setStatus("安全停止中", false);
  updateDiagnostics(prototype.diagnostics());
}

function togglePause(): void {
  if (!runtime || disposed || pauseButton.disabled) {
    return;
  }
  if (!prototype.togglePause()) {
    return;
  }
  const active = prototype.gameState.suspensionState === "None";
  setStatus(active ? "実行中" : "一時停止中", active);
  runtime.updatePrototype(prototype.snapshot());
  runtime.step(0);
  updateDiagnostics(prototype.diagnostics());
}

function resetPrototype(): void {
  if (!runtime || disposed) {
    return;
  }
  prototype.reset(parsePhysicsHz(hzSelect.value));
  prototypeError.hidden = true;
  pauseButton.disabled = false;
  setInputDisabled(false);
  runtime.updatePrototype(prototype.snapshot());
  runtime.step(0);
  setStatus("実行中", true);
  if (!gameLoop.isRunning) {
    gameLoop.start();
  }
  updateDiagnostics(prototype.diagnostics());
}

pauseButton.addEventListener("click", togglePause, { signal: lifecycleController.signal });
resetButton.addEventListener("click", resetPrototype, { signal: lifecycleController.signal });
hzSelect.addEventListener("change", resetPrototype, { signal: lifecycleController.signal });

bindPrototypeInput({
  root,
  keyboardTarget: window,
  visibilityTarget: document,
  input: prototype.input,
  controller: lifecycleController,
  onPauseToggle: togglePause,
  onVisibilityChange: (hidden) => {
    gameLoop.discardElapsedTime();
    prototype.setVisibility(hidden);
    const active = !hidden && prototype.gameState.suspensionState === "None";
    setStatus(hidden ? "画面非表示で停止中" : active ? "実行中" : "一時停止中", active);
  },
  onError: showPrototypeError,
});

window.addEventListener("beforeunload", () => {
  saves.save({
    lastStatus: status.textContent ?? "unknown",
    physicsStepHz: prototype.physicsStepHz,
  });
  disposeApplication();
}, { signal: lifecycleController.signal });

const forceFailure = (() => {
  const query = new URLSearchParams(window.location.search);
  return (
    query.get("forceWebGLFailure") === "1" ||
    query.get("webgl") === "fail" ||
    query.get("webgl") === "failure"
  );
})();

async function initializePixiRuntime(): Promise<boolean> {
  if (prototype.gameState.isFatalRecovery) {
    gameLoop.stop();
    setInputDisabled(true);
    return false;
  }
  const generation = runtimeGeneration + 1;
  runtimeGeneration = generation;
  gameLoop.stop();
  const previousRuntime = runtime;
  runtime = null;
  const destroyError = destroyRuntimeSafely(previousRuntime);
  if (destroyError) {
    showWebglError(destroyError.error);
    return false;
  }
  pauseButton.disabled = true;
  resetButton.disabled = true;
  setInputDisabled(true);
  canvasHost.removeAttribute("aria-hidden");
  webglError.hidden = true;
  setStatus("初期化中", false);

  try {
    const created = await createPixiRuntime({
      host: canvasHost,
      forceWebGLFailure: forceFailure,
      onFatalError: showWebglError,
    });
    if (disposed || generation !== runtimeGeneration) {
      destroyRuntimeSafely(created);
      return false;
    }
    runtime = created;
    runtime.updatePrototype(prototype.snapshot());
    runtime.step(0);
    pauseButton.disabled = false;
    resetButton.disabled = false;
    setInputDisabled(false);
    setStatus("実行中", true);
    updateDiagnostics(prototype.diagnostics());
    if (!gameLoop.start()) {
      throw new Error("The single game loop could not be started");
    }
    return true;
  } catch (error: unknown) {
    if (!disposed && generation === runtimeGeneration) {
      showWebglError(error);
    }
    return false;
  }
}

function updateDiagnostics(diagnostics: G1BPrototypeDiagnostics): void {
  diagnosticsElements.hz.textContent = `${diagnostics.fixedStep.physicsStepHz} Hz`;
  diagnosticsElements.step.textContent = String(diagnostics.fixedStep.physicsStepId);
  diagnosticsElements.queue.textContent = `${diagnostics.inputQueueSize} / 256`;
  diagnosticsElements.resources.textContent =
    `${diagnostics.physics.bodyCount} / ${diagnostics.physics.fixtureCount} / ${diagnostics.physics.jointCount}`;
  diagnosticsElements.dropped.textContent =
    `${diagnostics.fixedStep.droppedSimulationCount}回 · ${diagnostics.fixedStep.droppedSimulationMs.toFixed(1)}ms`;
  diagnosticsElements.integrity.textContent = diagnostics.runIntegrity;
  diagnosticsElements.integrity.dataset.valid = String(diagnostics.runIntegrity === "valid");
  diagnosticsElements.shot.textContent = prototype.snapshot().shotProgress[0]?.currentState ?? "Idle";
  diagnosticsElements.speed.textContent = diagnostics.physics.ballSpeed.toFixed(2);
  diagnosticsElements.physicsLatency.textContent = formatLatency(
    diagnostics.inputLatency.inputToPhysics.medianMs,
    diagnostics.inputLatency.inputToPhysics.p95Ms,
  );
  diagnosticsElements.drawLatency.textContent = formatLatency(
    diagnostics.inputLatency.inputToDraw.medianMs,
    diagnostics.inputLatency.inputToDraw.p95Ms,
  );
  chargeProgress.value = diagnostics.launchCharge;
  chargeProgress.setAttribute("aria-valuetext", `${Math.round(diagnostics.launchCharge * 100)}%`);
}

function formatLatency(medianMs: number | null, p95Ms: number | null): string {
  return medianMs === null || p95Ms === null
    ? "未計測"
    : `${medianMs.toFixed(1)} / ${p95Ms.toFixed(1)} ms`;
}

declare global {
  interface Window {
    __DOPPAN_G1A__?: {
      getLoopDiagnostics: () => ReturnType<GameLoop["diagnostics"]>;
      getPixiDiagnostics: () => PixiDiagnostics | null;
      reinitializeRenderer: () => Promise<boolean>;
    };
    __DOPPAN_G1B__?: {
      getLoopDiagnostics: () => ReturnType<GameLoop["diagnostics"]>;
      getPixiDiagnostics: () => PixiDiagnostics | null;
      getPrototypeDiagnostics: () => G1BPrototypeDiagnostics;
      getSnapshot: () => ReturnType<G1BPrototype["snapshot"]>;
      reset: (physicsStepHz?: PhysicsStepHz) => void;
      reinitializeRenderer: () => Promise<boolean>;
    };
  }
}

interface PixiDiagnostics {
  rendererName: string;
  tickerPresent: false;
  tickerAutoStart: false;
  tickerStarted: false;
  renderCount: number;
}

function getPixiDiagnostics(): PixiDiagnostics | null {
  return runtime
    ? {
        rendererName: runtime.renderer.name,
        tickerPresent: false,
        tickerAutoStart: false,
        tickerStarted: false,
        renderCount: runtime.renderCount,
      }
    : null;
}

window.__DOPPAN_G1A__ = {
  getLoopDiagnostics: () => gameLoop.diagnostics(),
  getPixiDiagnostics,
  reinitializeRenderer: initializePixiRuntime,
};

window.__DOPPAN_G1B__ = {
  getLoopDiagnostics: () => gameLoop.diagnostics(),
  getPixiDiagnostics,
  getPrototypeDiagnostics: () => prototype.diagnostics(),
  getSnapshot: () => prototype.snapshot(),
  reset: (physicsStepHz = prototype.physicsStepHz) => {
    hzSelect.value = String(physicsStepHz);
    prototype.reset(physicsStepHz);
    setInputDisabled(runtime === null);
    runtime?.updatePrototype(prototype.snapshot());
    runtime?.step(0);
    if (runtime !== null) {
      setStatus("実行中", true);
      if (!gameLoop.isRunning) {
        gameLoop.start();
      }
    }
    updateDiagnostics(prototype.diagnostics());
  },
  reinitializeRenderer: initializePixiRuntime,
};

void initializePixiRuntime();
