# @lisp MCP Server

MCP (Model Context Protocol) Server for @lisp on CAD — 为 CAD 环境提供 @lisp 包管理服务的 MCP 服务器，同时为 AI Agent 操控 CAD 提供 **340+ 个调用工具**和通道。自 v1.8.32 起，Windows 自动启动支持后台静默运行（无终端窗口）。

支持 **AutoCAD / ZWCAD / GStarCAD / BricsCAD**，通过 COM 互操作与 CAD 通信。

---

## 目录

- [功能特性](#功能特性)
- [快速安装](#快速安装)
- [配置 AI Agent](#配置-ai-agent)
- [启动服务](#启动服务)
- [连接 CAD](#连接-cad)
- [工具列表](#工具列表)
- [MCP 资源](#mcp-资源)
- [MCP Prompts](#mcp-prompts)
- [HTTP API 端点](#http-api-端点)
- [环境变量](#环境变量)
- [命令行参数](#命令行参数)
- [配置文件](#配置文件)
- [工作原理](#工作原理)
- [Docker](#docker)
- [开发指南](#开发指南)
- [故障排除](#故障排除)
- [许可证](#许可证)

---

## 功能特性

- **连接多平台 CAD** — AutoCAD / ZWCAD / GStarCAD / BricsCAD
- **执行 AutoLISP** — 执行 LISP 代码并获取结果
- **AI Agent 控制 CAD** — 340+ MCP 工具，涵盖绘图、编辑、查询、管理
- **包管理** — 列出、搜索、安装 @lisp 包
- **批量操作** — 批量复制/移动/旋转/缩放/镜像/偏移/改名/改色/改图层
- **3D 建模** — 创建 Box/Sphere/Cylinder/Cone/Torus/Wedge，布尔运算，拉伸/旋转
- **图纸集管理** — 创建/发布/归档/比较/打包图纸集
- **动态块** — 获取/设置参数、可见性状态
- **几何约束与标注约束** — 添加/删除/列出约束
- **外部参照** — 附着/拆离/绑定/裁剪/路径管理/批量相对化
- **PDF/DGN/DWF 底图** — 附着/拆离/重载/批量附着
- **扩展数据 (Xdata)** — 读写/复制/搜索/导入/导出
- **管道 (Pipeline)** — 编排多步工具调用链
- **触发器 (Watch)** — 注册 CAD 变更触发器，等待条件满足
- **Webhook** — 事件驱动回调（工具执行/包安装/CAD 连接等）
- **REPL** — 交互式 Lisp 执行会话
- **流式读取** — 分页流式读取实体/文字/块参照
- **外部数据** — 查询/导入/导出 CSV/JSON 数据源
- **审计日志** — 查询和统计工具调用历史
- **规范标准** — 行业制图规范检查、模板应用、合规报告
- **CAD 连接池** — 发现/连接/切换/健康检查多 CAD 实例，支持 ROT 自动发现
- **多实例并发** — `batch_concurrent_tasks` 跨实例并发执行任务
- **会话实例绑定** — `session_pin_instance` 将会话绑定到指定 CAD 实例
- **沙箱** — 验证 LISP 代码安全性
- **资源订阅** — 实时推送 CAD/DWG/包变更
- **LLM Sampling** — 通过配置的 LLM 提供采样能力
- **Prometheus 指标** — 导出 /metrics 端点
- **SSL/TLS** — 支持 HTTPS 加密通信
- **API Key 认证与速率限制**
- **配置热重载** — 配置文件变更自动加载
- **多种传输模式** — HTTP / SSE / stdio / WebSocket

---

## 快速安装

### Windows (PowerShell)

```powershell
iwr -useb https://atlisp.cn/install.ps1 | iex
```

安装脚本会自动：
- 安装 Node.js（如未安装，支持 winget/choco/scoop/MSI）
- 全局安装 `@atlisp/mcp` 包
- 注册命令 `atlisp-mcp`

### 手动安装 (npm)

```bash
npm install -g @atlisp/mcp
```

### 验证安装

```bash
atlisp-mcp --version
```

---

## 配置 AI Agent

### WorkBuddy

在 `~/.workbuddy/.mcp.json` 中添加:

```json
{
  "mcpServers": {
    "atlisp-mcp": {
      "url": "http://localhost:8110/mcp"
    }
  }
}
```

### Claude Desktop

在 `~/AppData/Roaming/Claude/claude_desktop_config.json` 中添加:

```json
{
  "mcpServers": {
    "atlisp-mcp": {
      "command": "atlisp-mcp",
      "env": {
        "TRANSPORT": "stdio"
      }
    }
  }
}
```

### Cline / Cursor / Windsurf

```json
{
  "mcpServers": {
    "atlisp-mcp": {
      "command": "atlisp-mcp",
      "args": [],
      "env": {
        "TRANSPORT": "stdio"
      }
    }
  }
}
```

### opencode / Goose / 其他支持 stdio 的 Agent

```json
{
  "mcpServers": {
    "atlisp-mcp": {
      "command": "atlisp-mcp",
      "env": {
        "TRANSPORT": "stdio"
      }
    }
  }
}
```

---

## 启动服务

### HTTP 模式（默认，端口 8110）

```bash
atlisp-mcp
```

输出:
```
@lisp MCP Server 启动 - http://0.0.0.0:8110 - Streamable HTTP
```

### stdio 模式

```bash
TRANSPORT=stdio atlisp-mcp
```

### WebSocket 模式

```bash
TRANSPORT=ws atlisp-mcp
# 或
atlisp-mcp --ws
```

### 指定端口/主机

```bash
atlisp-mcp --port 9000 --host 127.0.0.1
```

> **端口防冲突**：每个端口只允许一个实例运行。启动时自动检测端口是否已被其他 `atlisp-mcp` 进程占用（通过 `~/.atlisp/locks/atlisp-mcp-{port}.lock` PID 锁文件），占用则报错退出。不同端口可同时运行多个实例互不干扰。

### 设置开机自启

注册到用户登录后自动启动 HTTP 服务：

```bash
atlisp-mcp --install-autostart
```

移除自启：

```bash
atlisp-mcp --uninstall-autostart
```

查看自启状态：

```bash
atlisp-mcp --autostart-status
```

支持三种平台：Windows（Registry Run 键）、macOS（LaunchAgent）、Linux（XDG Autostart）。

**Windows 隐藏窗口**：Windows 10 1809+ 使用 `conhost.exe --headless` 承载 node，无任何控制台窗口，且为微软签名组件，不写脚本、不建计划任务；Windows 7/8/8.1（内核 6.x）无 `--headless`，回退到 `powershell -WindowStyle Hidden`（该平台无 Windows Terminal，可可靠隐藏）。两者均注册到 HKCU 启动项，登录后静默后台运行。

### Windows 托盘管理工具

`tray/` 下提供一个 WinForms 托盘程序（单文件 C#，无需额外运行时），用于图形化管理本机服务：

- 启动 / 停止 / 重启服务，自动识别 `service.ps1` 安装的 Windows 服务
- 检查更新、通过 npm 下载安装 / 升级 `@atlisp/mcp@latest`
- 检测不到 Node.js 时，从 npmmirror 下载官方 MSI 并静默安装（UAC 授权）
- 显示端口、CAD 连接状态、版本；异常退出气泡提醒
- 一键打开调试面板、API 文档、Playground、服务器日志
- 托盘随 Windows 启动、托盘启动时自动启动服务、npmmirror 镜像切换
- 环境诊断（Node/npm/安装位置/健康检查）

构建（跨平台，输出 `dist/AtlispTray.exe`）：

```bash
npm run build:tray
```

`npm publish` 时 `prepack` 会自动构建托盘，并把 `dist/AtlispTray.exe` 和 `atlisp-tray` 启动器一起发布到 npm。全局安装后运行：

```bash
atlisp-tray
```

Windows 本地构建/安装也可以使用：

```powershell
powershell -ExecutionPolicy Bypass -File tray\build.ps1 -Install
```

详细说明见 [`tray/README.md`](tray/README.md)。

### 健康检查

```bash
curl http://localhost:8110/health
```

返回 `{"status":"ok","cad":"connected"}` 表示服务正常。

### 查看指标

```bash
curl http://localhost:8110/metrics
```

### 调试面板

打开浏览器访问 `http://localhost:8110/debug`

### 工具游乐场

打开浏览器访问 `http://localhost:8110/playground`

---

## 连接 CAD

### 前置条件

- Windows 系统
- CAD 软件已安装
- CAD 已启动或允许自动启动

### 使用 MCP 工具连接

```json
{
  "name": "open_cad",
  "arguments": {}
}
```

或指定平台:

```json
{
  "name": "open_cad",
  "arguments": {
    "platform": "AutoCAD"
  }
}
```

也支持 `connect_cad` 工具（仅连接不切前台）：

```json
{
  "name": "connect_cad",
  "arguments": {}
}
```

**自动行为**:
- 如果 CAD 已运行，连接现有实例
- 如果 CAD 未运行，通过 COM 自动创建新实例
- `open_cad` 额外将 CAD 窗口切换到前台

连接成功返回类似: `已连接到 AutoCAD 2025`

### 多 CAD 实例管理

支持同时连接多个 CAD 实例（包括同一平台的不同进程），通过连接池统一管理：

```json
{
  "name": "cad_pool_connect",
  "arguments": {
    "key": "autocad-1",
    "platform": "AutoCAD"
  }
}
```

可通过 `pid` 参数连接到指定进程的 CAD：

```json
{
  "name": "cad_pool_connect",
  "arguments": {
    "key": "autocad-1234",
    "pid": 1234
  }
}
```

**自动发现** — `cad_pool_discover` 使用 Windows ROT（Running Object Table）枚举所有运行中的 CAD 实例并自动加入连接池。

**会话绑定** — 使用 `session_pin_instance` 将当前会话绑定到指定实例，后续所有工具调用自动路由到该实例，无需每次传入 `instance` 参数。

---

## 工具列表 (340+)

> 所有工具的 `description` 和参数说明已针对 AI Agent 优化——包含触发条件、参数示例、交叉引用和后果提示，帮助 Agent 更准确选择和使用工具。

### 系统与 CAD 连接 (12)

| 工具 | 说明 | 参数 |
|------|------|------|
| `open_cad` | 打开 CAD 应用并切换到前台（未运行则自动启动） | `platform` (可选) |
| `connect_cad` | 连接 CAD（仅连接不切换前台） | `platform` (可选) |
| `eval_lisp` | 执行 LISP 代码（无返回值） | `code` (必填) |
| `eval_lisp_with_result` | 执行 LISP 并返回结果 | `code` (必填), `encoding` (可选) |
| `get_cad_info` | 获取 CAD 信息 | — |
| `get_platform_info` | 获取平台信息 | — |
| `at_command` | 执行 @lisp 命令 | `command` (必填) |
| `new_document` | 新建空白文档 | — |
| `bring_to_front` | 切换 CAD 到前台 | — |
| `install_atlisp` | 安装 @lisp | — |
| `init_atlisp` | 初始化 @lisp 环境 | — |
| `get_system_status` | 获取系统诊断信息 | — |

### LISP 执行

| 工具 | 说明 |
|------|------|
| `eval_lisp` | 执行 LISP 代码，不返回结果 |
| `eval_lisp_with_result` | 执行 LISP 代码并返回结果，支持 `encoding: utf-8/gbk/gb2312/gb18030` |
| `lisp_repl` | REPL 会话执行，自动追踪变量和历史 |
| `lisp_repl_history` | 获取 REPL 会话历史 |
| `lisp_repl_list` | 列出活跃 REPL 会话 |
| `lisp_repl_close` | 关闭 REPL 会话 |

### 包管理 (3)

| 工具 | 说明 | 参数 |
|------|------|------|
| `list_packages` | 列出已安装包 | — |
| `search_packages` | 搜索包 | `query` (必填) |
| `install_package` | 安装包到 CAD | `packageName` (必填) |

### 信息与函数 (5)

| 工具 | 说明 |
|------|------|
| `get_function_usage` | 获取 @lisp 函数用法 |
| `list_symbols` | 列出所有符号（函数/变量） |
| `import_funlib` | 导入函数库数据到 AI Agent |
| `list_prompts` | 列出提示模板 |
| `get_prompt` | 获取指定提示模板 |

### 实体操作 (4)

| 工具 | 说明 |
|------|------|
| `get_entity` | 获取实体属性（句柄/类型/图层/颜色等） |
| `set_entity` | 设置实体属性（layer/color/linetype/elevation） |
| `delete_entity` | 删除实体 |
| `select_entities` | 按条件选择实体（type/layer 过滤） |
| `get_entity_info` | 获取实体详细信息 |

### 图层操作 (4)

| 工具 | 说明 |
|------|------|
| `create_layer` | 创建图层 |
| `delete_layer` | 删除图层 |
| `set_layer` | 设置图层属性（color/linetype/freeze/thaw/lock/unlock） |
| `set_current_layer` | 设置当前图层 |

### 块操作 (6)

| 工具 | 说明 |
|------|------|
| `create_block` | 创建块定义 |
| `insert_block` | 插入块参照 |
| `get_blocks` | 获取所有块定义 |
| `explode_block` | 炸开块参照 |
| `batch_get_block_attributes` | 批量获取块属性 |
| `batch_set_block_attributes` | 批量设置块属性 |

### 动态块与参数化 (6)

| 工具 | 说明 |
|------|------|
| `get_dynamic_block_properties` | 获取动态块所有属性 |
| `set_dynamic_block_property` | 设置动态块属性值 |
| `get_block_parameters` | 获取块参数值 |
| `set_block_parameter` | 设置块参数值 |
| `list_visibility_states` | 列出可见性状态 |
| `set_visibility_state` | 切换可见性状态 |

### 文件/DWG 操作 (5)

| 工具 | 说明 |
|------|------|
| `open_dwg` | 打开 DWG 文件 |
| `save_dwg` | 保存图形 |
| `export_pdf` | 导出 PDF |
| `export_dxf` | 导出 DXF |
| `export_dwf` | 导出 DWF |
| `close_dwg` | 关闭图形 |
| `import_dxf` | 导入 DXF 文件 |
| `import_dgn` | 导入 DGN 文件 |
| `export_dgn` | 导出 DGN 文件 |

### 标注与填充 (7)

| 工具 | 说明 |
|------|------|
| `create_dimension` | 创建标注（ALIGNED/LINEAR/ORDINATE/RADIAL/DIAMETER/ANGULAR） |
| `get_dimension` | 获取标注值 |
| `create_hatch` | 创建图案填充 |
| `set_hatch` | 设置填充属性 |
| `get_block_attributes` | 获取块属性值 |
| `set_block_attribute` | 设置块属性值 |
| `dimension_style` | 创建和管理标注样式 |

### 样式管理 (11)

| 工具 | 说明 |
|------|------|
| `create_dimension_style` | 创建标注样式 |
| `set_dimstyle_var` | 设置标注样式变量 |
| `list_dimension_styles` | 列出所有标注样式 |
| `create_text_style` | 创建文字样式 |
| `list_text_styles` | 列出所有文字样式 |
| `create_linetype` | 创建线型 |
| `load_linetype` | 加载线型文件 |
| `list_linetypes` | 列出所有线型 |
| `create_mleader_style` | 创建多重引线样式 |
| `set_mleader_style_prop` | 设置多重引线样式属性 |
| `list_mleader_styles` | 列出多重引线样式 |

### 视图与缩放 (5)

| 工具 | 说明 |
|------|------|
| `zoom_extents` | 缩放到图形范围 |
| `zoom_window` | 缩放到窗口 |
| `create_named_view` | 创建命名视图 |
| `restore_named_view` | 恢复命名视图 |
| `list_named_views` | 列出所有命名视图 |

### UCS 与布局 (11)

| 工具 | 说明 |
|------|------|
| `create_ucs` | 创建 UCS |
| `set_ucs` | 切换到 UCS |
| `list_ucs` | 列出所有 UCS |
| `delete_ucs` | 删除 UCS |
| `get_current_ucs` | 获取当前 UCS 名称 |
| `create_layout` | 创建布局 |
| `set_layout` | 切换布局 |
| `list_layouts` | 列出所有布局 |
| `delete_layout` | 删除布局 |
| `get_current_layout` | 获取当前布局 |
| `rename_layout` | 重命名布局 |

### 查询与测量 (5)

| 工具 | 说明 |
|------|------|
| `measure_distance` | 测量两点距离 |
| `measure_area` | 测量多边形面积 |
| `get_3d_solid_info` | 获取 3D 实体信息 |
| `list_groups` | 列出所有组 |
| `get_group_entities` | 获取组内实体 |

### 组操作 (4)

| 工具 | 说明 |
|------|------|
| `create_group` | 创建组 |
| `delete_group` | 删除组 |
| `list_groups` | 列出所有组 |
| `get_group_entities` | 获取组内实体句柄 |

### 批量操作 (14)

| 工具 | 说明 |
|------|------|
| `batch_copy` | 批量复制实体到指定偏移 |
| `batch_move` | 批量移动到指定图层 |
| `batch_delete` | 批量删除实体 |
| `batch_rename` | 批量重命名实体 |
| `batch_set_color` | 批量设置颜色 |
| `batch_set_layer` | 批量设置图层 |
| `batch_set_linetype` | 批量设置线型 |
| `batch_explode` | 批量炸开 |
| `batch_mirror` | 批量镜像 |
| `batch_offset` | 批量偏移 |
| `batch_rotate` | 批量旋转 |
| `batch_scale` | 批量缩放 |
| `batch_match_properties` | 批量匹配属性（格式刷） |
| `batch_create_group` | 批量创建组 |
| `batch_add_to_group` | 批量添加到组 |

### 3D 建模 (20)

| 工具 | 说明 |
|------|------|
| `create_box` | 创建立方体 |
| `create_sphere` | 创建球体 |
| `create_cylinder` | 创建圆柱体 |
| `create_cone` | 创建圆锥体 |
| `create_torus` | 创建圆环体 |
| `create_wedge` | 创建楔体 |
| `create_3d_face` | 创建 3D 面 |
| `create_3d_polyline` | 创建 3D 多段线 |
| `create_mesh` | 创建网格 |
| `extrude_solid` | 拉伸成实体 |
| `revolve_solid` | 旋转成实体 |
| `create_region` | 创建面域 |
| `boolean_union` | 并集 |
| `boolean_subtract` | 差集 |
| `boolean_intersect` | 交集 |
| `slice_solid` | 剖切实体 |
| `create_loft_surface` | 创建放样曲面 |
| `thicken_surface` | 曲面加厚 |
| `offset_surface` | 曲面偏移 |
| `convert_to_cloud_line` | 转为修订云线 |
| `create_cloud_line` | 创建修订云线 |

### 约束 (4)

| 工具 | 说明 |
|------|------|
| `add_geom_constraint` | 添加几何约束（平行/垂直/相切/共线/同心/固定/对称/相等等） |
| `add_dim_constraint` | 添加标注约束（水平/垂直/对齐/半径/直径/角度） |
| `del_constraint` | 删除实体上所有约束 |
| `list_constraints` | 列出所有约束 |

### 扩展数据 Xdata (9)

| 工具 | 说明 |
|------|------|
| `get_xdata` | 获取实体扩展数据 |
| `set_xdata` | 设置实体扩展数据 |
| `delete_xdata` | 删除扩展数据 |
| `list_xdata_apps` | 列出所有注册的扩展数据应用名 |
| `get_all_entity_xdata` | 获取所有扩展数据 |
| `copy_xdata` | 复制扩展数据到另一实体 |
| `search_by_xdata` | 按扩展数据搜索实体 |
| `export_xdata_to_file` | 导出扩展数据到 JSON |
| `import_xdata_from_file` | 从 JSON 导入扩展数据 |

### PDF/底图 (14)

| 工具 | 说明 |
|------|------|
| `attach_pdf` | 附着 PDF 底图 |
| `detach_pdf` | 拆离 PDF 底图 |
| `reload_pdf` | 重载 PDF 底图 |
| `list_attached_pdfs` | 列出已附着的 PDF |
| `get_pdf_info` | 获取 PDF 底图信息 |
| `batch_attach_pdfs` | 批量附着 PDF |
| `create_dgn_underlay` | 附着 DGN 底图 |
| `create_dwf_underlay` | 附着 DWF 底图 |
| `create_hyperlink` | 创建超链接 |
| `remove_hyperlink` | 删除超链接 |

### 外部参照 Xref (14)

| 工具 | 说明 |
|------|------|
| `attach_xref` | 附着外部参照 |
| `detach_xref` | 拆离外部参照 |
| `reload_xref` | 重载外部参照 |
| `unload_xref` | 卸载外部参照 |
| `list_xrefs` | 列出所有外部参照 |
| `bind_xref` | 绑定外部参照 |
| `clip_xref` | 裁剪外部参照 |
| `path_xref` | 修改外部参照路径 |
| `xref_notifications` | 配置/查询外部参照变更通知 |
| `xref_compare` | 比较外部参照 |
| `xref_convert_to_block` | 外部参照转为块 |
| `xref_demote` | 嵌套参照降级 |
| `xref_path_relative` | 批量转换路径为相对路径 |

### 图纸集 (18)

| 工具 | 说明 |
|------|------|
| `create_sheet_set` | 创建图纸集 |
| `open_sheet_set` | 打开图纸集文件 |
| `list_sheet_sets` | 列出所有图纸集 |
| `add_sheet` | 添加图纸 |
| `list_sheets` | 列出图纸 |
| `delete_sheet` | 删除图纸 |
| `reorder_sheet` | 重新排序图纸 |
| `create_subset` | 创建子集 |
| `list_subsets` | 列出子集 |
| `set_sheet_property` | 设置图纸属性 |
| `get_sheet_set_property` | 获取图纸集属性 |
| `publish_sheet_set` | 发布图纸集 |
| `create_sheet_set_archive` | 归档图纸集 |
| `sheet_set_publish_options` | 发布选项配置 |
| `sheet_set_transmit` | eTransmit 打包 |
| `sheet_set_compare` | 比较图纸集 |
| `sheet_list_views` | 列出图纸视图 |
| `sheet_import_layouts` | 从 DWG 导入布局 |

### 打印 (8)

| 工具 | 说明 |
|------|------|
| `plot_to_pdf` | 打印到 PDF |
| `plot_to_printer` | 打印到打印机 |
| `save_pdf_layout` | 布局另存为 PDF |
| `publish_layouts` | 批量发布布局到 PDF |
| `batch_plot_wizard` | 批量打印向导 |
| `plot_device_management` | 打印设备管理 |
| `plot_log` | 查询打印历史 |
| `plot_from_file_list` | 从文件列表批量打印 |

### 管道 Pipeline (5)

| 工具 | 说明 |
|------|------|
| `pipeline_execute` | 执行管道链（多步工具顺序执行） |
| `pipeline_save` | 保存管道定义 |
| `pipeline_list` | 列出已保存管道 |
| `pipeline_run` | 运行已保存管道 |
| `pipeline_delete` | 删除管道 |

### 触发器 Watch (5)

| 工具 | 说明 |
|------|------|
| `watch_register` | 注册 CAD 变更触发器 |
| `watch_remove` | 移除触发器 |
| `watch_list` | 列出所有触发器 |
| `watch_wait` | 等待触发器触发 |
| `watch_create_and_wait` | 注册并等待（合并操作） |

### Webhook (4)

| 工具 | 说明 |
|------|------|
| `webhook_register` | 注册 webhook |
| `webhook_list` | 列出所有 webhook |
| `webhook_remove` | 移除 webhook |
| `webhook_log` | 获取 webhook 日志 |

### 流式读取 (4)

| 工具 | 说明 |
|------|------|
| `stream_entities` | 分页流式读取实体数据 |
| `stream_text` | 分页流式读取文字内容 |
| `stream_block_refs` | 分页流式读取块参照 |
| `combine_text` | 碎片文本按位置组合为完整段落 |

### 外部数据 (4)

| 工具 | 说明 |
|------|------|
| `external_db_query` | 查询外部数据源 (CSV/JSON) |
| `import_external_data` | 从外部数据源导入实体到 CAD |
| `export_to_external` | 导出 CAD 实体到外部文件 |
| `list_data_sources` | 列出可用数据源 |

### 沙箱 (3)

| 工具 | 说明 |
|------|------|
| `sandbox_validate` | 验证 Lisp 代码安全规则 |
| `sandbox_allowlist_add` | 添加规则到会话白名单 |
| `sandbox_allowlist_clear` | 清除会话白名单 |

### 审计日志 (2)

| 工具 | 说明 |
|------|------|
| `audit_log_query` | 查询审计日志（支持分页和筛选） |
| `audit_log_stats` | 获取审计日志统计 |

### 规范标准 (16)

| 工具 | 说明 | 参数 |
|------|------|------|
| `check_drawing_standards` | 检查图纸是否符合制图规范 | `industry`, `categories`, `strict` |
| `apply_standards_template` | 应用行业制图规范模板 | `industry` (必填), `overwrite` |
| `list_standards` | 列出所有可用行业规范 | `industry` (可选) |
| `load_standards` | 加载指定行业规范内容 | `industry` (必填) |
| `save_standards` | 保存自定义规范文件 | `name`, `standards` (必填), `overwrite` |
| `compare_standards` | 比较两个规范文件差异 | `standard1`, `standard2` (必填) |
| `check_layer_naming` | 检查图层命名规范 | `industry` |
| `check_color_conformity` | 检查颜色合规性 | `industry` |
| `check_linetype_conformity` | 检查线型合规性 | `industry` |
| `check_lineweight_conformity` | 检查线宽合规性 | `industry` |
| `check_text_style_conformity` | 检查文字样式合规性 | `industry` |
| `check_dim_style_conformity` | 检查标注样式合规性 | `industry` |
| `check_file_naming` | 检查文件命名规范 | — |
| `generate_compliance_report` | 生成规范合规报告 | `industry`, `format`, `outputFile` |

**支持行业**：通用、建筑、结构、机械、电气、暖通给排水、土木道桥、测绘、室内装饰、景观园林

### CAD 连接池 (7)

| 工具 | 说明 |
|------|------|
| `cad_pool_discover` | 发现并连接所有运行的 CAD 实例（ROT 枚举） |
| `cad_pool_list` | 列出所有已连接实例及状态 |
| `cad_pool_connect` | 连接到指定 CAD 平台并加入连接池（支持 PID 指定进程） |
| `cad_pool_disconnect` | 断开并移除指定 CAD 实例 |
| `cad_pool_switch` | 切换活动 CAD 实例 |
| `cad_pool_health` | 检查所有实例健康状态 |
| `cad_pool_stats` | 获取连接池统计 |

### 会话管理 (2)

| 工具 | 说明 |
|------|------|
| `session_pin_instance` | 将会话绑定到指定 CAD 实例，后续调用自动路由到该实例 |
| `session_unpin_instance` | 取消会话的实例绑定，恢复使用连接池的活动实例 |

### 批量并发任务 (1)

| 工具 | 说明 |
|------|------|
| `batch_concurrent_tasks` | 跨多个 CAD 实例并发执行不同的工具任务 |

---

## MCP 资源

### 静态资源 (13)

| URI | 名称 | 说明 | 可订阅 |
|-----|------|------|--------|
| `atlisp://cad/info` | CAD Info | CAD 连接信息 | ✓ |
| `atlisp://dwg/entities` | Entities | 实体列表/统计 | ✓ |
| `atlisp://dwg/text-content` | Text Content | 文字内容与位置 | ✓ |
| `atlisp://dwg/text-combined` | Combined Text | 合并后的段落文本 | ✓ |
| `atlisp://dwg/name` | DWG Name | 当前文件名 | ✓ |
| `atlisp://dwg/path` | DWG Path | 文件完整路径 | ✓ |
| `atlisp://dwg/block-refs` | Block References | 块参照与属性 | ✓ |
| `atlisp://dwg/tbl` | Tables | CAD 表数据 | ✓ |
| `atlisp://cad/dwgs` | DWG List | 所有打开的 DWG | ✓ |
| `atlisp://packages` | Packages | 已安装包列表 | ✓ |
| `atlisp://platforms` | Platforms | 支持的平台 | ✗ |
| `atlisp://standards/drafting` | Drafting | CAD 制图规范 | ✗ |
| `atlisp://standards/coding` | Coding | @lisp 编码规范 | ✗ |
| `atlisp://standards/architectural` | Architectural | 建筑行业规范 | ✗ |
| `atlisp://standards/structural` | Structural | 结构行业规范 | ✗ |
| `atlisp://standards/mechanical` | Mechanical | 机械行业规范 | ✗ |
| `atlisp://standards/electrical` | Electrical | 电气行业规范 | ✗ |
| `atlisp://standards/hvac` | HVAC | 暖通给排水行业规范 | ✗ |
| `atlisp://standards/civil` | Civil | 土木道桥行业规范 | ✗ |
| `atlisp://standards/surveying` | Surveying | 测绘行业规范 | ✗ |
| `atlisp://standards/interior` | Interior | 室内装饰行业规范 | ✗ |
| `atlisp://standards/landscape` | Landscape | 景观园林行业规范 | ✗ |

### 资源模板

| URI 模板 | 说明 |
|----------|------|
| `atlisp://dwg/entity/{handle}` | 按句柄查实体详情 |
| `atlisp://dwg/entities?type={type}&layer={layer}&bbox={bbox}` | 过滤实体 |
| `atlisp://dwg/block-refs/{blockName}` | 按块名过滤块参照 |
| `atlisp://dwg/tbl/{table}` | 查询表（layer/block/textstyle/dimstyle/linetype/ucs/view/viewport/regapp/plotstyle） |
| `atlisp://dwg/text-content?bbox={bbox}&layer={layer}&offset={offset}&limit={limit}` | 分页文字 |
| `atlisp://packages?search={query}` | 搜索包 |

### MCP 根目录 (Roots)

| URI | 说明 |
|-----|------|
| `file://~/.atlisp` | @lisp 工作目录 |
| `file://~/.atlisp/projects` | 项目目录 |

---

## MCP Prompts (19)

| Prompt | 功能 | 参数 |
|--------|------|------|
| `excel-report` | Excel 报表导出 | visible, savePath |
| `geometry-calc` | 几何计算 | action, points |
| `generate-dimension` | 生成尺寸标注 | style |
| `analyze-drawing` | 分析当前图纸统计 | — |
| `coding-conventions` | AutoLISP 编码规范 | — |
| `string-process` | 字符串处理 | action, input |
| `json-exchange` | JSON 数据交换 | action, data |
| `color-convert` | 颜色转换 | action, value |
| `pickset-filter` | 选择集操作 | action, dxfType, layerName |
| `text-process` | 文本处理 | action, markdown |
| `curve-analysis` | 曲线分析 | action, distance |
| `manage-blocks` | 块操作 | action, blockName |
| `manage-layers` | 图层管理 | action, layers |
| `export-entities` | 导出实体统计 | format |
| `batch-draw-lines` | 批量画线段 | count, length |
| `draw-residential` | 农村民居平面图 | width, depth, rooms |
| `draw-floor-plan` | 建筑楼层平面图 | floor, scale |
| `standards-check` | 检查图纸规范 | industry, categories, strict |
| `standards-apply` | 应用规范模板 | industry (必填), overwrite |
| `standards-report` | 生成合规报告 | industry, format, outputFile |

---

## HTTP API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/health` | 健康检查 |
| `GET` | `/metrics` | Prometheus 指标 |
| `POST` | `/mcp` | MCP JSON-RPC |
| `GET` | `/mcp` | MCP 信息 |
| `GET` | `/sse` | SSE 长连接端点 |
| `POST` | `/message` | SSE 消息发送 |
| `WS` | `/ws` | WebSocket 端点 |
| `POST` | `/config/reload` | 热重载配置 |
| `GET` | `/rate-limit/status` | 速率限制状态 |
| `POST` | `/rate-limit/reset` | 重置速率限制 |
| `GET` | `/api/docs` | API 文档页面 |
| `GET` | `/debug` | 调试面板 |
| `GET` | `/playground` | 工具游乐场 |

---

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `8110` | HTTP 端口 |
| `HOST` | `0.0.0.0` | HTTP 监听地址 |
| `TRANSPORT` | `http` | 传输模式: http/stdio/ws |
| `MCP_API_KEY` | — | API Key 认证 |
| `ENABLE_SSE` | `true` | 启用 SSE |
| `MESSAGE_TIMEOUT` | `60000` | 消息超时 (ms) |
| `HEARTBEAT_INTERVAL` | `30000` | 心跳间隔 (ms) |
| `BUSY_RETRIES` | `10` | CAD 忙重试次数 |
| `BUSY_DELAY` | `500` | 重试延迟 (ms) |
| `ENABLE_CORS` | `true` | 启用 CORS |
| `CORS_ORIGIN` | `localhost,*.atlisp.cn,atlisp.cn` | CORS 允许源，逗号分隔；`*` 表示全放行，**只写 host**（协议与端口会被忽略，见 `originMatches`），`*.` 开头按子域后缀匹配 |
| `RATE_LIMIT_WINDOW` | `60000` | 速率限制窗口 (ms) |
| `RATE_LIMIT_MAX` | `100` | 窗口内最大请求数 |
| `RESOURCE_CACHE_TTL` | `5000` | 资源缓存 TTL (ms) |
| `FUNCTION_LIB_CACHE_TTL` | `300000` | 函数库缓存 TTL (ms) |
| `DEBUG` | `false` | 调试模式 |
| `DEBUG_FILE` | — | 调试日志文件路径 |
| `FUNCTION_LIB_URL` | `http://s3.atlisp.cn/json/functions.json` | 函数库 URL |
| `CONFIG_FILE` | `~/.atlisp/atlisp.config.json` | 配置文件路径 |
| `METRICS_ENABLED` | `true` | 启用 /metrics 端点 |
| `REQUEST_LOG_ENABLED` | `true` | 启用请求日志 |
| `ERROR_REPORT_ENABLED` | `true` | 将 ERROR 日志上报到 atlisp.cn（用于改进项目，可用 false/0/off 关闭） |
| `ERROR_REPORT_URL` | `https://atlisp.cn/api/error/report` | 错误上报端点 |
| `SSL_KEY_PATH` | — | SSL 私钥文件 |
| `SSL_CERT_PATH` | — | SSL 证书文件 |
| `LLM_API_KEY` | — | LLM API Key (sampling) |
| `LLM_API_URL` | `https://api.openai.com/v1/chat/completions` | LLM API URL |
| `LLM_MODEL` | `gpt-4o-mini` | LLM 模型 |
| `LLM_MAX_TOKENS` | `4096` | LLM 最大 tokens |
| `LLM_TEMPERATURE` | `0.7` | LLM 温度 |
| `API_KEY_RATE_LIMIT` | `1000` | API Key 速率限制 |

---

## 命令行参数

| 参数 | 说明 |
|------|------|
| `--port <number>` | HTTP 端口 |
| `--host <address>` | HTTP 主机地址 |
| `--transport <mode>` | 传输模式 (http/stdio/ws) |
| `--stdio` | 等价于 `--transport stdio` |
| `--ws` | 等价于 `--transport ws` |
| `--config <path>` | 配置文件路径 |
| `--ssl-key <path>` | SSL 私钥文件 |
| `--ssl-cert <path>` | SSL 证书文件 |
| `--install-autostart` | 注册用户登录后自动启动 HTTP 服务 |
| `--uninstall-autostart` | 移除自动启动注册 |
| `--autostart-status` | 查询自动启动是否已安装 |

---

## 配置文件

配置文件位于 `~/.atlisp/atlisp.config.json`，支持以下字段：

```json
{
  "port": 8110,
  "host": "0.0.0.0",
  "transport": "http",
  "apiKey": "your-api-key",
  "enableSse": true,
  "messageTimeout": 60000,
  "heartbeatInterval": 30000,
  "enableCors": true,
  "corsOrigin": "*",
  "rateLimitWindow": 60000,
  "rateLimitMax": 100,
  "debug": false,
  "metricsEnabled": true,
  "requestLogEnabled": true,
  "errorReportEnabled": true,
  "errorReportUrl": "https://atlisp.cn/api/error/report",
  "maxPoolSize": 3,
  "apiKeys": [
    { "key": "key1", "limit": 100, "name": "user1", "role": "admin" }
  ],
  "sslKey": "/path/to/key.pem",
  "sslCert": "/path/to/cert.pem",
  "llmApiKey": "sk-xxx",
  "llmApiUrl": "https://api.openai.com/v1/chat/completions",
  "llmModel": "gpt-4o-mini",
  "llmMaxTokens": 4096,
  "llmTemperature": 0.7
}
```

配置变更会自动热重载。

> **错误上报**：`logger.error()` 的条目会异步 POST 到 `ERROR_REPORT_URL`（默认 `https://atlisp.cn/api/error/report`），
> 用于聚类分析、改进项目。同一错误 60 秒内只上报一次；上报失败只写 stderr，不会影响主流程。
> 负载仅包含错误文本、客户端标识与运行上下文（版本/平台/内存/CAD 连接状态），不含图纸内容。
> 如需完全关闭：设置环境变量 `ERROR_REPORT_ENABLED=false`，或配置文件 `"errorReportEnabled": false`。

---

## 架构与开发

架构图、项目结构、开发指南请参见 [`DEV.md`](DEV.md)。

---

## 测试验证

MCP Server 已通过多平台真机测试，所有核心功能正常：

| CAD 平台 | 版本 | 测试项 | 通过率 |
|----------|------|--------|--------|
| AutoCAD | 24.1s | 20/20 | **100%** |
| ZWCAD | 2026 | 20/20 | **100%** |
| GStarCAD | 3.05 | 12/20 | 60% |

### 测试覆盖

| 测试类别 | 测试项 | AutoCAD | ZWCAD | GStarCAD |
|---------|--------|---------|-------|----------|
| 系统变量 | ACADVER/GRIDMODE/SNAPMODE | ✓ | ✓ | ✓ |
| 绘图 | 直线/圆/矩形/多段线 | ✓ | ✓ | ✓ |
| 编辑 | 复制/移动/旋转/缩放/镜像 | ✓ | ✓ | ⚠️ |
| 图层 | 创建/切换/列表 | ✓ | ✓ | ⚠️ |
| 文字 | TEXT/MTEXT | ✓ | ✓ | ⚠️ |
| 查询 | ssget/entget/tblnext | ✓ | ✓ | ✓ |
| VL函数 | princ-to-string/filename-mktemp | ✓ | ✓ | ✓ |

### 压力测试

| CAD | 并发数 | OPS | 成功率 |
|-----|--------|-----|--------|
| AutoCAD | 5 | 9.0/s | 44% (去重机制) |
| ZWCAD | 5 | 4.1/s | 49% (去重机制) |
| GStarCAD | 5 | 4.6/s | 48% (去重机制) |

**单元测试：865 通过, 2 跳过**

---

## 故障排除

| 问题 | 解决方案 |
|------|---------|
| 连接失败 | 确保 CAD 已启动并启用 COM 接口 |
| 工具调用超时 | CAD 可能繁忙，稍后重试；增大 `MESSAGE_TIMEOUT` |
| 中文乱码 | 使用 `encoding: gbk` 参数或用 `vl-prin1-to-string` 处理 |
| 括号错误 | MCP Server 会自动检查并提示 |
| CAD 未自动启动 | 检查 COM 权限，以管理员身份运行 |
| 端口被占用 | 使用 `--port` 指定其他端口；同端口多实例冲突时，结束原进程或换端口 |
| 全局命令找不到 | 检查 npm 全局安装路径是否在 PATH 中 |

---

## 许可证

ISC
