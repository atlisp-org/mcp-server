# 误报申诉材料 — AtlispTray.exe（v1.12.24）

> 用途：重建托盘后按哈希重新提交杀软误报白名单。背景与策略见
> `tray/false-positive-submission.md`。
> 旧基线 `ce67af91…` 对应的申诉已随上一版提交；本文件是**新哈希**（`46ea8dd5…`）的作业单。

- 提交日期：**2026-11-04**
- 对应 npm 版本：**@atlisp/mcp@1.12.24**（tag `v1.12.24`）
- 代码提交：`115512d`（行为改动）/ `e34aa31`（release）

## 一、被申诉文件的事实（照抄填表）

| 字段 | 值 |
|---|---|
| 文件名 | `AtlispTray.exe` |
| SHA256 | `46ea8dd51614c9d32464cd1f536b6e3b0e7c014bc816604cf6724ce29c7d084f` |
| 大小 | 179712 字节（175.5 KB） |
| 文件版本资源 | `1.0.0.0`（固定，不随产品版本变化） |
| 产品版本 | `1.12.24`（写在包内 `dist/AtlispTray.version` 与 `tray-manifest.json`） |
| 下载地址（主源） | <https://atlisp.cn/download/AtlispTray.exe> |
| 备用下载 | <https://github.com/atlisp-org/mcp-server/releases/tag/v1.12.24> |
| 校验文件 | <https://atlisp.cn/download/SHASUMS256.txt> |
| 签名状态 | **未做 Authenticode 签名**（正在申请证书） |
| 构建方式 | 公开源码 + .NET Framework 4.x `csc`（Roslyn 交叉编译），`-deterministic` + `-pathmap`；同源码同编译器 ⇒ 字节一致 |
| 是否加壳/混淆 | 否（无 UPX、无混淆、无自解压） |

版本资源（用资源管理器 → 属性 → 详细信息可核对）：

| 键 | 值 |
|---|---|
| CompanyName | `atlisp.cn` |
| ProductName | `@lisp MCP Server` |
| FileDescription | `AtlispTray` |
| FileVersion / ProductVersion | `1.0.0.0` |
| LegalCopyright | `Copyright (c) 2026 atlisp.cn` |
| OriginalFilename | `AtlispTray.exe` |

## 二、这一版改了什么（本次重建的唯一原因）

只改了 **npm 源策略**，**没有新增任何下载 / 执行 / 自替换 / 写启动项行为**：

- `@atlisp/mcp` 的检查更新、安装、升级、重新安装一律使用官方源
  `https://registry.atlisp.cn`（此前可被用户切换到 npmmirror，而镜像版本落后，
  会把已装的新版本降级）。
- npmmirror 只保留为「检查更新时官方源失败」的**只读**兜底，不参与装包。

行为面没有变化：托盘仍不自己下载文件、不自我替换、不写 `.cmd/.bat`；
仍是「启动/停止本机 127.0.0.1:8110 上的 Node.js MCP 服务 + 显示状态」。

## 三、微软 WDSI（Defender）

入口：<https://www.microsoft.com/en-us/wdsi/filesubmission>
类型选 **Software developer**（不是 Home customer）。

| 字段 | 填写内容 |
|---|---|
| Product name | `@lisp MCP Server (AtlispTray)` |
| Company name | `atlisp.cn` |
| File | 上传 `AtlispTray.exe`（或填 SHA256 + 下载 URL） |
| Detection name | `<填写 Defender「保护历史记录」里的检测名，如 Trojan:Win32/Wacatac.B!ml>` |
| Download URL | `https://atlisp.cn/download/AtlispTray.exe` |

说明正文（English, paste as-is):

```text
File: AtlispTray.exe
SHA256: 46ea8dd51614c9d32464cd1f536b6e3b0e7c014bc816604cf6724ce29c7d084f
Size: 179712 bytes, version resource 1.0.0.0 (product version 1.12.24)
Download: https://atlisp.cn/download/AtlispTray.exe

AtlispTray.exe is the optional system-tray GUI of the open-source @lisp MCP server
(https://atlisp.cn, source: https://github.com/atlisp-org/mcp-server, ISC license).
It is a plain .NET Framework 4.x WinForms utility that starts/stops a local Node.js
MCP service bound to 127.0.0.1:8110 and shows its status. It does not obfuscate, pack
or hide anything, does not self-update, does not replace itself, and does not write
any .cmd/.bat scripts. The only autostart entry is written with explicit user consent
to HKCU\Software\Microsoft\Windows\CurrentVersion\Run and can be removed from the same
menu. It launches the user's own node.exe when the user starts the service.

The binary is built deterministically from the public source above
(-deterministic + -pathmap), so the hash can be reproduced. The detected file is
byte-identical to the one we distribute; SHA256SUMS is published at
https://atlisp.cn/download/SHASUMS256.txt

This build (1.12.24) only changes which npm registry is used for updating our own
CLI package; no new file downloads, process spawns or persistence were added.

Please review and whitelist this hash, or tell us which behaviour triggers the
machine-learning verdict so we can remove it. We are in the process of obtaining a
code-signing certificate.
```

## 四、国内厂商

| 厂商 | 入口 | 备注 |
|---|---|---|
| 360 | <https://open.360.cn/report.html>（误报申诉） | 选「文件误报」，附 SHA256 与下载地址 |
| 火绒 | 服务 → 误报反馈（`support@huorong.cn`） | 附文件 + 检测名 + 复现步骤 |
| 腾讯电脑管家 | <https://guanjia.qq.com/online_server/feedback.html> | 选「误报申诉」 |

中文正文（三家通用）：

```text
文件：AtlispTray.exe（179712 字节，文件版本 1.0.0.0，产品版本 1.12.24）
SHA256：46ea8dd51614c9d32464cd1f536b6e3b0e7c014bc816604cf6724ce29c7d084f
下载：https://atlisp.cn/download/AtlispTray.exe
校验：https://atlisp.cn/download/SHASUMS256.txt
产品：@lisp MCP Server 托盘（开源，ISC 协议，https://github.com/atlisp-org/mcp-server）
检测名：<填厂商给出的检测名>
说明：.NET Framework 4.x 托盘程序，用于启动/停止本机 127.0.0.1:8110 的 Node.js MCP 服务并显示状态。
无加壳、无混淆、不自替换、不写 .cmd/.bat 脚本；需要拉起服务时调用用户自己安装的 node.exe。
开机自启仅在用户于菜单中勾选后写入 HKCU\Software\Microsoft\Windows\CurrentVersion\Run，可随时取消。
本次 1.12.24 仅调整 npm 源地址（改为固定官方源），未新增下载/执行/持久化行为。
二进制由公开源码确定性构建（-deterministic + -pathmap），哈希可复现。
请复核并加入白名单；如需我们调整触发特征，请告知具体行为。
```

## 五、提交前自检（已完成）

- [x] SHA256 = `46ea8dd51614c9d32464cd1f536b6e3b0e7c014bc816604cf6724ce29c7d084f`
      （= `tray/exe-baseline.json`，= 服务端 `download/AtlispTray.exe` 回读值）
- [x] 无加壳 / 混淆 / UPX
- [x] 版本资源完整（CompanyName / ProductName / FileDescription / Copyright 见上表）
- [x] 本版未新增「下载并执行 / 写启动项 / 自我替换」行为（只改 npm 源地址）
- [x] `npm test`：1704 passed / 17 skipped
- [x] 服务端一致性：`atlisp.cn/download/AtlispTray.exe` 与 `stable/bin/AtlispTray.exe`
      均为同一哈希；`stable/bin/AtlispTray.exe.base64` 已重生成

## 六、提交跟踪

| 日期 | 通道 | 提交内容 | 状态 | 结果/备注 |
|---|---|---|---|---|
| 2026-11-04 | 微软 WDSI | 文件 + SHA256 | 待提交 | |
| 2026-11-04 | 360 | 文件 + SHA256 | 待提交 | |
| 2026-11-04 | 火绒 | 邮件 + 文件 | 待提交 | |
| 2026-11-04 | 腾讯管家 | 文件 + SHA256 | 待提交 | |

## 七、白名单通过后要做的三件事

1. 把确认结果写进 `tray/exe-baseline.json`：把 `note` 改成
   「已提交误报白名单（YYYY-MM-DD）」，哈希/版本/大小保持不变。
2. 在 `tray/README.md` 的「杀软误报」一节补一行：日期 + 版本 + 结论。
3. 若期间又重建过 exe：哈希变了就要**重新走一遍本文件**（白名单按文件哈希生效）。
