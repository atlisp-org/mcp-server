# SignPath Foundation 代码签名配置指南

Windows 二进制（`dist/AtlispTray.exe`、`dist/AtlispUpdater.exe`）通过
[SignPath Foundation](https://signpath.org) 免费签名。证书主体是 **SignPath Foundation**
（不是本项目），用户看到的发布者名称也是它；这是换取「无需自购 OV 证书 + 无地区限制」的代价。

> Azure Artifact Signing 的 Public Trust **只对特定国家/地区的组织开放，个人仅限美国/加拿大**，
> 中国大陆主体无法使用。详见 `docs/azure-artifact-signing.md` 开头的资格说明。

---

## 1. 申请前：仓库必须已经满足的条件

SignPath Foundation 的 [Code of Conduct](https://signpath.org/terms) 是硬性要求，审核时会逐条看：

| 条件 | 本仓库现状 |
|---|---|
| OSI 认可的开源许可证，无商业双许可 | ISC（`LICENSE`）✅ |
| 不含专有组件；待签名的二进制由本仓库源码构建 | `tray/*.cs`、`src/cad-rothelper.cs` ✅ |
| 项目活跃维护、已发布 | npm 已发布、有版本历史 ✅ |
| 功能有文档（下载页/应用商店条目） | `README.md` + `atlisp.cn` ✅ |
| 项目主页有 **Code signing policy** 章节，含固定措辞、团队角色、隐私政策 | `README.md` → 「Code signing policy」✅ |
| 所有成员对 GitHub / SignPath 开启 MFA | 需你确认 ⚠️ |
| 每次发布人工批准签名 | 签名策略里配 approver ✅ |

固定措辞必须是这一句（README 里已写入）：

```
Free code signing provided by SignPath.io, certificate by SignPath Foundation.
```

如果改了 README 的章节标题或删掉这句话，审核会被打回。

---

## 2. 提交申请

打开 <https://signpath.org/apply>（HubSpot 表单，需要浏览器 JS）。要填的内容：

| 项目 | 填什么 |
|---|---|
| Project / product name | `@lisp MCP Server` |
| Repository | `https://github.com/atlisp-org/mcp-server` |
| License | `ISC` |
| Website / download page | `https://atlisp.cn` 或 npm 页面 `https://www.npmjs.com/package/@atlisp/mcp` |
| Description | 一句话：MCP server bridging AI agents and CAD (AutoCAD/ZWCAD/GStarCAD/BricsCAD)；Windows 托盘负责启动本地服务 |
| Contact / email | 常用邮箱（SignPath 的批准通知、签名请求都会发这里） |
| 已签名/待签名文件 | `AtlispTray.exe`（WinForms 托盘）、`AtlispUpdater.exe`（自更新器） |

审核关注两点，如实说明有帮助：

- **为什么要签名**：未签名的 .NET exe 具备「下载并执行、写启动项、替换自身」能力，
  被 Defender 云端 ML 模型判为 `Trojan:Win32/Wacatac.H!ml`（误报）。
- **项目有一定可验证的声誉**：官网/用户群/发布历史。SignPath 明确写过
  「对可被下载执行的程序要求一定的可验证声誉」，新项目容易被拒；
  被拒可以隔一段时间补充材料再申请，不要反复刷。

审核是人工的，通常几天到两三周。

---

## 3. 通过后：在 SignPath 控制台配置

登录 <https://app.signpath.io>（邀请邮件里设置密码/SSO）。

### 3.1 组织与用户

1. 确认 Organization 已创建（名称随意，如 `atlisp`）
2. 邀请自己为成员并**开启 MFA**
3. 安装 [SignPath GitHub App](https://github.com/apps/signpath)，授权 `atlisp-org/mcp-server`
   （用于审计日志校验；不装的话私有仓库需要额外 `actions: read` 权限）

### 3.2 项目（Project）

Projects → New project：

| 字段 | 值 |
|---|---|
| Name | `@lisp MCP Server` |
| Slug | `atlisp-mcp-server` |
| Trusted Build System | 选 **GitHub.com**（需先在 Organization → Trusted Build Systems 里添加） |

### 3.3 签名策略（Signing Policy）

Project → Signing Policies → New：

| 字段 | 值 |
|---|---|
| Name | `release-signing` |
| Slug | `release-signing` |
| Requires approval | ✅ 开（OSS 项目强制） |
| Approvers | vitalgg |
| Artifact configuration | `atlisp-mcp-binaries`（下一步创建） |

### 3.4 制品配置（Artifact Configuration）

Project → Artifact Configurations → New：

- Name：`atlisp-mcp-binaries`（slug 必须与 workflow 里的
  `SIGNPATH_ARTIFACT_CONFIG_SLUG` 一致）
- 把仓库里的 [`signpath/artifact-configuration.xml`](../signpath/artifact-configuration.xml)
  全文粘贴进去（或用编辑器上传该文件）

配置要点：

- 根元素必须是 `<zip-file>` —— GitHub Actions 上传的 artifact 就是 ZIP
- 只签 `AtlispTray.exe` 和 `AtlispUpdater.exe`
- `product-name` / `product-version` / `file-version` / `company-name` / `copyright` /
  `original-filename` 是**元数据限制**：exe 的版本资源必须完全匹配，否则签名请求直接失败。
  这些值来自 `scripts/build-tray.mjs` 的 `writeStamp()`（固定 `1.0.0.0`），
  **改版本资源就要同步改 XML**

### 3.5 API Token

User settings → API Tokens → New：

- 权限：该项目的 **submitter**（能提交签名请求即可，不要给 admin）
- 复制 token（只显示一次）→ 填进 GitHub secret `SIGNPATH_API_TOKEN`

Organization ID 在 Organization settings 页面上（GUID 形式）→
`SIGNPATH_ORGANIZATION_ID`。

---

## 4. GitHub Secrets

仓库 → Settings → Secrets and variables → Actions → New repository secret：

| Secret | 值 |
|---|---|
| `SIGNPATH_API_TOKEN` | 3.5 生成的 token |
| `SIGNPATH_ORGANIZATION_ID` | Organization ID（GUID） |
| `SIGNPATH_PROJECT_SLUG` | `atlisp-mcp-server` |
| `SIGNPATH_SIGNING_POLICY_SLUG` | `release-signing` |
| `SIGNPATH_ARTIFACT_CONFIG_SLUG` | `atlisp-mcp-binaries` |

**不要**再配 `AZURE_TS_*`：`sign-release.yml` 的 `pick` 步骤优先 Azure，
两套都在会走错渠道。

---

## 5. 跑一次签名

Actions → **Sign release binaries** → Run workflow（不要勾 publish）：

1. `pick` 步骤应输出 `signer=signpath`（输出 `signer=none` 说明 secrets 没生效）
2. `提交 SignPath 签名请求` 步骤会挂起，等你在 SignPath 控制台批准
   （Approvals → 打开请求 → Approve；`wait-for-completion` 已放宽到 1800s）
3. 批准后自动下载签名产物到 `dist-signed/`，覆盖回 `dist/`
4. `signtool verify /pa /v` 通过
5. artifact `signed-binaries-v<版本>` 里就是最终要发布的 exe

正式发版：bump 版本 → 打 `v*` tag 推上去；或用 Run workflow 勾 `publish`
（publish job 用 `npm publish --ignore-scripts`，不会重新编译覆盖已签名产物）。

打 tag 时 `release-assets` job 会：
1. 生成 `dist/tray-manifest.json`（含两个 exe 的 SHA256）与 `dist/SHASUMS256.txt`
2. 如果配了 `ATLISP_UPLOAD_KEY`，把 exe + manifest 上传到 atlisp.cn（对外地址
   `https://atlisp.cn/download/<文件名>`，国内主源；上传失败不阻塞发版）
3. 同时把同样四个文件挂到对应的 GitHub Release（兜底源）

`atlisp-tray` 首次运行按顺序尝试这两个源，SHA256 对不上就拒绝执行。签名 job 被跳过
（`signer=none`）时该 job 也不会跑，避免把未签名产物挂上去。

`ATLISP_UPLOAD_KEY` 是 atlisp.cn 的开发者上传密钥（用户中心 → 安全 → 上传密钥，
账号 role ≥ developer），不配也能发版，只是国内用户只能走 GitHub。

### 本地验证签名

```powershell
signtool verify /pa /v dist\AtlispTray.exe
Get-AuthenticodeSignature dist\AtlispTray.exe | Format-List Status, SignerCertificate
# Status 应为 Valid，Subject 里有 "SignPath Foundation"
```

---

## 6. 常见问题

| 现象 | 原因 / 处理 |
|---|---|
| `signer=none` | 5 个 secret 缺一个；Environment secrets 不会自动对 job 可见 |
| `Artifact configuration 'xxx' not found` | `SIGNPATH_ARTIFACT_CONFIG_SLUG` 与实际 slug 不一致 |
| 签名请求被拒：metadata mismatch | exe 版本资源与 XML 里的 `product-*` 不匹配（改过 `writeStamp()` 没同步 XML） |
| 签名请求超时 | 没人批准；默认 600s 已调到 1800s，仍需人工点 Approve |
| `Root element must be zip-file` | artifact 是 ZIP（`upload-artifact` 默认行为），XML 根元素要改成 `<zip-file>` |
| `Jobs must run on GitHub-hosted runners` | OSS 项目不允许 self-hosted runner 参与签名前的构建 |
| 发布后 exe 又变未签名 | publish 时跑了 `preprepublishOnly`/`prepack` 重新编译；必须 `--ignore-scripts` |
| 用户仍看到「未知发布者」 | 首次下载的新 hash 在 SmartScreen 里没有累积，签名后点「更多信息」即可通过，通常几天后消失 |

---

## 7. 后续可选项

### 7.1 把 `cad-rothelper.dll` 也签上

当前没签，因为 `scripts/build-rot.mjs` 没给 dll 写程序集属性，过不了元数据限制。
要做的话：

1. 给 `build-rot.mjs` 加一个类似 `writeStamp()` 的 AssemblyInfo 源
   （`AssemblyProduct("@lisp MCP Server")`、`AssemblyFileVersion("1.0.0.0")` 等），
   并补 `-deterministic` + `-pathmap`
2. sign job 里加 `npm run build:rot`，`upload-artifact` 的 path 加上
   `dist/cad-rothelper.dll`
3. 制品配置里加对应 `<pe-file path="cad-rothelper.dll">`
4. publish job 的 `download-artifact` 会覆盖 `npm run build` 刚产出的未签名 dll —— 顺序本来就对

### 7.2 版本资源是否需要恢复真实版本号

现在 exe 的版本资源固定 `1.0.0.0`（为了让 hash 跨版本稳定、积累 Defender 信誉）。
签名之后信誉主体变成证书，这个理由弱化了；但改动会影响制品配置的元数据限制。
若要改：`writeStamp()` 接 npm 版本 → XML 用
`<parameter name="version" required="true"/>` + `product-version="${version}"`，
workflow 里通过 action 的 `parameters` 传入版本号。

### 7.3 签名后的说明

签名后证书主体是 **SignPath Foundation**，不是 `atlisp.cn`。
建议在 `README.md`、`tray/README.md` 的故障排查表里说明：
「文件属性 → 数字签名」显示 SignPath Foundation 属正常，这是 OSS 免费签名计划。
