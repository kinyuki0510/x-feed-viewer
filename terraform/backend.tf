# backend.tf — Terraform ステート管理の設定
#
# bucket は scripts/init.sh が動的に取得した AWS アカウント ID を使って
# `terraform init -backend-config="bucket=..."` で渡す。
# ここに bucket を直接書くとアカウント ID がリポジトリに露出するため禁止。

terraform {
  backend "s3" {
    key    = "x-feed-viewer/terraform.tfstate"
    region = "ap-northeast-1"

    # bucket は init.sh から -backend-config で注入されるため省略
  }
}
