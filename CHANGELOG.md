# Changelog

本文件由 `scripts/release.mjs` 自动维护（`npm run release <patch|minor|major>`）。

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
