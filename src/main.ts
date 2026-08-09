import "./styles.css";
import { BUILD_INFO, formatBuildInfoValue } from "./build-info";
import { registerGameLoopHmrDispose, type GameLoop } from "./runtime";
import { createPixiRuntime, type PixiRuntime } from "./rendering/pixi-app";
import { createSaveStorage } from "./storage/save-storage";
import { bindLoopControls } from "./ui/loop-controls";

const root = document.querySelector<HTMLElement>("[data-app-root]");
const startButton = document.querySelector<HTMLButtonElement>("[data-action='toggle-loop']");
const status = document.querySelector<HTMLElement>("[data-status]");
const webglError = document.querySelector<HTMLElement>("[data-webgl-error]");
const canvasHost = document.querySelector<HTMLElement>("[data-canvas-host]");

if (!root || !startButton || !status || !webglError || !canvasHost) {
  throw new Error("DOPPAN boot markup is incomplete");
}

const startButtonElement = startButton;
const statusElement = status;
const webglErrorElement = webglError;
const canvasHostElement = canvasHost;

let runtime: PixiRuntime | null = null;
const saves = createSaveStorage<Record<string, unknown>>(BUILD_INFO.environment);
const lifecycleController = new AbortController();
let disposed = false;
let runtimeGeneration = 0;

const WEBGL_ERROR_GUIDE =
  "WebGL描画を開始または継続できませんでした。ページを再読み込みするか、ブラウザのハードウェアアクセラレーションを確認してください。";

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
  startButtonElement.disabled = true;
  const activeRuntime = runtime;
  runtime = null;
  gameLoop.dispose();
  destroyRuntimeSafely(activeRuntime);
}

const gameLoop: GameLoop = registerGameLoopHmrDispose(
  (deltaMs) => {
    runtime?.step(deltaMs);
  },
  import.meta.hot,
  {
    onDispose: disposeApplication,
    onError: showWebglError,
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

function setStatus(message: string, active: boolean): void {
  statusElement.textContent = message;
  statusElement.dataset.active = active ? "true" : "false";
  startButtonElement.textContent = active ? "停止 (Space)" : "開始 (Space)";
  startButtonElement.setAttribute("aria-pressed", String(active));
}

function showWebglError(error: unknown): void {
  const message = error instanceof Error ? error.message : "WebGL renderer could not be started.";
  const failedRuntime = runtime;
  runtime = null;
  webglErrorElement.hidden = false;
  webglErrorElement.textContent = WEBGL_ERROR_GUIDE;
  webglErrorElement.dataset.error = message;
  canvasHostElement.setAttribute("aria-hidden", "true");
  startButtonElement.disabled = true;
  gameLoop.stop();
  destroyRuntimeSafely(failedRuntime);
  setStatus("WebGL案内を表示中", false);
}

function toggleLoop(): void {
  if (!runtime || disposed || startButtonElement.disabled) {
    return;
  }
  if (gameLoop.isRunning) {
    gameLoop.stop();
    setStatus("停止中", false);
  } else if (gameLoop.start()) {
    setStatus("実行中", true);
  }
}

bindLoopControls({
  button: startButtonElement,
  keyboardTarget: window,
  onToggle: toggleLoop,
  controller: lifecycleController,
});

window.addEventListener("beforeunload", () => {
  // The save path is deliberately best-effort. A storage failure never blocks
  // navigation or the active game loop.
  saves.save({ lastStatus: statusElement.textContent ?? "unknown" });
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
  startButtonElement.disabled = true;
  canvasHostElement.removeAttribute("aria-hidden");
  webglErrorElement.hidden = true;
  setStatus("初期化中", false);

  try {
    const created = await createPixiRuntime({
      host: canvasHostElement,
      forceWebGLFailure: forceFailure,
      onFatalError: showWebglError,
    });
    if (disposed || generation !== runtimeGeneration) {
      destroyRuntimeSafely(created);
      return false;
    }
    runtime = created;
    startButtonElement.disabled = false;
    setStatus("停止中", false);
    return true;
  } catch (error: unknown) {
    if (!disposed && generation === runtimeGeneration) {
      showWebglError(error);
    }
    return false;
  }
}

declare global {
  interface Window {
    __DOPPAN_G1A__?: {
      getLoopDiagnostics: () => ReturnType<GameLoop["diagnostics"]>;
      getPixiDiagnostics: () => {
        rendererName: string;
        tickerPresent: boolean;
        tickerAutoStart: boolean;
        tickerStarted: boolean;
        renderCount: number;
      } | null;
      reinitializeRenderer: () => Promise<boolean>;
    };
  }
}

window.__DOPPAN_G1A__ = {
  getLoopDiagnostics: () => gameLoop.diagnostics(),
  getPixiDiagnostics: () =>
    runtime
      ? {
          rendererName: runtime.renderer.name,
          tickerPresent: false,
          tickerAutoStart: false,
          tickerStarted: false,
          renderCount: runtime.renderCount,
        }
      : null,
  reinitializeRenderer: initializePixiRuntime,
};

void initializePixiRuntime();
