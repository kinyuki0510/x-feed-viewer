# X Feed Viewer

nitter.net 経由で X（Twitter）の特定アカウントのポストを RSS 取得し、ブラウザで閲覧できる PWA。

## アーキテクチャ

```
[GitHub Actions] ──fetch──▶ [nitter.net]
       │
       │ s3:PutObject (OIDC 認証)
       ▼
[S3 バケット]
  ├── accounts.json
  ├── feeds/{username}.xml
  └── frontend/ (index.html, app.js, feed.js, sw.js, manifest.json)
       │
       │ CloudFront OAC
       ▼
[CloudFront] ──HTTPS──▶ [ブラウザ (PWA)]
```

## ディレクトリ構成

```
.
├── frontend/          # PWA 静的ファイル（S3 にデプロイする）
│   ├── index.html
│   ├── app.js         # DOM 操作・フェッチ
│   ├── feed.js        # 純粋ロジック（パース・ソート・フィルタ）
│   ├── manifest.json
│   └── sw.js          # Service Worker
├── tests/
│   └── feed.test.js   # Vitest ユニットテスト
├── terraform/         # IaC（S3・CloudFront・IAM）
│   ├── backend.tf
│   ├── main.tf
│   ├── variables.tf
│   └── outputs.tf
├── scripts/
│   └── init.sh        # Terraform 初期化スクリプト
└── .github/
    └── workflows/
        └── fetch-rss.yml  # RSS 取得ジョブ（6時間ごと）
```

## セットアップ手順

### 前提条件

- AWS CLI（認証済み）
- Terraform >= 1.6.0
- Node.js >= 18（テスト実行用）

---

### 1. Terraform 初期化

```bash
bash scripts/init.sh
```

これにより以下が実行されます：
- AWS アカウント ID を動的取得
- ステート管理用 S3 バケット `x-feed-viewer-tfstate-{ACCOUNT_ID}` を作成
- `terraform init` を実行

---

### 2. Terraform apply

```bash
cd terraform
terraform apply \
  -var="github_org=<GitHubのorg名またはユーザー名>" \
  -var="github_repo=<リポジトリ名>"
```

apply 完了後、以下の値が出力されます：

| Output | 用途 |
|---|---|
| `cloudfront_domain` | PWA のアクセス URL |
| `app_bucket_name` | GitHub Secret `S3_BUCKET` に設定する |
| `github_actions_role_arn` | GitHub Secret `AWS_ROLE_ARN` に設定する |

---

### 3. GitHub Secrets の設定

リポジトリの **Settings → Secrets and variables → Actions** で以下を追加：

| Secret 名 | 値 |
|---|---|
| `AWS_ROLE_ARN` | Terraform output の `github_actions_role_arn` |
| `S3_BUCKET` | Terraform output の `app_bucket_name` |

---

### 4. accounts.json を S3 にアップロード

監視したいアカウントを記述した `accounts.json` を S3 に配置します。

```json
{
  "accounts": [
    { "username": "official_clpc", "display_name": "CLPC" },
    { "username": "anthropic",     "display_name": "Anthropic" }
  ]
}
```

```bash
# S3_BUCKET は Terraform output の app_bucket_name
aws s3 cp accounts.json s3://<S3_BUCKET>/accounts.json
```

---

### 5. フロントエンドファイルを S3 にデプロイ

```bash
aws s3 sync frontend/ s3://<S3_BUCKET>/ \
  --exclude "*.DS_Store"
```

> **注意**: `icon-192.png` と `icon-512.png` を `frontend/` に追加してからデプロイしてください。
> これらはホーム画面追加時のアイコンとして使用されます。

---

### 6. 初回 RSS 取得

GitHub Actions タブから `Fetch RSS Feeds` ワークフローを手動実行して、
初回フィードを取得してください。

---

### 7. アクセス確認

Terraform output の `cloudfront_domain` の URL をブラウザで開いてください。

## テスト実行

```bash
npm install
npm test
```

## コスト目安

| リソース | 月額概算 |
|---|---|
| S3 ストレージ | < $0.01 |
| S3 リクエスト（GitHub Actions） | < $0.01 |
| CloudFront（軽量トラフィック） | ~$0.10 |
| **合計** | **< $0.20/月** |
