# Changelog

本文件由 `scripts/release.mjs` 自动维护（`npm run release <patch|minor|major>`）。

## [1.12.16] - 2026-10-27

### 更新内容

- feat(tray): 降低杀软误报 + exe 移出 npm 包 (91c49c6)

## [1.12.15] - 2026-10-27

### 更新内容

- fix(tray): 削减静态特征——不落 .cmd 提权、去掉 PowerShell（改 WMI）、WebClient 改 HttpWebRequest、知识库默认不自动升级 (2f9065d)

## [1.12.14] - 2026-10-27

### 更新内容

- fix(cad): 长代码免弹信任框——预置 TRUSTEDPATHS，无该变量时改走内存分块注入 (f6efc93)
- fix(import_funlib): list 格式带上参数列表，调用方据此对齐 arity (f28526b)
- README: Code signing policy 改回 SignPath Foundation 主路线（Azure 保留为备选渠道） (74dcf49)
- tray: 降低杀软误报特征——PowerShell 脚本改经 stdin 传入（去掉 -EncodedCommand/base64）、删除 wmic 兜底 (a828aa4)
- chore: 配置脚本加可执行位 (37f4a23)
- docs+scripts: Azure Artifact Signing 一键配置脚本与指南；README 签名政策改为 Azure 表述 (65f2995)
- ci: 适配 Azure Artifact Signing 更名（artifact-signing-action@v2，OIDC 无需客户端密钥） (73377b5)
- docs: 补充 ISC LICENSE 与 Code signing policy（SignPath Foundation 申请前置） (0e285f3)

## [1.12.13] - 2026-10-25

### 更新内容

- feat(prompts): library-usage —— 图库与填充的系统提示词（可直接被客户端拉取） (3adb72c)
- feat(prompts): 图库与填充图案的使用流程 prompt (246e477)
- feat(pattern): 填充图案库（855 个 .pat）接入 MCP (3bf290b)
- feat(library): library_insert 支持外部传入 off/size/units（用户端免索引） (376f110)
- perf(library): 同机部署直读本地索引，CAD 可走内网取 dwg (479ec7c)
- fix(library): MCP 端不再依赖本地图库副本 (bd727a1)
- feat(library): 4 个在线图库 MCP 工具 (04638d8)

## [1.12.12] - 2026-10-25

### 更新内容

- feat(dwg-kb): 新增 6 个审查向工具 (21bc187)

### 图纸知识库：新增 6 个审查向工具

`dwg_kb_*` 从 11 个扩到 17 个，补上「图层反查图纸」和「单图双轨校验」两条原来
只能靠 SPARQL 手写的路：

- `dwg_kb_layer_drawings` — 图层 → 图纸反查（子串匹配，回传实际命中的 `matchedLayers`）
- `dwg_kb_verify_drawing` — 单张图双轨校验（VLM 声称 vs ezdxf 硬数据，冲突标 `corrected`）
- `dwg_kb_render_drawing` — 历史图渲染 PNG/SVG，回传落盘路径 + URL（图片不进上下文）
- `dwg_kb_job` — 查询 `verify`/`render` 的 `background=true` 异步任务
- `dwg_kb_project_overview` — 项目级图纸数/专业分布/审查轮次
- `dwg_kb_cross_ref_graph` — 跨专业全景（bridges / matrix / shared_layers）

`verify` / `render` 会落盘（校验报告还会挂到 RDF），因此不标 `readOnlyHint`；
`render` 记为幂等写。其余四个为只读。

## [1.12.11] - 2026-10-25

### 更新内容

- fix(tray): 升级时彻底释放 npm 包目录占用（EBUSY） (e19f41b)

### 修复：升级 @lisp/mcp 报 EBUSY（包目录被占用）

npm 替换全局包的做法是把整个 `node_modules\@atlisp\mcp` 改名成 `.mcp-XXXXXX`
再解压新版本，只要还有进程「在里面」Windows 就拒绝改名：

```
EBUSY: resource busy or locked, rename '...\@atlisp\mcp' -> '...\.mcp-otF029uM'
```

常见占用者：把该目录当工作目录的服务进程（托盘旧版把服务 CWD 直接设成包目录）、
连过 CAD 后常驻的 `edge-js` 原生模块、Windows 服务模式、
MCP 客户端拉起的实例、残留的 `cad-worker`、包内运行中的托盘 exe。
旧逻辑只停托盘自己拉起的服务再原样重试一次，命中其他情况仍然失败。

- 服务不再以包目录为工作目录启动（改用 `%APPDATA%\atlisp-mcp`），
  `cad-worker` 显式 `cwd: os.tmpdir()`——从根上消掉最常见的占用源；
- 新增目录占用探测：把目录**改名再改回来**（和 npm 那一步等价）判断是否真的空闲，
  不再靠猜；占用者用 PowerShell `Win32_Process` 枚举（`-EncodedCommand` 传参，wmic 兜底）；
- 升级/安装前预检：目录空闲就照旧边下载边服务、不停服务；被占用则依次停托盘服务、
  停 Windows 服务、把托盘 CWD 移出包目录、等句柄释放，再只结束确定属于本包的
  进程（node / `AtlispTray` / `AtlispUpdater`，编辑器与终端不碰），确认空闲后才跑 npm。
  手动升级会弹一次确认框列出占用进程，自动升级静默处理；
- 失败重试 1 次 → 2 次，且必须探测到目录已释放才重试；仍失败时对话框直接给出占用清单
  与「命令行窗口/编辑器把该目录当工作目录」这类漏网原因；
- 改名探测途中被强杀的残留目录下次启动自动复原；升级失败时把被停掉的旧服务拉回来。

> 从旧版本升级到本版仍需先手动过一次（旧托盘没有新逻辑，它自己会撞 EBUSY）：
> 退出托盘与 MCP 客户端 → `npm install -g @atlisp/mcp@latest` → 重新运行 `atlisp-tray`。
> 之后托盘日志里搜 `locked:` 可看到它探测到/结束了哪些占用进程。

## [1.12.10] - 2026-10-25

### 更新内容

- feat(resources): 重写工具/资源描述，资源扩展到 24 个 (f8ad678)
- fix(package): install_package 走包管理器 API 并等待安装完成 (7d297f7)

### 修复：install_package 装不上包

- `install_package` 旧实现发的是 `(@::load-module '包名)`——那是**内核模块**
  加载器，对包名只返回 `T`，什么也不装（实测 at-pm 装完后 `pkg.lsp` 仍不存在）。
  改为包管理器 API：`(@::load-module 'pkgman)` + `(@::package-install "包名")`；
- 安装是异步的：发完命令后轮询 `(@::package-list-in-local)`，等包**真的出现**
  再返回（默认 60s，`PACKAGE_INSTALL_WAIT_MS` 可调），随后
  `(@::load-pkg "包名" '())` 加载函数；已安装则只重新加载；
- 超时/包不存在返回 `isError` 与可执行的下一步，不再回「已发送」让 agent
  接着撞 `no function definition`。

## [1.12.9] - 2026-10-25

### 更新内容

- feat(analysis): 新增 cad_duplicates 只读重复实体检查 (efb1106)
- fix(print): 修正 PlotToFile/PlotToDevice 的 ActiveX 调用 (0d69982)
- ci: 新增签名 workflow（Azure Trusted Signing / SignPath），凭据缺失时跳过 (b965690)

## [1.12.8] - 2026-10-24

### 更新内容

- feat(tray): 独立更新器 + 下载物校验 + 稳定 hash 构建（降低杀软误报，保留自动更新） (7bf0f94)
- fix(tray): 升级 EBUSY 时给出可操作的诊断，重试计数按轮次重置 (be6a781)
- fix(tray): 清理 pip 中断残留的 ~<包名> 目录，知识库未升级时不再谎报「已升级」 (8f11a91)

## [1.12.7] - 2026-10-24

### 更新内容

- fix(tray): 降低杀软误报——补全版本资源、去掉 cmd 自替换脚本、默认不再自动升级 (a0a747f)

## [1.12.6] - 2026-10-24

### 更新内容

- 重新发布 1.12.5 的内容：1.12.5 的 `npm publish` 落入 registry 的 staged-publish 卡死状态（`npm view` 404、`npm stage list` 为空、重发报 409），按 npm/cli#9889 的建议升版本重发
- fix(health): `/health` 忙时不再阻塞——普通探测 1.2s 上限（`HEALTH_FAST_PROBE_MS`），CAD 命令队列非空或已有 ping 在途时直接返回 `status:"busy"`（HTTP 200）；`?probe=1` 显式探测仍保留 8s (c917e12)
- fix(tray): 健康检查 HTTP 超时 1.5s/2s → 10s（与服务端探测上限对齐）；探测超时不再把状态打成「启动中」，原为 Running 则保持，状态行可显示「CAD 忙（队列 N）」
- fix(tray): 升级 `@lisp/mcp` 与 `atlisp-dwg-kb` 不再一开始就停服务，先下载，仅在替换本地文件被占用（EBUSY/EPERM+unlink/WinError 32/PermissionError）时才停服务并重试一次

## [1.12.5] - 2026-10-24（未发布）

> 未上线：npm registry 的 staged-publish 卡死（见 1.12.6），内容与 1.12.6 相同。

### 更新内容

- fix(health): `/health` 忙时不再阻塞——普通探测 1.2s 上限（`HEALTH_FAST_PROBE_MS`），CAD 命令队列非空或已有 ping 在途时直接返回 `status:"busy"`（HTTP 200）；`?probe=1` 显式探测仍保留 8s (c917e12)
- fix(tray): 健康检查 HTTP 超时 1.5s/2s → 10s（与服务端探测上限对齐）；探测超时不再把状态打成「启动中」，原为 Running 则保持，状态行可显示「CAD 忙（队列 N）」
- fix(tray): 升级 `@lisp/mcp` 与 `atlisp-dwg-kb` 不再一开始就停服务，先下载，仅在替换本地文件被占用（EBUSY/EPERM+unlink/WinError 32/PermissionError）时才停服务并重试一次

## [1.12.4] - 2026-10-24

### 更新内容

- fix(handler-loader): 缺 handlers 目录时用静态清单兜底，避免全量 Handler not found (9f3449d)

## [1.12.3] - 2026-10-24

### 更新内容

- fix(tray): 知识库服务补全启停/重启与外部实例管理，区分服务与本机版本 (fe238c0)

## [1.12.2] - 2026-10-24

### 更新内容

- feat(tray): 右键菜单按状态与用途重组，启停按当前状态只显示可执行项，补充悬停说明
- feat(tray): 知识库自动安装 / 自动升级（PyPI）/ 异常自愈；MCP 异常退出自动拉起
- feat(tray): 知识库本地服务启停、版本与三元组状态、地址与 API Key 设置
- feat(dwg-kb): 新增 11 个 dwg_kb_* 只读工具（检索/查询/图纸/项目/图层/块/复核/版本/互引）
- feat(dwg-kb): 新增 DWG_KB_URL / DWG_KB_API_KEY / DWG_KB_TIMEOUT 配置与「图纸知识库」分类
- docs: 更新托盘 README（菜单树、自动升级与自愈说明）与 AGENTS 文件表

## [1.12.0] - 2026-10-23

### 更新内容

- fix(frames): 宽高比默认容差 0.002 → 0.0035，识别约 0.1% 偏差的加长图幅 (f8e08aa)

## [1.11.10] - 2026-10-23

### 更新内容

- build: 非 Windows 平台交叉编译 C#（cad-rothelper.dll / AtlispTray.exe） (207c725)
- feat(frames): 图框识别改双路径，lib 可用时启用三条通道 (4447923)

## [1.11.9] - 2026-10-23

### 更新内容

- fix(install): 修复无 .NET SDK 时 npm 安装失败（spawn dotnet ENOENT） (efd203b)

## [1.11.8] - 2026-10-21

### 更新内容

- fix(build): 检测 dist 与包版本不一致，避免发布旧构建 (4fd7c3e)

## [1.11.7] - 2026-10-21

### 更新内容

- fix(atlisp): 修复探测 token 与未保存图纸判断（.53 实测） (96646c0)

## [1.11.6] - 2026-10-21

### 更新内容

- feat(tray): 每小时自动升级 @lisp/mcp，并支持托盘自我更新 (500e548)
- feat(atlisp): 连接 CAD 后强制检查并自动安装 @lisp (40e2d53)

## [1.11.5] - 2026-10-21

### 更新内容

- fix(cad): 结果文件按系统 ANSI 代码页解码，修复中文乱码 (4c52edf)
- fix(tray): build.ps1 加 UTF-8 BOM，修复 Windows PowerShell 5.1 解析失败 (343dd06)
- fix(streaming): stream_entities 用 prog1 清理 ss/result 等全局变量 (debff8f)
- fix(queue): 清空队列时丢弃未 flush 的读批次，并清理 _br* 临时变量 (76b5624)
- fix(cad): 轮换/熔断降为 WARN，修正读 worker 永不轮换与在途请求清理 (4f3ccbd)
- fix(tray): 修复 npm 安装时找不到 node，并自动补齐运行环境 (7454697)
- feat(atlisp): auto install and load @lisp after CAD connects (545268d)

## [1.11.4] - 2026-10-18

### 更新内容

- feat(tray): add Windows tray manager and publish exe via npm (d35fdc4)

## [1.11.3] - 2026-10-18

### 更新内容

- feat(report): ERROR 日志上报到 atlisp.cn 用于聚类改进 (db80816)

## [1.11.2] - 2026-10-18

### 更新内容

- feat(plugin): 新增 plugin_list / plugin_reload 管理工具 (0d1f6d7)
- feat(plugin): 接通工具与 CAD 生命周期钩子，支持回收插件注册的工具 (7b28623)
- fix(robustness): 为缺失超时的外部 HTTP 调用补超时 (9f84299)
- perf(startup): @atlisp/lint 延迟加载，减少日志热路径系统调用 (17c2035)
- refactor(cad): 提取命令队列到 command-queue.js 并修复去重竞态 (52e11a4)
- fix(text-clean): 保留 MTEXT 转义花括号，补 21 条单元测试 (d797a7f)
- fix(plugin): 修复纯 ESM 下插件全部加载失败，完善热重载生命周期 (3b5c6ac)
- chore(log): 空闲会话清理日志降为 info，避免误报 error (77b559e)
- feat(data): 文本清洗/type+layer、图框去重、analysis facts 下沉到 MCP (7592496)
- feat(relay): 常驻后台中继 —— 页面关闭后仍可操作 CAD (87d9164)
- fix(cad): 心跳区分「worker 忙」与「worker 死」，消除重启循环 (22fff01)
- docs(AGENTS): 更正「CAD 会话未加载 lib」的错误判断（atoms-family format=1 返回字符串） (d5a04a9)
- fix(health): 探测超时单独报 timeout，超时上限 3s → 8s（3s 会把正常 CAD 误判为 down） (718ddab)
- fix(health): /health 未连接时不再一律报 connected:false，新增 status/probed 与 ?probe=1 (0a98050)
- fix: 修复端口锁释放时 ENOENT 误报错误日志 (09eb6b1)
- fix(dwg): list_frames 未登记分派表导致「未知工具」，并加目录↔分派一致性棘轮测试 (134a313)
- feat(dwg): 图框识别资源与工具；修 block-refs 属性读取与 T 真值依赖 (2a1ac3a)
- fix(dwg): analysis 聚合截断、blockUsage 语义错误、block-refs 分页与含 $ 块名 (bb090ff)

## [1.11.1] - 2026-10-16

### 更新内容

- fix: worker 轮换计数只统计外部请求，消除阈值漂移 (92a5dd1)
- feat: 内存变化与 ERROR/WARN 日志输出到终端 (30484c9)
- chore: 暂时关闭 atlisp.cn 健康上报（遥测 POST） (7270663)

## [1.11.0] - 2026-10-16

### 更新内容

- refactor: resource-handlers 1583 行拆分，resource-readers 去重至 588 行 (53d2213)
- test: 覆盖率 41.7% → 62.7%（+303 用例） (4d7bdba)

## [1.10.0] - 2026-10-16

### 更新内容

- test: 内存防回归 soak 测试 + HTTP 传输 e2e (e9caf71)
- feat: TOOL_PROFILE 工具档位 + search_tools 摘要化 + 描述瘦身 (150ec8f)
- docs: 2026Q4 路线图；fix: 空 catch 块 lint 清理 (99dc31d)
- feat: peer 熔断状态机 + 自动选路 + 转发指标 (32f7acf)
- feat: MCP 协议升级到 2025-11-25 + 工具 title 与结构化输出 (81c68e7)

## [1.9.14] - 2026-10-16

### 更新内容

- fix: 远程 peer 按地址去重，实例 ID 漂移不再堆积重复条目 (c8af720)
- Merge remote-tracking branch 'origin/main' (e689988)
- fix: 全局兜底 unhandledRejection，避免 MCP server 进程退出 (bf1ef63)
- fix: 正确性/安全/可靠性多项修复并补充测试 (68f660f)
- fix: 配置优先级倒置，--port 等命令行参数被配置文件静默覆盖 (ad98605)
- fix: 修正 heapSizeLimit 取值来源（OOM 天花板此前恒为 0） (3994758)

## [1.9.13] - 2026-10-06

### 更新内容

- feat: --mem 终端内存监控（RSS/堆/趋势/增量） (6bfbab4)
- fix: 修复 HTTP MCP 会话与 agent context 内存泄漏（4GB 堆 OOM） (d8ed1cf)

## [1.9.11] - 2026-10-05

### 更新内容

- fix: 修复常驻进程内存无界增长（4GB 堆 OOM） (a9b8557)
- fix: CORS 默认放行 localhost 与 atlisp.cn 子域（浏览器桥接预检 403） (e0079cf)

## [1.9.10] - 2026-09-30

### 更新内容

- feat: 远程 peer 通用工具转发与自动转发（Linux → Windows CAD） (5e3fcd4)

## [1.9.9] - 2026-09-25

### 更新内容

- fix: 补全 peer 扫描模块 mcp-scanner 并修复 lint/测试 (8f6d958)

## [1.9.8] - 2026-09-25

### 更新内容

- feat: send_esc 工具 + 打开/保存 DWG 改用 ActiveX(COM) (5a9d08e)
- feat: 添加行业规范和标准工具 (dd31057)

## [1.9.6] - 2026-09-19

### 更新内容

- feat: windowless Windows autostart with Win7 fallback (7f29199)
- feat: default security level to relaxed (9770043)

## [1.9.5] - 2026-09-19

### 更新内容

- chore: bump version to 1.9.4 (402eb11)
- feat: add peer_broadcast tool (6a3f0fe)
- fix: add peer_summary to mcp-tools handler mapping (8f7a96b)
- feat: add peer discovery and communication (8af2822)
- refactor: 抽取 handlers 子模块 (entity/metadata/analysis/standards) + 更新 sampling 测试 (a6f4ad9)
- test: 新增 mcp-tools 单元测试 + 完善 sampling 测试 (13b88e0)
- docs: 更新文档 - v1.9.2 多平台测试验证 (e76a576)
- chore: bump version to 1.9.2 (acbe763)
- test: 新增 edit/draw/text/constraint handlers 测试 (7f40ecc)
- v1.9.1: CAD 连接健壮性增强 + handler 改进 (f732900)
- v1.9.0: MCP 服务器稳定性增强 (2647b72)
- chore: release v1.9.0 (ce6b945)
- chore: 剩余 lint 修复（resource-handlers、tools/grouping） (bc9ea07)
- docs: 文档更新 + CHANGELOG (57e08d6)
- feat: i18n 国际化 + OTel tracing + 工具分类过滤 (f64b68e)
- chore: 全量 eslint 修复 + 小修 (362fe7a)
- chore: 测试/lint/构建基建 + CI 修复 (83002b3)
- feat: CAD 停滞快速失败与恢复 + 工具分类/服务化等多项整理 (1a4be01)
- feat: lazy CAD connection — no connect on startup, auto-discover and auto-launch on demand (1f4cf5f)
- fix: 工具分类整理——57 个其他工具全部归位 (91d5b70)
- refactor: 项目完善 P0-P4 全部完成 (eb2d991)
- fix: escape inner quotes in reg add command for --install-autostart on Windows (edb760f)
- feat: add port lockfile and autostart support (e8d44ee)
- chore: bump version to 1.8.30 (22c3b03)
- v1.8.29 (fb249a0)
- chore: bump to v1.8.29, increase MESSAGE_TIMEOUT default to 5min (e0e189a)
- feat: use iconv-lite for GBK→UTF-8 decoding in eval_lisp_with_result (6540ab3)
- refactor: architecture optimization P0-P3 + new features + test coverage (64fb685)
- feat: support multi-domain CORS with wildcard matching (5ed8ced)
- chore: bump to v1.8.23 (ea9ee48)
- feat: add interactive debug session protocol (5 tools) (7a8b98e)
- feat: add CLI options for api-key/metrics/ssl, improve help text and env var docs (9846c28)
- feat: add --security-level option (strict/standard/relaxed) to control dangerous function execution (bfd85d2)
- feat: 多CAD实例并行执行 + MCP规范合规完善 (6abf7e6)
- chore: bump to v1.8.20 (6f89761)
- feat: 14项优化与新功能 (P0修复/P1性能/P2增强/P3工程质量) (73cc657)
- feat: 更新 AGENTS.md 与实际代码同步，新增 test-autolisp MCP Prompt (10395a1)

## [1.9.2] - 2026-09-14

### 更新内容

- test: 新增 edit/draw/text/constraint handlers 测试 (7f40ecc)
- test: 覆盖率 40.07% → 42.4% (+2.33%)
- test: 测试用例 692 → 784 (+92)
- chore: bump version to 1.9.2 (acbe763)

## [1.9.1] - 2026-09-14

### 更新内容

- fix: ensureDocument COM 异常时自动创建新文档作为降级方案 (cad-worker.js)
- fix: newDocument 返回值兼容旧布尔值和新对象格式 (cad-handlers.js)
- fix: createLayer 检查 entmake 返回值，nil 时明确报错 (layer-handlers.js)
- fix: openDwg 简化路径校验逻辑，移除 INVALIDPATH 冗余分支 (file-handlers.js)
- fix: 安全规则 directory 函数从 BLOCK 放宽为 ALLOW (lisp-security.js)
- fix: 熔断器参数调优——阈值 5、恢复窗口 10s (cad-circuit-breaker.js)
- chore: ESLint 未使用变量修复
- docs: README 新增真机测试验证章节

## [1.9.0] - 2026-08-23

### 更新内容

- chore: 剩余 lint 修复（resource-handlers、tools/grouping） (bc9ea07)
- docs: 文档更新 + CHANGELOG (57e08d6)
- feat: i18n 国际化 + OTel tracing + 工具分类过滤 (f64b68e)
- chore: 全量 eslint 修复 + 小修 (362fe7a)
- chore: 测试/lint/构建基建 + CI 修复 (83002b3)
- feat: CAD 停滞快速失败与恢复 + 工具分类/服务化等多项整理 (1a4be01)
- feat: lazy CAD connection — no connect on startup, auto-discover and auto-launch on demand (1f4cf5f)
- fix: 工具分类整理——57 个其他工具全部归位 (91d5b70)
- refactor: 项目完善 P0-P4 全部完成 (eb2d991)
- fix: escape inner quotes in reg add command for --install-autostart on Windows (edb760f)
- feat: add port lockfile and autostart support (e8d44ee)
- chore: bump version to 1.8.30 (22c3b03)
- v1.8.29 (fb249a0)
- chore: bump to v1.8.29, increase MESSAGE_TIMEOUT default to 5min (e0e189a)
- feat: use iconv-lite for GBK→UTF-8 decoding in eval_lisp_with_result (6540ab3)
- refactor: architecture optimization P0-P3 + new features + test coverage (64fb685)
- feat: support multi-domain CORS with wildcard matching (5ed8ced)
- chore: bump to v1.8.23 (ea9ee48)
- feat: add interactive debug session protocol (5 tools) (7a8b98e)
- feat: add CLI options for api-key/metrics/ssl, improve help text and env var docs (9846c28)
- feat: add --security-level option (strict/standard/relaxed) to control dangerous function execution (bfd85d2)
- feat: 多CAD实例并行执行 + MCP规范合规完善 (6abf7e6)
- chore: bump to v1.8.20 (6f89761)
- feat: 14项优化与新功能 (P0修复/P1性能/P2增强/P3工程质量) (73cc657)
- feat: 更新 AGENTS.md 与实际代码同步，新增 test-autolisp MCP Prompt (10395a1)

## [1.8.32] - 2026-08-23

### 更新内容

- feat: CAD 停滞快速失败与恢复 + 工具分类/服务化等多项整理 (1a4be01)
- fix: tests/cad.test.js 平台依赖修复——connect 相关测试在非 Windows 平台强制 win32 平台标志
- chore: 测试基建（vitest.config.js + 覆盖率）、构建脚本抽取、eslint 强制化、发布流程
