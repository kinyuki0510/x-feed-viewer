# outputs.tf — apply 後に必要な情報を出力する
#
# CloudFront URL と IAM ロール ARN は GitHub Secrets に設定が必要。

output "cloudfront_domain" {
  description = "PWA のアクセス URL（https:// を付けてブラウザでアクセス）"
  value       = "https://${aws_cloudfront_distribution.app.domain_name}"
}

output "app_bucket_name" {
  description = "S3 バケット名（GitHub Secret: S3_BUCKET に設定する）"
  value       = aws_s3_bucket.app.id
}

output "github_actions_role_arn" {
  description = "GitHub Actions 用 IAM ロール ARN（GitHub Secret: AWS_ROLE_ARN に設定する）"
  value       = aws_iam_role.github_actions.arn
}
