# DOPPAN 制作状況

- 文書種別: 現在地・停止条件・次作業
- 更新日: 2026-08-10
- 正本対象: `main`
- 現在の段階: G0通過 / G0.5未着手 / G1-A自動ゲート通過 / G1-B Draft検証中

## 1. この文書の使い方

制作を再開する時は、最初に本書を確認する。

本書は詳細仕様を持たず、現在地、停止条件、次の成果物、作らないものだけを示す。

作業中のブランチ名とpull request番号は、本書へ固定しない。各pull request本文で管理する。

---

## 2. 現在地

| 項目 | 状態 | 内容 |
|---|---|---|
| 計画体系 | 改訂済み | プロデューサー、ゲームエンジニア、敵対的検証を反映 |
| G0 制作目的 | 通過 | カメレオンJPの代表作候補として制作 |
| G0.5 市場・名称 | 未着手 | 8〜12作品比較と名称確認 |
| G1-A 技術基盤 | 通過 | 固定環境CIと未告知確認ビルドが通過。Pages実配置と端末確認は節目へ繰り延べ |
| G1-B 物理試作 | Draft検証中 | 最小盤面、入力、物理、状態のローカル自動ゲートは通過。Draft PR上のChromium・WebKit実行を残す |
| G2 中心体験 | 未着手 | 代表的な仕組み、意味のテーマ、ショットマップ |
| GA グレー版アルファ | 開始禁止 | G0.5、G1-A、G1-B、G2通過が必要 |
| 本番素材 | 開始禁止 | GA面白さ判定通過が必要 |
| 正式公開 | 開始禁止 | G7でユーザー本人が承認するまで行わない |
| ランキング・外部分析 | 開始禁止 | v1.0公開後に再判断 |

G0.5とG1-Bは並行可能。

---

## 3. 完成前のGitHub Pages方針

- GitHub PagesをiPhone確認に使用
- 完成前はURLをREADME、SNS、公開サイト、記事へ掲載・案内しない
- ユーザー本人だけがGitHub Actionsなどから確認URLを開く
- 本番ルートへ未完成ゲームを置かない
- 確認ページは信頼済みブランチ一件だけ
- 検索除外を設定
- GitHub Pagesは公開URLであり、秘密性やアクセス制限は保証されない
- 第三者へ確認URLを配布しない
- `main`への取り込みだけでは正式版を公開しない
- G7後の手動承認で正式公開

試遊で第三者へURLを送らない。完成前の試遊は、原則としてユーザー所有端末を使った対面または管理下の確認で行う。

---

## 4. 現在のBLOCKER

### G0.5

1. 市場比較が未実施
2. 正式名称が未決定
3. DOPPAN固有の価値が未検証

### 公開・端末確認の繰り延べ事項

1. `github-pages` Environmentの必須reviewerと、bootstrap push用`agent/g1a-technical-foundation`および手動更新・cleanup用`main`のdeployment branch ruleを確認しておらず、`DEVELOPMENT_PREVIEW_ENABLED`も未有効化
2. GitHub Pagesの未告知確認枠を実際に配置していない
3. 本番ルートと確認枠の成果物構成を実URLで確認していない
4. G1-Aマージ後の確認ページ終了処理を確認していない
5. iPhone Safariの表示、保存、二本指、体感遅延、発熱はGA開始時にまとめて確認する

これらはG1-B開始を止めない。Pagesを実際に配置する工程とGA開始時の端末確認で扱う。

### G1-B

1. Draft PRのChromium・WebKit実行結果が未確定

### G2

1. 代表的な仕組みが未決定
2. 意味のテーマが未決定
3. ショットマップが未決定

---

## 5. 次の成果物

順序:

1. G1-B物理試作のDraft PRを作り、Chromium・WebKitを通す
2. CI成功後、G1-Bの通過可否をユーザー本人が判断する
3. G0.5市場・名称調査とG2中心体験・ショットマップへ進む
4. GA開始時にG1-A / G1-Bの端末確認をまとめて行う
5. RCで対応端末の最終確認を行う

---

## 6. G1-A固定範囲

含める:

- package設定とlockファイル
- Node.js、npm、TypeScript、ESLint等の版固定
- TypeScript、Vite、Vitest、Playwright
- GitHub Actions CI
- GitHub Pages未告知確認枠
- 本番ルートの開発中案内
- PixiJS起動画面
- 単一GameLoop骨格
- 環境名、コミットSHA表示
- 環境別保存キー
- GA開始時へ引き継ぐiPhone Safari確認項目

含めない:

- Planck.js物理品質の判断
- 本番盤面
- 本番得点
- 本番画像、音楽、効果音
- 代表的な仕組み
- ランキング、Supabase、外部分析

---

## 7. G1-B固定範囲

含める:

- Planck.js world
- 左右フリッパー2本
- 球と外周
- 発射装置、発射レーン、強度3区画
- 安全ショット通路1本
- Pointer Events、キーボード
- InputEventQueue
- 単一GameLoop
- 60Hz / 120Hz比較
- 用途別接触イベント
- PhysicsCommandQueue
- ショット状態機械
- baseState、suspensionState、pendingTerminalEvents
- 安全位置と回復
- 資源寿命監視
- Vitest、Playwright
- GA開始時へ引き継ぐ端末確認項目の記録

含めない:

- 本番盤面
- 代表的な仕組みの本実装
- クライマックス本実装
- 本番素材
- ランキング、Supabase、外部分析

---

## 8. 今は作らないもの

- 本番盤面
- 本番画像、音楽、効果音
- クライマックス本実装
- オンラインランキング
- Supabase連携
- 外部テレメトリー
- 複数盤面
- 対戦
- 3D化
- 外部へ配布する確認URL
- `main`マージ時の自動本番公開

---

## 9. 正本文書の分担

| 文書 | 正本となる内容 |
|---|---|
| [GAME_PRODUCTION_PLAN.md](./GAME_PRODUCTION_PLAN.md) | 制作目的、対象、作品方針、制作ゲート |
| [CORE_EXPERIENCE_PLAN.md](./CORE_EXPERIENCE_PLAN.md) | 中心体験、習熟、保持、縦切り、表現 |
| [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) | 実装順序、G1-A/B、技術構成 |
| [ENGINEERING_ARCHITECTURE.md](./ENGINEERING_ARCHITECTURE.md) | 入力キュー、ゲームループ、接触、物理、状態、資源 |
| [TEST_AND_PREVIEW_PLAN.md](./TEST_AND_PREVIEW_PLAN.md) | CI、Vitest、Playwright、実機確認 |
| [DEPLOYMENT_AND_SECURITY_PLAN.md](./DEPLOYMENT_AND_SECURITY_PLAN.md) | GitHub Pages、未告知運用、権限、正式公開 |
| [QUALITY_GATES.md](./QUALITY_GATES.md) | 合否基準、不具合重大度 |
| [PLAYTEST_PROTOCOL.md](./PLAYTEST_PROTOCOL.md) | 試遊の実施、記録、URLを渡さない方法 |
| [MARKET_AND_NAME_REVIEW.md](./MARKET_AND_NAME_REVIEW.md) | 競合比較、独自性、名称確認 |
| [DECISION_LOG.md](./DECISION_LOG.md) | 決定、検証仕様、未決定、変更履歴 |
| [EXPANSION_IDEAS.md](./EXPANSION_IDEAS.md) | v1.0公開後の候補 |

---

## 10. 承認状態

| 決定 | 状態 |
|---|---|
| 代表作候補として制作 | 決定 |
| 3球制 | 決定 |
| GitHub Pages使用 | 決定 |
| 完成までURLを外部へ案内しない | 決定 |
| Pagesは非公開ではない | 認識済み |
| `main`と正式公開を分離 | 決定 |
| G1をG1-A / G1-Bへ分割 | 決定 |
| 球間恒久進行 | GA検証仕様 |
| 発射強度 | 長押しして離す方式をG1-B技術候補に決定。操作感はGAで確定 |
| Planck.js | 1.5.0をG2まで継続 |
| 物理Hz | 60Hzを既定、120Hzを比較診断として保持 |
| 球受け・保持 | 技術接触は成立。通常経路は必須約束から外し、G2で再判断 |
| Playwright | ブラウザ自動試験に採用 |
| 外部フォークの自動Pages公開 | 禁止 |
| Node.js / npm | 24.19.0 / 11.17.0に固定 |
| G1-AのCI | 品質ジョブとブラウザジョブへ分離 |
| G1-A確認枠 | 専用内部ブランチpushと手動実行。毎回全体再構築 |
| 端末確認の頻度 | 各PRでは行わず、GA開始時とRCでまとめる。端末固有P0/P1疑いだけ例外 |

---

## 11. 更新ルール

- ゲート通過、BLOCKER、承認、次作業の変更時に更新
- 作業中PR番号を固定しない
- 詳細仕様を本書へ重複記載しない
- 次作業が変わった場合は実装より先に更新
- 正式公開後も確認ページの扱いが変われば更新
