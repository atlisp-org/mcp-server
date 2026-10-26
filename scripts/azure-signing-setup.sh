#!/usr/bin/env bash
# Azure Artifact Signing（原 Trusted Signing，2026-01 更名）+ GitHub Actions OIDC 一键配置
#
# 前置：
#   1. 已安装 az CLI 并已 az login（无头机器用设备码：az login 会提示浏览器输入代码）
#   2. 已有 pay-as-you-go 订阅（Basic 档 $9.99/月含 5000 次签名）
#      注意：证书主体 = 该订阅的认证身份（个人实名/公司），想好再选订阅
#
# 用法：
#   bash scripts/azure-signing-setup.sh
#   bash scripts/azure-signing-setup.sh --subscription <id> --location westeurope
#
# 完成后会打印 6 个需要粘贴到 GitHub secrets 的值。

set -euo pipefail

SUBSCRIPTION=''
RESOURCE_GROUP='atlisp-rg'
LOCATION='eastus'
ACCOUNT_NAME='atlisp-mcp-signing'
PROFILE_NAME='atlisp-mcp-profile'
APP_NAME='atlisp-mcp-gh-action-signer'

while [[ $# -gt 0 ]]; do
  case "$1" in
    --subscription) SUBSCRIPTION="$2"; shift 2;;
    --resource-group) RESOURCE_GROUP="$2"; shift 2;;
    --location) LOCATION="$2"; shift 2;;
    --account-name) ACCOUNT_NAME="$2"; shift 2;;
    --profile-name) PROFILE_NAME="$2"; shift 2;;
    *) echo "未知参数: $1"; exit 1;;
  esac
done

# ---- GitHub 仓库常量（immutable subject，2026-07-15 后新建仓库的格式）----
# 参考: https://docs.github.com/en/actions/reference/security/oidc#immutable-subject-claims
GITHUB_OWNER='atlisp-org'
GITHUB_OWNER_ID='105924696'
GITHUB_REPO='mcp-server'
GITHUB_REPO_ID='1433768727'
OIDC_ISSUER='https://token.actions.githubusercontent.com'

command -v az >/dev/null 2>&1 || { echo "未找到 az CLI（winget install Microsoft.AzureCLI / pip install azure-cli）"; exit 1; }

echo "==> 检查登录状态..."
ACCOUNT_JSON="$(az account show -o json)" || {
  echo "未登录。请先运行: az login"
  echo "（无头机器会自动走设备码流程：打开 https://microsoft.com/devicelogin 输入提示的代码）"
  exit 1
}
TENANT_ID="$(echo "$ACCOUNT_JSON" | python3 -c 'import sys,json;print(json.load(sys.stdin)["tenantId"])')"
if [[ -n "$SUBSCRIPTION" ]]; then
  az account set --subscription "$SUBSCRIPTION"
else
  SUBSCRIPTION="$(echo "$ACCOUNT_JSON" | python3 -c 'import sys,json;print(json.load(sys.stdin)["subscriptionId"])')"
fi
echo "使用订阅: $SUBSCRIPTION (tenant: $TENANT_ID)"

echo "==> 创建资源组 $RESOURCE_GROUP ($LOCATION)..."
az group create --name "$RESOURCE_GROUP" --location "$LOCATION" >/dev/null

echo "==> 创建签名账户 $ACCOUNT_NAME（自动签发 OV 代码签名证书）..."
az trusted-signing create --resource-group "$RESOURCE_GROUP" --name "$ACCOUNT_NAME" --location "$LOCATION" >/dev/null

echo "==> 创建证书配置档 $PROFILE_NAME..."
az trusted-signing cert-profile create --account "$ACCOUNT_NAME" --name "$PROFILE_NAME" --resource-group "$RESOURCE_GROUP" >/dev/null

echo "==> 创建 Entra 应用注册 $APP_NAME..."
APP_JSON="$(az ad app create --name "$APP_NAME" \
  --display-name "GitHub Actions signer for $GITHUB_OWNER/$GITHUB_REPO" -o json)"
APP_ID="$(echo "$APP_JSON" | python3 -c 'import sys,json;print(json.load(sys.stdin)["appId"])')"
APP_OBJECT_ID="$(echo "$APP_JSON" | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')"

echo "==> 创建柔性联合身份凭据（subject 限定本仓库 main 分支 + v* tag）..."
CRED_JSON="$(mktemp /tmp/atlisp-fic-XXXXXX.json)"
cat > "$CRED_JSON" <<EOF
{
  "name": "github-actions-sign-release",
  "issuer": "$OIDC_ISSUER",
  "audiences": ["api://AzureADTokenExchange"],
  "claimsMatchingExpression": {
    "value": "claims['sub'] matches 'repo:${GITHUB_OWNER}@${GITHUB_OWNER_ID}/${GITHUB_REPO}@${GITHUB_REPO_ID}:ref:refs/(heads/main|tags/v[^/]+)' and claims['repository_id'] eq '${GITHUB_REPO_ID}'",
    "languageVersion": 1
  }
}
EOF
az ad app federated-credential create --id "$APP_OBJECT_ID" --parameters "$CRED_JSON" >/dev/null
rm -f "$CRED_JSON"

echo "==> 分配签名角色..."
SCOPE="/subscriptions/$SUBSCRIPTION/resourceGroups/$RESOURCE_GROUP"
az role assignment create --assignee "$APP_OBJECT_ID" --assignee-principal-type ServicePrincipal \
  --role "Artifact Signing Certificate Profile Signer" --scope "$SCOPE" >/dev/null 2>&1 || {
  echo "   新角色名不可用，尝试旧角色名（Trusted Signing Certificate Profile Signer）..."
  az role assignment create --assignee "$APP_OBJECT_ID" --assignee-principal-type ServicePrincipal \
    --role "Trusted Signing Certificate Profile Signer" --scope "$SCOPE" >/dev/null
}

# endpoint 与区域绑定：eastus→eus、westus2→wus2；多词区域（westeurope、japaneast 等）直接用区域名。
# 最终以门户 Overview 页显示的 Endpoint 为准。
EP_REGION="$(echo "$LOCATION" | sed -e 's/^east/e/' -e 's/^west/w/')"
ENDPOINT="https://${EP_REGION}.codesigning.azure.net"

echo ""
echo "============================================================"
echo "配置完成！把下面 6 个值粘贴到 GitHub："
echo "  github.com/$GITHUB_OWNER/$GITHUB_REPO → Settings → Secrets and variables → Actions"
echo "============================================================"
echo "AZURE_CLIENT_ID        = $APP_ID"
echo "AZURE_TENANT_ID        = $TENANT_ID"
echo "AZURE_SUBSCRIPTION_ID  = $SUBSCRIPTION"
echo "AZURE_TS_ENDPOINT      = $ENDPOINT   （以门户 Overview 页显示的 Endpoint 为准）"
echo "AZURE_TS_ACCOUNT       = $ACCOUNT_NAME"
echo "AZURE_TS_CERT_PROFILE  = $PROFILE_NAME"
echo "============================================================"
echo ""
echo "下一步："
echo "  1. Actions → Sign release binaries → Run workflow（先不勾 publish）试跑"
echo "  2. 签名 + signtool verify 通过后，bump 版本打 tag 正式发布"
