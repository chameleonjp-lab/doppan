# G1-A dependency licenses

この一覧は `package.json` と `package-lock.json` に固定した直接依存・主要な間接依存の、公開時点でのライセンス確認表です。版は変更せず、依存を更新するときは `npm ci` 後に各パッケージの `package.json` と LICENSE/NOTICE を再確認します。

## 直接依存

| Package | Version | License | 原典 |
| --- | ---: | --- | --- |
| pixi.js | 8.19.0 | MIT | [PixiJS LICENSE](https://github.com/pixijs/pixijs/blob/dev/LICENSE) |
| planck | 1.5.0 | MIT | [Planck.js LICENSE](https://github.com/piqnt/planck.js/blob/master/LICENSE) |

## 開発依存

| Package | Version | License | 原典 |
| --- | ---: | --- | --- |
| vite | 8.1.5 | MIT | [Vite LICENSE](https://github.com/vitejs/vite/blob/main/LICENSE) |
| vitest | 4.1.10 | MIT | [Vitest LICENSE](https://github.com/vitest-dev/vitest/blob/main/LICENSE) |
| @playwright/test | 1.61.1 | Apache-2.0 | [Playwright LICENSE](https://github.com/microsoft/playwright/blob/main/LICENSE) |
| typescript | 6.0.3 | Apache-2.0 | [TypeScript LICENSE](https://github.com/microsoft/TypeScript/blob/main/LICENSE.txt) |
| eslint | 10.8.1 | MIT | [ESLint LICENSE](https://github.com/eslint/eslint/blob/main/LICENSE) |
| typescript-eslint | 8.66.0 | MIT | [typescript-eslint LICENSE](https://github.com/typescript-eslint/typescript-eslint/blob/main/LICENSE) |
| @types/node | 24.13.3 | MIT | [DefinitelyTyped LICENSE](https://github.com/DefinitelyTyped/DefinitelyTyped/blob/master/LICENSE) |

## 主要な間接依存

| Package family | License | 用途 |
| --- | --- | --- |
| rolldown 1.1.5 | MIT | Viteの変換・本番バンドル |
| lightningcss 1.33.0 | MPL-2.0 | ViteのCSS変換 |
| postcss 8.5.26 | MIT | CSS処理 |
| @vitest/* 4.1.10 / tinybench 2.9.0 | MIT | Vitest実行基盤 |
| playwright / playwright-core 1.61.1 | Apache-2.0 | ブラウザ試験実行基盤 |
| @typescript-eslint/* 8.66.0 | MIT | TypeScript向け静的検査 |
| @pixi/colord 2.9.6 | MIT | PixiJSの色処理 |
| earcut 3.2.3 | ISC | PixiJSのポリゴン三角形分割 |
| stage-js 1.0.2 | MIT | Planckの間接依存 |
| picomatch 4.0.5 / tinyglobby 0.2.17 | MIT | ファイル探索・glob |
| undici-types 7.18.2 | MIT | Node.js型定義 |

上表は `npm ci` 後の `npm ls --depth=1` と各packageの `package.json` を照合した、主要パッケージのライセンス種別の要約です。完全な依存木は生成済みの `package-lock.json` とインストールされた各packageの `license`/LICENSE/NOTICEを正とします。Playwrightブラウザ本体の配布条件は、`npx playwright install` が取得する各ブラウザの公式条件にも従います。
