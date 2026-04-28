# variables.tf — 外部から注入する設定値

variable "aws_region" {
  description = "リソースを作成する AWS リージョン"
  type        = string
  default     = "ap-northeast-1"
}

variable "project_name" {
  description = "リソース名のプレフィックス（S3 バケット名・IAM ロール名などに使用）"
  type        = string
  default     = "x-feed-viewer"
}

variable "github_org" {
  description = "GitHub の組織名またはユーザー名（OIDC の信頼ポリシーに使用）"
  type        = string
}

variable "github_repo" {
  description = "GitHub のリポジトリ名（OIDC の信頼ポリシーに使用）"
  type        = string
}
