import "./styles.css";
import { BUILD_INFO, formatBuildInfoValue } from "./build-info";
import { registerGameLoopHmrDispose, type GameLoop } from "./runtime";
import { createPixiRuntime, type PixiRuntime } from "./rendering/pixi-app";
import { bindPrototypeInput } from "./ui/prototype-input-bindings";
import {
  GaSession,
  type GaSessionDiagnostics,
  type GaSessionSnapshot,
} from "./game";
import {
  GRAYBOX_PATH_LENGTH,
  formatGrayboxReturnRouteLabel,
  formatGrayboxTargetLabel,
  type GrayboxAlphaSnapshot,
} from "./graybox";
import type { PhysicsStepHz } from "./loop/fixed-step-clock";

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`DOPPAN boot markup is missing ${selector}`);
  }
  return element;
}

const root = requiredElement<HTMLElement>("[data-app-root]");
const debugMode = new URLSearchParams(window.location.search).get("debug") === "1";
root.dataset.debug = String(debugMode);
const pauseButton = requiredElement<HTMLButtonElement>("[data-action='toggle-pause']");
const resetButton = requiredElement<HTMLButtonElement>("[data-action='reset-prototype']");
const hzSelect = requiredElement<HTMLSelectElement>("[data-physics-hz]");
const status = requiredElement<HTMLElement>("[data-status]");
const copyReportButton = requiredElement<HTMLButtonElement>("[data-action='copy-report']");
const webglError = requiredElement<HTMLElement>("[data-webgl-error]");
const prototypeError = requiredElement<HTMLElement>("[data-prototype-error]");
const canvasHost = requiredElement<HTMLElement>("[data-canvas-host]");
const chargeProgress = requiredElement<HTMLProgressElement>("[data-launch-charge]");
const reportOutput = requiredElement<HTMLElement>("[data-playtest-report]");
const startGameButton = requiredElement<HTMLButtonElement>("[data-action='start-game']");
const restartGameButton = requiredElement<HTMLButtonElement>("[data-action='restart-game']");
const startOverlay = requiredElement<HTMLElement>("[data-game-overlay='start']");
const resultOverlay = requiredElement<HTMLElement>("[data-game-overlay='result']");
const resultScore = requiredElement<HTMLElement>("[data-result='score']");
const resultProgress = requiredElement<HTMLElement>("[data-result='progress']");
const resultClimax = requiredElement<HTMLElement>("[data-result='climax']");
const playerNameInput = requiredElement<HTMLInputElement>("#player-name");
const nameStatus = requiredElement<HTMLElement>("[data-name-status]");
const resultPlayer = requiredElement<HTMLElement>("[data-result='player']");
const resultShareText = requiredElement<HTMLTextAreaElement>("[data-result='share-text']");
const shareStatus = requiredElement<HTMLElement>("[data-share-status]");
const rankingList = requiredElement<HTMLOListElement>("[data-ranking-list]");
const rankingStatus = requiredElement<HTMLElement>("[data-ranking-status]");
const homeShareButton = requiredElement<HTMLButtonElement>("[data-action='share-home']");
const startShareButton = requiredElement<HTMLButtonElement>("[data-action='share-start']");
const resultShareButton = requiredElement<HTMLButtonElement>("[data-action='share-result']");
const grayboxElements = {
  target: requiredElement<HTMLElement>("[data-graybox='target']"),
  returnRoute: requiredElement<HTMLElement>("[data-graybox='return']"),
  progress: requiredElement<HTMLElement>("[data-graybox='progress']"),
  score: requiredElement<HTMLElement>("[data-graybox='score']"),
  combo: requiredElement<HTMLElement>("[data-graybox='combo']"),
  event: requiredElement<HTMLElement>("[data-graybox='event']"),
};
const gaElements = {
  ball: requiredElement<HTMLElement>("[data-ga='ball']"),
  remaining: requiredElement<HTMLElement>("[data-ga='remaining']"),
  phase: requiredElement<HTMLElement>("[data-ga='phase']"),
  result: requiredElement<HTMLElement>("[data-ga='result']"),
};
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
const lifecycleController = new AbortController();
let disposed = false;
let runtimeGeneration = 0;
let lastDiagnosticsAt = -Infinity;
let gameStarted = false;
let playerName = readPlayerName();
let resultPlatformLoaded = false;

const SUPABASE_URL = "https://mlpnjgezrnhdxsxolyzj.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_drzcy0v97knU6FgjqSgBHw_0A9XPdFM";
const GAME_SLUG = "doppan";
const CLIENT_VERSION = "doppan-2026-08-31-platform";
playerNameInput.value = playerName;

const WEBGL_ERROR_GUIDE =
  "WebGL描画を開始または継続できませんでした。ページを再読み込みするか、ブラウザのハードウェアアクセラレーションを確認してください。";
const PROTOTYPE_ERROR_GUIDE =
  "入力または物理の安全条件を保てなかったため停止しました。盤面をリセットするか、再読み込みして診断情報を確認してください。";

const session = new GaSession({
  physicsStepHz: parsePhysicsHz(hzSelect.value),
  onFatalError: showPrototypeError,
});

function setInputDisabled(disabled: boolean): void {
  for (const button of inputButtons) {
    button.disabled = disabled;
  }
}

setInputDisabled(true);

function updateResultOverlay(snapshot: GaSessionSnapshot): void {
  const isResult = gameStarted && snapshot.phase === "result";
  startOverlay.hidden = gameStarted || session.gameState.isFatalRecovery;
  resultOverlay.hidden = !isResult;
  const score = snapshot.result?.score ?? snapshot.graybox.score;
  const progress = snapshot.result?.progress ?? snapshot.graybox.progress;
  resultScore.textContent = String(score);
  resultProgress.textContent =
    String(Math.round(progress * GRAYBOX_PATH_LENGTH)) + " / " + String(GRAYBOX_PATH_LENGTH);
  resultClimax.textContent =
    snapshot.result?.climaxState === "active" ? "クライマックス到達" : "クライマックス未到達";
  if (isResult && !resultPlatformLoaded) {
    resultPlatformLoaded = true;
    void renderResultPlatform(Number(score));
  }
  if (!isResult) resultPlatformLoaded = false;
}

function readPlayerName(): string {
  try { return cleanName(localStorage.getItem("doppan.player-name") ?? ""); } catch { return ""; }
}

function cleanName(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 20);
}

function currentGameUrl(): string { return new URL(window.location.href).toString().split("#")[0] ?? window.location.href; }
function homeShareText(): string { return `DOPPAN「つなぎ直す」で3球のルートをつなごう！\n${currentGameUrl()}\n#DOPPAN #ミニゲーム`; }
function resultShareMessage(finalScore: number, progress: number, climax: boolean): string {
  return `${playerName}さんのDOPPAN結果：${finalScore}点、進行${Math.round(progress * GRAYBOX_PATH_LENGTH)}/${GRAYBOX_PATH_LENGTH}！${climax ? "クライマックス到達！" : "ルートをつなぎ直しました。"}\n${currentGameUrl()}\n#DOPPAN #ミニゲーム`;
}

async function shareOrCopy(text: string, statusElement: HTMLElement, textElement?: HTMLTextAreaElement): Promise<void> {
  statusElement.textContent = "";
  if (navigator.share) {
    try { await navigator.share({ title: "DOPPAN", text, url: currentGameUrl() }); statusElement.textContent = "共有しました。"; return; }
    catch (error) { if (error instanceof DOMException && error.name === "AbortError") return; }
  }
  try { await navigator.clipboard.writeText(text); statusElement.textContent = "シェア文をコピーしました。"; }
  catch { if (textElement) { textElement.focus(); textElement.select(); } statusElement.textContent = "シェア文を選択しました。コピーしてご利用ください。"; }
}

async function callRankingRpc(name: string, payload: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, { method: "POST", headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const text = await response.text();
  const data: unknown = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${name}: ${response.status}`);
  return data;
}

function rankingRows(data: unknown): Array<Record<string, unknown>> {
  return Array.isArray(data) ? data.slice(0, 10) as Array<Record<string, unknown>> : [];
}

function rankingDisplayName(value: unknown): string {
  if (typeof value !== "string") {
    return "ななし";
  }
  const normalized = value.trim();
  return normalized || "ななし";
}

function rankingScore(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

async function renderResultPlatform(finalScore: number): Promise<void> {
  const snapshot = session.snapshot();
  const progress = snapshot.result?.progress ?? snapshot.graybox.progress;
  const climax = snapshot.result?.climaxState === "active";
  const text = resultShareMessage(finalScore, progress, climax);
  resultPlayer.textContent = `${playerName}さんの結果`;
  resultShareText.value = text;
  rankingList.innerHTML = "<li>ランキングを読み込み中…</li>";
  rankingStatus.textContent = "ランキングを更新中…";
  try {
    await callRankingRpc("submit_score", { p_display_name: playerName, p_game_slug: GAME_SLUG, p_score: Math.trunc(finalScore), p_client_version: CLIENT_VERSION });
  } catch { rankingStatus.textContent = "今回のスコアを送信できませんでした。ランキングを表示します。"; }
  try {
    const rows = rankingRows(await callRankingRpc("get_best_score_ranking", { p_game_slug: GAME_SLUG, p_limit: 10 }));
    rankingList.innerHTML = rows.length ? "" : "<li>まだランキングがありません。</li>";
    for (const row of rows) {
      const item = document.createElement("li");
      const displayName = rankingDisplayName(row.display_name ?? row.player_name);
      const score = rankingScore(row.score ?? row.best_score);
      item.textContent = `${displayName}：${score}点`;
      rankingList.appendChild(item);
    }
    if (rankingStatus.textContent === "ランキングを更新中…") rankingStatus.textContent = "上位10名を表示しています。";
  } catch { rankingList.innerHTML = "<li>ランキングを読み込めませんでした。</li>"; rankingStatus.textContent = "ランキングを読み込めませんでした。"; }
}

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
  copyReportButton.disabled = true;
  setInputDisabled(true);
  const activeRuntime = runtime;
  runtime = null;
  gameLoop.dispose();
  session.destroy();
  destroyRuntimeSafely(activeRuntime);
}

const gameLoop: GameLoop = registerGameLoopHmrDispose(
  (deltaMs, timestampMs) => {
    session.advance(deltaMs);
    const snapshot = session.snapshot();
    runtime?.updatePrototype(snapshot);
    updateGraybox(snapshot);
    updateSessionUi(snapshot);
    runtime?.step(deltaMs);
    if (runtime !== null) {
      session.markRendered(timestampMs);
    }
    if (timestampMs - lastDiagnosticsAt >= 100) {
      lastDiagnosticsAt = timestampMs;
      updateDiagnostics(session.diagnostics());
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
  copyReportButton.disabled = true;
  setInputDisabled(true);
  gameLoop.stop();
  session.safeStop(error, false);
  destroyRuntimeSafely(failedRuntime);
  setStatus("WebGL案内を表示中", false);
}

function showPrototypeError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  prototypeError.hidden = false;
  prototypeError.textContent = PROTOTYPE_ERROR_GUIDE;
  prototypeError.dataset.error = message;
  pauseButton.disabled = true;
  copyReportButton.disabled = true;
  setInputDisabled(true);
  gameLoop.stop();
  session.safeStop(error, false);
  setStatus("安全停止中", false);
  updateDiagnostics(session.diagnostics());
}

function togglePause(): void {
  if (!runtime || disposed || !gameStarted || pauseButton.disabled) {
    return;
  }
  if (!session.togglePause()) {
    return;
  }
  const active = session.gameState.suspensionState === "None";
  setStatus(active ? "実行中" : "一時停止中", active);
  const snapshot = session.snapshot();
  runtime.updatePrototype(snapshot);
  updateGraybox(snapshot);
  updateSessionUi(snapshot);
  runtime.step(0);
  updateDiagnostics(session.diagnostics());
}

function resetSession(started: boolean): void {
  if (!runtime || disposed) {
    return;
  }
  gameStarted = started;
  resultPlatformLoaded = false;
  session.reset(parsePhysicsHz(hzSelect.value));
  prototypeError.hidden = true;
  reportOutput.hidden = true;
  reportOutput.textContent = "";
  pauseButton.disabled = !started;
  resetButton.disabled = false;
  copyReportButton.disabled = !debugMode;
  setInputDisabled(!started);
  const snapshot = session.snapshot();
  runtime.updatePrototype(snapshot);
  updateGraybox(snapshot);
  runtime.step(0);
  updateSessionUi(snapshot);
  if (!gameLoop.isRunning) {
    gameLoop.start();
  }
  updateDiagnostics(session.diagnostics());
}

function beginGame(): void {
  playerName = cleanName(playerNameInput.value);
  playerNameInput.value = playerName;
  if (!playerName) {
    nameStatus.textContent = "名前を入力してから開始してください。";
    playerNameInput.focus();
    return;
  }
  localStorage.setItem("doppan.player-name", playerName);
  nameStatus.textContent = "";
  resetSession(true);
  startGameButton.blur();
  restartGameButton.blur();
}

function resetPrototype(): void {
  resetSession(gameStarted);
}

startGameButton.addEventListener("click", beginGame, { signal: lifecycleController.signal });
restartGameButton.addEventListener("click", beginGame, { signal: lifecycleController.signal });
playerNameInput.addEventListener("input", () => { nameStatus.textContent = ""; }, { signal: lifecycleController.signal });
homeShareButton.addEventListener("click", () => void shareOrCopy(homeShareText(), nameStatus), { signal: lifecycleController.signal });
startShareButton.addEventListener("click", () => void shareOrCopy(homeShareText(), nameStatus), { signal: lifecycleController.signal });
resultShareButton.addEventListener("click", () => void shareOrCopy(resultShareText.value, shareStatus, resultShareText), { signal: lifecycleController.signal });
pauseButton.addEventListener("click", togglePause, { signal: lifecycleController.signal });
resetButton.addEventListener("click", resetPrototype, { signal: lifecycleController.signal });
hzSelect.addEventListener("change", resetPrototype, { signal: lifecycleController.signal });
copyReportButton.addEventListener(
  "click",
  () => void showPlaytestReport(),
  { signal: lifecycleController.signal },
);

bindPrototypeInput({
  root,
  keyboardTarget: window,
  visibilityTarget: document,
  input: session.input,
  controller: lifecycleController,
  onPauseToggle: togglePause,
  isEnabled: () => gameStarted && runtime !== null && !session.gameState.isFatalRecovery,
  onVisibilityChange: (hidden) => {
    gameLoop.discardElapsedTime();
    session.setVisibility(hidden);
    const active = gameStarted && !hidden && session.gameState.suspensionState === "None";
    setStatus(
      hidden ? "画面非表示で停止中" : gameStarted ? active ? "実行中" : "一時停止中" : "ゲーム開始待ち",
      active,
    );
  },
  onError: showPrototypeError,
});

window.addEventListener("beforeunload", () => {
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
  if (session.gameState.isFatalRecovery) {
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
      renderMode: debugMode ? "diagnostic" : "player",
      onFatalError: showWebglError,
    });
    if (disposed || generation !== runtimeGeneration) {
      destroyRuntimeSafely(created);
      return false;
    }
    runtime = created;
    const snapshot = session.snapshot();
    runtime.updatePrototype(snapshot);
    updateGraybox(snapshot);
    runtime.step(0);
    pauseButton.disabled = !gameStarted;
    resetButton.disabled = false;
    copyReportButton.disabled = !debugMode;
    setInputDisabled(!gameStarted);
    updateSessionUi(snapshot);
    updateDiagnostics(session.diagnostics());
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

function updateDiagnostics(diagnostics: GaSessionDiagnostics): void {
  diagnosticsElements.hz.textContent = `${diagnostics.fixedStep.physicsStepHz} Hz`;
  diagnosticsElements.step.textContent = String(diagnostics.fixedStep.physicsStepId);
  diagnosticsElements.queue.textContent = `${diagnostics.inputQueueSize} / 256`;
  diagnosticsElements.resources.textContent =
    `${diagnostics.physics.bodyCount} / ${diagnostics.physics.fixtureCount} / ${diagnostics.physics.jointCount}`;
  diagnosticsElements.dropped.textContent =
    `${diagnostics.fixedStep.droppedSimulationCount}回 · ${diagnostics.fixedStep.droppedSimulationMs.toFixed(1)}ms`;
  diagnosticsElements.integrity.textContent = diagnostics.runIntegrity;
  diagnosticsElements.integrity.dataset.valid = String(diagnostics.runIntegrity === "valid");
  diagnosticsElements.shot.textContent = session.snapshot().shotProgress[0]?.currentState ?? "Idle";
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
  updateGrayboxFromDiagnostics(diagnostics);
}

function updateGraybox(snapshot: GrayboxAlphaSnapshot): void {
  grayboxElements.target.textContent =
    snapshot.graybox.activeTargetIds.length > 0
      ? snapshot.graybox.activeTargetIds.map((targetId) => formatGrayboxTargetLabel(targetId)).join(" / ")
      : snapshot.graybox.climaxState === "active"
        ? "クライマックス中"
        : "目標なし";
  grayboxElements.returnRoute.textContent = formatGrayboxReturnRouteLabel(snapshot.graybox.returnRouteId);
  grayboxElements.progress.textContent =
    `${snapshot.graybox.completedShotIds.length} / ${GRAYBOX_PATH_LENGTH}`;
  grayboxElements.score.textContent = String(snapshot.graybox.score);
  grayboxElements.combo.textContent = String(snapshot.graybox.combo);
  grayboxElements.event.textContent = snapshot.graybox.lastEventLabel ?? "—";
}

function updateGrayboxFromDiagnostics(diagnostics: GaSessionDiagnostics): void {
  updateGraybox({
    ...session.snapshot(),
    graybox: diagnostics.graybox,
  });
}

function updateSessionUi(snapshot: GaSessionSnapshot): void {
  gaElements.ball.textContent = String(snapshot.currentBall) + " / " + String(snapshot.totalBalls);
  gaElements.remaining.textContent = String(snapshot.ballsRemaining);
  gaElements.phase.textContent = formatPhase(snapshot.phase);
  gaElements.result.textContent = snapshot.result === null ? "—" : String(snapshot.result.score);
  updateResultOverlay(snapshot);
  if (!gameStarted) {
    setStatus("ゲーム開始待ち", false);
    pauseButton.disabled = true;
    setInputDisabled(true);
    return;
  }
  if (snapshot.phase === "result") {
    setStatus("結果表示", false);
    pauseButton.disabled = true;
    setInputDisabled(true);
    return;
  }
  if (session.gameState.suspensionState !== "None") {
    setStatus("一時停止中", false);
    pauseButton.disabled = false;
    setInputDisabled(true);
    return;
  }
  if (snapshot.phase === "launch-ready") {
    setStatus("球" + snapshot.currentBall + " 発射待ち", true);
  } else if (snapshot.phase === "playing") {
    setStatus("球" + snapshot.currentBall + " プレイ中", true);
  } else if (snapshot.phase === "ball-ending") {
    setStatus("球終了。次の球を準備中", false);
  }
  pauseButton.disabled = runtime === null;
  setInputDisabled(runtime === null);
}

function formatPhase(phase: GaSessionSnapshot["phase"]): string {
  switch (phase) {
    case "launch-ready":
      return "発射待ち";
    case "playing":
      return "プレイ中";
    case "ball-ending":
      return "球終了";
    case "result":
      return "結果";
  }
}

async function showPlaytestReport(): Promise<void> {
  const report = session.playtestReportJson();
  reportOutput.hidden = false;
  reportOutput.textContent = report;
  const clipboard = navigator.clipboard;
  try {
    if (clipboard === undefined) {
      throw new Error("Clipboard API is unavailable");
    }
    await clipboard.writeText(report);
    const active = session.snapshot().phase === "launch-ready" || session.snapshot().phase === "playing";
    setStatus("試遊レポートを表示・コピーしました", active);
  } catch {
    const active = session.snapshot().phase === "launch-ready" || session.snapshot().phase === "playing";
    setStatus("試遊レポートを表示しました", active);
  }
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
      getPrototypeDiagnostics: () => GaSessionDiagnostics;
      getSnapshot: () => GaSessionSnapshot;
      reset: (physicsStepHz?: PhysicsStepHz) => void;
      reinitializeRenderer: () => Promise<boolean>;
    };
    __DOPPAN_GA__?: {
      getPrototypeDiagnostics: () => GaSessionDiagnostics;
      getSessionDiagnostics: () => GaSessionDiagnostics;
      getSnapshot: () => GaSessionSnapshot;
      getPlaytestReport: () => ReturnType<GaSession["playtestReport"]>;
      getPlaytestReportJson: () => string;
      reset: (physicsStepHz?: PhysicsStepHz) => void;
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
  getPrototypeDiagnostics: () => session.diagnostics(),
  getSnapshot: () => session.snapshot(),
  reset: (physicsStepHz = session.physicsStepHz) => {
    hzSelect.value = String(physicsStepHz);
    session.reset(physicsStepHz);
    setInputDisabled(runtime === null);
    const snapshot = session.snapshot();
    runtime?.updatePrototype(snapshot);
    updateGraybox(snapshot);
    updateSessionUi(snapshot);
    runtime?.step(0);
    if (runtime !== null) {
      setInputDisabled(false);
      if (!gameLoop.isRunning) {
        gameLoop.start();
      }
    }
    updateDiagnostics(session.diagnostics());
  },
  reinitializeRenderer: initializePixiRuntime,
};

window.__DOPPAN_GA__ = {
  getPrototypeDiagnostics: () => session.diagnostics(),
  getSessionDiagnostics: () => session.diagnostics(),
  getSnapshot: () => session.snapshot(),
  getPlaytestReport: () => session.playtestReport(),
  getPlaytestReportJson: () => session.playtestReportJson(),
  reset: (physicsStepHz = session.physicsStepHz) => {
    hzSelect.value = String(physicsStepHz);
    resetPrototype();
  },
};

void initializePixiRuntime();
