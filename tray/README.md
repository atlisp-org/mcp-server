# @lisp MCP 托盘管理工具

Windows 通知区域（托盘）小程序，用来管理本机 `@lisp/mcp` 服务的日常运行：

- **启动 / 停止 / 重启** 本机 `atlisp-mcp` 服务（自动识别 Windows 服务模式）
- **下载 / 安装 / 升级**：通过 npm 安装或升级到 `@atlisp/mcp@latest`
- **自动安装 Node.js**：检测不到 Node.js 时，默认下载免 UAC 的 portable zip 解压到用户目录；失败才降级 MSI（需 UAC 授权）
- **检查更新**：对比本机版本与 npm 上的最新版本，默认启动后检查一次并**只提示、不自动安装**；可在设置里开启定时自动升级（默认间隔 24 小时，用户确认后才执行 npm 安装）
- **知识库全自动**：默认随托盘启动本地知识库，缺 Python / `atlisp-dwg-kb` 时自动下载安装；定时查 PyPI 新版本并静默升级（升级前停服务、完成后自动拉起）
- **异常自愈**：MCP 或知识库进程异常退出后自动拉起（带退避，最多 5 次），用户主动停止的不会被拉起
- **托盘自我更新**：从 npm 包目录启动时先迁移到用户目录（避免升级时 exe 被锁），每次升级 @lisp/mcp 后自动替换托盘自身并重启（由 exe 自身完成替换，**不生成 cmd 脚本**，见下方「杀软误报」）
- **状态监控**：显示服务端口、CAD 连接状态、版本号；异常退出时提醒
- **日志与面板**：一键打开调试面板、API 文档、Playground、服务器日志
- **开机自启**：首次启动自动加入 Windows 启动项（之后尊重手动开关）；可选托盘启动时自动启动服务
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
- **右键菜单**按用途分成四组，顶层只放状态和最常用的动作：

  ```
  @lisp MCP 服务  v1.12.0                  ← 状态（不可点）
  MCP 服务：运行中 · 端口 8110 · CAD 已连接
  图纸知识库：在线 · v0.2.2 · 550万条三元组
  ────────────────────────────
  打开 Agent Chat                          ← 主入口
  启动 MCP 服务 / 停止 MCP 服务            ← 只显示当前能做的那个
  重启 MCP 服务                            ← 运行中才显示
  ────────────────────────────
  图纸知识库 ▸
  日志与诊断 ▸
  设置 ▸
  更新与安装 ▸（有新版本时标题提示）
  ────────────────────────────
  关于 @lisp MCP…
  退出托盘
  ```

  子菜单内容：

  - **图纸知识库** ▸（未连接时标题带「未连接」）
    - 运行环境：Python 3.12.8 · 本机包 v0.2.2（状态行，不可点）
    - 版本不一致时多一行提示：`服务 v0.2.0 落后于本机 v0.2.2，自动重启服务中…`
    - 打开图纸知识库（`{地址}/ui`）
    - 启动 / 停止 / 重启本地知识库服务（不可用时置灰；托盘启动的记 PID，外部启动的按端口找 PID 并确认后再停）
    - 重新检测连接
    - 安装 / 升级知识库…（`pip install --upgrade atlisp-dwg-kb`；没有 Python 3.10+ 时**自动下载并安装**到用户目录，免管理员权限）
    - 重建索引…（服务端后台重建，管理员操作，需要与该服务一致的 API Key）
    - ☑ 随托盘自动启动（默认开启；未安装时自动补齐 Python + 包，然后拉起；仅本机地址生效）
    - ☑ 自动检查新版本（默认开启；按 `AutoUpgradeHours`（默认 24 小时）查 PyPI，发现新版本静默 `pip install --upgrade`）
    - 设置地址与 API Key…（默认 `http://127.0.0.1:8322`，可填局域网服务器地址）
  - **日志与诊断** ▸
    - 查看服务器日志 / 打开日志目录
    - 打开调试面板 / API 文档 / Playground（服务运行时可点）
    - 环境诊断…
  - **更新与安装** ▸（有新版本时标题会提示）
    - 检查更新
    - 升级到最新版（或「升级到 v1.12.2（当前 v1.12.0）」）
    - 重新安装 / 修复安装
    - 安装 Node.js v22.12.0…（默认 v22.12.0，npmmirror）
  - **设置** ▸
    - ☑ 随 Windows 启动托盘
    - ☑ 启动托盘时自动启动 MCP
    - ☑ 启动时自动补齐运行环境
    - ☐ 自动升级 @lisp/mcp（默认关闭；开启后按 `AutoUpgradeHours`（默认 24 小时）检查并升级）
    - ☐ 使用 npmmirror 国内镜像
    - 重新加载配置
    - 打开配置文件
  - **关于 @lisp MCP…**：版本、端口、项目主页
  - **退出托盘**

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
| `CheckUpdateOnStart` | `true` | 托盘启动 20 秒后自动检查更新，仅提示新版本（`AutoUpgrade=true` 时由定时检查接管） |
| `AutoUpgrade` | `false` | 定时检查 @lisp/mcp 新版本并自动升级；服务运行中会先停止再重启。默认关闭，需在托盘菜单里开启 |
| `AutoUpgradeHours` | `24` | 自动检查间隔（小时，1–168） |
| `AutoInstall` | `true` | 启动时自动补齐缺失的 Node.js / @lisp/mcp（见下方「自动补齐运行环境」） |
| `StopServerOnExit` | `false` | 退出托盘时是否停止服务 |
| `HealthyPollSeconds` | `5` | 健康检查间隔（秒） |
| `DwgKbUrl` | `http://127.0.0.1:8322` | 图纸知识库（atlisp-dwg-kb）服务地址；指向局域网服务器时改成对应 IP |
| `DwgKbApiKey` | `""` | 知识库 API Key；服务端设置了 `DWG_KB_API_KEY` 时必须一致 |
| `PythonVersion` | `3.12.8` | 自动安装 Python 时使用的版本（官方安装包） |
| `PythonMirror` | `https://registry.npmmirror.com/-/binary/python` | Python 安装包镜像；留空则用 python.org |
| `PythonPath` | `""` | 手动指定 `python.exe` 路径（留空自动检测：托盘目录 → PATH → `py` 启动器） |
| `DwgKbAutoStart` | `true` | 托盘启动时自动拉起本地知识库服务（仅本机地址；没装 Python/包且 `AutoInstall=true` 时自动安装） |
| `DwgKbAutoUpgrade` | `true` | 定时检查 PyPI 上的 `atlisp-dwg-kb` 新版本并静默升级；间隔复用 `AutoUpgradeHours` |

修改后可从托盘菜单选择 **重新加载配置**（端口等设置立即生效）。

## 自动补齐运行环境

托盘启动 3 秒后开始检查环境，缺什么装什么，默认无需人工确认：

1. **缺 Node.js** → 从 `NodeMirror` 下载 `node-v<版本>-win-<架构>.zip`，解压到 `%LOCALAPPDATA%\atlisp-mcp\node\`。zip 版不需要安装、不写注册表、不弹 UAC。解压在后台线程完成，不阻塞界面。
2. **portable 路线失败**（镜像不可达、磁盘不足等）→ 自动降级为 MSI 安装，此时会弹 **UAC**（这是唯一需要人工点「是」的环节），再失败则退到 winget。
3. **缺 @lisp/mcp** → `npm install -g @atlisp/mcp@latest`。普通用户的 npm 全局前缀是 `%APPDATA%\npm`，同样不需要管理员权限；只有确实没有写权限时才会触发 UAC 重试。检测不到 `dotnet` 时自动追加 `--ignore-scripts` 并补齐 `edge-js` 的 VC 运行时 DLL（见「安装 / 升级 @lisp/mcp」）。
4. **缺 Python / 知识库包**（`DwgKbAutoStart` 开启且 `DwgKbUrl` 是本机）→ 自动静默安装 Python 到 `%LOCALAPPDATA%\atlisp-mcp\python`，再 `pip install atlisp-dwg-kb`，完成后自动拉起知识库服务。全程不需要确认。
5. **依赖齐全** → 按 `AutoStartServer` 启动 MCP 服务，按 `DwgKbAutoStart` 启动知识库服务。

第 4 步只在 `AutoInstall=true`（默认）时执行；把知识库地址配成局域网服务器后不再在本机装包。

Node.js 探测顺序：`tray.json` 的 `NodePath` → `%ProgramFiles%\nodejs` / fnm / nvm / scoop → **portable 目录** → `PATH`。portable 排在 `PATH` 之前是为了修复「刚装完 Node.js 但 Explorer 环境没刷新」的情况；同时托盘会在调用 npm 前把 Node.js 目录补进自身 `PATH`（否则 `edge-js` 等依赖的安装脚本会报 `'node' 不是内部或外部命令`）。

失败退避：1 分钟 → 5 分钟 → 30 分钟，累计 3 次后停止自动安装并给出提示。退避状态写入 `%APPDATA%\atlisp-mcp\bootstrap.state`，避免每次开机重复下载 35 MB。环境一旦就绪（即使是你手动装的），托盘仍会自动启动服务。

菜单 **设置 → 启动时自动补齐运行环境** 可开关该行为。

## 服务自愈

两个服务都要「一直在跑」，所以意外退出会被自动拉起（用户主动停止的不算）：

| 服务 | 触发条件 | 退避 | 上限 |
|------|----------|------|------|
| MCP（`@lisp/mcp`） | 进程退出码非 0 且 `AutoStartServer=true` | 1 / 2 / 5 / 10 / 30 分钟 | 5 次 |
| 知识库（`atlisp-dwg-kb`） | 托盘启动的进程消失、端口无监听、`DwgKbAutoStart=true` | 1 / 2 / 5 / 15 分钟 | 5 次 |

菜单里点「停止服务 / 停止知识库服务」属于主动停止，不会触发自动拉起（知识库在下次托盘启动或手动启动前保持停止）。
自动拉起次数用完后只记日志，等下次托盘启动重新计数。

## 知识库（atlisp-dwg-kb）

「知识库（dwg-kb）」子菜单用于管理图纸知识库服务（默认 `http://127.0.0.1:8322`）：

- **状态行**：在线/不可达 + 版本 + 三元组数；**运行环境行**：Python 版本 + `atlisp-dwg-kb` 版本
- **安装 / 升级知识库（PyPI）…**：执行 `python -m pip install --upgrade atlisp-dwg-kb`
- **重建知识库…**：`POST /build`（服务端后台任务，管理员操作）
- **设置知识库地址…**：地址 + API Key，带「测试连接」

**没有 Python 时自动安装**（无需管理员权限）：

1. 从 `PythonMirror` 下载官方安装包 `python-<版本>-amd64.exe`（ARM64 用 `-arm64`，32 位无后缀）
2. 静默安装到 `%LOCALAPPDATA%\atlisp-mcp\python\`：
   `/quiet InstallAllUsers=0 TargetDir=... PrependPath=0 Shortcuts=0 Include_pip=1`
   —— `InstallAllUsers=0` 是**免 UAC** 的关键，`PrependPath=0` 不改系统 PATH
3. 安装完成后自动继续 `pip install atlisp-dwg-kb`，全程在任务窗口里可见

探测顺序：`tray.json` 的 `PythonPath` → `%LOCALAPPDATA%\atlisp-mcp\python\python.exe` → `PATH` 的 `python.exe`/`python3.exe` → `py -3` 启动器。**版本必须 ≥ 3.10**；Windows 应用商店的 `python.exe` 占位符会因探测失败被跳过。

装完包后本地启动服务：

```
%LOCALAPPDATA%\atlisp-mcp\python\python.exe -m atlisp_dwg_kb.cli serve --host 127.0.0.1 --port 8322 --no-browser
```

（或把知识库部署在服务器上，用「设置知识库地址」指向它。）

**启动 / 停止（菜单项，不用手敲命令）**

- **启动知识库服务**：仅在「地址是本机（localhost/127.0.0.1）+ 已安装 atlisp-dwg-kb + 端口空闲」时可用。
  绑地址规则：`DwgKbUrl` 是 loopback → 绑 `127.0.0.1`；配成局域网 IP → 绑 `0.0.0.0`（允许外部访问）。
- **停止知识库服务**：托盘启动的进程直接停止（PID 写在 `%APPDATA%\atlisp-mcp\dwgkb.pid`）；
  如果是手动/计划任务启动的实例，按端口找到 PID 并弹确认框，只对 `python` 系进程生效，
  端口被其他程序占用时拒绝操作。停止后本轮托盘生命周期内不会自动拉起。
  系统服务方式启动的实例可能没有权限停止，会提示改用服务管理器。
- **重启知识库服务**：停止后用托盘探测到的 Python 重新启动。升级了包但旧服务还在跑时，
  点它即可让新版本生效（托盘自己启动的服务也会自动做这件事）。
- **随托盘自动启动知识库**（`DwgKbAutoStart`，默认开）：托盘启动 5 秒自动拉起；
  未安装时自动补 Python + 包再拉起；端口已有服务则不重复启动。
- **知识库异常自愈**：托盘启动的服务进程意外退出后自动重新拉起（退避 1/2/5/15 分钟，最多 5 次）。
- 服务输出写在 `%APPDATA%\atlisp-mcp\logs\dwgkb-<时间>.log`；首次加载大索引需要几十秒，状态行会显示「索引加载中」。
- 托盘退出时不会停止知识库（它是服务，退出托盘后仍可被 MCP/浏览器使用）。

**自动升级（PyPI）**

`DwgKbAutoUpgrade` 默认开启，间隔与 `AutoUpgradeHours` 一致（默认 24 小时）：

1. 先用 PyPI JSON（`https://pypi.org/pypi/atlisp-dwg-kb/json`）查最新版本；
   失败时回退 `python -m pip index versions atlisp-dwg-kb`（会走你配置的 pip 镜像/代理）
2. 发现比本机新 → 若知识库由托盘启动则先停止（Windows 会锁 Python 扩展）
3. `python -m pip install --upgrade atlisp-dwg-kb`（静默执行，输出写 `logs/pip-*.log`）
   - 每次 pip 任务前会先清理 site-packages 里以 `~` 开头的无效分发包目录。pip 卸载时
     会先把包目录改名成 `~<包名>` 再删，若 `.pyd` 被运行中的知识库进程占用就会留下
     `~tlisp-dwg-kb`，之后每条 pip 命令都刷
     `WARNING: Ignoring invalid distribution ~tlisp-dwg-kb`。托盘现在自动清掉，
     不清理也不影响功能，只是告警噪音
4. 成功后自动恢复知识库服务；失败则按旧版本恢复服务，并在 5/30/180 分钟后重试
5. 只在 `DwgKbUrl` 是本机地址时生效（配了局域网服务器时本机包用不上）
6. pip 报 `Requirement already satisfied` 时不会再说「已升级」，气泡显示「知识库已是最新」

**版本号怎么读**

- 顶层状态行 `图纸知识库：在线 · 服务 v0.2.2`：**正在运行的进程**版本（`/health` 返回）
- 子菜单 `运行环境：… · 本机包 v0.2.0`：**本机 Python 环境里 pip 安装**的版本
- 两者不同时，子菜单会多一行提示：
  - 服务是托盘启动的、且本机更新 → 自动重启服务应用新版本
  - 服务是外部/远程启动的 → 只提示；本机实例可用「重启本地知识库服务」确认后接管

服务日志：`%APPDATA%\atlisp-mcp\logs\server-YYYYMMDD.log`
托盘日志：`%APPDATA%\atlisp-mcp\logs\tray.log`
npm 任务日志：`%APPDATA%\atlisp-mcp\logs\npm-*.log`
Node.js 安装日志：`%APPDATA%\atlisp-mcp\logs\node-msi-*.log`
Node.js 安装包缓存：`%LOCALAPPDATA%\atlisp-mcp\downloads\`
portable Node.js：`%LOCALAPPDATA%\atlisp-mcp\node\`
首次自动开启自启的标记：`%APPDATA%\atlisp-mcp\autostart-default.txt`（删除后下次启动会重新检查）

## 自动检测顺序

**Node.js**：配置项 → `%ProgramFiles%\nodejs\node.exe` → fnm / nvm / scoop → portable 目录（`%LOCALAPPDATA%\atlisp-mcp\node`）→ `PATH` 中的 `node.exe`。

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
- **没有 .NET SDK 的机器**：`edge-js` 的安装脚本会无条件 `spawn dotnet`（构建 CoreCLR bootstrap），没装 SDK 时报 `Error: spawn dotnet ENOENT` 让 npm 退出码 1。Windows 端走 native CLR + COM，用不到 bootstrap，所以托盘检测不到 `dotnet` 时自动给 npm 追加 `--ignore-scripts`，再调用 `EdgeNativeSupport.Repair()` 把 VC 运行时 DLL 复制到 `edge-js\lib\native\win32\<arch>\<node-abi>\`（这一步本来是安装脚本做的）。安装窗口会提示「已跳过 npm 安装脚本」，不影响使用
- **定时自动升级**（默认关闭）：开启后默认每 24 小时执行一次 `npm view @atlisp/mcp version`，发现比本机新就自动升级；升级前停止服务（Windows 会锁定 `edge-js` 原生模块），升级后按原状态重启。全程不弹窗口，失败只记托盘日志并在气泡里提示，下次再重试。可在「设置 → 定时自动检查并升级 @lisp/mcp」开启/关闭，或改 `tray.json` 的 `AutoUpgrade` / `AutoUpgradeHours`
  - 旧版本默认是「每 1 小时自动静默升级」；升级到本版后 `tray.json` 会一次性迁移为 `AutoUpgrade=false`、`AutoUpgradeHours=24`（`ConfigVersion` 记到 `1`），需要自动升级请手动重新开启
- 如果全局 npm 目录需要管理员权限，托盘会在失败后提示以管理员身份重试（会弹出 UAC）；自动升级不会弹 UAC，失败留给下一次或手动升级
- 升级前如果服务正在运行，升级完成后托盘会自动重启服务
- 手动「检查更新」只读取 `npm view @atlisp/mcp version`，不会修改任何文件

### 托盘自我更新

托盘 exe 随 `@atlisp/mcp` 一起发布（`dist/AtlispTray.exe`），所以升级包时托盘也应该跟着换新：

1. **自迁移**：如果托盘是从 npm 包目录启动的（`atlisp-tray`，路径含 `node_modules`），启动时会把自身复制到
   `%LOCALAPPDATA%\Programs\atlisp-mcp\AtlispTray.exe` 并直接启动副本（副本自己创建托盘），同时把开机自启项改到新路径。
   这样 `npm install -g` 不会再因为运行中的 exe 被 Windows 锁定（EBUSY/EPERM）而失败。
2. **自我替换**：每次升级 @lisp/mcp 成功后，托盘会比较包内 `dist\AtlispTray.exe` 与当前 exe 的 SHA256；
   不同则把新 exe 复制成同目录下的暂存副本 `.AtlispTray.update.exe`，由**副本自己**以 `--apply-update <暂存> <目标> <旧PID>`
   模式启动：等旧进程退出 → 覆盖目标 exe（最多重试 30 次）→ 启动新版，保留 `--silent` / `--start-server`。
   然后托盘退出，图标消失 1～2 秒，**服务进程不受影响**；重启后的托盘会按原状态恢复服务。
   - 这里刻意**不生成任何 `.cmd`/`.bat` 脚本**：旧版用过「写脚本 → `tasklist` 轮询父进程 → `copy /y` 覆盖 exe → `start`」，
     那是杀软启发式里最典型的自我更新形态（未签名时几乎必被 `!ml` 类规则命中）。旧版留下的
     `%APPDATA%\atlisp-mcp\update-tray.cmd` 会在新版本启动时自动删除。
3. **失败降级**：如果托盘所在目录不可写（例如手工放进 Program Files），只记录日志并提示手动重启，不弹 UAC。
   替换过程写入托盘日志 `%APPDATA%\atlisp-mcp\logs\tray.log`（关键字 `tray-selfupdate`）。
4. exe 的版本号在构建时取自 `package.json`（`npm run build:tray` / `build.ps1` 自动注入），可在「关于」和「环境诊断」里查看；
   同时 exe 的版本资源里带 `CompanyName=atlisp.cn`、`ProductName=@lisp MCP Server`、`FileDescription`、`Copyright`，
   文件属性里能看到完整的发布者信息（见「杀软误报」）。

## 杀软误报（Defender / 360 / 火绒）

托盘是**未签名**的 .NET WinForms exe，同时又具备「自复制、写启动项、下载并执行安装包、自我更新」等能力，
这在 Defender 的云端 ML 模型（报 `Trojan:Win32/Wacatac.B!ml` 一类 `!ml` 后缀）眼里和恶意软件高度重合。
已做的降噪改动：

- **版本资源补全**：exe 里有 `CompanyName=atlisp.cn`、`ProductName=@lisp MCP Server`、
  `FileDescription`、`Copyright`、`LegalTrademarks`（之前只有版本号，发布者字段是空的，是 ML 模型的强特征）。
- **不再生成任何 `.cmd`/`.bat` 脚本**：自我更新改为「新版 exe 暂存 → 副本自己覆盖目标 → 启动」，
  彻底去掉「`tasklist` 轮询父进程 + `copy /y` 覆盖 exe + `start`」这套恶意软件自我更新的经典形态。
- **默认不再自动安装新版本**：`AutoUpgrade` 默认 `false`、间隔默认 24h，只检查并提示，避免开机后
  静默联网并在后台执行 `npm install -g`（「下载并执行」形态）。
- **迁移/重启不再借道 `cmd.exe`**：自迁移只做「复制 + `Process.Start` 副本」。

仍然需要做（代码层面已无能为力）：

1. **代码签名**（唯一根治手段）。OV/EV 证书需硬件 token/HSM，签名后用同一主体持续发布才能积累发布者信誉：
   ```bat
   set ATLISP_TRAY_SIGN_THUMBPRINT=<证书指纹，无空格>
   npm run build:tray
   ```
   也可以直接调脚本：`powershell -File tray\build.ps1 -SignThumbprint <指纹> -TimestampUrl http://timestamp.digicert.com`
   （`build.ps1` 会找 Windows SDK 的 `signtool.exe`，签名 + SHA256 时间戳；证书没插好会直接报错退出）。
   Linux 交叉编译环境下没有 `signtool`，发布前在 Windows 上补签，或把签名放到 CI 的 Windows runner。
2. **提交误报**：<https://www.microsoft.com/en-us/wdsi/filesubmission>（按「软件开发者」提交，公司名与签名主体一致）。
   国内再报 360 / 火绒 / 腾讯的误报通道。**先改行为再提报**，否则换 hash 后要重提。
3. 不要把 exe 加壳/混淆/UPX；发布时附 `SHA256SUMS`。

## 故障排查

| 现象 | 处理 |
|------|------|
| 托盘图标不出现 | Windows 11 默认折叠新图标：点击任务栏 `^` 找到 “M” 图标并拖到任务栏 |
| 启动失败：未检测到 Node.js | 托盘菜单 → 下载并安装 Node.js（npmmirror）；或在 `tray.json` 中配置 `NodePath` |
| Node.js 下载失败 | 检查网络/镜像；托盘会询问是否改用 winget；也可手动从 npmmirror 下载 MSI 放入 `%LOCALAPPDATA%\atlisp-mcp\downloads\` |
| Node.js 安装失败 | 查看 `%APPDATA%\atlisp-mcp\logs\node-msi-*.log`，常见原因是取消 UAC 或系统策略禁止 MSI |
| 启动失败：未安装 @lisp MCP Server | 托盘菜单 → 下载并安装 |
| 安装失败：`'node' 不是内部或外部命令` | 托盘进程继承的 `PATH` 不含 Node.js 目录（常见于「用托盘装完 Node.js 后没重启 Explorer/注销」）。新版托盘会在执行 npm 前自动把 Node.js 目录补进 `PATH`；若仍失败请重启托盘或注销后重新登录，也可在 `tray.json` 显式配置 `NodePath` |
| 启动后一直是黄色 | 右键 → 查看服务器日志，确认端口是否被占用、CAD 是否已启动 |
| 升级提示 EPERM/EACCES | 同意以管理员身份重试，或把 Node.js 安装到用户目录 |
| 升级报 `EBUSY: ... rename ... node_modules\@atlisp\mcp` | npm 升级要把**整个包目录**改名，任何在用该目录的进程都会挡住它：MCP 客户端（Claude Desktop / VSCode / opencode 等）拉起的服务、从 npm 包目录直接跑的旧托盘、残留的 `cad-worker`。托盘自己启动的服务会在失败后自动停掉并重试一次；仍失败说明有托盘管不到的进程，关掉它们后重试，或关掉托盘后手动 `npm install -g @atlisp/mcp@latest` |
| 升级后托盘还是旧版本 | 在托盘日志 `%APPDATA%\atlisp-mcp\logs\tray.log` 里搜 `tray-selfupdate`；若提示“不在受管目录”，手动关闭托盘后重新运行 `%LOCALAPPDATA%\Programs\atlisp-mcp\AtlispTray.exe` |
| 托盘没有随 Windows 启动 | 右键勾选“随 Windows 启动托盘”，检查 `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` 下的 `atlisp-mcp-tray` |
| 首次运行被 SmartScreen 拦截 / 被杀软报毒 | exe 未做代码签名（见「杀软误报」）。临时处理：点“更多信息 → 仍要运行”，或把安装目录加入排除项；根治靠代码签名 + 提交误报 |

## 代码结构

`AtlispTray.cs` 单文件包含：

- `Program` / `TrayApplication`：托盘生命周期、右键菜单、状态轮询
- `ServerManager`：启动/停止/重启、pid/lock 文件解析、Windows 服务识别
- `HealthMonitor` / `HealthClient`：后台线程轮询 `/health`，避免阻塞 UI
- `ServerLocator`：Node/npm/@lisp mcp 路径与版本探测
- `PythonLocator` / `PythonRunner`：Python ≥3.10 探测、官方安装包静默安装、pip 安装
- `DwgKbServer` / `DwgKbClient` / `DwgKbSettingsForm`：知识库本地服务启停（PID 记录）、状态探活、`/build` 提交、地址与 API Key 设置
- `ZipInstaller` / `PortableInstallJob`：portable Node.js zip 的剥根解压（后台线程）
- `NpmRunner` / `LongTask`：npm 安装、升级、检查更新的异步执行与日志
- `TraySelfUpdate`：托盘自迁移（npm 包目录 → 用户目录）与升级后的自我替换/重启
- `DownloadJob`：npmmirror 下载、进度与文件大小校验
- `IconFactory`：从 exe 提取品牌图标，叠加状态圆点（失败时回退到内置绘制图标）
- `OutputForm`：任务输出与环境诊断窗口
- `AutostartHelper`：`HKCU\...\Run` 托盘自启

构建/发布相关：`scripts/build-tray.mjs`（跨平台构建）、`tray/build.ps1`（Windows csc）、`tray/atlisp-tray.js`（npm 全局命令）。
