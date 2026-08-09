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
| 依存再現 | npm 11.17.0で `npm ci` | ローカル成功。ローカルNode.js 24.14.0のため、固定版24.19.0とのengine警告あり。CIで固定版を確認する |
| TypeScript | `npm run typecheck` | 成功 |
| ESLint | `npm run lint` | 成功 |
| GameLoop再初期化20回・停止・二重開始 | `npm test` / `tests/unit/game-loop.test.ts` | 成功 |
| HMR破棄所有権・入力購読の20回再初期化 | `npm test` / `tests/unit/runtime-hmr.test.ts`, `tests/unit/loop-controls.test.ts` | 成功 |
| WebGLRenderer初期化失敗時の保持参照・cleanup | `npm test` / `tests/unit/renderer-lifecycle.test.ts` | 初期化例外後のdestroy 1回を確認 |
| 保存キー分離・一時キー読戻し・失敗継続 | `npm test` / `tests/unit/save-storage.test.ts` | 成功 |
| build info | `npm test` / `tests/unit/build-info.test.ts` | 成功 |
| Planck smoke | `npm test` / `tests/physics/planck-smoke.test.ts` | 成功 |
| 単体・物理smoke試験合計 | `npm test` | 7ファイル・23件成功 |
| 本番ビルド | `npm run build` | 成功 |
| 起動・環境/SHA・WebGL失敗案内 | ローカルChromium確認 | 成功。空画面・エラーoverlay・console error・page errorなし |
| WebGL専用renderer・非対応時fallback拒否・context loss | ローカルChromium確認 | `webgl`を確認。失敗時はcanvas 0件、ループ0件、再読み込み案内へ安全停止 |
| 開始停止・ループ1件・PixiTicker未生成 | ローカルChromium確認 | 成功。WebGLRendererを直接所有し、Ticker自体を使用しない |
| 320/390/430px・横画面案内 | ローカルChromium確認 | 成功。横幅overflowなし |
| Chromium / WebKit試験定義 | `npm run test:browser -- --list` | 2ブラウザ・計20件を検出 |
| Chromium / WebKit CI実行 | Draft PRのCI | 未実行 |
| JavaScript+CSS gzip容量 | `npm run size`（600 KiB以下） | 成功、135,829 bytes / 614,400 bytes |

## 手動確認の残り

- iPhone実機: 未確認
- GitHub Pages実デプロイ: 未確認
- `github-pages` Environmentの必須reviewer・bootstrap push用`agent/g1a-technical-foundation`＋手動更新・cleanup用`main`制限、および`DEVELOPMENT_PREVIEW_ENABLED=true`: 未確認
- `preview-cleanup.yml` の実行: 未確認
- 固定Node.js 24.19.0上のCI、およびPlaywright Chromium / WebKit: Draft PR作成後に確認

ローカルのPlaywright管理ブラウザ取得は配布CDNの証明書検証エラーで完了できなかったため、Chromium / WebKitの正式な20件はGitHub Actionsで実行します。上記項目は、リポジトリ権限・実機・Pages環境が必要なため、このローカル実装では完了扱いにしません。
