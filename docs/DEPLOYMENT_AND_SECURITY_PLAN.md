# DOPPAN 公開・プレビュー・安全運用計画

- 文書種別: GitHub Pages・環境分離・GitHub Actions権限・未告知運用
- 作成日: 2026-08-09
- 版: 1.1
- 状態: G1-A実装中
- 現在地: [制作状況](./PRODUCTION_STATUS.md)
- 関連文書:
  - [推奨実装計画書](./IMPLEMENTATION_PLAN.md)
  - [自動試験・確認ページ計画](./TEST_AND_PREVIEW_PLAN.md)
  - [品質ゲート定義](./QUALITY_GATES.md)
  - [意思決定記録](./DECISION_LOG.md)

## 1. この文書の役割

本書は、DOPPANをGitHub Pagesで確認・公開する際の正本である。

次を一つの実装担当者の判断へ任せない。

- 完成前の確認ページをどこへ置くか
- `main`への取り込みと一般公開をどう分けるか
- 完成までURLを案内しない方針をどう守るか
- 本番と開発用の保存データをどう分けるか
- 外部フォークのpull requestを自動公開しない方法
- GitHub Actionsへ与える権限
- 本番公開と開発用公開が競合しない方法
- GitHub Pagesが公開URLであることの限界

CIとブラウザ試験の詳細は[自動試験・確認ページ計画](./TEST_AND_PREVIEW_PLAN.md)を参照する。

---

## 2. 基本方針

### 2.1 GitHub Pagesを使用する

DOPPANの確認ページと正式版はGitHub Pagesで配信する。

ただし、完成前と完成後を同じ意味で扱わない。

- 完成前: **未告知の開発確認ページ**
- G7公開承認後: **正式版の一般公開ページ**

### 2.2 完成まではURLを案内しない

完成までは次を行わない。

- READMEやリポジトリ説明へゲームURLを掲載
- カメレオンJPの公開サイトからリンク
- SNS、チャット、記事でURLを案内
- 検索エンジン向けサイトマップへ掲載
- 公開用画像や動画から確認URLへ誘導
- pull request本文へ確認URLを恒常的に転載

確認URLは、ユーザー本人がGitHub ActionsのSummaryなどから開くためだけに使用する。

### 2.3 非公開ではない

GitHub Pagesは公開URLである。

URLを案内しなくても、次を完全には防げない。

- URLを推測される
- GitHub Actionsや公開リポジトリから構成を調べられる
- 検索除外設定が無視される
- 第三者が直接アクセスする

そのため、本計画では「秘密のテスト環境」「アクセス制限された非公開環境」とは表現しない。

完成前に置いてよいものは、第三者に見られても安全な開発版だけとする。

---

## 3. GitHub Pagesの構成

### 3.1 G7承認前

G1-Aで、GitHub Pagesの成果物を次の構成に固定する。

```text
/
├─ index.html                 # 開発中を示す静的な案内だけ
├─ robots.txt                 # 全体を検索対象外として依頼
└─ _preview/
   └─ current/                # 現在確認中の信頼済みブランチ1件
```

本番ルートには未完成ゲームを配置しない。

開発確認ページは同時に一件だけとする。複数pull requestの成果物を同じPages成果物へ並行して統合しない。

### 3.2 G7承認後

正式公開時は次へ切り替える。

```text
/
├─ index.html                 # 正式版
├─ assets/
├─ robots.txt                 # 正式な公開方針へ更新
└─ _preview/                  # 原則として公開成果物へ含めない
```

正式公開後は、同一オリジンに開発版を常設しない。

正式版公開後に確認ページが必要になった場合は、次のいずれかを改めて承認する。

- 別オリジンを持つ確認環境
- GitHub Pages上での信頼済み・短時間・手動確認
- 確認ページを使わず、CI成果物と実機ローカル確認を組み合わせる方法

外部貢献者のコードを同一オリジンへ公開する方式は採用しない。

---

## 4. 確認ページの対象

### 4.1 公開できるブランチ

自動または手動で確認ページへ出せるのは、次をすべて満たすブランチだけとする。

- `chameleonjp-lab/doppan`内のブランチ
- ユーザー本人または承認済み実装担当が作成
- 外部フォークではない
- 秘密情報を含まない
- 型検査、単体試験、物理試験、ビルドが成功
- 確認ページ用の環境表示を含む

### 4.2 公開しないpull request

次はCIだけ実行し、Pagesへ出さない。

- 外部フォークからのpull request
- 不明な作成者のブランチ
- Dependabotなど依存更新だけのpull request
- 権限変更や公開ワークフロー自体を変更する未承認pull request
- 秘密情報を必要とするもの
- P0、P1相当の既知問題があるもの

### 4.3 `pull_request_target`の禁止

未信頼コードを実行する目的で`pull_request_target`を使わない。

外部pull requestのコードへ書き込み権限、Pages公開権限、秘密情報を渡さない。

---

## 5. `main`と正式公開の分離

### 5.1 `main`への取り込み

`main`への取り込みでは次だけを行う。

- 依存取得
- 型検査
- 静的検査
- 単体試験
- 物理試験
- ブラウザ試験
- 本番形式のビルド確認
- 容量確認

**`main`への取り込みだけでは正式版を公開しない。**

G1、G2、GA、VS、CCBの未完成版を本番ルートへ自動配置しない。

### 5.2 開発確認ページ

開発確認ページへの配置は、信頼済みブランチだけを対象とする専用ワークフローで行う。

G1-Aの初回構築では、専用内部ブランチ`agent/g1a-technical-foundation`のpush時だけ起動する。同じワークフロー内で自動試験を再実行し、成功した成果物だけを配置する。

初回配置前にGitHub Environment `github-pages`へユーザー本人の必須reviewerと、bootstrap push用`agent/g1a-technical-foundation`および手動更新・cleanup用`main`だけを許可するdeployment branch ruleを設定する。その確認後にだけRepository variable `DEVELOPMENT_PREVIEW_ENABLED=true`を設定する。ブランチ上のworkflow自身が変更可能であるため、このEnvironment保護と明示スイッチを初回bootstrapの前提とする。設定を確認できない場合は、検査成果物までで停止し、Pages配置を完了扱いにしない。

mainへ専用ワークフローを取り込んだ後は、`workflow_dispatch`で同一リポジトリ内の信頼済みrefと表示名を明示して更新できる。G1-A / G1-Bの専用内部ブランチをallowlistし、checkoutしたSHAが対象ブランチの現在tipと一致する場合だけ実行する。`refs/pull/*`とallowlist外のSHAは拒否する。

確認ページは一件だけなので、後から実行された承認済みビルドで置き換える。

終了処理は`workflow_dispatch`専用の別ワークフローで、開発中案内と`robots.txt`だけを含む成果物へ全体を置き換える。G1-Aマージ後に実際の削除結果を確認する。

### 5.3 正式版公開

正式版公開はG7通過後、次のいずれかで行う。

- `workflow_dispatch`による手動実行
- GitHub Environment `production`の承認付き実行

公開するコミットSHAを明示し、公開後に版を付ける。

正式公開を通常のpushやpull requestマージへ連動させない。

---

## 6. 保存データの環境分離

### 6.1 保存キー

保存キーへ環境名を含める。

```text
doppan:development-preview:settings:v1
doppan:development-preview:score:v1
doppan:production:settings:v1
doppan:production:score:v1
```

ビルド時に次を埋め込む。

```text
APP_ENV=development-preview | production | test
BUILD_SHA=<commit sha>
BUILD_SOURCE=<pull request or release>
```

開発版は通常処理で本番キーを読まない、書かない。

### 6.2 同一オリジンの限界

GitHub Pagesの本番ルートと確認ページは同じオリジンを共有する。

保存キーを分けても、同じオリジンで実行されるJavaScriptは技術的には別キーへアクセスできる。

このため、次を必須とする。

- G7前は本番ゲームと本番保存データを配置しない
- 確認ページへ出すコードは同一リポジトリ内の信頼済みブランチだけ
- 外部pull requestを確認ページへ出さない
- G7後は確認ページを原則停止
- 将来外部貢献を受ける場合は別オリジンへ移行

### 6.3 保存の安全な更新

保存は次の順で行う。

1. 一時キーへ書く
2. 読み戻す
3. データ形式を検査する
4. 正式キーへ書く
5. 一時キーを削除する

書き込み失敗でもゲームを続ける。破損した値を正式値として採用しない。

---

## 7. 検索除外と未告知表示

G7前は次を行う。

- `robots.txt`で全体の巡回停止を依頼
- `meta name="robots" content="noindex,nofollow,noarchive"`
- 本番ルートから確認ページへリンクしない
- 確認ページにも同じ`noindex`指定
- OGPや検索向け説明を設定しない
- 画面に「開発確認版」「一般公開前」を表示
- PR番号または確認対象名とコミットSHAを表示

これらは検索除外の依頼であり、アクセス制限ではない。

---

## 8. GitHub Actionsの権限

### 8.1 既定権限

ワークフロー全体の既定は次とする。

```yaml
permissions:
  contents: read
```

### 8.2 CI

CIは読み取り権限だけで実行する。

- リポジトリへ書き込まない
- Pagesへ公開しない
- 秘密情報を必要としない

### 8.3 Pages公開

Pages公開ジョブだけに必要な権限を与える。

```yaml
permissions:
  contents: read
  pages: write
  id-token: write
```

必要以上の`contents: write`、`pull-requests: write`、`actions: write`を与えない。

### 8.4 Actionsの固定

第三者Actionは完全なコミットSHAへ固定する。

バージョンタグだけを信頼しない。更新は独立した依存更新として確認する。

### 8.5 Environment

次を分ける。

- `github-pages`: G1-A / G1-Bの開発確認枠。ユーザー本人の必須reviewerと、bootstrap push用`agent/g1a-technical-foundation`および手動更新・cleanup用`main`のみを許可する制限を設定。確認後にだけ`DEVELOPMENT_PREVIEW_ENABLED=true`とする。内容refのG1-A / G1-B allowlistはワークフロー内で別に検査する
- `production`

`production`はG7まで使用しない。正式公開時はユーザー本人の承認を必要とする。

---

## 9. 同時実行

### 9.1 CI

同じpull requestでは古いCIを中止する。

```text
ci-pr-<番号>
```

### 9.2 開発確認ページ

確認ページは一件だけなので、全pull requestで共通のグループを使う。

```text
pages-development-preview
```

新しい承認済み配置が始まったら、古い配置処理を中止する。

### 9.3 正式公開

正式公開は別のグループを使う。

```text
pages-production
```

開発確認ページと正式公開を同時実行しない。

---

## 10. GitHub Actionsのジョブ分離

GitHubホスト型ランナーでは、ジョブごとに環境が分かれることを前提にする。

`install`ジョブで作った`node_modules`が別ジョブへ自動共有されるとは考えない。

実装済みの構成:

- 各ジョブで`npm ci`
- npmキャッシュで取得を短縮
- ビルド成果物だけArtifactで渡す
- `node_modules`全体をArtifactで渡さない

G1-Aでは、品質検査を一ジョブにまとめ、ブラウザ検査をChromium / WebKitの行列に分ける。実行時間が許容範囲を超えた場合だけ、次を再検討する。

- 型検査・静的検査・単体試験を一つのジョブへまとめる
- 複数ジョブでそれぞれ`npm ci`する

---

## 11. 開発確認ページの切り替えと削除

### 11.1 更新

確認ページを更新する時は、Pages成果物全体を再構築する。

G7前の成果物には必ず次を含める。

- 開発中のルート案内
- `robots.txt`
- 現在の確認ページ1件

他のpull request成果物を保持・統合する処理は作らない。

### 11.2 pull request終了時

pull request終了時は、確認ページを削除した成果物を再配置するか、次の確認対象へ置き換える。

G1-Aを実装したpull request自身の終了後処理は、マージ後に確認し、結果を次のPRまたは制作状況へ記録する。

一つのpull request内だけで「終了後削除まで完全確認済み」とは扱わない。

---

## 12. G1-Aの合格条件

- CIとPages公開の権限が分離
- 外部フォークではPages公開ジョブが実行されない
- `pull_request_target`でPRコードを実行しない
- 開発確認ページをiPhone Safariで開ける
- 本番ルートには未完成ゲームを置かない
- ルートと確認ページに`noindex`
- 開発確認ページへ環境名とコミットSHAを表示
- 開発版と本番版の保存キーが分離
- `main`への取り込みだけでは正式版を公開しない
- 正式公開は手動承認が必要
- GitHub Actionsの権限が必要最小限
- 第三者Actionを完全なコミットSHAへ固定
- URLを案内しない方針がREADME、公開サイト、SNS運用と一致

---

## 13. G7正式公開時の確認

- ユーザー本人が一般公開を承認
- 正式版コミットSHAを固定
- 正式版ルートへゲームを配置
- 開発確認ページを公開成果物から除外
- `robots.txt`とOGPを正式公開用へ変更
- 本番保存キーを使用
- 公開URL、操作説明、対応環境を確認
- 直前成果物へ戻せることを確認
- URLを初めて外部へ案内する範囲を決定

---

## 14. 中止条件

次の場合はPages公開処理を止める。

- 本番ルートが開発版で上書きされる可能性
- 外部pull requestが公開権限を得る
- 開発版が本番保存キーを読み書きする
- Pages公開に不要な書き込み権限が必要
- 秘密情報をPages成果物へ含める必要がある
- 同時実行で成果物の出所を特定できない
- 公開コミットSHAを画面で確認できない
- G7前に一般公開用のリンクが掲載される

中止時はCIだけを残し、公開方式を再設計する。
