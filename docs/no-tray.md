# 不装托盘运行（no-tray 模式）

`AtlispTray.exe` 只是**图形化管理器**：启动/停止服务、装 Node、查更新、看日志。
服务本身（`atlisp-mcp`）不依赖托盘，可以完全独立运行。不需要常驻图标时，用下面两种方式之一。

---

## 方式一：MCP 客户端直接拉起（stdio，无常驻进程）

Claude Desktop / VSCode / opencode 等客户端自己 spawn 服务，退出客户端即结束：

```json
{
  "mcpServers": {
    "atlisp": {
      "command": "atlisp-mcp",
      "args": ["--stdio"]
    }
  }
}
```

适合：只用 AI 客户端、不需要 HTTP 端口、不需要开机自启。

---

## 方式二：开机自启 HTTP 服务（推荐替代托盘）

```bash
atlisp-mcp --install-autostart     # 注册登录自启
atlisp-mcp --autostart-status      # 查看状态（含完整命令行）
atlisp-mcp --uninstall-autostart   # 取消
```

注册内容因平台而异：

| 平台 | 机制 | 承载进程 |
|---|---|---|
| Windows 10 1809+ | `HKCU\...\Run` | `conhost.exe --headless` + `node.exe`（都是微软/OpenJS 签名的组件） |
| Windows 7/8/8.1 | `HKCU\...\Run` | `powershell -WindowStyle Hidden`（老系统没有 `--headless`） |
| macOS | `~/Library/LaunchAgents/com.atlisp.mcp.plist` | `node` |
| Linux | `~/.config/autostart/atlisp-mcp.desktop` | `node` |

**没有自建 exe**，所以不涉及代码签名，也不会出现「未签名 PE 被杀软误报」的问题。

登录后服务在后台监听 `http://127.0.0.1:8110`，管理入口：

| 页面 | 地址 |
|---|---|
| 调试面板（状态/工具调用/日志） | `http://127.0.0.1:8110/debug` |
| API 文档 | `http://127.0.0.1:8110/api/docs` |
| Playground | `http://127.0.0.1:8110/playground` |
| 健康检查 | `http://127.0.0.1:8110/health` |

常用运维命令：

```bash
curl http://127.0.0.1:8110/health
atlisp-mcp --version
curl -X POST http://127.0.0.1:8110/config/reload    # 改完配置后热重载
```

---

## 和托盘的关系：二选一

托盘默认也会把自己加进开机自启（`atlisp-mcp-tray`）。两边同时开会抢同一个端口：

- 想**只留服务自启** → 托盘右键取消「随 Windows 启动」
- 想**只留托盘** → `atlisp-mcp --uninstall-autostart`

`atlisp-mcp --autostart-status` 会提示 `托盘自启已安装`；`--install-autostart` 在检测到托盘自启时也会给出同样提示。

托盘启动时如果 `/health` 已经正常（服务被自启拉起了），不会再启动第二个实例；但两者同时注册仍可能在开机瞬间竞争端口，建议二选一。

---

## 需要托盘才能做的事

以下功能只在托盘里，no-tray 模式下需要手工处理：

| 功能 | 替代做法 |
|---|---|
| 自动安装 Node.js | `winget install OpenJS.NodeJS.LTS` |
| 自动安装/升级 `@atlisp/mcp` | `npm i -g @atlisp/mcp@latest` |
| 图纸知识库启停/升级 | `pip install -U atlisp-dwg-kb`，手动运行 `atlisp-dwg-kb serve` |
| 异常退出自动拉起 | 用任务计划（`schtasks /sc onfailure`）或 Windows 服务包一层；普通用户场景一般不需要 |
| 更新提示 | `npm outdated -g @atlisp/mcp` |

想用图形界面时再临时运行 `npx -p @atlisp/mcp atlisp-tray`，不用长期常驻。

---

## 排错

| 现象 | 处理 |
|---|---|
| 登录后端口没起来 | `atlisp-mcp --autostart-status` 看命令；确认 `node.exe` 路径仍然存在（换 Node 安装位置后要重新 `--install-autostart`） |
| 端口被占用 | 换 `--port`，或改 `~/.atlisp/atlisp.config.json` 的 `port` 后重新注册自启 |
| 改了 npm 全局路径 | 重新执行 `atlisp-mcp --install-autostart`（注册的是绝对路径） |
| macOS 自启不生效 | `launchctl list \| grep com.atlisp.mcp`，必要时 `launchctl unload/load` |
| 想彻底清掉 | 先 `--uninstall-autostart`，再删 `%LOCALAPPDATA%\Programs\atlisp-mcp`（或 `~/.config/autostart/atlisp-mcp.desktop`） |
