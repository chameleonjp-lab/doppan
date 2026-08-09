# DOPPAN ゲームエンジン設計

- 文書種別: ゲームループ・物理イベント・状態管理・盤面実行状態
- 作成日: 2026-08-09
- 版: 1.0
- 状態: G1技術試作前
- 現在地: [制作状況](./PRODUCTION_STATUS.md)
- 関連文書:
  - [推奨実装計画書](./IMPLEMENTATION_PLAN.md)
  - [品質ゲート定義](./QUALITY_GATES.md)
  - [自動試験・PRプレビュー計画](./TEST_AND_PREVIEW_PLAN.md)
  - [中心体験・表現計画](./CORE_EXPERIENCE_PLAN.md)
  - [意思決定記録](./DECISION_LOG.md)

## 1. この文書の役割

本書は、ゲームエンジン内部の処理順とデータ境界の正本である。

次を一つの実装担当者の解釈に任せない。

- 一回の物理更新で何をどの順番に処理するか
- 接触通知をいつ得点や盤面変化へ変換するか
- 物理計算中に盤面を変更しない方法
- 描画速度と物理速度を分ける方法
- 盤面の初期定義とプレイ中の状態を分ける方法
- ショットの途中状態を球ごとに管理する方法
- ゲーム状態を安全に遷移させる方法
- 異常な球をどこへ戻すか
- 診断履歴と表示物が増え続けないようにする方法

作品ルールや得点の意味は別文書で決める。本書は、それらを安全かつ再現可能に実行する仕組みを定める。

---

## 2. 依存関係の初期候補

2026年8月9日時点の初期候補を次とする。実装PRで互換性を確認し、`package.json`と`package-lock.json`へ正確な版を固定する。

| 用途 | 初期候補 | 扱い |
|---|---|---|
| Node.js | 24.18.0 LTS | GitHub Actionsで正確な版を固定 |
| PixiJS | 8.19.0 | 実行時依存 |
| Planck.js | 1.5.0 | 実行時依存、TP結果で継続判断 |
| Vite | 8.1.5 | 開発用依存 |
| Vitest | 4.1.10 | 単体・物理試験 |
| Playwright Test | 1.61.1 | ブラウザ自動試験 |

方針:

- 開発開始時に最新版へ自動追従しない
- 範囲指定だけに頼らずlockファイルを保存する
- 依存更新はゲーム実装と別PRにする
- 更新前後で物理試験とブラウザ試験を実行する
- Playwrightが使うブラウザも、Playwrightの版に対応するものをCIで取得する

---

## 3. 物理単位と画面座標

Planck.jsへ画面のピクセル値をそのまま渡さない。

初期の物理単位候補:

```text
盤面の横幅       9.0単位
盤面の高さ      16.0単位前後
球の直径         0.30単位前後
フリッパー長     1.4〜1.7単位
静的な外周長    50単位以内
```

これは最終値ではない。Planck.jsが扱いやすい大きさへ収めるための初期基準である。

座標変換を一か所へ集約する。

```text
物理座標
  ↓ PhysicsViewport
表示座標
  ↓ CSSレイアウト
端末画面
```

必須規則:

- 物理はメートル相当の共通単位で管理
- PixiJSは表示時だけ拡大・縮小
- 端末の縦横比で重力、球速、フリッパー長を変えない
- 角度は内部でラジアンを使用
- デバッグ表示では物理単位と画面座標の両方を確認できる

---

## 4. 正規のゲームループ

一回の画面描画の中で、次の順番を守る。

```text
1. ブラウザ入力を受け取り、入力状態へ反映
2. 経過時間を固定時間用の蓄積へ加算
3. 必要な回数だけ固定物理ステップを実行
   3-1. 入力状態をフリッパー・発射装置へ反映
   3-2. Planck.jsのworld.stepを実行
   3-3. 接触コールバックの必要情報だけをバッファへ複写
   3-4. 物理ステップ終了後に接触情報を整理
   3-5. ショット状態を更新
   3-6. 得点・盤面進行・球終了候補を更新
   3-7. 予約された物理変更を実行
   3-8. 状態遷移要求を優先順位に従って確定
4. 直前と現在の物理位置から表示位置を補間
5. PixiJSを描画
6. 表示・音イベントを消費
7. 性能・診断カウンターを更新
```

禁止事項:

- 接触コールバック内で物体、fixture、jointを作成・削除しない
- 接触コールバック内で得点画面や音を直接操作しない
- 描画状態をショット成功や得点の根拠にしない
- `Date.now()`など実時間をゲームルールの進行時間へ直接使わない
- 一回の描画でゲーム状態を複数箇所から直接変更しない

物理時間をルールの正本とする。画面の描画速度が120Hzでも60Hzでも、ゲーム速度を変えない。

---

## 5. 固定時間と遅れの扱い

TPで次を比較する。

- 60物理ステップ/秒
- 120物理ステップ/秒

初期方針:

```text
最大追いつき時間: 66ms
60ステップ/秒: 最大4ステップ/描画
120ステップ/秒: 最大8ステップ/描画
```

処理規則:

- `requestAnimationFrame`の時刻を使って経過時間を計算
- 非表示中の時間は破棄
- 66msを超える未処理時間は記録して切り捨てる
- 切り捨てが反復した場合は自動ポーズ候補にする
- 250ms以上の差は復帰・停止扱いとし、通常計算へ渡さない
- 表示位置は直前と現在の物理状態から補間する
- 物理ステップ数を下げる前に表示負荷を下げる

診断情報:

- `physicsStepHz`
- `stepsThisFrame`
- `accumulatorMs`
- `droppedSimulationMs`
- `autoPauseReason`

---

## 6. 接触イベントと物理変更予約

### 6.1 接触バッファ

Planck.jsの接触通知から、必要な値だけを独自データへ複写する。

```text
PhysicsContactEvent
- eventId
- physicsStepId
- phase: begin | end | preSolve | postSolve
- fixtureAId
- fixtureBId
- bodyAId
- bodyBId
- ballId
- contactPoint
- normal
- relativeSpeed
- normalImpulse
- sensor
```

Planck.jsのcontactオブジェクト参照を、物理ステップ後まで保持しない。

### 6.2 重複防止

連続衝突判定により、一回の物理ステップ中に同じ接触の通知が複数回発生する可能性を前提とする。

重複判定キーの候補:

```text
physicsStepId + ballId + fixturePair + eventPhase + contactFeature
```

得点イベントには一意の`scoringEventId`を付け、同じIDを二度処理しない。

### 6.3 物理変更予約

盤面を変える要求は、物理計算中に直接実行しない。

```text
PhysicsCommand
- openGate
- closeGate
- enableFixture
- disableFixture
- createBody
- destroyBody
- teleportBall
- setCollisionFilter
- resetTemporaryRoute
```

`PhysicsCommandQueue`へ積み、物理ステップ終了後に実行する。

同じ対象へ矛盾する命令がある場合は、優先順位または最後の命令を採用する規則を対象ごとに定める。

---

## 7. データの分離

### 7.1 TableDefinition

ゲーム開始前に読み込む、変更しない盤面定義。

```text
- schemaVersion
- tableVersion
- physicsScale
- bounds
- spawnPoints
- fixtures
- joints
- sensors
- shots
- routes
- runtimeComponentDefinitions
```

### 7.2 TableRuntimeState

プレイ中に変わる盤面状態。

```text
- connectedRoutes
- gateStates
- enabledShots
- chargeValues
- awakeningStage
- activeRuntimeComponents
```

### 7.3 RuleState

得点とゲーム進行。

```text
- score
- ballsRemaining
- permanentProgress
- baseMultiplier
- temporaryMultiplier
- combo
- climaxPreparation
- activeMode
```

### 7.4 PresentationState

表示と音のための状態。ルール判定の根拠にしない。

```text
- highlightedTargets
- activeEffects
- queuedSounds
- cameraShake
- accessibilityOverrides
```

初期定義、実行状態、ルール、表示を同じオブジェクトへ混ぜない。

---

## 8. ショット状態機械

先に平易に言うと、入口を通っただけでは成功にせず、球がどの順番で通ったかを覚える。

この状態管理をショット状態機械と呼ぶ。

球ごと、ショットごとに次を持つ。

```text
Idle
  ↓ 入口を正しい方向で通過
Entered
  ↓ 必要条件を確認
Validated
  ↓ 出口を時間内に通過
Completed
  ↓ 重複受付を止める
Cooldown
  ↓ 球が範囲を離れる、または時間経過
Idle
```

失敗遷移:

- 逆方向通過
- 制限時間超過
- 入口へ戻る
- 別の排他的ショットへ入る
- 球終了
- 盤面状態変更により無効化

記録する情報:

- ballId
- shotId
- currentState
- enteredStepId
- lastTransitionStepId
- direction
- entranceId
- exitId
- failureReason
- completedEventId

球終了、再開始、盤面版変更時に途中状態を残さない。

---

## 9. ゲーム状態遷移

ゲーム状態は一か所の`GameStateMachine`だけが変更する。

主要遷移:

| 現在 | イベント | 次 | 物理 | 得点 | 入力 |
|---|---|---|---|---|---|
| Title | Start | LaunchReady | 停止 | 停止 | 発射のみ |
| LaunchReady | Launch | Playing | 開始 | 開始 | 左右有効 |
| Playing | VisibilityLost | AutoPaused | 停止 | 停止 | 全解除 |
| AutoPaused | ResumeRequest | Playing | 再開 | 再開 | 再取得 |
| Playing | ManualPause | ManualPaused | 停止 | 停止 | 全解除 |
| Playing | BallDrained | BallEnding | 停止 | 最終確定 | 全解除 |
| BallEnding | BallRemaining | NextBallReady | 停止 | 停止 | 発射のみ |
| BallEnding | NoBallRemaining | Result | 停止 | 停止 | UIのみ |
| Playing | WebGLLost | RenderRecovery | 停止 | 停止 | 全解除 |
| RenderRecovery | Recovered | ManualPaused | 停止 | 停止 | UIのみ |
| RenderRecovery | RecoveryFailed | FatalRecovery | 停止 | 停止 | UIのみ |
| Any | FatalError | FatalRecovery | 停止 | 停止 | 全解除 |

同一物理ステップで複数の遷移要求が出た場合の優先順位:

```text
FatalError
> WebGLLost
> VisibilityLost
> BallDrained
> ManualPause
> 通常モード遷移
```

状態変更時に必ず実行する共通処理:

- 不要入力を解除
- 許可されない得点イベントを破棄
- 必要な音を停止
- 診断履歴へ遷移理由を記録

---

## 10. 安全位置と球の回復

`lastSafeBallState`は毎フレーム無条件に更新しない。

更新条件:

- 盤面の有効範囲内
- 落下センサー外
- 他のfixtureと不正に重なっていない
- 非有限値がない
- 球速が安全上限以内
- 一方向ゲートの内部ではない
- 連続3物理ステップ以上、正常状態が続いている

保存する内容:

```text
- position
- linearVelocity
- angularVelocity
- physicsStepId
- routeContext
```

再配置前に、球半径を含む空間が空いているか確認する。

同じ場所で二回連続して異常が再発した場合は、その安全位置を無効化し、発射待ち位置または球終了へ移る。

システム起因の回復では原則として残り球を減らさない。

---

## 11. 資源と履歴の上限

ブラウザのメモリ値だけに頼らず、ゲーム内部の個数を監視する。

記録する値:

- Planck.js body、fixture、joint数
- PixiJS表示オブジェクト数
- テクスチャ数
- 登録イベント購読数
- 同時再生音数
- 接触バッファ件数
- 物理変更予約件数
- ショット途中状態件数
- 診断履歴件数
- 試遊レポートのバイト数

初期上限:

```text
接触バッファ: 1物理ステップ終了時に必ず空
物理変更予約: 256件/ステップ
状態遷移履歴: 128件
入力履歴: 512件
エラー履歴: 64件
試遊レポート: 256KB
同時再生音: 16
```

上限到達時は古い診断情報を捨てる。ゲームルールに必要なデータは捨てない。

ゲーム再開始を20回行った後、body、fixture、joint、イベント購読の個数が基準値へ戻ることを確認する。

---

## 12. G1技術試作の最小構成

G1は品質ゲートを実際に測れる範囲まで作る。

含める:

- 左右フリッパー2本
- 球1個
- 外周壁
- 発射装置と発射レーン
- 発射強度確認用の3区画
- 安全ショット用の単純な通路1本
- Pointer Eventsによる左右同時入力
- キーボード入力
- 固定時間ゲームループ
- 接触バッファ
- 物理変更予約
- 最小の状態遷移
- 判定・物理時刻・入力遅延表示
- Chromium、WebKitの起動試験
- PRプレビューURL

含めない:

- 本番盤面
- 本番得点バランス
- 代表的な仕組みの本実装
- 本番画像、音楽、効果音
- ランキング、Supabase、外部分析

G1終了時には、Planck.jsを継続するか、物理方式を見直すかを決定する。