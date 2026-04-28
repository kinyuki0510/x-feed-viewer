#!/usr/bin/env bash
# init.sh — Terraform 初期化スクリプト
#
# 実行内容:
#   1. AWS アカウント ID を動的取得
#   2. Terraform ステート用 S3 バケットを（未存在の場合）作成
#   3. terraform init を -backend-config でバケット名を注入して実行
#
# 使い方:
#   bash scripts/init.sh
#
# 前提:
#   - AWS CLI がインストール済みで認証済みであること
#   - Terraform がインストール済みであること

set -euo pipefail

REGION="${AWS_DEFAULT_REGION:-ap-northeast-1}"

# ─── アカウント ID 取得 ───────────────────────────────────────────────────────
echo "AWS アカウント ID を取得しています..."
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "  Account ID: ${ACCOUNT_ID}"

STATE_BUCKET="x-feed-viewer-tfstate-${ACCOUNT_ID}"
echo "  State Bucket: ${STATE_BUCKET}"

# ─── ステートバケット作成 ─────────────────────────────────────────────────────
if aws s3api head-bucket --bucket "${STATE_BUCKET}" 2>/dev/null; then
  echo "ステートバケットは既に存在します。スキップします。"
else
  echo "ステートバケットを作成しています..."

  # us-east-1 以外のリージョンでは LocationConstraint の指定が必要
  # us-east-1 のみ CreateBucketConfiguration を省略する必要がある（逆に指定するとエラー）
  if [ "${REGION}" = "us-east-1" ]; then
    aws s3api create-bucket \
      --bucket "${STATE_BUCKET}" \
      --region "${REGION}"
  else
    aws s3api create-bucket \
      --bucket "${STATE_BUCKET}" \
      --region "${REGION}" \
      --create-bucket-configuration LocationConstraint="${REGION}"
  fi

  echo "  作成完了: s3://${STATE_BUCKET}"
fi

# ─── terraform init ───────────────────────────────────────────────────────────
echo "terraform init を実行しています..."
cd "$(dirname "$0")/../terraform"

terraform init \
  -backend-config="bucket=${STATE_BUCKET}" \
  -backend-config="region=${REGION}"

echo ""
echo "初期化完了。次のコマンドで apply してください:"
echo "  cd terraform && terraform apply -var='github_org=<ORG>' -var='github_repo=<REPO>'"
