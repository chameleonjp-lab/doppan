import "./styles.css";
import { BUILD_INFO } from "./build-info";
import { registerGameLoopHmrDispose } from "./runtime";
import { PachiSession } from "./game/pachi-session";
import { clampPachiPowerIndex, PACHI_DEFAULT_POWER_INDEX, pachiPowerForIndex } from "./game/pachi-power";
import type { PachiSessionEvent, PachiSessionSnapshot } from "./game/pachi-types";
import {
  applyPachiFeedbackEvent,
  createPachiFeedbackState,
  getPachiChargeText,
  getPachiVisualState,
  syncPachiFeedback,
  type PachiFeedbackState,
} from "./presentation/pachi-feedback";
import { createPachiRenderer, PACHI_SCREEN_RECT, type PachiRenderer } from "./rendering/pachi-renderer";
import { PachiAudio } from "./ui/pachi-audio";
import { cleanPlayerName, gameUrl, readPreference, savePreference, shareGame, readHistoricalRanking, PACHI_RULE_VERSION } from "./ui/pachi-platform";

function element<T extends Element>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Missing game element: ${selector}`);
  return found;
}
const root = element<HTMLElement>("[data-app-root]");
const ui = {
  score: element<HTMLElement>("[data-score]"), time: element<HTMLElement>("[data-time]"), stock: element<HTMLElement>("[data-stock]"),
  event: element<HTMLElement>("[data-event]"), power: element<HTMLInputElement>("#power"), powerValue: element<HTMLOutputElement>("[data-power-value]"),
  fire: element<HTMLButtonElement>("[data-action=fire]"), push: element<HTMLButtonElement>("[data-action=push]"), pause: element<HTMLButtonElement>("[data-action=pause]"), finish: element<HTMLButtonElement>("[data-action=finish]"),
  start: element<HTMLButtonElement>("[data-action=start]"), name: element<HTMLInputElement>("#player-name"), nameStatus: element<HTMLElement>("[data-name-status]"),
  display: element<HTMLElement>("[data-reel-display]"), mode: element<HTMLElement>("[data-mode]"), title: element<HTMLElement>("[data-spin-title]"), detail: element<HTMLElement>("[data-spin-detail]"),
  reels: [...document.querySelectorAll<HTMLElement>("[data-reel]")], pending: element<HTMLElement>("[data-pending]"), pendingCount: element<HTMLElement>("[data-pending-count]"),
  lights: [...document.querySelectorAll<HTMLElement>(".pending-lights i")], charge: element<HTMLProgressElement>("[data-charge]"), chargeLabel: element<HTMLElement>("[data-charge-label]"),
  mouths: {
    start: element<HTMLElement>("[data-mouth-label=start]"),
    attacker: element<HTMLElement>("[data-mouth-label=attacker]"),
  },
  banner: element<HTMLElement>("[data-win-banner]"), winNote: element<HTMLElement>("[data-win-note]"), loading: element<HTMLElement>("[data-loading]"),
  error: element<HTMLElement>("[data-error]"), errorText: element<HTMLElement>("[data-error-text]"), host: element<HTMLElement>("[data-canvas-host]"),
  sound: element<HTMLButtonElement>("[data-action=sound]"), reduced: element<HTMLInputElement>("[data-reduced-motion]"),
};
const dialogs = {
  start: element<HTMLDialogElement>("[data-dialog=start]"), help: element<HTMLDialogElement>("[data-dialog=help]"),
  pause: element<HTMLDialogElement>("[data-dialog=pause]"), result: element<HTMLDialogElement>("[data-dialog=result]"),
};
const controller = new AbortController();
const signal = controller.signal;
const audio = new PachiAudio();
let renderer: PachiRenderer | null = null;
let disposed = false;
let fatal = false;
let session = newSession();
let playerName = cleanPlayerName(readPreference("doppan.player-name") ?? "");
let soundEnabled = false;
let reducedMotion = readPreference("doppan:pachi:reduced-motion") === "true" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let pointerId: number | null = null;
let keyboardFiring = false;
let resultShown = false;
let displayedTicket: number | null = null;
let lastDigits: readonly number[] = [7, 7, 7];
let helpOrigin: "start" | "game" | "pause" | "result" = "start";
let rankingRequest: AbortController | null = null;
let rankingLoaded = false;
let resultText = "";
let audioGeneration = 0;
let feedback: PachiFeedbackState = createPachiFeedbackState();
const machine = element<HTMLElement>("[data-machine]");
const playArea = element<HTMLElement>(".play-area");
const fitMachine = (): void => {
  const width = Math.min(playArea.clientWidth, playArea.clientHeight * 720 / 900);
  machine.style.width = `${width}px`;
  machine.style.height = `${width * 900 / 720}px`;
};
const layoutObserver = new ResizeObserver(fitMachine);
layoutObserver.observe(playArea);
fitMachine();
const debug = new URLSearchParams(window.location.search).get("debug") === "1";
root.dataset.buildSha = BUILD_INFO.sha;
root.dataset.ruleVersion = PACHI_RULE_VERSION;
ui.name.value = playerName;
ui.reduced.checked = reducedMotion;

function setPowerIndex(index: number): void {
  const presetIndex = clampPachiPowerIndex(index);
  const power = pachiPowerForIndex(presetIndex);
  const displayValue = String(Math.round(power * 100));
  ui.power.value = String(presetIndex);
  ui.powerValue.value = displayValue;
  ui.power.setAttribute("aria-valuetext", displayValue);
  session.setPower(power);
}

setPowerIndex(PACHI_DEFAULT_POWER_INDEX);

function newSession(): PachiSession {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  const params = new URLSearchParams(window.location.search);
  const debugSeed = Number(params.get("seed"));
  const seed = params.get("debug") === "1" && params.has("seed") && Number.isSafeInteger(debugSeed) ? debugSeed : (values[0] ?? 1);
  return new PachiSession({ seed });
}

function setText(target: HTMLElement, value: string): void {
  if (target.textContent !== value) target.textContent = value;
}
function setSoundControl(enabled: boolean): void {
  ui.sound.textContent = enabled ? "音 ON" : "音 OFF";
  ui.sound.setAttribute("aria-pressed", String(enabled));
}
function applyAudioResult(generation: number, enabled: boolean): void {
  if (disposed || generation !== audioGeneration) return;
  soundEnabled = enabled;
  setSoundControl(enabled);
}
function suspendAudio(): void {
  const generation = ++audioGeneration;
  void audio.setSuspended(true).then((enabled) => applyAudioResult(generation, enabled));
}
function resumeAudio(): void {
  const generation = ++audioGeneration;
  void audio.setSuspended(false).then((enabled) => applyAudioResult(generation, enabled));
}
function listen(action: string, callback: () => void): void {
  element<HTMLButtonElement>(`[data-action=${action}]`).addEventListener("click", callback, { signal });
}
function closeDialogs(): void { for (const dialog of Object.values(dialogs)) if (dialog.open) dialog.close(); }
function openDialog(dialog: HTMLDialogElement): void { closeDialogs(); if (!dialog.open) dialog.showModal(); }
function activeGame(snapshot = session.snapshot()): boolean { return snapshot.phase === "playing" || snapshot.phase === "settling"; }
function canFire(snapshot: PachiSessionSnapshot): boolean {
  return !fatal && renderer !== null && !snapshot.paused && snapshot.ballsRemaining > 0 &&
    (snapshot.phase === "playing" || (snapshot.phase === "settling" && snapshot.jackpotRemaining > 0));
}
function releaseFire(): void {
  const captured = pointerId;
  pointerId = null;
  keyboardFiring = false;
  session.setFiring(false);
  if (captured !== null && ui.fire.hasPointerCapture(captured)) ui.fire.releasePointerCapture(captured);
  ui.fire.dataset.firing = "false";
}
function syncFire(): void { session.setFiring((pointerId !== null || keyboardFiring) && canFire(session.snapshot())); }

function acknowledgePush(): void {
  const snapshot = session.snapshot();
  if (snapshot.spin.pushState !== "ready") return;
  if (!session.acknowledgePush(snapshot.spin.ticket ?? undefined)) return;
  // Publish the acknowledgement and its short cue in the same input turn so
  // keyboard and touch users see no frame of ambiguous state.
  for (const event of session.drainEvents()) handleEvent(event);
  updateUi(session.snapshot());
}

function pauseGame(): void {
  if (!activeGame() || fatal) return;
  releaseFire();
  session.setPaused(true);
  suspendAudio();
  loop.discardElapsedTime();
  if (!dialogs.help.open) openDialog(dialogs.pause);
  updateUi(session.snapshot());
}
function resumeGame(): void {
  if (!activeGame() || fatal) return;
  closeDialogs();
  releaseFire();
  loop.discardElapsedTime();
  session.setPaused(false);
  resumeAudio();
  updateUi(session.snapshot());
  ui.fire.focus({ preventScroll: true });
}
function finishGame(): void {
  element<HTMLElement>("[data-result-end-note]").textContent = "ここまでの保留を精算しました。";
  releaseFire();
  closeDialogs();
  session.setPaused(false);
  resumeAudio();
  session.finish();
  loop.discardElapsedTime();
  const snapshot = session.snapshot();
  for (const event of session.drainEvents()) handleEvent(event, snapshot);
  updateUi(snapshot);
}
function startGame(): void {
  if (!renderer || fatal || activeGame()) return;
  const value = cleanPlayerName(ui.name.value);
  if (!value) { setText(ui.nameStatus, "名前を入力してください。"); ui.name.focus(); return; }
  playerName = value;
  savePreference("doppan.player-name", value);
  rankingRequest?.abort();
  rankingLoaded = false;
  element<HTMLDetailsElement>(".ranking-details").open = false;
  resultShown = false;
  element<HTMLElement>("[data-result-end-note]").textContent = "";
  displayedTicket = null;
  lastDigits = [7, 7, 7];
  feedback = createPachiFeedbackState();
  setText(ui.event, "強さを調整して、中央の入賞口を狙おう。");
  session.destroy();
  session = newSession();
  setPowerIndex(Number(ui.power.value));
  session.start();
  const snapshot = session.snapshot();
  for (const event of session.drainEvents()) handleEvent(event, snapshot);
  closeDialogs();
  resumeAudio();
  loop.discardElapsedTime();
  updateUi(snapshot);
  ui.fire.focus({ preventScroll: true });
}
function showHelp(): void {
  helpOrigin = dialogs.start.open ? "start" : dialogs.result.open ? "result" : dialogs.pause.open ? "pause" : "game";
  if (activeGame()) { releaseFire(); session.setPaused(true); suspendAudio(); }
  openDialog(dialogs.help);
}
function closeHelp(): void {
  if (helpOrigin === "game") resumeGame();
  else openDialog(dialogs[helpOrigin]);
}

function renderReels(snapshot: PachiSessionSnapshot): void {
  const spin = snapshot.spin;
  ui.display.dataset.stage = spin.stage;
  if (spin.ticket !== displayedTicket) { displayedTicket = spin.ticket; }
  if (spin.finalDigits) {
    if (spin.stopped.every(Boolean)) lastDigits = spin.finalDigits.map((digit, index) => digit ?? lastDigits[index] ?? 7);
    ui.reels.forEach((reel, index) => {
      const moving = !spin.stopped[index];
      reel.dataset.spinning = String(moving);
      const value = moving ? (reducedMotion ? "·" : String((Math.floor(spin.elapsed * 12) + index * 3) % 10)) : String(spin.finalDigits?.[index] ?? 7);
      setText(reel, value);
    });
  } else {
    ui.reels.forEach((reel, index) => { reel.dataset.spinning = "false"; setText(reel, String(lastDigits[index] ?? 7)); });
  }
  const judging = snapshot.rushStage === "judge";
  const opening = snapshot.jackpotRemaining > 0;
  const judgment = `継続判定 ${snapshot.rushRound} / 3`;
  ui.display.dataset.rushStage = snapshot.rushStage;
  setText(ui.mode, snapshot.rushStage !== "idle" ? `RUSH ${snapshot.rushRound} / 3` : "DOPPAN CHANCE");
  setText(ui.title, judging ? judgment : opening ? `RUSH ${snapshot.rushRound} / 3` : spin.stage === "preview" ?
    (spin.cue === "guaranteed" ? "大当たり保証！" : "保留がたまった！") : spin.title ||
    (snapshot.phase === "settling" ? "最後の玉を見届けよう" : snapshot.charge >= 5 ? "次の抽選で、大当たり" : "中央の入賞口を狙おう"));
  const detail = judging ? "結果を待とう。" : opening ? `得点口 あと${snapshot.jackpotRemaining.toFixed(1)}秒` :
    spin.stage === "revival" ? (spin.stopped[1] ? "まだ、終わらない" : "再始動！ ここから巻き返す") : spin.stage === "preview" && spin.cue === "guaranteed" ? "この保留で大当たり" :
    spin.stage === "reach" ? "あと、ひとつ。" : spin.stage === "reveal" && spin.reveal === "miss" ? snapshot.charge >= 5 ? "次は大当たり" : getPachiChargeText(snapshot) :
    snapshot.pending >= 4 ? "保留満タン · 発射を休めます" : "3つそろえば大当たり";
  setText(ui.detail, detail);
  setText(ui.pendingCount, `${snapshot.pending} / 4`);
  const guarantees = snapshot.pendingCues.filter((cue) => cue === "guaranteed").length;
  ui.pending.setAttribute("aria-label", `保留${snapshot.pending}件${guarantees ? `、大当たり保証${guarantees}件` : ""}`);
  ui.lights.forEach((light, index) => {
    light.dataset.active = String(index < snapshot.pending);
    light.dataset.cue = snapshot.pendingCues[index] ?? "normal";
    light.title = light.dataset.cue === "guaranteed" ? "大当たり保証の保留" : "保留";
  });
  ui.charge.value = snapshot.charge;
  setText(ui.chargeLabel, snapshot.charge >= 5 ? "次は大当たり" : `チャージ ${snapshot.charge} / 5`);
  // The reward accent stays inside the LCD and appears only for the initial award.
  ui.banner.hidden = !(snapshot.rushRound === 1 && snapshot.jackpotRemaining > 4.8);
  setText(ui.winNote, "得点口が開いた！");
}

function handleEvent(event: PachiSessionEvent, eventSnapshot = session.snapshot()): void {
  audio.play(event);
  if (event.type === "deadline" && event.reason) {
    element<HTMLElement>("[data-result-end-note]").textContent = event.reason === "balls-exhausted" ?
      "持ち玉と保留を使い切ったため、終了しました。" : "90秒の発射と、残った保留を精算した結果です。";
  }
  feedback = applyPachiFeedbackEvent(feedback, event, eventSnapshot);
  if (feedback.text) setText(ui.event, feedback.text);
  if (event.type === "deadline") releaseFire();
}

function updatePocketLabels(snapshot: PachiSessionSnapshot): void {
  const startState = snapshot.phase === "settling" || snapshot.phase === "result"
    ? "settling"
    : snapshot.phase === "playing" && snapshot.pending >= 4
      ? "full"
      : "available";
  const attackerState = snapshot.jackpotRemaining > 0
    ? "open"
    : snapshot.phase === "settling"
      ? "settling"
      : "closed";

  ui.mouths.start.dataset.pocketState = startState;
  ui.mouths.attacker.dataset.pocketState = attackerState;
  setText(ui.mouths.start, startState === "full" ? "START 保留満タン" : startState === "settling" ? "START 精算中" : "START +50点 / +3玉");
  setText(ui.mouths.attacker, attackerState === "open" ? "OPEN +100点 / +5玉" : attackerState === "settling" ? "得点口 精算中" : "得点口 CLOSED");
}

function updateUi(snapshot: PachiSessionSnapshot): void {
  feedback = syncPachiFeedback(feedback, snapshot);
  if (feedback.text) setText(ui.event, feedback.text);
  else if (snapshot.phase === "idle") setText(ui.event, "名前を入力して、ゲームを始めよう。");
  else if (snapshot.phase === "result") setText(ui.event, "今回の結果を確認しよう。");
  else if (feedback.guard === "none") setText(ui.event, "");
  root.dataset.phase = snapshot.phase;
  root.dataset.paused = String(snapshot.paused);
  root.dataset.fired = String(snapshot.stats.fired);
  root.dataset.startEntries = String(snapshot.stats.startEntries);
  root.dataset.jackpots = String(snapshot.stats.jackpotCount);
  root.dataset.attackerEntries = String(snapshot.stats.attackerEntries);
  root.dataset.spinStage = snapshot.spin.stage;
  root.dataset.rushStage = snapshot.rushStage;
  root.dataset.rushRound = String(snapshot.rushRound);
  const visualState = getPachiVisualState(snapshot);
  root.dataset.focusTarget = visualState.target;
  root.dataset.presentationStage = visualState.stage;
  setText(ui.score, snapshot.score.toLocaleString("ja-JP"));
  ui.score.parentElement?.setAttribute("data-negative", String(snapshot.score < 0));
  setText(ui.time, snapshot.phase === "settling" ? "精算中" : `${Math.ceil(snapshot.timeRemaining)}秒`);
  setText(ui.stock, String(snapshot.ballsRemaining));
  const playable = activeGame(snapshot) && !snapshot.paused && !fatal;
  ui.fire.disabled = !canFire(snapshot);
  ui.fire.dataset.firing = String(snapshot.firing && !snapshot.paused && !ui.fire.disabled);
  const pushState = snapshot.spin.pushState;
  ui.push.disabled = !activeGame(snapshot) || snapshot.paused || fatal || pushState !== "ready";
  ui.push.dataset.pushState = pushState;
  root.dataset.pushState = pushState;
  ui.push.textContent = pushState === "accepted" ? "受付済" : "PUSH";
  ui.push.setAttribute("aria-label", pushState === "accepted" ? "PUSH受付済み" : "PUSH演出の合図");
  ui.display.dataset.pushAccepted = String(pushState === "accepted");
  ui.power.disabled = !playable;
  ui.pause.disabled = !activeGame(snapshot) || fatal;
  ui.finish.disabled = !activeGame(snapshot) || fatal;
  updatePocketLabels(snapshot);
  renderReels(snapshot);
  if (snapshot.phase === "result" && !resultShown) showResult(snapshot);
}

function showResult(snapshot: PachiSessionSnapshot): void {
  resultShown = true;
  releaseFire();
  openDialog(dialogs.result);
  element<HTMLElement>("[data-result-player]").textContent = `${playerName}さん`;
  element<HTMLElement>("[data-result-score]").textContent = snapshot.score.toLocaleString("ja-JP");
  element<HTMLElement>("[data-result-jackpots]").textContent = `${snapshot.stats.jackpotCount}回`;
  element<HTMLElement>("[data-result-starts]").textContent = `${snapshot.stats.startEntries}回`;
  element<HTMLElement>("[data-result-attacker]").textContent = `${snapshot.stats.attackerEntries}回`;
  element<HTMLElement>("[data-result-fired]").textContent = `${snapshot.stats.fired}発`;
  element<HTMLElement>("[data-result-side]").textContent = `${snapshot.stats.sideEntries}回`;
  element<HTMLElement>("[data-result-rush]").textContent = `${snapshot.stats.rushContinuations}回`;
  const breakdown = element<HTMLElement>("[data-result-breakdown]");
  breakdown.replaceChildren();
  const parts = [["発射による減点", snapshot.scoreParts.shots], ["中央・副入賞", snapshot.scoreParts.start + snapshot.scoreParts.side], ["大当たり", snapshot.scoreParts.jackpot], ["得点口の入賞", snapshot.scoreParts.attacker]] as const;
  for (const [label, score] of parts) {
    const row = document.createElement("div"); const term = document.createElement("dt"); const value = document.createElement("dd");
    term.textContent = label; value.textContent = `${score > 0 ? "+" : ""}${score.toLocaleString("ja-JP")}点`; row.append(term, value); breakdown.append(row);
  }
  const hint = snapshot.stats.fired === 0 ? "発射ボタンを押している間、玉が出ます。次は強さを動かして、飛び方を見てみよう。" :
    snapshot.stats.startEntries < 3 ? "中央に届きにくい時は、強さを95に戻してみよう。50・80・95の3段階で、玉の落ちる場所を見比べられます。" :
    snapshot.stats.jackpotCount > 0 && snapshot.stats.attackerEntries === 0 ? "大当たり中の得点口も、強さで狙えます。開いている6秒が稼ぎどころです。" :
    `中央に${snapshot.stats.startEntries}回入賞。保留が満タンの間は発射を休むと、玉と減点を抑えられます。`;
  element<HTMLElement>("[data-result-hint]").textContent = hint;
  resultText = `【ドッパン】${playerName} / ${snapshot.score.toLocaleString("ja-JP")}点 / 大当たり${snapshot.stats.jackpotCount}回 / 中央入賞${snapshot.stats.startEntries}回\n90秒ルール v1\n${gameUrl()}\n#ドッパン #カメレオンJP`;
  element<HTMLTextAreaElement>("[data-share-text]").value = resultText;
  element<HTMLTextAreaElement>("[data-share-text]").hidden = true;
  element<HTMLElement>("[data-share-status]").textContent = "";
  element<HTMLElement>("[data-ranking-status]").textContent = "新ルールのランキングは準備中です。今回の結果はシェアできます。";
  element<HTMLOListElement>("[data-ranking-list]").replaceChildren();
}

async function loadRanking(): Promise<void> {
  const details = element<HTMLDetailsElement>(".ranking-details");
  if (!details.open || rankingLoaded || !resultShown) return;
  rankingLoaded = true;
  rankingRequest?.abort();
  const request = new AbortController(); rankingRequest = request;
  const timeout = window.setTimeout(() => request.abort(), 7000);
  const status = element<HTMLElement>("[data-ranking-status]");
  setText(status, "新ルールは準備中です。旧3球ルールの参考記録を読み込みます…");
  try {
    const rows = await readHistoricalRanking(request.signal);
    if (request.signal.aborted || !resultShown) return;
    setText(status, "新ルールは準備中です。以下は旧3球ルールの記録で、今回の得点とは比較できません。");
    const list = element<HTMLOListElement>("[data-ranking-list]"); list.replaceChildren();
    for (const row of rows) { const item = document.createElement("li"); item.textContent = `${row.name}：${row.score.toLocaleString("ja-JP")}点`; list.append(item); }
    if (!rows.length) setText(status, "新ルールのランキングは準備中です。旧ルールの記録はありません。");
  } catch {
    if (rankingRequest === request && resultShown) { setText(status, "旧ルールの記録を読み込めませんでした。開き直すと再試行できます。新ルールのランキングは準備中です。"); rankingLoaded = false; }
  } finally { window.clearTimeout(timeout); }
}

async function share(text: string, home = false): Promise<void> {
  const outcome = await shareGame(text);
  const status = home ? ui.nameStatus : element<HTMLElement>("[data-share-status]");
  if (outcome === "cancelled" || disposed) return;
  setText(status, outcome === "shared" ? "共有しました。" : outcome === "copied" ? "シェア文をコピーしました。" : "コピー用の文を表示しました。");
  if (outcome === "manual") {
    if (home) { ui.nameStatus.textContent = text; ui.nameStatus.style.userSelect = "text"; }
    else { const copy = element<HTMLTextAreaElement>("[data-share-text]"); copy.hidden = false; copy.focus(); copy.select(); }
  }
}

function fail(error: unknown): void {
  if (fatal || disposed) return;
  fatal = true;
  releaseFire();
  session.setPaused(true);
  suspendAudio();
  closeDialogs();
  ui.loading.hidden = true;
  ui.error.hidden = false;
  ui.errorText.textContent = "盤面を表示できませんでした。読み込み直してください。";
  root.dataset.error = "true";
  ui.start.disabled = true;
  updateUi(session.snapshot());
  if (debug) console.error(error);
}

const loop = registerGameLoopHmrDispose((deltaMs) => {
  if (fatal || disposed) return;
  // Visibility/blur pauses rather than paying a multi-second backlog on return.
  if (deltaMs > 250 && activeGame()) { pauseGame(); return; }
  const snapshot = session.step(Math.min(deltaMs, 250));
  for (const event of session.drainEvents()) handleEvent(event, snapshot);
  updateUi(snapshot);
  renderer?.render(snapshot, reducedMotion);
}, import.meta.hot, { onError: fail, onDispose: dispose });

function dispose(): void {
  if (disposed) return;
  disposed = true;
  ++audioGeneration;
  controller.abort();
  layoutObserver.disconnect();
  rankingRequest?.abort();
  loop.dispose();
  audio.destroy();
  renderer?.destroy();
  renderer = null;
  session.destroy();
}

ui.fire.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || pointerId !== null || !canFire(session.snapshot())) return;
  event.preventDefault(); pointerId = event.pointerId; ui.fire.setPointerCapture(event.pointerId); syncFire();
}, { signal });
for (const type of ["pointerup", "pointercancel", "lostpointercapture"] as const) {
  ui.fire.addEventListener(type, (event) => { if (event.pointerId === pointerId) { pointerId = null; syncFire(); } }, { signal });
}
ui.fire.addEventListener("contextmenu", (event) => event.preventDefault(), { signal });
ui.push.addEventListener("click", acknowledgePush, { signal });
root.addEventListener("dblclick", (event) => { if (!(event.target instanceof HTMLInputElement)) event.preventDefault(); }, { signal });
ui.power.addEventListener("input", () => { setPowerIndex(Number(ui.power.value)); }, { signal });
element<HTMLFormElement>("[data-start-form]").addEventListener("submit", (event) => { event.preventDefault(); startGame(); }, { signal });
listen("pause", pauseGame); listen("resume", resumeGame); listen("finish", finishGame); listen("finish-paused", finishGame);
listen("help", showHelp); listen("close-help", closeHelp); listen("reload", () => window.location.reload());
listen("restart", () => { closeDialogs(); resultShown = false; startGame(); });
listen("share-home", () => { void share(`【ドッパン】狙って、ためて、大当たり。90秒でスコアを競おう！\n${gameUrl()}`, true); });
listen("share-result", () => { void share(resultText); });
ui.sound.addEventListener("click", () => {
  const generation = ++audioGeneration;
  soundEnabled = !soundEnabled;
  setSoundControl(soundEnabled);
  void audio.setEnabled(soundEnabled).then((enabled) => applyAudioResult(generation, enabled));
}, { signal });
ui.reduced.addEventListener("change", () => { reducedMotion = ui.reduced.checked; savePreference("doppan:pachi:reduced-motion", String(reducedMotion)); }, { signal });
element<HTMLDetailsElement>(".ranking-details").addEventListener("toggle", () => { void loadRanking(); }, { signal });
for (const dialog of [dialogs.start, dialogs.result]) dialog.addEventListener("cancel", (event) => event.preventDefault(), { signal });
dialogs.help.addEventListener("cancel", (event) => { event.preventDefault(); closeHelp(); }, { signal });
dialogs.pause.addEventListener("cancel", (event) => { event.preventDefault(); resumeGame(); }, { signal });
window.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || document.querySelector("dialog[open]")) return;
  if (event.code === "Escape") { event.preventDefault(); pauseGame(); return; }
  if (!activeGame() || session.snapshot().paused || fatal) return;
  if (event.code === "Space") {
    // Let native controls (including PUSH) handle their own Space activation;
    // the fire button is the one intentional exception for keyboard firing.
    const interactive = event.target instanceof Element ? event.target.closest("button,a,summary,select,[contenteditable=true]") : null;
    if (interactive !== null && interactive !== ui.fire) return;
    if (canFire(session.snapshot())) { event.preventDefault(); keyboardFiring = true; syncFire(); }
  }
  if (event.code === "ArrowLeft" || event.code === "ArrowRight") {
    event.preventDefault();
    setPowerIndex(Number(ui.power.value) + (event.code === "ArrowLeft" ? -1 : 1));
  }
}, { signal });
window.addEventListener("keyup", (event) => {
  if (event.code === "Space") { keyboardFiring = false; syncFire(); }
}, { signal });
window.addEventListener("blur", pauseGame, { signal });
document.addEventListener("visibilitychange", () => { if (document.hidden) pauseGame(); loop.discardElapsedTime(); }, { signal });
window.addEventListener("pagehide", pauseGame, { signal });
window.addEventListener("pageshow", () => loop.discardElapsedTime(), { signal });

async function boot(): Promise<void> {
  try {
    const created = await createPachiRenderer({ host: ui.host, onFatalError: fail, forceWebGLFailure: new URLSearchParams(location.search).get("webgl") === "off" });
    if (disposed || fatal) { created.destroy(); return; }
    renderer = created;
    const screen = session.snapshot().geometry.screen ?? PACHI_SCREEN_RECT;
    ui.display.style.left = `${screen.x / 720 * 100}%`;
    ui.display.style.top = `${screen.y / 900 * 100}%`;
    ui.display.style.width = `${screen.width / 720 * 100}%`;
    ui.display.style.height = `${screen.height / 900 * 100}%`;
    const board = session.snapshot().geometry;
    for (const kind of ["start", "attacker"] as const) {
      const mouth = board[kind];
      const label = element<HTMLElement>(`[data-mouth-label=${kind}]`);
      label.style.left = `${(mouth.x + mouth.width / 2) / board.width * 100}%`;
      label.style.top = `${(mouth.y + mouth.height + 8) / board.height * 100}%`;
    }
    renderer.render(session.snapshot(), reducedMotion);
    ui.loading.hidden = true;
    ui.start.disabled = false;
    root.dataset.ready = "true";
    updateUi(session.snapshot());
    openDialog(dialogs.start);
    loop.start();
  } catch (error) { fail(error); }
}
void boot();
