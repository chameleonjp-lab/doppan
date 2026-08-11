# G1-A verification record

G1-Aは、ゲーム内容や物理品質ではなく、起動・描画・ループ所有権・保存境界・公開前導線の技術基盤を確認する段階です。Planckはsmoke testのみで、物理品質の判断には使用しません。

## 固定環境

- Node.js `24.19.0`
- npm `11.17.0` / `packageManager: npm@11.17.0`
- PixiJS `8.19.0`
- planck `1.5.0`
- Vite `8.1.5` / Vitest `4.1.10` / Playwright `1.61.1`
- Chromium and WebKit

## 自動確認項目

| 項目 | コマンド / 対象 | 結果 |
| --- | --- | --- |
| 依存再現 | `npm ci` | ローカルNode.js 24.14.0 / npm 11.9.0でengine警告付き成功。GitHub Actionsの固定Node.js 24.19.0 / npm 11.17.0でも成功 |
| TypeScript | `npm run typecheck` | 成功 |
| ESLint | `npm run lint` | 成功 |
| GameLoop再初期化20回・停止・二重開始 | `npm test` / `tests/unit/game-loop.test.ts` | 成功 |
| HMR破棄所有権・入力購読の20回再初期化 | `npm test` / `tests/unit/runtime-hmr.test.ts`, `tests/unit/loop-controls.test.ts` | 成功。操作要素にフォーカス中のSpaceを横取りしないことも確認 |
| WebGLRenderer初期化失敗時の保持参照・cleanup | `npm test` / `tests/unit/renderer-lifecycle.test.ts` | 初期化例外後のdestroy 1回を確認 |
| 保存キー分離・一時キー読戻し・失敗継続 | `npm test` / `tests/unit/save-storage.test.ts` | 成功 |
| build info | `npm test` / `tests/unit/build-info.test.ts` | 成功 |
| Planck smoke | `npm test` / `tests/physics/planck-smoke.test.ts` | 成功 |
| 単体・物理smoke試験合計 | `npm test` | 7ファイル・24件成功 |
| 本番ビルド | `npm run build` | 成功 |
| 起動・環境/SHA・WebGL失敗案内 | ローカルChromium確認 | 成功。空画面・エラーoverlay・console error・page errorなし |
| WebGL専用renderer・非対応時fallback拒否・context loss | ローカルChromium確認 | `webgl`を確認。失敗時はcanvas 0件、ループ0件、再読み込み案内へ安全停止 |
| 開始停止・ループ1件・PixiTicker未生成 | ローカルChromium確認、`npm run lint` | 成功。WebGLRendererを直接所有し、静的境界検査でPixi Application / Tickerと監査不能なimportを禁止 |
| 320/390/430px・横画面案内 | ローカルChromium確認 | 成功。横幅overflowなし |
| Chromium / WebKit試験定義 | `npm run test:browser -- --list` | 2ブラウザ・計22件。起動画面10件と公開ルート案内1件を各ブラウザで検証 |
| Chromium / WebKit CI実行 | Draft PRのCI | 成功。quality、Chromium、WebKitの3ジョブを固定Node.js / npmで確認 |
| 未告知確認ビルド | `Development preview` workflow | 成功。信頼済みref検査、品質、両ブラウザ、成果物作成を確認。安全スイッチ未有効のためPages配置だけを意図どおりskip |
| JavaScript+CSS gzip容量 | `npm run size`（600 KiB以下） | 成功、136,019 bytes / 614,400 bytes |

## 節目へ引き継ぐ確認

- iPhone実機: 未確認
- GitHub Pages実デプロイ: 未確認
- `github-pages` Environmentの必須reviewer・bootstrap push用`agent/g1a-technical-foundation`＋手動更新・cleanup用`main`制限、および`DEVELOPMENT_PREVIEW_ENABLED=true`: 未確認
- `preview-cleanup.yml` の実行: 未確認

ローカルのPlaywright管理ブラウザ取得は、この作業環境から配布ファイルを正常に取得できず完了しませんでした。Chromium / WebKitの正式な22件はGitHub Actionsで確認しました。Pages実配置とマージ後処理は配置工程へ、実機項目はGA開始時へ引き継ぎ、G1-B開始の停止条件にはしません。
