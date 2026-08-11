# DOPPAN 推奨実装計画書

- 文書種別: 技術方針・実装工程・完成条件
- 初版作成日: 2026-08-09
- 最終更新日: 2026-08-10
- 版: 5.2
- 状態: G1-A自動ゲート通過・G1-B実装中
- 現在地: [制作状況](./PRODUCTION_STATUS.md)
- 上位文書: [ゲーム制作・プロデュース計画書](./GAME_PRODUCTION_PLAN.md)
- 技術の正本:
  - [ゲームエンジン設計](./ENGINEERING_ARCHITECTURE.md)
  - [自動試験・確認ページ計画](./TEST_AND_PREVIEW_PLAN.md)
  - [公開・プレビュー・安全運用計画](./DEPLOYMENT_AND_SECURITY_PLAN.md)
- 関連文書:
  - [中心体験・表現計画](./CORE_EXPERIENCE_PLAN.md)
  - [品質ゲート定義](./QUALITY_GATES.md)
  - [試遊実施手順](./PLAYTEST_PROTOCOL.md)
  - [意思決定記録](./DECISION_LOG.md)

## 1. この文書の役割

本書は、DOPPANをiPhoneのブラウザで安定して遊べる2Dピンボールとして実装する順序と範囲の正本である。

本書では次を扱う。

- 採用技術
- G1-AとG1-Bの実装範囲
- ディレクトリ構成
- 入力、物理、表示、保存の要約
- GitHub運用
- GA以降の工程
- どの段階で何を作らないか

内部の処理順、入力キュー、接触イベント、状態、物理命令、資源寿命は[ゲームエンジン設計](./ENGINEERING_ARCHITECTURE.md)を正本とする。

CI、Playwright、節目でまとめる端末確認は[自動試験・確認ページ計画](./TEST_AND_PREVIEW_PLAN.md)を正本とする。

GitHub Pages、未告知運用、Actions権限、本番公開は[公開・プレビュー・安全運用計画](./DEPLOYMENT_AND_SECURITY_PLAN.md)を正本とする。

---

## 2. 技術構成

### 2.1 実行時

| 用途 | 固定構成 |
|---|---|
| 言語 | TypeScript |
| 描画 | `pixi.js` 8.19.0 |
| 物理 | `planck` 1.5.0。G1-Aは最小world/body/1ステップの読込確認のみ |
| 公開 | GitHub Pages |

旧パッケージ名`planck-js`は使わない。

### 2.2 開発時

| 用途 | 固定版 |
|---|---|
| Node.js | 24.19.0 LTS |
| npm | 11.17.0 |
| ビルド | Vite 8.1.5 |
| 単体・物理試験 | Vitest 4.1.10 |
| ブラウザ試験 | Playwright Test 1.61.1 |
| 言語検査 | TypeScript 6.0.3 |
| 静的検査 | ESLint 10.8.1 + typescript-eslint 8.66.0 |
| Node.js型 | `@types/node` 24.13.3 |

G1-Aでは`planck`をlockへ含め、最小の物理世界・動的body・1ステップだけの読込確認を行う。衝突、フリッパー、性能、継続可否はG1-Bで判定する。

### 2.3 版固定

- `package.json`
- `package-lock.json`
- `packageManager`
- GitHub Actions内のNode.js版
- Playwrightの版とブラウザ

をそろえる。

`npm ci`で再現できない構成は不合格とする。

---

## 3. 依存方向

```text
入力・UI
   ↓
入力キュー・ゲーム進行・状態
   ↓
ルール・ショット判定
   ↓
物理接続

物理状態 → 表示状態 → PixiJS
ゲームイベント → 表示・音・触覚
```

禁止:

- 物理からPixiJSを直接呼ぶ
- 得点ルールからHTMLを直接変更
- UIからPlanck.js物体を直接操作
- ルールへ音声ファイル名を書く
- 表示状態を得点やショット判定へ使う
- 接触コールバック内で物理世界を変更
- PixiJS Tickerと独自GameLoopを同時稼働

---

## 4. 推奨ディレクトリ

```text
/
├─ docs/
├─ public/
│  └─ assets/
├─ src/
│  ├─ app/             # 起動、全体エラー、環境表示
│  ├─ game/            # 基本状態、球数、進行
│  ├─ input/           # Pointer、Keyboard、イベントキュー、所有
│  ├─ loop/            # 単一GameLoop、固定時間、補間
│  ├─ physics/         # Planck接続、接触バッファ、物理命令
│  ├─ table/           # TableDefinition、検査、部品生成
│  ├─ runtime/         # TableRuntimeState、ゲート、経路
│  ├─ shots/           # 球別ショット状態機械
│  ├─ rules/           # 得点、倍率、球間進行、モード
│  ├─ rendering/       # PixiJS、表示同期、WebGL復旧
│  ├─ audio/           # 音イベント、同時再生制限
│  ├─ haptics/         # 任意の短い触覚
│  ├─ storage/         # 環境別保存、版移行
│  ├─ diagnostics/     # 性能、履歴、試遊レポート
│  └─ ui/              # タイトル、ポーズ、結果、設定
├─ tests/
│  ├─ unit/
│  ├─ physics/
│  ├─ fixtures/
│  └─ e2e/
└─ .github/workflows/
```

初期段階で空ファイルを大量に作らない。G1-A、G1-Bで必要な責任だけを分ける。

正式版1.0では外部テレメトリーを作らない。

---

## 5. GitHub Pagesの扱い

### 5.1 完成前

- GitHub PagesをiPhone確認に使用
- URLをREADME、SNS、公開サイトへ掲載しない
- 本番ルートには未完成ゲームを配置しない
- 確認ページ一件だけを未告知で配置
- `noindex`を設定
- 公開URLなので秘密性は保証しない

### 5.2 `main`

`main`への取り込みではCIと本番形式ビルドを実行するが、正式版を自動公開しない。

### 5.3 正式公開

G7でユーザー本人が承認したコミットだけを、手動ワークフローと`production`環境承認で公開する。

---

## 6. G1-A: 技術基盤

### 6.1 目的

物理試作を載せる前に、再現可能な開発、試験、確認ページを完成させる。

### 6.2 実装範囲

- `package.json`
- `package-lock.json`
- TypeScript
- ESLint、typescript-eslint
- Vite
- Vitest
- Playwright
- GitHub Actions CI
- GitHub Pages未告知確認枠
- 本番ルートの開発中案内
- PixiJS起動画面
- 単一GameLoop骨格
- 環境名、コミットSHA、ビルド日時の表示
- 環境別保存キー
- WebGL初期化失敗時の案内
- キーボードで起動・停止確認

### 6.3 確認ページ

- 信頼済み同一リポジトリブランチだけ
- 一件だけ
- 本番ルートを上書きしない
- 外部フォークはCIのみ
- URLを外部へ案内しない

### 6.4 含めないもの

- Planck.js物理の品質検証
- 本番盤面
- 本番得点
- 本番画像・音
- 代表的な仕組み
- ランキング、Supabase

### 6.5 完了条件

[品質ゲート定義](./QUALITY_GATES.md)のG1-A条件を満たす。

特に次を必須とする。

- `npm ci`
- 型・静的・単体・ビルド・ブラウザ試験
- 本番ルートに未完成ゲームがない
- `main`マージで正式公開されない
- Actions権限が必要最小限
- 外部フォークがPages公開されない
- PixiJS自動Tickerを使わずGameLoop一件

G1-Aのpull request終了後の確認ページ削除は、マージ後に結果を記録する。

Pagesの実配置と端末確認は、G1-B開始を止めない。最初に遊べるGA段階でG1-AとG1-Bをまとめて端末確認し、公開前のRCで再確認する。

---

## 7. G1-B: ピンボール技術試作

### 7.1 目的

G1-Aで完成した基盤上に、品質ゲートを実際に測れる最小のピンボールを作る。

### 7.2 実装範囲

- Planck.js world
- 左右フリッパー2本
- 球1個
- 外周壁
- 発射装置
- 発射レーン
- 発射強度確認用3区画
- 安全ショット用の単純通路1本
- Pointer Events二本指
- キーボード
- InputEventQueue
- InputState、InputOwnership
- 60Hz / 120Hz固定時間比較
- 用途別接触イベント
- PhysicsCommandQueue
- ショット状態機械
- `baseState`と`suspensionState`
- pendingTerminalEvents
- 安全位置と回復
- 入力・物理・描画遅延表示
- 資源数表示
- 試験用診断出力

### 7.3 発射

G1-Bでは、ばねの完全再現より再現性を優先する。

- 引いて離す
- 長押しして離す

を比較する。

強度は決定的な初速またはimpulseへ変換し、乱数を加えない。

攻略価値と初見理解が不足する場合は固定発射へ変更する。

### 7.4 球受け・保持

中心技能として残すかを検証する。

- 面白さを増す → 継続
- 経験者だけが使う → 上級技能
- 初心者を妨げる → 初回案内から外す
- 物理全体を不自然にする → 作品約束から外す

### 7.5 完了条件

- 全技術保証値を通過
- 設計仮説値の結果を記録
- Planck.js継続または見直しを決定
- 60Hzまたは120Hzを決定
- 発射方式の技術候補を決定し、端末上の操作感はGAで確定
- 球受け・保持の技術的成立性を記録し、面白さの位置付けはGAで確定
- `PRODUCTION_STATUS.md`を更新

端末固有の重大不具合が疑われない限り、G1-Bの各PRで実機確認を要求しない。

---

## 8. 入力

詳細は[ゲームエンジン設計](./ENGINEERING_ARCHITECTURE.md)を参照する。

必須:

- pointerId所有
- InputEventQueue
- 短いタップを一物理ステップ以上反映
- 押下と解放の順序保持
- 不要な三本目で既存操作を変えない
- 全解除を一か所へ集約
- 入力キュー上限超過で安全停止

キーボード候補:

```text
左: Z / ArrowLeft
右: / / ArrowRight
発射: Space
ポーズ: Escape
```

`event.repeat`を新規押下にしない。入力欄やボタン操作中はゲームキーを横取りしない。

---

## 9. ゲームループ

- `requestAnimationFrame`は一つ
- PixiJS自動Tickerは停止
- 物理更新後、表示状態を更新してから描画
- 音は描画後に再生してよい
- HMRと再初期化で古いループを停止
- GameLoop世代と稼働件数を診断

短いタップ、接触、得点、盤面変更、状態遷移、表示の正規順序は[ゲームエンジン設計](./ENGINEERING_ARCHITECTURE.md)に従う。

---

## 10. 物理

### 10.1 単位

- ピクセルを直接使わない
- 盤面横幅9物理単位を初期候補
- 原点は左下、+yは上
- 表示座標との変換を`PhysicsViewport`へ集約

### 10.2 球

初期候補:

- dynamic
- bullet有効
- sleep無効を比較
- 球速上限
- 明示的な衝突カテゴリ

### 10.3 フリッパー

- dynamic
- revolute joint
- motor
- 角度制限
- 上昇・復帰の速度とトルク

### 10.4 接触

- センサー遷移
- 衝撃
- 接触滞在
- 意味イベント
- 得点イベント

へ分ける。

接触コールバック内でbody、fixture、jointを変更しない。

### 10.5 物理命令

命令へID、対象、step、sequenceを付ける。

- destroy優先
- 同一ゲート開閉は後の有効命令
- 上限超過はP1安全停止
- ルール状態と物理状態の一致を確認

---

## 11. 状態

本体状態と一時停止理由を分ける。

```text
baseState
suspensionState
pendingTerminalEvents
```

発射待ち中に画面非表示になった場合、復帰後も発射待ちへ戻る。

球落下と画面非表示が同時の場合、球終了を保留して復帰後に完了する。

重大エラーは通常復帰せず、安全停止へ移る。

---

## 12. 保存

環境別キー:

```text
doppan:development-preview:...
doppan:production:...
```

更新:

1. 一時キー
2. 読み戻し
3. 検査
4. 正式キー
5. 一時キー削除

保存失敗でもプレイを続ける。開発版は通常処理で本番キーを使わない。

---

## 13. 診断・試遊レポート

GAまでに端末内生成する。

G1では基盤だけ先に用意する。

含める候補:

- コミットSHA、環境
- 物理Hz
- 入力キュー
- 入力から物理・描画の遅延
- droppedSimulationMs
- runIntegrity
- body、fixture、joint
- GameLoop件数
- 表示物、イベント購読
- WebGL、音声、未処理エラー

個人情報と永続端末識別子を含めず、自動送信しない。

---

## 14. 性能と容量

固定した初期目標:

- JavaScriptとCSS: gzip後600KB以内
- 初回画像: 1.5MB以内
- 初回音声: 1.5MB以内
- 初回転送合計: 3MB以内
- 遅延素材込み: 10MB以内

負荷削減順:

1. 粒子
2. 影
3. 発光解像度
4. 軌跡点数
5. UI更新頻度
6. 画像解像度

物理計算回数を最初に下げない。

時間切り捨てが反復したゲームは自己最高記録へ保存しない。

---

## 15. アクセシビリティ

正式版までに次を満たす。

- 音なしでも主要状態を理解
- 点滅、粒子、揺れを軽減
- `prefers-reduced-motion`を初期設定へ反映
- 一秒に3回を超える強い点滅を作らない
- 高コントラスト
- 色だけに依存しない
- 主要操作対象は最低24×24 CSSピクセル
- 主ボタンは可能な範囲で44×44 CSSピクセル前後
- PCではキーボードだけで開始から終了

軽減設定でもクライマックスの成否が分かることを確認する。

---

## 16. G0.5とG1の並行

市場・名称調査G0.5とG1-Aは並行可能。

G1-BもG0.5と並行できるが、GAは次がすべて通過するまで開始しない。

- G0.5
- G1-A
- G1-B
- G2

---

## 17. GA以降

### G2

- 市場比較
- 代表的な仕組み3候補
- 意味のテーマ
- ショットマップ
- 発射スキルショット
- 仮得点
- 習熟段階

### GA

- 3球制
- 球間進行
- 主要ショット
- 代表的な仕組み
- 仮ボーナス
- 得点内訳
- 初見・反復試遊

### VS

[中心体験・表現計画](./CORE_EXPERIENCE_PLAN.md)の固定範囲を統合する。

### CCB

- 盤面全体
- クライマックス
- 設定、保存、結果
- 基本練習候補
- 公開説明

### RC

- 不具合修正のみ
- 権利台帳
- 最終端末試験
- 共有代替
- 診断情報
- ロールバック

### G7・正式公開

- ユーザー本人の承認
- 手動Pages公開
- 確認ページを外す
- 正式版保存キー
- 版付け
- 更新履歴
- 完成後に初めてURL案内範囲を決定

---

## 18. GitHub運用

- `main`へ直接実装しない
- 一つの確認可能な成果物につき一つのDraft PR
- G1-AとG1-Bを分ける
- 仕様変更と正本文書更新を同じPRへ含める
- 自動検査失敗で取り込まない
- PR本文へ自動ゲート、端末確認へ残す項目、残る問題を記載
- 確認URLは外部へ転載しない
- `main`マージを正式公開へ直結させない
- RCでは新機能を入れない

推奨ブランチ:

```text
agent/g1a-technical-foundation
agent/g1b-physics-prototype
agent/core-experience-and-shot-map
agent/graybox-alpha
agent/vertical-slice
agent/content-complete
agent/release-candidate
```

---

## 19. 次の実装

次はG1-Bだけを扱う。

確認すること:

> 最小盤面で入力、発射、左右フリッパー、接触、状態、60Hz / 120Hzを自動試験でき、Planck.jsを継続できるか判断できること。

G1-Bの自動ゲート通過後にG2へ進む。端末確認はGAの最初にまとめる。

本番盤面、本番素材、本番音、ランキング、Supabase、外部分析は含めない。
