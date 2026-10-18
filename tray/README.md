# @lisp MCP 托盘管理工具

Windows 通知区域（托盘）小程序，用来管理本机 `@lisp/mcp` 服务的日常运行：

- **启动 / 停止 / 重启** 本机 `atlisp-mcp` 服务（自动识别 Windows 服务模式）
- **下载 / 安装 / 升级**：通过 npm 安装或升级到 `@atlisp/mcp@latest`
- **自动安装 Node.js**：检测不到 Node.js 时，从 npmmirror 下载官方 MSI 并静默安装（需 UAC 授权）
- **检查更新**：对比本机版本与 npm 上的最新版本，发现新版本时气泡提醒
- **状态监控**：显示服务端口、CAD 连接状态、版本号；异常退出时提醒
- **日志与面板**：一键打开调试面板、API 文档、Playground、服务器日志
- **开机自启**：托盘随 Windows 启动；可选托盘启动时自动启动服务
- **环境诊断**：Node/npm 路径、安装位置、服务状态、健康检查一屏查看
- **npm 镜像**：一键切换 npmmirror（国内网络）

## 构建

托盘程序是单文件 WinForms 程序（`AtlispTray.cs`）：

- **Windows**：使用系统自带的 .NET Framework 4.x `csc.exe`，无需额外安装
- **Linux / macOS**：使用 `dotnet` 自带的 Roslyn csc + .NET Framework 4.8 参考程序集交叉编译；首次构建会下载约 21 MB 参考程序集，缓存到 `tray/.cache/`

```bash
# 跨平台构建到 dist/AtlispTray.exe
npm run build:tray
```

Windows 也可以直接使用 PowerShell 脚本：

```powershell
# 构建到 dist\AtlispTray.exe
powershell -ExecutionPolicy Bypass -File tray\build.ps1

# 构建 + 安装到 %LOCALAPPDATA%\Programs\atlisp-mcp + 创建开始菜单快捷方式
powershell -ExecutionPolicy Bypass -File tray\build.ps1 -Install
```

产物 `dist/AtlispTray.exe` 会随 `npm pack` / `npm publish` 一起发布。全局安装后可直接运行：

```bash
atlisp-tray
```

源码是 UTF-8（带 BOM），构建脚本使用 `/codepage:65001`，避免中文系统下 csc 按 ANSI 解码源码。

> 也可以直接把 `tray/AtlispTray.cs` 拖到任何 C# 4.x 编译环境；但请保持 **C# 5 语法**，因为系统自带的 csc 不支持 C# 6+。

## 发布到 npm

`package.json` 的 `prepack` 会执行 `npm run build && npm run build:tray`，因此：

```bash
npm publish
```

会自动把以下文件打进 `@atlisp/mcp`：

- `dist/atlisp-mcp.js` 等主程序
- `dist/AtlispTray.exe`
- `tray/atlisp-tray.js`（注册为 `atlisp-tray` 命令）
- `tray/README.md`

发布前可以用以下命令检查包内容：

```bash
npm pack --dry-run
```

非 Windows 发布机需要安装 .NET SDK（并具备 `unzip` 或 `python3`）用于交叉编译；也可以在 Windows 上发布。`tray/.cache/` 已被 `.gitignore` 忽略。

## 使用

运行 `AtlispTray.exe` 后，通知区域出现 @lisp 品牌图标（右下角的小圆点表示服务状态）：

- **双击图标**：打开 `https://atlisp.cn/agent/chat`
- **右键菜单**（二级菜单）：
  - 启动服务 / 停止服务 / 重启服务
  - **打开网页** ▸
    - Agent Chat（atlisp.cn）
    - 调试面板
    - API 文档
    - Playground
  - **日志与诊断** ▸
    - 查看服务器日志
    - 打开日志目录
    - 环境诊断…
  - **更新与安装** ▸（有新版本时标题会提示）
    - 检查更新
    - 升级到最新版
    - 重新安装 / 修复安装
    - 下载并安装 Node.js（默认 v22.12.0，npmmirror）
  - **设置** ▸
    - 随 Windows 启动托盘
    - 托盘启动时自动启动服务
    - 使用 npmmirror 镜像下载
    - 重新加载配置
    - 打开配置文件
    - 关于
  - 退出托盘

右下角状态圆点颜色：

| 颜色 | 含义 |
|------|------|
| 绿色 | 服务运行中（`/health` 正常） |
| 黄色 | 启动中 / 等待健康检查响应 |
| 灰色 | 服务已停止 |
| 红色 | 进程异常退出 |

品牌图标来源：<https://atlisp.cn/assets/images/brand/icon.png>（源文件 `tray/atlisp-brand.png`，已转换为多尺寸 `tray/atlisp.ico` 并嵌入 exe，运行时无需联网）。

## 配置

配置文件：`%APPDATA%\atlisp-mcp\tray.json`（首次修改设置时自动创建）。

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `Port` | `8110` | 服务端口 |
| `NodePath` | `""` | 手动指定 `node.exe` 路径（留空自动检测） |
| `NpmPath` | `""` | 手动指定 `npm.cmd` 路径（留空自动检测） |
| `ServerScript` | `""` | 手动指定 `atlisp-mcp.js` 路径（留空自动检测） |
| `ConfigFile` | `""` | 传给服务的 `--config` 路径（留空使用默认配置） |
| `NpmRegistry` | `""` | npm 源；设为 `https://registry.npmmirror.com` 使用国内镜像 |
| `NodeVersion` | `22.12.0` | 从 npmmirror 安装的 Node.js 版本（自动带 `v` 前缀） |
| `NodeMirror` | `https://npmmirror.com/mirrors/node` | Node.js 安装包镜像地址 |
| `AutoStartServer` | `true` | 托盘启动时自动启动服务 |
| `CheckUpdateOnStart` | `true` | 托盘启动 20 秒后自动检查更新 |
| `StopServerOnExit` | `false` | 退出托盘时是否停止服务 |
| `HealthyPollSeconds` | `5` | 健康检查间隔（秒） |

修改后可从托盘菜单选择 **重新加载配置**（端口等设置立即生效）。

服务日志：`%APPDATA%\atlisp-mcp\logs\server-YYYYMMDD.log`
托盘日志：`%APPDATA%\atlisp-mcp\logs\tray.log`
npm 任务日志：`%APPDATA%\atlisp-mcp\logs\npm-*.log`
Node.js 安装日志：`%APPDATA%\atlisp-mcp\logs\node-msi-*.log`
Node.js 安装包缓存：`%LOCALAPPDATA%\atlisp-mcp\downloads\`

## 自动检测顺序

**Node.js**：配置项 → `%ProgramFiles%\nodejs\node.exe` → fnm / nvm / scoop → `PATH` 中的 `node.exe`。

**@lisp/mcp**：

1. 配置项 `ServerScript` 或环境变量 `ATLISP_MCP_SCRIPT`
2. 托盘 exe 同目录 / 上级目录的 `dist/atlisp-mcp.js`、`src/atlisp-mcp.js`（方便开发）
3. npm 全局目录下的 `@atlisp/mcp/dist/atlisp-mcp.js`（通过 `npm root -g` 获取）

## 与 Windows 服务模式的关系

如果已经用 `service.ps1 install` 安装了名为 `atlisp-mcp` 的 Windows 服务，托盘会优先使用服务：

- 菜单里的启动/停止操作改为 `sc start` / `sc stop`
- 不会额外启动一个 node 进程
- 服务操作通常需要管理员权限；权限不足时托盘会给出错误提示

如果使用普通进程模式，托盘启动的 node 进程**不会随托盘退出而结束**（默认 `StopServerOnExit=false`），退出托盘后服务仍在后台运行。

## 与 `atlisp-mcp --install-autostart` 的区别

| 方式 | 登录后启动 | 管理方式 |
|------|-----------|----------|
| `atlisp-mcp --install-autostart` | 直接启动服务（无界面） | 命令行 |
| 托盘“随 Windows 启动” | 启动托盘，由托盘拉起服务 | 托盘菜单 |

两种方式可以同时使用；如果同时启用，托盘会通过 `/health` 发现服务已在运行，不会重复启动。

## 下载 / 升级说明

### 安装 Node.js

检测不到 Node.js 时（或从菜单选择“下载并安装 Node.js”），托盘会：

1. 自动识别架构（`x64` / `arm64` / `x86`）
2. 从 `NodeMirror` 下载对应版本，例如：
   `https://npmmirror.com/mirrors/node/v22.12.0/node-v22.12.0-x64.msi`
3. 校验下载文件大小
4. 通过 UAC 提权，执行静默安装：
   `msiexec /i node-v22.12.0-x64.msi /qn /norestart /l*v <log>`
5. 安装完成后重新探测 Node.js，并继续提示安装 `@lisp/mcp`

如果下载失败，托盘会询问是否改用 winget 安装；如果 `msiexec` 失败，会显示退出码和安装日志路径。

> MSI 安装包会缓存在 `%LOCALAPPDATA%\atlisp-mcp\downloads\`，可手动重新运行。  
> 默认版本 `22.12.0`；改 `tray.json` 的 `NodeVersion` 可指定其他版本（需确认镜像中存在对应文件）。

### 安装 / 升级 @lisp/mcp

- 安装与升级都通过 npm 完成：`npm install -g @atlisp/mcp@latest`
- 如果全局 npm 目录需要管理员权限，托盘会在失败后提示以管理员身份重试（会弹出 UAC）
- 升级前如果服务正在运行，升级完成后托盘会自动重启服务
- “检查更新”只读取 `npm view @atlisp/mcp version`，不会修改任何文件

## 故障排查

| 现象 | 处理 |
|------|------|
| 托盘图标不出现 | Windows 11 默认折叠新图标：点击任务栏 `^` 找到 “M” 图标并拖到任务栏 |
| 启动失败：未检测到 Node.js | 托盘菜单 → 下载并安装 Node.js（npmmirror）；或在 `tray.json` 中配置 `NodePath` |
| Node.js 下载失败 | 检查网络/镜像；托盘会询问是否改用 winget；也可手动从 npmmirror 下载 MSI 放入 `%LOCALAPPDATA%\atlisp-mcp\downloads\` |
| Node.js 安装失败 | 查看 `%APPDATA%\atlisp-mcp\logs\node-msi-*.log`，常见原因是取消 UAC 或系统策略禁止 MSI |
| 启动失败：未安装 @lisp MCP Server | 托盘菜单 → 下载并安装 |
| 启动后一直是黄色 | 右键 → 查看服务器日志，确认端口是否被占用、CAD 是否已启动 |
| 升级提示 EPERM/EACCES | 同意以管理员身份重试，或把 Node.js 安装到用户目录 |
| 托盘没有随 Windows 启动 | 右键勾选“随 Windows 启动托盘”，检查 `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` 下的 `atlisp-mcp-tray` |
| 首次运行被 SmartScreen 拦截 | exe 未做代码签名，点击“更多信息 → 仍要运行”；建议从本仓库自行构建 |

## 代码结构

`AtlispTray.cs` 单文件包含：

- `Program` / `TrayApplication`：托盘生命周期、右键菜单、状态轮询
- `ServerManager`：启动/停止/重启、pid/lock 文件解析、Windows 服务识别
- `HealthMonitor` / `HealthClient`：后台线程轮询 `/health`，避免阻塞 UI
- `ServerLocator`：Node/npm/@lisp mcp 路径与版本探测
- `NpmRunner` / `LongTask`：npm 安装、升级、检查更新的异步执行与日志
- `DownloadJob`：npmmirror 下载、进度与文件大小校验
- `IconFactory`：从 exe 提取品牌图标，叠加状态圆点（失败时回退到内置绘制图标）
- `OutputForm`：任务输出与环境诊断窗口
- `AutostartHelper`：`HKCU\...\Run` 托盘自启

构建/发布相关：`scripts/build-tray.mjs`（跨平台构建）、`tray/build.ps1`（Windows csc）、`tray/atlisp-tray.js`（npm 全局命令）。
