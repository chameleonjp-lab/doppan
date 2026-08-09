# DOPPAN ゲームエンジン設計

- 文書種別: ゲームループ・入力・物理イベント・状態管理・盤面実行状態
- 作成日: 2026-08-09
- 最終更新日: 2026-08-10
- 版: 2.2
- 状態: G1-A検証中・G1-B開始前
- 現在地: [制作状況](./PRODUCTION_STATUS.md)
- 関連文書:
  - [推奨実装計画書](./IMPLEMENTATION_PLAN.md)
  - [自動試験・確認ページ計画](./TEST_AND_PREVIEW_PLAN.md)
  - [公開・プレビュー・安全運用計画](./DEPLOYMENT_AND_SECURITY_PLAN.md)
  - [データ非保存・GitHub運用方針](./DATA_AND_HOSTING_POLICY.md)
  - [品質ゲート定義](./QUALITY_GATES.md)
  - [中心体験・表現計画](./CORE_EXPERIENCE_PLAN.md)
  - [意思決定記録](./DECISION_LOG.md)
  - [2026-08-10意思決定追補](./DECISION_LOG_2026-08-10.md)

## 1. この文書の役割

本書は、DOPPANのゲームエンジン内部で、入力、物理、ルール、状態、表示をどの順番と境界で動かすかの正本である。

次を一つの実装担当者の解釈へ任せない。

- 短いタップを物理計算へ確実に渡す方法
- 一回の物理更新で何をどの順番に処理するか
- PixiJSと独自ループの二重起動を防ぐ方法
- 接触通知を得点や盤面変化へ安全に変換する方法
- 接触中に物理世界を変更しない方法
- 描画速度とゲーム速度を分ける方法
- 一時停止と球終了が同時に起きた時の扱い
- 盤面の初期定義とプレイ中の状態を分ける方法
- ショットの途中状態を球ごとに管理する方法
- 異常な球をどこへ戻すか
- 診断履歴、表示物、音、イベント購読が増え続けない方法
- 重い端末で時間を切り捨てたゲームの公正性をどう表示するか
- 一回のゲーム状態をメモリ内だけに閉じる方法
- 非個人設定とゲーム記録を混ぜない方法

作品固有の得点や進行は別文書で決める。本書は、それらを安全かつ再現可能に実行する土台を定める。

データ、個人アカウント、外部通信について衝突がある場合は、[データ非保存・GitHub運用方針](./DATA_AND_HOSTING_POLICY.md)を優先する。

---

## 2. G1-Aで固定した依存関係

実装では、パッケージ名と版を`package.json`と`package-lock.json`へ固定する。

| 用途 | 固定版 | 備考 |
|---|---|---|
| Node.js | 24.19.0 | GitHub Actionsと`.nvmrc`で固定 |
| npm | 11.17.0 | `packageManager`とCIで固定 |
| TypeScript | 6.0.3 | 開発用依存 |
| PixiJS | `pixi.js` 8.19.0 | 実行時依存 |
| Planck.js | `planck` 1.5.0 | G1-Aは読込確認のみ。旧`planck-js`を使わない |
| Vite | 8.1.5 | 開発・ビルド |
| Vitest | 4.1.10 | 単体・Planck読込確認 |
| Playwright Test | 1.61.1 | Chromium・WebKit試験 |
| ESLint | 10.8.1 | 静的検査 |
| typescript-eslint | 8.66.0 | TypeScript用規則 |
| `@types/node` | 24.13.3 | 開発用型 |

方針:

- 「最新」であることより、組み合わせて試験を通過することを優先する
- 依存版は範囲指定だけに頼らずlockファイルで固定する
- `packageManager`へnpmの正確な版を記録する
- 依存更新はゲーム機能と別のpull requestで行う
- 第三者Actionも完全なコミットSHAへ固定する
- 実行時依存はPixiJSとPlanck.jsを中心に保つ
- 認証、ランキング、外部DB、外部分析、広告用の依存を正式版1.0へ追加しない

---

## 3. 物理座標と画面座標

### 3.1 物理単位

Planck.jsへCSSピクセルを直接渡さない。

初期候補:

```text
盤面横幅       9.0物理単位
盤面高さ      16.0物理単位前後
球直径         0.30物理単位前後
フリッパー長   1.4〜1.7物理単位
```

G1-Bで調整するが、ピクセルと物理単位を分離する方針は固定する。

### 3.2 座標規則

内部規則を次へ統一する。

```text
物理原点: 盤面左下
+x: 右
+y: 上
角度: 反時計回りを正、ラジアン
画面原点: 表示領域左上
画面+y: 下
```

### 3.3 Viewport変換

`PhysicsViewport`だけが座標変換を担当する。

```text
worldToScreen(position)
screenToWorld(position)
worldAngleToScreen(angle)
screenAngleToWorld(angle)
```

画面へ盤面全体を収め、余白は上下または左右へ置く。端末比率で物理盤面を切り取らない。

タッチ座標が盤面表示領域の外なら、フリッパー・発射入力へ変換しない。

Safariのアドレスバー伸縮などで表示領域が変わった場合は、物理値を変更せずViewportだけを更新する。

### 3.4 自動試験

- `worldToScreen`から`screenToWorld`へ戻した誤差が許容範囲内
- 左下、右上、中央、余白境界で往復確認
- 320px、390px、430px幅で盤面が見切れない
- 画面回転後も物理位置が変わらない
- 余白上のタッチをゲーム操作として扱わない

---

## 4. 更新ループの所有者

### 4.1 一つだけのループ

ゲーム全体の`requestAnimationFrame`は一つだけとする。

- 独自の`GameLoop`が時刻、物理、ルール、描画を統括
- PixiJSの自動Tickerと自動描画は停止または使用しない
- PixiJSは独自ループから手動で描画
- 同じアプリで二つ目の`requestAnimationFrame`ループを開始しない

### 4.2 二重起動防止

`GameLoop`へ世代番号を持たせる。

```text
loopGeneration
activeAnimationFrameId
loopRunning
```

開始時:

- 既に実行中なら二重開始を拒否
- 実行中世代を診断表示

終了時:

- `cancelAnimationFrame`
- 入力全解除
- イベント購読解除
- PixiJSリソースの対象範囲を破棄

開発時のHot Module Replacementでは、dispose処理で古いループを必ず停止する。

### 4.3 合格条件

- HMRまたは再初期化20回で稼働中ループ1件
- 描画回数が意図せず倍増しない
- ゲーム再開始で`requestAnimationFrame`登録が増えない

---

## 5. 入力イベントキュー

### 5.1 状態だけで管理しない

現在押されているかという状態だけでは、同じ描画間隔内に発生した短いタップを取りこぼす可能性がある。

次を分ける。

```text
InputEventQueue  # 押した、離したという順序
InputState       # 現在押されている操作
InputOwnership   # pointerIdが所有する操作
```

### 5.2 入力イベント

```text
InputEvent
- sequenceId
- source: pointer | keyboard
- sourceId: pointerId | keyCode
- action: leftFlipper | rightFlipper | launcher | pause
- phase: pressed | released | cancelled
- receivedAtMs
- assignedPhysicsStepId
```

`receivedAtMs`には`performance.now()`系の単調増加時刻を使う。

### 5.3 物理ステップへの適用

各物理ステップ開始時に、未処理イベントを`sequenceId`順で適用する。

同じ物理ステップ開始前に押下と解放の両方が届いている場合:

1. 押下を現在ステップへ適用
2. 解放を次の物理ステップまで遅延
3. 少なくとも一物理ステップは押下状態を物理へ渡す

これにより、極端に短いタップを消失させない。延長は最大一物理ステップとする。

### 5.4 キュー上限

初期上限:

```text
未処理入力イベント: 256件
```

上限超過時は古い入力を黙って捨てない。

- 全入力解除
- ゲームを安全停止または自動ポーズ
- P1相当の診断を記録

### 5.5 所有規則

- pointerIdを押し始めた操作へ固定
- 指を別領域へ動かしても操作を途中変更しない
- 同じ操作への二本目の指は無視
- 不要な三本目以降は既存操作へ影響させない
- 発射装置は発射待ち状態だけ所有可能
- `setPointerCapture`を明示的に使う

全解除条件:

- `pointerup`
- `pointercancel`
- `lostpointercapture`
- `visibilitychange`
- `window.blur`
- 球終了
- 一時停止
- 結果画面
- 重大エラー

解除も入力イベントとして記録し、最終的に`InputState`を空にする。

---

## 6. 固定時間と遅れ

G1-Bで比較する。

- 60物理ステップ/秒
- 120物理ステップ/秒

初期規則:

```text
最大追いつき時間: 66ms
60ステップ/秒: 最大4ステップ/描画
120ステップ/秒: 最大8ステップ/描画
250ms以上の差: 通常計算へ渡さない
```

処理:

- `requestAnimationFrame`の時刻で経過時間を計算
- 非表示中の時間は破棄
- 66ms超の未処理時間は記録して切り捨て
- 切り捨てが反復した場合は自動ポーズ
- 描画位置は直前と現在の物理状態から補間
- 表示負荷を下げる前に物理条件を下げない

診断値:

```text
physicsStepHz
stepsThisFrame
accumulatorMs
droppedSimulationMs
droppedSimulationCount
autoPauseReason
```

---

## 7. 正規のゲームループ

一画面描画ごとに次の順番を守る。

```text
1. ブラウザ入力イベントをInputEventQueueへ追加
2. 経過時間を固定時間用の蓄積へ追加
3. 必要な回数だけ固定物理ステップを実行
   3-1. 入力イベントを順番にInputStateへ適用
   3-2. InputStateをフリッパー・発射装置へ反映
   3-3. Planck.jsのworld.stepを実行
   3-4. 接触コールバックの値を用途別バッファへ複写
   3-5. 物理ステップ終了後に接触情報を整理
   3-6. ショット途中状態を更新
   3-7. 意味のあるゲームイベントを生成
   3-8. 得点、盤面実行状態、球終了候補を更新
   3-9. 物理変更命令を正規化して実行
   3-10. 基本状態と一時停止状態を更新
4. 表示状態へ現在のゲームイベントを反映
5. 音・触覚イベントを準備
6. 直前と現在の物理位置から表示位置を補間
7. PixiJSを一回描画
8. 音・触覚イベントを再生
9. 性能・資源・診断カウンターを更新
```

表示状態の更新を描画後へ回さない。現在の物理ステップで起きた入力反応、ライト、得点を同じ画面描画へ反映する。

禁止:

- 接触コールバック内で物体、fixture、jointを作成・削除
- 接触コールバックからUIや音を直接操作
- 描画状態を得点・ショット成功の根拠にする
- `Date.now()`をルール時間へ直接使用
- 複数箇所からゲーム状態を直接書き換える
- PixiJS Tickerと独自ループを同時稼働
- ゲームループから外部分析、ランキング、認証、外部DBへ通信
- 得点や進行を永続保存層へ渡す

物理時間をルール時間の正本とする。

---

## 8. 接触イベントの分離

接触通知を一種類の汎用イベントとして扱わない。

### 8.1 センサー遷移

```text
SensorTransitionEvent
- eventId
- physicsStepId
- ballId
- sensorId
- phase: entered | exited
- direction
- position
```

用途:

- ショット入口・出口
- レーン通過
- 落下判定
- 盤面区域の出入り

### 8.2 衝撃

```text
ImpactEvent
- eventId
- physicsStepId
- ballId
- fixtureId
- position
- normal
- relativeSpeed
- normalImpulse
```

用途:

- バンパー反発
- 接触音の強さ
- 強い衝突の演出

### 8.3 接触滞在

```text
ContactOccupancy
- ballId
- fixturePair
- beganStepId
- lastSeenStepId
- active
```

用途:

- フリッパー上の球受け
- 挟まり
- 長時間接触

### 8.4 意味イベント

物理イベントを直接得点にしない。

```text
GameEvent
- ShotCompleted
- BumperActivated
- BallEnteredDrain
- BallReceivedByFlipper
- RouteChanged
- ModeConditionCompleted
```

`ScoringEvent`は`GameEvent`から一度だけ生成する。

### 8.5 Planck.js参照

Planck.jsのcontactオブジェクトを物理ステップ後まで保持しない。必要な値だけ独自データへ複写する。

---

## 9. 重複と順序

各イベントへ単調増加するIDを付ける。

```text
physicsStepId
eventSequenceId
gameEventId
scoringEventId
```

同じ`scoringEventId`を二度処理しない。

センサー遷移、衝撃、接触滞在は用途が異なるため、同じ一般キーでまとめて重複除去しない。

同じ物理ステップ内では、`eventSequenceId`で決定的な順序を作る。

---

## 10. 物理変更命令

### 10.1 命令

物理計算中に盤面を直接変更しない。

```text
PhysicsCommand
- commandId
- physicsStepId
- sequenceId
- targetId
- type
- payload
```

種類:

- openGate
- closeGate
- enableFixture
- disableFixture
- createBody
- destroyBody
- teleportBall
- setCollisionFilter
- resetTemporaryRoute

### 10.2 競合規則

同じ対象へ複数命令がある場合、次で正規化する。

| 組み合わせ | 規則 |
|---|---|
| `destroyBody`と他命令 | `destroyBody`を優先し、他を拒否 |
| `createBody`と同じIDの作成 | P1として安全停止 |
| `openGate`と`closeGate` | sequenceIdが後の有効命令 |
| `enableFixture`と`disableFixture` | sequenceIdが後の有効命令 |
| `teleportBall`複数 | 最後の有効命令。理由を一件へ集約 |
| 破棄済み対象への命令 | 実行せずP1診断 |

命令の実行結果と`TableRuntimeState`が一致することを確認する。

### 10.3 上限

初期上限:

```text
PhysicsCommandQueue: 256件/物理ステップ
```

257件目を黙って捨てない。

- キュー処理を停止
- 物理と得点を安全停止
- P1として記録
- 再読み込み案内または開発時エラー表示

---

## 11. データの分離

### 11.1 TableDefinition

ゲーム開始前に読み込み、プレイ中に変更しない。

```text
schemaVersion
tableVersion
physicsScale
bounds
spawnPoints
fixtures
joints
sensors
shots
routes
runtimeComponentDefinitions
```

### 11.2 TableRuntimeState

プレイ中に変化する盤面状態。

```text
connectedRoutes
gateStates
enabledShots
chargeValues
awakeningStage
activeRuntimeComponents
```

### 11.3 RuleState

```text
score
ballsRemaining
permanentProgress
baseMultiplier
temporaryMultiplier
combo
climaxPreparation
activeMode
runIntegrity
```

`RuleState`は一回のゲームのメモリ内状態である。端末保存、外部送信、次回ゲームへの引き継ぎを行わない。

### 11.4 PresentationState

ルール判定の根拠にしない。

```text
highlightedTargets
activeEffects
queuedSounds
cameraShake
accessibilityOverrides
```

初期定義、実行状態、ルール、表示を同じオブジェクトへ混ぜない。

### 11.5 SettingsState

個人を識別しない設定だけを扱う。

```text
audioEnabled
audioVolume
reducedMotion
reducedParticles
reducedShake
highContrast
showFirstRunGuide
```

次を含めない。

```text
playerName
userId
deviceId
score
bestScore
scoreHistory
playCount
playedAt
```

設定はゲーム状態と別の型、別の責任で扱う。

---

## 12. 盤面データ検査

正式版1.0で盤面が一枚の間は、独自のTypeScript検査関数を第一候補とする。

拒否するもの:

- 未対応`schemaVersion`
- ID重複
- 必須座標不足
- 非有限値
- 0以下の大きさ
- 盤面外の重要部品
- 存在しない参照
- 初期球と部品の重なり
- 落下口なし
- 不正なフリッパー角度
- 不正な経路参照
- 重複ショットID
- 循環して終了不能な必須参照

検査エラーはファイル名、ID、項目、理由を返す。

---

## 13. ショット状態機械

球ごと、ショットごとに途中状態を持つ。

```text
Idle
  ↓ 正しい入口と方向
Entered
  ↓ 条件確認
Validated
  ↓ 時間内に出口
Completed
  ↓ 重複受付停止
Cooldown
  ↓ 範囲離脱または時間経過
Idle
```

失敗:

- 逆方向
- 制限時間超過
- 入口へ戻る
- 排他的ショットへ入る
- 球終了
- 盤面状態変更で無効化

記録:

```text
ballId
shotId
currentState
enteredStepId
lastTransitionStepId
direction
entranceId
exitId
failureReason
completedGameEventId
```

球終了、再開始、盤面版変更で途中状態を消す。

---

## 14. 基本状態と一時停止状態

一時停止を本体状態へ平面的に混ぜない。

### 14.1 基本状態

```text
Boot
Title
LaunchReady
Playing
BallEnding
NextBallReady
Result
FatalRecovery
```

### 14.2 一時停止状態

```text
None
ManualPause
VisibilityLost
WebGLLost
SystemInterrupted
```

`baseState`と`suspensionState`を別に保持する。

例:

```text
baseState = LaunchReady
suspensionState = VisibilityLost
```

復帰時は`baseState`を維持し、勝手に`Playing`へ移らない。

### 14.3 終端イベントの保留

球落下、ゲーム終了、重大得点確定など、消してはいけないイベントを`pendingTerminalEvents`へ一時保持する。

同じ物理ステップで球落下と画面非表示が起きた場合:

1. 球落下を保留イベントへ記録
2. 一時停止理由を`VisibilityLost`へ設定
3. 物理を停止
4. 復帰後に球終了処理を完了

安全上の一時停止が、確定済みの球終了や得点を消してはいけない。

`pendingTerminalEvents`はメモリ内だけであり、再読み込みやタブ終了から復元しない。

### 14.4 重大エラー

重大エラーは一時停止ではなく`FatalRecovery`へ移る。

- 入力全解除
- 物理停止
- 得点停止
- 非個人設定へ破損値を書かない
- ゲーム記録を保存しない
- 診断情報を表示

---

## 15. Planck.jsのG1-B初期設定

初期候補:

### 15.1 球

- dynamic body
- `bullet = true`
- `allowSleep = false`を第一候補として比較
- 円形fixture
- 衝突カテゴリを明示
- 球速上限を設定

### 15.2 フリッパー

- dynamic body
- revolute joint
- motor使用
- 角度下限・上限
- 上昇と復帰で速度またはトルクを切り替え
- 左右を鏡写しにするが同一設定値を保証しない

### 15.3 物理解法

初期候補:

```text
velocityIterations = 8
positionIterations = 3
```

60ステップ/秒と120ステップ/秒で、衝突、球受け、負荷を比較する。

### 15.4 発射

G1-Bでは、再現性の比較を優先する。

第一候補:

- 長押しまたは引き量から強度を決定
- release時に決定的なlinear impulseまたは初速を与える
- 乱数を加えない

本格的なばね部品の再現は、基本スキルショットに価値があると確認した後に判断する。

---

## 16. 安全位置と球の回復

`lastSafeBallState`を毎フレーム無条件に更新しない。

更新条件:

- 盤面有効範囲内
- 落下センサー外
- 他fixtureと不正に重ならない
- 非有限値なし
- 球速が安全上限内
- 一方向ゲート内部ではない
- 連続3物理ステップ以上正常

一時保持:

```text
position
linearVelocity
angularVelocity
physicsStepId
routeContext
```

再配置前に球半径を含む空間が空いているか確認する。

同じ位置で二回連続して異常が再発した場合、その位置を無効化し、発射待ち位置または球終了へ移る。

システム起因の回復では原則として残り球を減らさない。

`lastSafeBallState`はGameLifetime内だけで保持し、ページ再読み込みから復元しない。

---

## 17. 決定的な物理試験

物理試験で乱数を使う場合、初期値を固定し、失敗時に出力する。

試験行列:

| 軸 | 条件 |
|---|---|
| 球速 | 通常、高速、上限直前 |
| 角度 | 正面、浅い角度、角への衝突 |
| 対象 | 外周、フリッパー根元・先端、ゲート、狭い通路 |
| フリッパー | 休止、上昇中、最大角、復帰中 |
| 物理Hz | 60、120 |
| 端末負荷模擬 | 通常、描画遅延、時間切り捨て |

失敗時に記録する。

```text
seed
initialPosition
initialVelocity
physicsStepHz
fixtureIds
flipperState
failureStepId
```

簡単な一条件を10,000回繰り返しただけで高速衝突試験の合格としない。

試験結果はCI成果物または試遊レポートとして扱い、一般利用者の端末へ永続保存しない。

---

## 18. 資源の寿命

### 18.1 AppLifetime

アプリ起動からページ終了まで残す。

- PixiJS renderer
- 共通テクスチャ
- 共通UI
- 非個人設定管理
- 一つのGameLoop

### 18.2 GameLifetime

一ゲーム開始から結果終了または再挑戦まで。

- Planck.js world
- 盤面body、fixture、joint
- RuleState
- TableRuntimeState
- ゲーム内イベント購読
- 今回の結果表示用データ

GameLifetime終了時に得点、球数、進行、倍率、コンボ、結果を破棄する。

### 18.3 BallLifetime

一球ごとに作り直す。

- ball body
- 球別ショット途中状態
- 球別接触滞在
- 球別安全位置

### 18.4 EffectLifetime

短時間で破棄する。

- 粒子
- 一時ライト
- 得点ポップアップ
- 一時音声ノード

各資源を寿命区分へ登録し、開始・終了時に個数を比較する。

意図的に残すキャッシュと、漏れている資源を同じに扱わない。

---

## 19. 資源と履歴の上限

監視:

- body、fixture、joint
- PixiJS表示オブジェクト
- テクスチャ
- イベント購読
- 稼働中`requestAnimationFrame`
- 同時再生音
- 未処理入力イベント
- 接触バッファ
- 物理変更命令
- ショット途中状態
- 状態遷移履歴
- 試遊レポート容量

初期上限:

```text
稼働中ゲームループ: 1
未処理入力イベント: 256
物理変更命令: 256/ステップ
状態遷移履歴: 128
入力履歴: 512
エラー履歴: 64
試遊レポート: 256KB
同時再生音: 16
```

ここでいう履歴は現在の実行を診断する有限メモリであり、利用者のプレイ履歴ではない。

上限超過時にゲームルールに必要なデータを捨てない。安全停止し、診断を表示する。

20回のゲーム再開始後、GameLifetimeとBallLifetimeの資源が基準値へ戻ることを確認する。

---

## 20. 実行の公正性

時間切り捨てや重大復旧が起きたゲームへ`runIntegrity`を持たせる。

```text
valid
simulationTimeDropped
recoveredFromFatalRenderLoss
stateInconsistencyDetected
inputQueueOverflow
physicsCommandOverflow
```

次の場合、結果画面へ「比較に適さない可能性がある」旨を表示する。

- 大きな物理時間切り捨てが反復
- 入力キュー上限超過
- 物理変更命令上限超過
- 状態不整合から回復
- 重大な描画復旧でルール継続性を保証できない

DOPPANは得点、最高得点、履歴、ランキングを保存しないため、`runIntegrity`を保存可否や送信可否の判定へ使わない。

通常の手動ポーズや画面非表示による安全停止だけでは、正しく復帰できた場合に結果を無効と表示しない。

`runIntegrity`もGameLifetime終了時に破棄する。

---

## 21. 非個人設定の保存境界

端末内へ保存できるのは`SettingsState`だけとする。

環境別キー:

```text
doppan:development-preview:settings:v1
doppan:production:settings:v1
doppan:test:settings:v1
```

安全な更新:

1. 一時キーへ書く
2. 読み戻す
3. 型と禁止フィールドを検査
4. 正式キーへ反映
5. 一時キーを削除

設定保存が失敗した場合は安全な初期値で続ける。

禁止:

- `RuleState`、`TableRuntimeState`、結果データを保存APIへ渡す
- `localStorage`、`IndexedDB`、Cookieへゲーム記録を書く
- URLへゲーム進行を復元可能な形式で埋め込む
- 設定データへ名前、ID、得点、日時、回数を追加する

既存の汎用保存部品は設定専用の型と名称へ狭める。

---

## 22. G1の分割

### G1-A: 技術基盤

- package設定とlockファイル
- TypeScript、ESLint、Vitest、Playwright
- GitHub Actions
- GitHub Pagesの未告知確認ページ
- PixiJS起動画面
- 単一GameLoopの骨格
- 環境名、コミットSHA表示
- 非個人設定キーの環境分離

### G1-B: ピンボール技術試作

- Planck.js world
- 左右フリッパー2本
- 球、外周壁
- 発射装置と発射レーン
- 発射強度3区画
- 安全ショット通路1本
- InputEventQueue
- 接触イベント分離
- PhysicsCommandQueue
- 基本状態と一時停止状態
- 一回のゲーム状態をメモリ内へ閉じる試験
- 物理試験とiPhone実機試験

G1-Aを取り込んだ後、その基盤を使ってG1-Bを確認する。

---

## 23. G1-B完了時の判断

次を記録する。

- 60Hzまたは120Hzの採用
- Planck.js継続または見直し
- 発射方式
- 球受け・保持の位置付け
- 入力遅延
- 時間切り捨て
- 接触重複
- 資源増加
- ゲーム再開始・再読み込み時の状態初期化
- ゲーム記録の永続保存0件
- 外部分析、ランキング、認証、外部DB通信0件
- iPhone 17 Pro、iPhone 11 Pro、iPad Pro 2018の結果

G1-Bが通過するまで、代表的な仕組みを実装するGAへ進まない。
