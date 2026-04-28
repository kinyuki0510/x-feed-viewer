# main.tf — AWS リソース定義
#
# 作成するリソース:
#   1. S3 バケット（PWA 静的ファイル + feeds/ + accounts.json）
#   2. CloudFront ディストリビューション（HTTPS 配信 + OAC）
#   3. IAM OIDC プロバイダー（GitHub Actions 用）
#   4. IAM ロール・ポリシー（GitHub Actions から S3 へのアクセス）

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# アカウント ID をバケット名に使用するために取得（ハードコード禁止）
data "aws_caller_identity" "current" {}

# ─── S3 バケット ──────────────────────────────────────────────────────────────

resource "aws_s3_bucket" "app" {
  # バケット名にアカウント ID を含めてグローバル一意性を担保
  bucket = "${var.project_name}-app-${data.aws_caller_identity.current.account_id}"
}

# パブリックアクセスをすべてブロック（CloudFront OAC 経由のみ許可）
resource "aws_s3_bucket_public_access_block" "app" {
  bucket = aws_s3_bucket.app.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# CORS 設定
# フロントエンドが CloudFront 経由で同一オリジンからフィードを取得するため
# 通常は CORS 不要だが、ローカル開発時などのクロスオリジンアクセスに備えて設定する
resource "aws_s3_bucket_cors_configuration" "app" {
  bucket = aws_s3_bucket.app.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET"]
    allowed_origins = ["*"]
    max_age_seconds = 3600
  }
}

# ─── CloudFront ───────────────────────────────────────────────────────────────

# セキュリティレスポンスヘッダーポリシー
# style-src に unsafe-inline を許可しているのは index.html の <style> タグのため。
# 将来的に CSS を外部ファイルに分離した場合は unsafe-inline を削除すること。
resource "aws_cloudfront_response_headers_policy" "security" {
  name    = "${var.project_name}-security-headers"
  comment = "セキュリティヘッダーを全レスポンスに付与する"

  security_headers_config {
    content_security_policy {
      content_security_policy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self';"
      override                = true
    }

    # HTTPS の強制（1年間 HSTS を有効化）
    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = true
      preload                    = true
      override                   = true
    }

    # MIME タイプのスニッフィングを防止
    content_type_options {
      override = true
    }

    # iframe 埋め込みを拒否
    frame_options {
      frame_option = "DENY"
      override     = true
    }

    # XSS フィルターを有効化（レガシーブラウザ向け）
    xss_protection {
      mode_block = true
      protection = true
      override   = true
    }

    # リファラー情報の送信を制限
    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }
  }
}

# OAC (Origin Access Control) — OAI より新しい推奨方式
resource "aws_cloudfront_origin_access_control" "app" {
  name                              = "${var.project_name}-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "app" {
  origin {
    # REST エンドポイント（OAC には静的ウェブサイトエンドポイントではなくこちらを使う）
    domain_name              = aws_s3_bucket.app.bucket_regional_domain_name
    origin_id                = "S3-${aws_s3_bucket.app.id}"
    origin_access_control_id = aws_cloudfront_origin_access_control.app.id
  }

  enabled             = true
  default_root_object = "index.html"
  comment             = "${var.project_name} PWA"

  # 静的アセット（HTML/JS/manifest）: 5分キャッシュ
  default_cache_behavior {
    allowed_methods              = ["GET", "HEAD"]
    cached_methods               = ["GET", "HEAD"]
    target_origin_id             = "S3-${aws_s3_bucket.app.id}"
    viewer_protocol_policy       = "redirect-to-https"
    response_headers_policy_id   = aws_cloudfront_response_headers_policy.security.id

    forwarded_values {
      query_string = false
      cookies { forward = "none" }
    }

    min_ttl     = 0
    default_ttl = 300   # 5 分
    max_ttl     = 3600  # 1 時間
  }

  # feeds/*.xml: 6時間ごとに更新されるため TTL を0にしてキャッシュさせない
  ordered_cache_behavior {
    path_pattern                 = "/feeds/*"
    allowed_methods              = ["GET", "HEAD"]
    cached_methods               = ["GET", "HEAD"]
    target_origin_id             = "S3-${aws_s3_bucket.app.id}"
    viewer_protocol_policy       = "redirect-to-https"
    response_headers_policy_id   = aws_cloudfront_response_headers_policy.security.id

    forwarded_values {
      query_string = false
      cookies { forward = "none" }
    }

    min_ttl     = 0
    default_ttl = 0
    max_ttl     = 21600  # 6 時間（CloudFront はキャッシュしないが上限を明示）
  }

  # accounts.json: 手動更新の可能性があるため TTL を0に設定
  ordered_cache_behavior {
    path_pattern                 = "/accounts.json"
    allowed_methods              = ["GET", "HEAD"]
    cached_methods               = ["GET", "HEAD"]
    target_origin_id             = "S3-${aws_s3_bucket.app.id}"
    viewer_protocol_policy       = "redirect-to-https"
    response_headers_policy_id   = aws_cloudfront_response_headers_policy.security.id

    forwarded_values {
      query_string = false
      cookies { forward = "none" }
    }

    min_ttl     = 0
    default_ttl = 0
    max_ttl     = 3600
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  # CloudFront のデフォルト証明書を使用（カスタムドメイン不使用）
  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

# CloudFront OAC からの GetObject のみ許可するバケットポリシー
resource "aws_s3_bucket_policy" "app" {
  bucket = aws_s3_bucket.app.id

  # public_access_block より先に適用されるとエラーになるため依存関係を明示
  depends_on = [aws_s3_bucket_public_access_block.app]

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowCloudFrontOAC"
        Effect = "Allow"
        Principal = {
          Service = "cloudfront.amazonaws.com"
        }
        Action   = "s3:GetObject"
        Resource = "${aws_s3_bucket.app.arn}/*"
        Condition = {
          StringEquals = {
            # このディストリビューションからのリクエストのみ許可
            "AWS:SourceArn" = aws_cloudfront_distribution.app.arn
          }
        }
      }
    ]
  })
}

# ─── IAM（GitHub Actions OIDC） ──────────────────────────────────────────────

# GitHub の OIDC プロバイダーを AWS アカウントに登録
# サムプリントは GitHub の公式ドキュメントに記載された値を使用
resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [
    "6938fd4d98bab03faadb97b34396831e3780aea1",
    "1c58a3a8518e8759bf075b76b750d4f2df264fcd",
  ]
}

# GitHub Actions が AssumeRoleWithWebIdentity で引き受けるロール
resource "aws_iam_role" "github_actions" {
  name = "${var.project_name}-github-actions"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Federated = aws_iam_openid_connect_provider.github.arn
        }
        Action = "sts:AssumeRoleWithWebIdentity"
        Condition = {
          StringEquals = {
            "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          }
          # 特定リポジトリからのワークフローのみ許可（* でブランチ・タグを許容）
          StringLike = {
            "token.actions.githubusercontent.com:sub" = "repo:${var.github_org}/${var.github_repo}:*"
          }
        }
      }
    ]
  })
}

# GitHub Actions に必要最小限の S3 権限のみ付与（最小権限の原則）
resource "aws_iam_role_policy" "github_actions_s3" {
  name = "s3-feed-access"
  role = aws_iam_role.github_actions.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ReadAccounts"
        Effect = "Allow"
        Action = ["s3:GetObject"]
        # accounts.json の読み取りのみ
        Resource = "${aws_s3_bucket.app.arn}/accounts.json"
      },
      {
        Sid    = "WriteFeeds"
        Effect = "Allow"
        Action = ["s3:PutObject"]
        # feeds/ 配下の XML 書き込みのみ
        Resource = "${aws_s3_bucket.app.arn}/feeds/*"
      }
    ]
  })
}
