# Azure Artifact Signing 配置指南

> **先看资格，否则下面全白做**：Public Trust（能签出公信证书的那档）只对
> **特定国家/地区的组织**开放（美国、加拿大、欧盟、英国、澳大利亚、新西兰、日本、韩国、
> 新加坡、瑞士、挪威、以色列），**个人开发者仅限美国/加拿大**。
> Private Trust 签出来的证书只在本机/本域受信，对消除杀软误报没有作用。
> 中国大陆主体无法使用本服务 —— 请走
> [SignPath Foundation](signpath-signing.md)（免费、无地区限制，本仓库已接入）。

Windows 二进制（`dist/AtlispTray.exe` + `dist/AtlispUpdater.exe`）的代码签名服务。
原名 **Azure Trusted Signing**，2026-01 更名为 **Azure Artifact Signing**（功能不变；
GitHub Action 为 `azure/artifact-signing-action@v2`）。

## 成本与身份

- Basic 档 **$9.99/月**（含 5000 次签名，远超本项目需求）
- **证书主体 = Azure 订阅的认证身份**（个人实名或公司）。这个身份就是长期积累的
  发布者信誉主体，选定后不要换订阅/换身份。
- 全程无硬件 token、无本地私钥（Azure HSM 托管），CI 全自动，不需要每次发版人工审批。

## 一键配置（az CLI）

> 注意：`scripts/azure-signing-setup.sh` 仍是更名前的命令（`az trusted-signing` /
> `cert-profile`），现在会失败。正确命令是 `az artifact-signing create ... --sku Basic` 和
> `az artifact-signing certificate-profile create --profile-type PublicTrust
> --identity-validation-id <GUID>`，且身份验证（Identity validation）只能在门户做。
> 中国大陆主体没有资格，改用 `docs/signpath-signing.md` 的流程。

```bash
# 1. 安装 az CLI（Windows: winget install Microsoft.AzureCLI）
# 2. 登录（需要已有 pay-as-you-go 订阅；没有的话先到 azure.com 注册 + 绑卡）
az login
#    无头机器自动走设备码：浏览器打开 https://microsoft.com/devicelogin 输入提示的代码

# 3. 一键配置（资源组 / 签名账户 / 证书配置档 / Entra 应用 / 联合身份 / 角色）
bash scripts/azure-signing-setup.sh
#    可选参数: --subscription <id> --location <region>
```

脚本完成后打印 6 个值，粘贴到
`github.com/atlisp-org/mcp-server → Settings → Secrets and variables → Actions`：

| Secret | 说明 |
|---|---|
| `AZURE_CLIENT_ID` | Entra 应用注册 ID |
| `AZURE_TENANT_ID` | 目录 ID |
| `AZURE_SUBSCRIPTION_ID` | 订阅 ID |
| `AZURE_TS_ENDPOINT` | 与账户区域绑定（如 `https://eus.codesigning.azure.net`）|
| `AZURE_TS_ACCOUNT` | 签名账户名 |
| `AZURE_TS_CERT_PROFILE` | 证书配置档名 |

## OIDC 联合身份说明（关键坑）

本仓库创建于 2026-07-15 之后，GitHub OIDC 的 `sub` 声明使用 **immutable subject
格式**（带 owner/repo 数字 ID）：

```
repo:atlisp-org@105924696/mcp-server@1433768727:ref:refs/heads/main
repo:atlisp-org@105924696/mcp-server@1433768727:ref:refs/tags/v*
```

脚本创建的联合身份凭据是**柔性凭据**（`claimsMatchingExpression`），只匹配
`main` 分支和 `v*` tag 的签名工作流，并额外校验 `repository_id`。
如果改了仓库名/迁移了仓库，更新 `scripts/azure-signing-setup.sh` 顶部的常量
（数字 ID 不变，只改名字部分）。

## 触发签名与发布

- **试跑（不发布）**：Actions → `Sign release binaries` → Run workflow
- **正式发布**：bump 版本 → `git tag vX.Y.Z && git push <remote> vX.Y.Z`
  （tag push 自动跑：编译 → 签名 → `signtool verify /pa` → `npm publish --ignore-scripts`）

## 验证

```powershell
# Windows
signtool verify /pa /v dist\AtlispTray.exe
```

或重新下载 npm tarball 解析 PE 证书表（证书表非空 = 已签名）。

## 故障排查

| 现象 | 原因 / 处理 |
|---|---|
| `azure/login` 报 401/403 / 签名步骤鉴权失败 | 联合身份 subject 不匹配——确认用的是 immutable 格式（见上）；确认 Entra 应用存在且角色已分配 |
| 签名 403 `SignerSign()` 失败 | `AZURE_TS_ENDPOINT` 与签名账户区域不匹配，以门户 Overview 页的 Endpoint 为准 |
| 角色分配报找不到角色 | 角色名在门户可能是旧名 `Trusted Signing Certificate Profile Signer`，两个名字脚本都试了；仍失败就在门户手动分配 |
| 发布后 exe 仍是未签名 | publish job 下载的是 `signed-binaries-v<版本>` artifact——确认 sign job 真的执行了签名（不是 `signer=none` 跳过）|
| Defender 首次下载仍报毒 | 新 hash 无信誉属正常，到 microsoft.com/wdsi/filesubmission 提交误报（几天内生效）|

## 备选渠道：SignPath Foundation

`sign-release.yml` 同时支持 SignPath（免费，开源项目；证书主体为 SignPath
Foundation，每次发版需人工批准）。两条渠道互斥，`pick` 步骤优先 Azure。
若走 SignPath，需公开仓库 + OSI 许可（已具备）+ 向 signpath.org 申请，
流程见 `tray/README.md` 的「杀软误报」一节。
