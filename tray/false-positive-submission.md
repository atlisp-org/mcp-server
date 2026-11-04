# 拿不到代码签名证书时怎么办

代码签名是**根治**手段，但不是唯一手段。没有证书时，能改变杀软判定的只有两件事：

1. **误报白名单**（微软 Defender 与国内厂商各自的提交通道）；
2. **用户根本下载不到那个 PE**（换分发方式，减少浏览器 MOTW 触发 SmartScreen）。

本文是第 1 条的作业说明。第 2 条的页面/内核侧改动见 `/agent/chat` 的使用说明与
`docs/no-tray.md`。

---

## 前提：白名单是**按文件哈希**的

微软的误报白名单（以及 360/火绒/腾讯的）针对的是**具体文件**，不是“产品名”。
exe 只要重新编译一次，哈希就变了，白名单立即失效——用户又会被拦。

所以无证书策略的第一条不是“提交”，而是**冻结二进制**：

- `tray/build.ps1` 已把版本资源固定为 `1.0.0.0`（真实版本写在 `AtlispTray.version`），
  并用 `-deterministic` + `-pathmap` 编译：**源码不变 + 编译器版本不变 ⇒ 字节一致**。
- 因此：**不要为了 npm 版本号去重建托盘**。托盘只在 `tray/` 下的源码真的改了才重建，
  重建并提交误报通过后，把新哈希写进 `tray/exe-baseline.json`。
- `npm run build:tray-manifest` 会比对 `tray/exe-baseline.json`：哈希变了会告警，
  提醒你“这个 exe 还没被白名单覆盖”。

> 当前基线（`tray/exe-baseline.json`）：`ce67af91…1921b`，对应 v1.12.20 的发布产物。

---

## 提交前自检（先改行为，再提报）

- [ ] `dist/AtlispTray.exe` 的 SHA256 = `tray/exe-baseline.json` 里的值（同一份文件）
- [ ] 没有加壳 / 混淆 / UPX
- [ ] 版本资源完整：`CompanyName`、`ProductName`、`FileDescription`、`Copyright`
      （`tray/build.ps1` 已生成；用资源管理器 → 属性 → 详细信息核对）
- [ ] 这一版没有新增“下载并执行 / 写启动项 / 自我替换”之类的高权重行为
- [ ] 记下检测名（Defender 的「保护历史记录」里能看到，如 `Trojan:Win32/Wacatac.B!ml`）、
      系统版本、Defender 平台版本——提交时都要填

---

## 1. 微软 Defender（WDSI）

入口：<https://www.microsoft.com/en-us/wdsi/filesubmission>
类型选 **Software developer**（不是 “Home customer”），按下面填：

| 字段 | 内容 |
|---|---|
| Product name | `@lisp MCP Server (AtlispTray)` |
| Company name | `atlisp.cn`（与 exe 的 `CompanyName` 一致） |
| File | 上传 `AtlispTray.exe`（或填 SHA256 + 下载 URL） |
| Detection name | 例如 `Trojan:Win32/Wacatac.B!ml` |
| Download URL | `https://atlisp.cn/download/AtlispTray.exe` |

说明正文（可直接用）：

```text
AtlispTray.exe is the tray launcher for the open-source @lisp MCP server
(https://atlisp.cn, source: https://github.com/atlisp-org/mcp-server, ISC license).

It is a small signed-less .NET Framework 4.x WinForms utility that starts/stops a
local Node.js MCP service on 127.0.0.1:8110 and shows its status. It does not
obfuscate, pack, or hide anything, and it no longer self-updates or writes any
.cmd/.bat scripts. The only autostart entry is written with explicit user consent
to HKCU\Software\Microsoft\Windows\CurrentVersion\Run, and can be removed from the
same menu.

The detected file is byte-identical to the one we distribute:
SHA256 ce67af9190df774eb9ede6fa6ed8039126712e940106af7d6495ecc4a221921b
(178688 bytes, version resource 1.0.0.0).

Please review and whitelist this hash, or tell us which behaviour triggers the
machine-learning verdict so we can remove it. We are also in the process of
obtaining a code-signing certificate.
```

提交后几天内会回邮件；通过后 Defender 客户端会在数小时内更新定义。
**换了 exe 就要重提。**

## 2. 国内厂商

| 厂商 | 入口 | 备注 |
|---|---|---|
| 360 | <https://open.360.cn/report.html>（误报申诉） | 选「文件误报」，附 SHA256 与下载地址；也可在企业后台提交 |
| 火绒 | `huorong.cn` → 服务 → 误报反馈（邮件 `support@huorong.cn`） | 附文件、检测名、复现步骤 |
| 腾讯电脑管家 | <https://guanjia.qq.com/online_server/feedback.html> | 选「误报申诉」 |

中文模板：

```text
文件：AtlispTray.exe（178688 字节）
SHA256：ce67af9190df774eb9ede6fa6ed8039126712e940106af7d6495ecc4a221921b
下载：https://atlisp.cn/download/AtlispTray.exe
产品：@lisp MCP Server 托盘（开源，ISC 协议，https://github.com/atlisp-org/mcp-server）
检测名：<填厂商给的检测名>
说明：.NET 托盘程序，用于启动/停止本机 127.0.0.1:8110 的 Node.js MCP 服务并显示状态。
无加壳/混淆，不自替换，运行期间不写脚本；开机自启仅在用户于菜单中勾选后写入
HKCU\...\Run，可随时取消。请复核并加入白名单；如需我们调整触发特征，请告知具体行为。
```

---

## 3. 每次重建后的流程

1. 重建 → 跑 `npm run build:tray-manifest`，看有没有“哈希与基线不同”的告警；
2. 把新哈希提交到上述通道（微软 + 国内三家）；
3. 白名单通过后，把新哈希/版本写进 `tray/exe-baseline.json` 并提交；
4. 在 `tray/README.md` 的「杀软误报」一节补一行日期与结论（便于下次判断是否需要重提）。

## 4. 拿不到证书期间的产品侧兜底

- `/agent/chat` 的安装说明已改成：**优先** `npm install -g @atlisp/mcp` +
  `atlisp-mcp --install-autostart`（纯 Node，进程是签名的 `node.exe`/`conhost.exe`，
  完全没有 PE 可被拦）；托盘只是可选的图形界面。
- 必须用托盘时，页面提供 **PowerShell `Invoke-WebRequest`** 的下载方式：
  命令行下载不写 MOTW，不会触发 SmartScreen。
- 页面会读 `tray-manifest.json` 的 `signed` 字段，如实显示「尚未做代码签名」，
  不再写死一段可能已经过期的说法。
