# @lisp MCP 托盘管理工具

Windows 通知区域（托盘）小程序，用来管理本机 `@lisp/mcp` 服务的日常运行：

- **启动 / 停止 / 重启** 本机 `atlisp-mcp` 服务（自动识别 Windows 服务模式）
- **状态监控**：服务端口、CAD 连接状态、版本号；异常退出时提醒
- **检查更新**：只读取 npm registry 的版本号并与本机比较，**不下载、不安装**
- **日志与面板**：一键打开调试面板、API 文档、Playground、服务器日志
- **开机自启**：首次启动**询问**是否加入 Windows 启动项（默认按钮在「否」，之后可在右键菜单随时开关）
- **环境诊断**：Node/npm 路径、安装位置、服务状态、健康检查一屏查看
- **图纸知识库**：启停本机 `atlisp-dwg-kb`、探活、重建索引（安装/升级由用户手动执行）
- **异常自愈**：MCP 或知识库进程异常退出后自动拉起（带退避，最多 5 次），用户主动停止的不会被拉起

> **托盘不负责安装。** Node.js、`@lisp/mcp`、Python、`atlisp-dwg-kb` 都由用户自行安装；
> 缺少时菜单只显示对应命令。这样 exe 里没有「下载文件 + 执行安装包」的能力，
> 既是权限边界，也显著降低被杀软 ML 判为恶意软件的概率（见「杀软误报」）。

## 构建

托盘程序是单文件 WinForms 程序（`AtlispTray.cs`）：

- **Windows**：使用系统自带的 .NET Framework 4.x `csc.exe`，无需额外安装
- **Linux / macOS**：使用 `dotnet` 自带的 Roslyn csc + .NET Framework 4.8 参考程序集交叉编译；首次构建会下载约 21 MB 参考程序集，缓存到 `.cache/`

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

源码是 UTF-8，构建脚本使用 `/codepage:65001`，避免中文系统下 csc 按 ANSI 解码源码。

> 也可以直接把 `tray/AtlispTray.cs` 拖到任何 C# 4.x 编译环境；但请保持 **C# 5 语法**，因为系统自带的 csc 不支持 C# 6+。

## 发布与分发

`prepack` 会执行 `npm run build && npm run build:tray`，因此 `npm publish` 会自动生成
`dist/tray-manifest.json` 并打进包里：

- `dist/atlisp-mcp.js` 等主程序
- `dist/tray-manifest.json`（托盘二进制的下载地址与 SHA256）
- `tray/atlisp-tray.js`（注册为 `atlisp-tray` 命令）
- `tray/tray-download.js`
- `tray/README.md`

**不再包含** `dist/AtlispTray.exe`（`package.json` 的 `files` 里有 `!dist/*.exe`）：
未签名 PE 在 `npm install` 阶段就会被 Defender 扫描，容易触发
`Trojan:Win32/Wacatac.!ml`。exe 改为打 tag 后上传，首次运行 `atlisp-tray`
时按 manifest 的 SHA256 校验后下载到 `%LOCALAPPDATA%\Programs\atlisp-mcp`：

1. **atlisp.cn**（主源，国内）：`https://atlisp.cn/download/<文件名>`（客户端带 `?v=<版本>` 防缓存），
   由 `scripts/upload-tray.mjs` 调用 atlisp.cn 的 `/upload` 上传到 `public_html/download/`
2. **GitHub Releases**（兜底）：`.../releases/download/v<版本>/`

两个源按顺序尝试，任一可用即可；SHA256 必须与 manifest 一致，否则拒绝执行。

> `atlisp.cn/download/` 是**扁平目录**（同名文件按版本覆盖），所以客户端下载时会带
> `?v=<版本>` 防缓存。发布时上传 `AtlispTray.exe` 即可；文件缺失或 hash 不符会自动回退到 GitHub
> （GitHub 也没有 Release 时直接失败）。

```bash
atlisp-tray --check            # 打印路径/版本/所有下载源
atlisp-tray --force-download   # 强制重新下载
ATLISP_TRAY_BASE_URL=https://your-mirror/tray/v{version} atlisp-tray   # 只用指定源
```

发布前可以用 `npm pack --dry-run` 检查包内容。

非 Windows 发布机需要安装 .NET SDK（并具备 `unzip` 或 `python3`）用于交叉编译；也可以在 Windows 上发布。

## 使用

运行 `AtlispTray.exe` 后，通知区域出现 @lisp 品牌图标（右下角的小圆点表示服务状态）：

- **双击图标**：打开 `https://atlisp.cn/agent/chat`
- **右键菜单**按用途分组，顶层只放状态和最常用的动作：

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
    - 如何安装 / 升级知识库…（显示 `pip install` 命令，**托盘不代执行**）
    - 重建索引…（服务端后台重建，管理员操作，需要与该服务一致的 API Key）
    - ☑ 随托盘自动启动（默认开启；仅本机地址生效，已装包时拉起）
    - 设置地址与 API Key…（默认 `http://127.0.0.1:8322`，可填局域网服务器地址）
  - **日志与诊断** ▸
    - 查看服务器日志 / 打开日志目录
    - 打开调试面板 / API 文档 / Playground（服务运行时可点）
    - 环境诊断…
  - **更新与安装** ▸（有新版本时标题会提示）
    - 检查更新（只读 npm registry，不修改文件）
    - 如何升级…（显示 `npm install -g @atlisp/mcp@latest`）
    - 如何安装 @lisp MCP Server…
    - 如何安装 Node.js…
  - **设置** ▸
    - ☑ 随 Windows 启动托盘
    - ☑ 启动托盘时自动启动 MCP
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
| `NpmPath` | `""` | 手动指定 `npm.cmd` 路径（仅用于诊断显示，留空自动检测） |
| `ServerScript` | `""` | 手动指定 `atlisp-mcp.js` 路径（留空自动检测） |
| `ConfigFile` | `""` | 传给服务的 `--config` 路径（留空使用默认配置） |
| `AutoStartServer` | `true` | 托盘启动时自动启动服务 |
| `CheckUpdateOnStart` | `true` | 托盘启动 20 秒后自动检查更新，仅提示新版本 |
| `StopServerOnExit` | `false` | 退出托盘时是否停止服务 |
| `HealthyPollSeconds` | `5` | 健康检查间隔（秒） |
| `DwgKbUrl` | `http://127.0.0.1:8322` | 图纸知识库（atlisp-dwg-kb）服务地址；指向局域网服务器时改成对应 IP |
| `DwgKbApiKey` | `""` | 知识库 API Key；服务端设置了 `DWG_KB_API_KEY` 时必须一致 |
| `PythonPath` | `""` | 手动指定 `python.exe` 路径（留空自动检测） |
| `DwgKbAutoStart` | `true` | 托盘启动时自动拉起本地知识库服务（仅本机地址且已安装包） |

修改后可从托盘菜单选择 **重新加载配置**（端口等设置立即生效）。
旧版 `tray.json` 里已经失效的字段（`AutoInstall`、`AutoUpgrade`、`NodeMirror` 等）会被忽略。

## 运行环境（自行安装）

托盘只检测、不安装。缺什么时对应菜单项会显示安装命令：

| 依赖 | 检测不到时 | 建议安装方式 |
|------|-----------|--------------|
| Node.js | 启动服务时提示，菜单「如何安装 Node.js…」 | `winget install OpenJS.NodeJS.LTS` 或 <https://nodejs.org/zh-cn/download> |
| `@lisp/mcp` | 启动服务时提示，菜单「如何安装 @lisp MCP Server…」 | `npm install -g @atlisp/mcp@latest`（无 .NET SDK 时加 `--ignore-scripts`） |
| Python 3.10+ | 知识库菜单提示 | `winget install Python.Python.3.12` 或 <https://www.python.org/downloads/> |
| `atlisp-dwg-kb` | 知识库菜单提示 | `python -m pip install --upgrade atlisp-dwg-kb` |

Node.js 探测顺序：`tray.json` 的 `NodePath` → `%ProgramFiles%\nodejs` / fnm / volta / scoop / nvm
→ 旧版托盘留下的 portable 目录（`%LOCALAPPDATA%\atlisp-mcp\node`）→ `PATH`。

`@lisp/mcp` 探测顺序：

1. 配置项 `ServerScript` 或环境变量 `ATLISP_MCP_SCRIPT`
2. 托盘 exe 同目录 / 上级目录的 `dist/atlisp-mcp.js`、`src/atlisp-mcp.js`（方便开发）
3. 用户级 npm 全局目录：`%APPDATA%\npm\node_modules\@atlisp\mcp\dist\atlisp-mcp.js`
   （不会执行 `npm root -g`，只查标准路径）

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
- **如何安装 / 升级知识库…**：显示 `python -m pip install --upgrade atlisp-dwg-kb`（托盘不代执行）
- **重建知识库…**：`POST /build`（服务端后台任务，管理员操作）
- **设置知识库地址…**：地址 + API Key，带「测试连接」

探测顺序：`tray.json` 的 `PythonPath` → 旧版托盘目录
`%LOCALAPPDATA%\atlisp-mcp\python\python.exe` → `PATH` 的 `python.exe`/`python3.exe` → `py -3` 启动器。
**版本必须 ≥ 3.10**；Windows 应用商店的 `python.exe` 占位符会因探测失败被跳过。

装好包后，点菜单「启动本地知识库服务」即可，等价的命令行是：

```
python -m atlisp_dwg_kb.cli serve --host 127.0.0.1 --port 8322 --no-browser
```

（或把知识库部署在服务器上，用「设置知识库地址」指向它。）

**启动 / 停止**

- **启动知识库服务**：仅在「地址是本机（localhost/127.0.0.1）+ 已安装 atlisp-dwg-kb + 端口空闲」时可用。
  绑地址规则：`DwgKbUrl` 是 loopback → 绑 `127.0.0.1`；配成局域网 IP → 绑 `0.0.0.0`（允许外部访问）。
- **停止知识库服务**：托盘启动的进程直接停止（PID 写在 `%APPDATA%\atlisp-mcp\dwgkb.pid`）；
  如果是手动/计划任务启动的实例，按端口找到 PID 并弹确认框，只对 `python` 系进程生效，
  端口被其他程序占用时拒绝操作。停止后本轮托盘生命周期内不会自动拉起。
  系统服务方式启动的实例可能没有权限停止，会提示改用服务管理器。
- **重启知识库服务**：停止后用托盘探测到的 Python 重新启动。手动升级包后，
  点它即可让新版本生效（托盘自己启动的服务在检测到版本落后时也会自动重启一次）。
- **随托盘自动启动知识库**（`DwgKbAutoStart`，默认开）：托盘启动 5 秒自动拉起；
  端口已有服务则不重复启动。未安装包时跳过并记日志，装好后重启托盘即可。
- **知识库异常自愈**：托盘启动的服务进程意外退出后自动重新拉起（退避 1/2/5/15 分钟，最多 5 次）。
- 服务输出写在 `%APPDATA%\atlisp-mcp\logs\dwgkb-<时间>.log`；首次加载大索引需要几十秒，状态行会显示「索引加载中」。
- 托盘退出时不会停止知识库（它是服务，退出托盘后仍可被 MCP/浏览器使用）。

**版本号怎么读**

- 顶层状态行 `图纸知识库：在线 · 服务 v0.2.2`：**正在运行的进程**版本（`/health` 返回）
- 子菜单 `运行环境：… · 本机包 v0.2.0`：**本机 Python 环境里 pip 安装**的版本
- 两者不同时，子菜单会多一行提示：
  - 服务是托盘启动的、且本机更新 → 自动重启服务应用新版本
  - 服务是外部/远程启动的 → 只提示；本机实例可用「重启本地知识库服务」确认后接管

服务日志：`%APPDATA%\atlisp-mcp\logs\server-YYYYMMDD.log`
托盘日志：`%APPDATA%\atlisp-mcp\logs\tray.log`
首次自动开启自启的标记：`%APPDATA%\atlisp-mcp\autostart-default.txt`（删除后下次启动会重新检查）

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

## 升级说明

### @lisp/mcp

托盘**不执行** npm 安装。升级流程：

```bat
npm install -g @atlisp/mcp@latest
```

- 没有 .NET SDK 的机器：`edge-js` 的安装脚本会无条件 `spawn dotnet`，没装 SDK 时报
  `Error: spawn dotnet ENOENT` 让 npm 退出码 1。Windows 端走 native CLR + COM，用不到 bootstrap，
  所以可加 `--ignore-scripts` 跳过安装脚本，再把 VC 运行时 DLL 复制到
  `edge-js\lib\native\win32\<arch>\<node-abi>\`（这一步本来是安装脚本做的）。
- 升级前先停止托盘拉起的服务（Windows 会锁定 `edge-js` 原生模块），升级后重启托盘或点「启动 MCP 服务」。
- 升级 npm 包时若报 `EBUSY ... rename ... node_modules\@atlisp\mcp`，说明有进程还在使用该目录
  （MCP 客户端拉起的服务、残留的 `cad-worker` 等）。关掉占用程序后重试即可；
  托盘不再自动结束进程。

### 托盘自身

托盘 exe 由 `atlisp-tray` 下载安装到 `%LOCALAPPDATA%\Programs\atlisp-mcp\AtlispTray.exe`。
升级 `@lisp/mcp` 后，退出托盘并重新运行 `atlisp-tray` 即可获得新版（按 manifest 校验 SHA256）。
托盘自身不下载、不替换任何文件。

**版本号怎么读**：exe 的版本资源固定 `1.0.0.0`（为了让 hash 跨版本稳定），真实版本来自
`AtlispTray.version`（`atlisp-tray` 安装/更新时写入），没有 sidecar 时读 npm 包里的 `package.json`，
托盘「关于」里显示的是这个。

## 杀软误报（Defender / 360 / 火绒）

托盘是**未签名**的 .NET WinForms exe。早期版本同时具备「写启动项、下载并执行安装包、
枚举进程、调用 netstat」等能力，在 Defender 的云端 ML 模型（报 `Trojan:Win32/Wacatac.!ml`
一类 `!ml` 后缀）眼里和恶意软件高度重合。现在的能力边界已收窄到「管理一个本机进程」：

- **不具备下载 / 安装 / 解压能力**：没有 `WebClient`、没有 `HttpWebRequest` 写文件、
  没有 `ZipFile`/`ExtractToDirectory`、没有 `msiexec`/`winget`/`npm install`/`pip install` 调用。
  检查更新只对 npm registry 做一次 HTTPS GET 并读版本号。
- **不再有 WMI**：删除了 `System.Management` / `Win32_Process`。原先用于「谁占着包目录」
  的诊断已随安装功能一起删除。
- **不再调用 `netstat.exe`**：端口 → PID 改用 `iphlpapi!GetExtendedTcpTable`（进程内 API）。
- **不调用 PowerShell / where.exe / taskkill.exe / cmd.exe**：PATH 查找与进程终止都在进程内完成
  （`ProcessRunner.Where` 扫描 PATH，`ProcessKiller` 用 Toolhelp 快照 + `Process.Kill`）。
- **不自我替换、不生成 `.cmd`/`.bat`**：更新交给 `atlisp-tray`（Node 脚本）在托盘退出后完成；
  旧版留下的 `update-tray.cmd` / `.AtlispTray.update.exe` 启动时会清理。
- **不再静默写开机自启**：首次启动改为询问（默认按钮在「否」）。「未告知就设置自启」是 ML 模型里
  权重很高的行为；静默启动（`--silent`）不询问也不写标记。
- **版本资源补全**：exe 里有 `CompanyName=atlisp.cn`、`ProductName=@lisp MCP Server`、
  `FileDescription`、`Copyright`、`LegalTrademarks`。
- **不再把版本号编译进 exe**：版本资源固定 `1.0.0.0`，真实版本写 `AtlispTray.version`。
  配合 `-deterministic` + `-pathmap` 构建，源码不变时产物**字节一致**（hash 不随发版漂移，信誉能累积）。
- **体积同步下降**：下载/安装相关代码删除后，exe 从约 178 KB 降到约 117 KB。

仍然需要做（代码层面已无能为力）：

> **如果 Defender 是在 `npm install` 阶段（exe 还没运行）就报的**，那说明命中来自**静态扫描**，
> 上面这些运行期行为改动都影响不到它——静态模型只看文件的 PE 结构、IL 里出现的 API/字符串和
> 有无签名。只有两件事能改变判定：**签名**和**向微软提交误报**。想把「包内 exe 被扫」
> 这条路彻底去掉，只能不把 exe 放进 npm 包（已改为单独下载安装）。

1. **代码签名**（唯一根治手段）。本项目走 **SignPath Foundation**（免费、开源、无地区限制），
   配置见 `docs/signpath-signing.md`，制品配置源文件 `signpath/artifact-configuration.xml`。
   Azure Artifact Signing 是备选，但 **Public Trust 有地区限制（个人仅限美国/加拿大）**，
   中国大陆主体用不了。自购 OV/EV 证书需硬件 token/HSM，签名后用同一主体持续发布才能积累信誉：
   ```bat
   set ATLISP_TRAY_SIGN_THUMBPRINT=<证书指纹，无空格>
   npm run build:tray
   ```
   也可以直接调脚本：`powershell -File tray\build.ps1 -SignThumbprint <指纹> -TimestampUrl http://timestamp.digicert.com`
   （`build.ps1` 会找 Windows SDK 的 `signtool.exe`，签名 + SHA256 时间戳；证书没插好会直接报错退出）。
   Linux 交叉编译环境下没有 `signtool`，发布前在 Windows 上补签，或把签名放到 CI 的 Windows runner。

   **CI 签名**（`.github/workflows/sign-release.yml`，凭据缺失时自动跳过）：签 `AtlispTray.exe`，
   签完用 `signtool verify /pa` 校验并上传 artifact。

   | 渠道 | 适用 | 需要的 secrets |
   |---|---|---|
   | **Azure Artifact Signing**（2026-01 由 Trusted Signing 更名） | 付费（Basic 档 $9.99/月含 5000 次签名），CI 全自动；**证书主体 = Azure 订阅的认证身份** | `AZURE_CLIENT_ID` `AZURE_TENANT_ID` `AZURE_SUBSCRIPTION_ID` `AZURE_TS_ENDPOINT` `AZURE_TS_ACCOUNT` `AZURE_TS_CERT_PROFILE` |
   | **SignPath Foundation** | 开源项目免费（需公开仓库 + OSI 协议，本项目 ISC 符合） | `SIGNPATH_API_TOKEN` `SIGNPATH_ORGANIZATION_ID` `SIGNPATH_PROJECT_SLUG` `SIGNPATH_SIGNING_POLICY_SLUG` `SIGNPATH_ARTIFACT_CONFIG_SLUG` |

   > **坑**：签名后的 exe 必须是最终发布的那一份。CI 的 publish job 因此用
   > `npm publish --ignore-scripts` 发布——否则 `prepack` / `prepublishOnly` 会重新编译，
   > 把刚签好的 exe 覆盖成未签名版本（exe 本身不进 npm 包，但 manifest 的 hash 会跟着变）。

2. **提交误报**：<https://www.microsoft.com/en-us/wdsi/filesubmission>（按「软件开发者」提交，公司名与签名主体一致）。
   国内再报 360 / 火绒 / 腾讯的误报通道。**先改行为再提报**，否则换 hash 后要重提。
3. 不要把 exe 加壳/混淆/UPX；发布时附 `SHA256SUMS`。

## 故障排查

| 现象 | 处理 |
|------|------|
| 托盘图标不出现 | Windows 11 默认折叠新图标：点击任务栏 `^` 找到图标并拖到任务栏 |
| 启动失败：未检测到 Node.js | 按菜单「如何安装 Node.js…」自行安装后重载配置；或在 `tray.json` 中配置 `NodePath` |
| 启动失败：未安装 @lisp MCP Server | `npm install -g @atlisp/mcp@latest`，然后「重新加载配置」 |
| 启动后一直是黄色 | 右键 → 查看服务器日志，确认端口是否被占用、CAD 是否已启动 |
| 升级报 `EBUSY: ... rename ... node_modules\@atlisp\mcp` | 关掉占用该目录的程序（MCP 客户端拉起的服务、旧托盘、残留 `cad-worker`）后重试 |
| 知识库菜单显示「未安装」 | 按菜单提示 `python -m pip install --upgrade atlisp-dwg-kb`，再点「刷新状态」 |
| 知识库服务启动失败 | 查看 `%APPDATA%\atlisp-mcp\logs\dwgkb-*.log`；确认 Python ≥ 3.10、包已装、端口 8322 空闲 |
| 「关于」里的版本号和 exe 文件属性里的 1.0.0.0 不一样 | 正常：exe 版本资源固定，真实版本来自同目录 `AtlispTray.version`（或 npm 包 `package.json`） |
| 首次运行被 SmartScreen 拦截 / 被杀软报毒 | exe 未做代码签名（见「杀软误报」）。临时处理：点“更多信息 → 仍要运行”，或把安装目录加入排除项；根治靠代码签名 + 提交误报 |

## 代码结构

`AtlispTray.cs` 单文件包含：

- `Program` / `TrayApplication`：托盘生命周期、右键菜单、状态轮询
- `ServerManager`：启动/停止/重启、pid/lock 文件解析、Windows 服务识别
- `HealthMonitor` / `HealthClient`：后台线程轮询 `/health`，避免阻塞 UI
- `ServerLocator`：Node / npm / @lisp mcp 路径与版本探测（只做文件检查，不执行 npm）
- `PythonLocator`：Python ≥3.10 与 `atlisp-dwg-kb` 版本探测
- `PortInspector`：`GetExtendedTcpTable` 实现的「端口 → PID」，替代 netstat
- `DwgKbServer` / `DwgKbClient` / `DwgKbSettingsForm`：知识库本地服务启停（PID 记录）、状态探活、`/build` 提交、地址与 API Key 设置
- `IconFactory`：从 exe 提取品牌图标，叠加状态圆点（失败时回退到内置绘制图标）
- `OutputForm`：环境诊断窗口
- `AutostartHelper`：`HKCU\...\Run` 托盘自启
- `TraySelfUpdate`：清理旧版本留下的更新脚本/暂存副本

构建/发布相关：`scripts/build-tray.mjs`（跨平台构建）、`tray/build.ps1`（Windows csc）、`tray/atlisp-tray.js`（npm 全局命令）。

产物 `dist/AtlispTray.exe` 不随 npm 包发布；hash 只在源码改动时变化（版本号不烧进 exe）。
