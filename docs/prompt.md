# X（Twitter）RSS ビューワー PWA 構築

## 概要

nitter.net経由でXの特定ユーザーのポストをRSS取得し、
ブラウザで閲覧できるPWAをAWS上に構築する。
コスト目標: $1/月未満。

---

## 要件

### 1. アカウント管理 (S3)

- S3バケット上に `accounts.json` を配置し、監視対象アカウントを管理する
- 最大10アカウントまで
- フォーマット例:

```json
{
  "accounts": [
    { "username": "official_clpc", "display_name": "CLPC" }
  ]
}
```

---

### 2. RSS取得 (GitHub Actions)

- 6時間ごとに自動実行 (cron: `0 */6 * * *`)
- `accounts.json` を読み込み、各アカウントの RSS を取得する
- 取得URL例: `https://nitter.net/{username}/rss`
- 取得したXMLをアカウントごとに S3 へ保存: `feeds/{username}.xml`
- 古いファイルは上書き（履歴は保持しない）
- GitHub ActionsのOIDCを使いAWSへの認証を行う（アクセスキー不使用）

---

### 3. S3構成

```
s3://bucket-name/
├── accounts.json         # アカウント一覧
├── feeds/
│   ├── official_clpc.xml
│   └── ...
└── (PWA静的ファイル)
    ├── index.html
    ├── app.js
    ├── feed.js
    ├── manifest.json
    └── sw.js
```

---

### 4. フロントエンド (PWA)

- **実装: Vanilla JS**（ビルド不要、S3直置き可、依存なし）
- **配信: S3 + CloudFront**（Service WorkerはHTTPS必須のためCloudFront必須）
- `accounts.json` を読み込み、各アカウントの `feeds/{username}.xml` を取得・パース
- 全アカウントのポストを時系列順（新しい順）にまとめて表示
- アカウントごとのフィルタリング機能
- 引用ポストは非表示（`<blockquote>` を除去）
- 「元のポスト」リンクなし（本文をそのまま表示する方針のため）
- nitterのHTML構造を保持して表示（`sanitizeHTML` で危険な要素のみ除去、Option B採用）
- PWA対応: `manifest.json` と Service Worker を実装し、ホーム画面追加・オフライン対応

---

### 5. コスト制約

- S3ストレージ: XMLファイルは小さいため無視できるレベル
- S3リクエスト: 6時間×10アカウント = 40リクエスト/日、十分$1以下
- CloudFront: ~$0.10/月（軽量トラフィック想定）

---

### 6. IaC (Terraform)

- AWSリソースはすべてTerraformで管理する
- 対象リソース: S3バケット、IAMロール、IAMポリシー、CloudFront
- **ステートファイルはS3バケットで管理する**
  - バケット名: `x-feed-viewer-tfstate-{AWSアカウントID}`
  - アカウントIDは `scripts/init.sh` で動的取得（ハードコード禁止）
  - Terraformのbackend設定は変数を使えないため、`-backend-config` フラグ経由で渡す
- `terraform/` ディレクトリ以下に配置する

```
terraform/
├── backend.tf    # bucket以外の設定のみ（bucketはinit.shで渡す）
├── main.tf
├── variables.tf
└── outputs.tf
```

---

### 7. テスト

- **Vitest** を使用（ビルド不要で動作）
- テスト対象: `frontend/feed.js` の純粋ロジック（XMLパース・ソート・フィルタリング）
- DOM描画はテスト対象外（費用対効果が低いため）
- GitHub ActionsワークフローはE2Eテスト対象外

---

## 成果物

1. GitHub Actionsワークフローファイル (`.github/workflows/fetch-rss.yml`)
2. PWA静的ファイル一式 (`frontend/`)
3. Terraformファイル一式 (`terraform/`)
4. 初期化スクリプト (`scripts/init.sh`)
5. テストファイル (`tests/feed.test.js`)
6. README.md（セットアップ手順・Terraform apply手順を含む）

---

## 注意事項

- nitter.netへのアクセスはUser-Agentを設定してBot判定を回避する
- 取得失敗時（レスポンスがRSSでない場合）は既存ファイルを上書きしない
- CORSの設定をS3バケットに適切に行うこと
- AWSクレデンシャルはGitHub Secretsで管理する（`AWS_ROLE_ARN`, `S3_BUCKET`）
- アイコンファイル（`icon-192.png`, `icon-512.png`）は別途用意する必要がある
