import path from 'path';
import fs from 'fs';
import http from 'http';
import https from 'https';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { version } = require(path.join(__dirname, '..', 'package.json'));

import express from 'express';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { cad, onDocumentChanged } from './cad.js';
import {  SERVER_NAME } from './constants.js';
import { log, error as logError, closeLog, setLoggingNotify } from './logger.js';
import {  clearCache, RESOURCES } from './handlers/resource-handlers.js';
import * as subMgr from './subscription-manager.js';
import { sessionManager } from './subscription-manager.js';


import config from './config.js';
import { setupRoutes } from './routes.js';
import { mcpContext, removeSessionServer, sessionServers, createStdioServer } from './mcp-server-state.js';
import { tools, handleToolCall } from './mcp-tools.js';
import { createWebSocketServer } from './websocket-transport.js';
import { loadPlugins, initPlugins, onPluginChange, startPluginWatcher, stopPluginWatcher, getPlugins } from './plugin-loader.js';
import { registerTool } from './tool-registry.js';
import { broadcastToolListChanged, broadcastResourcesListChanged, broadcastPromptsListChanged, scheduleResourceUpdated } from './mcp-server-state.js';
import { startHealthReporter, stopHealthReporter } from './health-reporter.js';

import { initStreamableHttpServer, setupStreamableHttpRoutes, closeStreamableHttpServer } from './streamable-http.js';
import { acquirePortLock, releasePortLock } from './lockfile.js';
import { installAutostart, uninstallAutostart, autostartStatus } from './autostart.js';
import peerManager from './peer-manager.js';
import { isAuthConfigured } from './auth.js';

export { tools, handleToolCall } from './mcp-tools.js';
export { loadAtlibFunctionLib } from './handlers/function-handlers.js';

const isMcpScript = process.argv[1]?.includes('atlisp-mcp');
if (isMcpScript) {
    const cliArgs = process.argv.slice(2);

    if (cliArgs.includes('--mem') || cliArgs.includes('--mem-once') || cliArgs.includes('--mem-interval')) {
        const idx = cliArgs.indexOf('--mem-interval');
        const intervalSec = idx >= 0 ? Number(cliArgs[idx + 1]) : 2;
        if (!Number.isFinite(intervalSec) || intervalSec <= 0) {
            console.error('--mem-interval 需要一个正数（秒）');
            process.exit(1);
        }
        const { runMemMonitor } = await import('./mem-monitor.js');
        await runMemMonitor({
            host: process.env.HOST || config.host,
            port: Number(process.env.PORT || config.port),
            apiKey: process.env.MCP_API_KEY || config.apiKey || '',
            ssl: Boolean(config.sslKey && config.sslCert),
            intervalSec,
            intervalMs: intervalSec * 1000,
            once: cliArgs.includes('--mem-once'),
        });
        process.exit(0);
    }

    for (let i = 0; i < cliArgs.length; i++) {
        const arg = cliArgs[i];
        if (arg === '--version' || arg === '-v') {
            console.log(`atlisp-mcp v${version}`);
            process.exit(0);
        } else if (arg === '--help' || arg === '-h') {
            console.log(`
@lisp MCP Server v${version}

Usage: atlisp-mcp [options]

Options:
  -v, --version                Show version number
  -h, --help                   Show this help message
  --transport <type>           Transport: http, stdio, ws (default: http)
  --stdio                      Shorthand for --transport stdio
  --ws                         Shorthand for --transport ws
  --port <port>                HTTP port (default: 8110)
  --host <host>                HTTP host (default: 0.0.0.0)
  --config <path>              Path to config file (default: ~/.atlisp/atlisp.config.json)
  --ssl-key <path>             SSL key file path (enables HTTPS)
  --ssl-cert <path>            SSL certificate file path
  --debug                      Enable debug mode
  --metrics-enabled            Enable /metrics endpoint (true/false)
  --lint-preset <type>         Lint preset: recommended, strict, relaxed
  --lint-config <path>         Path to atlisp-lint.json config file
  --lint-level <level>         Lint level: error, warn, off
  --no-lint                    Disable lint pre-check for eval_lisp
  --lint-off                   Same as --no-lint
  --api-key <key>              API key for authentication
  --client-id <id>             Client identifier for remote health report
  --security-level <type>      Security level: strict, standard, relaxed (default: relaxed)
  --install-autostart          Register server to auto-start after user login
  --uninstall-autostart        Remove auto-start registration
  --autostart-status           Check if auto-start is installed
  --mem                        Terminal memory monitor (polls /health/full, Ctrl+C to exit)
  --mem-interval <sec>         Memory monitor refresh interval (default: 2)
  --mem-once                   Memory monitor single snapshot then exit

Environment Variables:
  TRANSPORT             Transport mode (http/stdio/ws)
  PORT                  HTTP port (default: 8110)
  HOST                  HTTP host (default: 0.0.0.0)
  MCP_API_KEY           API key for authentication
  ENABLE_SSE            Enable SSE (true/false, default: true)
  DEBUG                 Enable debug logging (true/false)
  DEBUG_FILE            Debug log file path
  METRICS_ENABLED       Enable /metrics endpoint (true/false, default: true)
  SSL_KEY_PATH          SSL key file path
  SSL_CERT_PATH         SSL certificate file path
  SECURITY_LEVEL        Security level: strict, standard, relaxed (default: relaxed)
  CONFIG_FILE           Path to config file
  LINT_PRESET           Lint preset (recommended/strict/relaxed)
  LINT_CONFIG_PATH      Path to atlisp-lint.json
  LINT_LEVEL            Lint level (error/warn/off)
  NO_LINT               Disable lint (true/false)
  REQUEST_LOG_ENABLED   Enable request logging (true/false, default: true)
  CORS_ORIGIN           CORS origin (default: https://atlisp.cn)
  CLIENT_ID             Client identifier for remote health report
  RATE_LIMIT_WINDOW     Rate limit window in ms (default: 60000)
  RATE_LIMIT_MAX        Max requests per window (default: 100)

Examples:
  atlisp-mcp                           Start HTTP server on port 8110
  atlisp-mcp --port 3000               Start HTTP server on port 3000
  atlisp-mcp --stdio                   Start in stdio mode for MCP clients
  atlisp-mcp --mem                     Watch server memory usage in the terminal
  atlisp-mcp --mem --mem-once          Print one memory snapshot and exit
  atlisp-mcp --config ~/my.json        Use custom config file
  atlisp-mcp --debug                   Enable debug output
  atlisp-mcp --ssl-key key.pem --ssl-cert cert.pem  Start HTTPS server
  TRANSPORT=stdio atlisp-mcp           Via env var for stdio mode
  TRANSPORT=ws atlisp-mcp              Via env var for WebSocket mode

API Endpoints:
  GET  /health         Health check
  GET  /metrics        Prometheus metrics (if enabled)
  POST /mcp            MCP JSON-RPC endpoint
  GET  /sse            Server-Sent Events endpoint
  POST /message        SSE message endpoint
  WS   /ws             WebSocket endpoint
  POST /config/reload  Reload configuration

For more info: https://atlisp.cn
`);
            process.exit(0);
        } else if (arg === '--transport' && cliArgs[i + 1]) {
            process.env.TRANSPORT = cliArgs[++i];
        } else if (arg === '--stdio') {
            process.env.TRANSPORT = 'stdio';
        } else if (arg === '--ws') {
            process.env.TRANSPORT = 'ws';
        } else if (arg === '--port' && cliArgs[i + 1]) {
            process.env.PORT = cliArgs[++i];
        } else if (arg === '--host' && cliArgs[i + 1]) {
            process.env.HOST = cliArgs[++i];
        } else if (arg === '--config' && cliArgs[i + 1]) {
            process.env.CONFIG_FILE = cliArgs[++i];
        } else if (arg === '--debug') {
            process.env.DEBUG = 'true';
        } else if (arg === '--lint-preset' && cliArgs[i + 1]) {
            process.env.LINT_PRESET = cliArgs[++i];
        } else if (arg === '--lint-config' && cliArgs[i + 1]) {
            process.env.LINT_CONFIG_PATH = cliArgs[++i];
        } else if (arg === '--lint-level' && cliArgs[i + 1]) {
            process.env.LINT_LEVEL = cliArgs[++i];
        } else if (arg === '--no-lint' || arg === '--lint-off') {
            process.env.NO_LINT = 'true';
        } else if (arg === '--security-level' && cliArgs[i + 1]) {
            process.env.SECURITY_LEVEL = cliArgs[++i];
        } else if (arg === '--ssl-key' && cliArgs[i + 1]) {
            process.env.SSL_KEY_PATH = cliArgs[++i];
        } else if (arg === '--ssl-cert' && cliArgs[i + 1]) {
            process.env.SSL_CERT_PATH = cliArgs[++i];
        } else if (arg === '--api-key' && cliArgs[i + 1]) {
            process.env.MCP_API_KEY = cliArgs[++i];
        } else if (arg === '--client-id' && cliArgs[i + 1]) {
            process.env.CLIENT_ID = cliArgs[++i];
        } else if (arg === '--metrics-enabled' && cliArgs[i + 1]) {
            process.env.METRICS_ENABLED = cliArgs[++i];
        } else if (arg === '--install-autostart') {
            installAutostart();
            process.exit(0);
        } else if (arg === '--uninstall-autostart') {
            uninstallAutostart();
            process.exit(0);
        } else if (arg === '--autostart-status') {
            const s = autostartStatus();
            if (s.installed) {
                console.error(`自动启动: 已安装`);
                if (s.command) console.error(`  命令: ${s.command}`);
            } else {
                console.error(`自动启动: 未安装`);
            }
            process.exit(0);
        }
    }
}

if (config.apiKey) log('API Key authentication enabled');

const { setLocale } = await import('./i18n.js');
setLocale(config.locale || 'zh-CN');

if (config.autoConnect) {
    log('Attempting to connect to CAD on startup...');
    const { ensureCadConnected } = await import('./handler-utils.js');
    ensureCadConnected().then(() => {
        log(`Auto-connected to CAD: ${cad.getPlatform()} ${cad.getVersion()}`);
        console.error(`已自动连接到 CAD: ${cad.getPlatform()} ${cad.getVersion()}`);
    }).catch((e) => {
        log(`Auto-connect failed: ${e.message}`);
    });
}

export async function startServer() {
    const startTime = Date.now();
    const _memBefore = process.memoryUsage();

    console.error('\n========== @lisp MCP Server 启动 ==========');
    console.error(`版本: ${version}`);
    console.error(`Node.js: ${process.version}`);
    console.error(`平台: ${process.platform} ${process.arch}`);
    console.error(`PID: ${process.pid}`);
    console.error(`工作目录: ${process.cwd()}`);
    console.error('');

    // 加载插件
    console.error('[1/6] 加载插件...');
    await loadPlugins();
    initPlugins({ cad, config, log, registerTool, tools });
    const pluginCount = getPlugins().length;
    console.error(`  ✓ 已加载 ${pluginCount} 个插件`);

    // 启动 Peer 发现
    console.error('[2/6] 启动 Peer 发现...');
    peerManager.start();
    console.error(`  ✓ Peer 发现已启动 (端口: ${config.peerDiscovery?.port || 9811})`);

    // Watch for plugin file changes
    onPluginChange((type, name) => {
        log(`Plugin changed: ${type} ${name}`);
        broadcastToolListChanged();
        broadcastResourcesListChanged();
        broadcastPromptsListChanged();
    });
    startPluginWatcher();

    // Watch external prompt files for changes
    let promptsWatcher = null;
    try {
        const promptsDir = path.join(__dirname, '..', 'prompts');
        if (fs.existsSync(promptsDir)) {
            promptsWatcher = fs.watch(promptsDir, (eventType, filename) => {
                if (filename && filename.endsWith('.json')) {
                    log(`Prompt changed: ${filename}`);
                    broadcastPromptsListChanged();
                }
            });
            console.error('  ✓ Prompt 目录监听已启用');
        }
    } catch (e) {
        logError(`Failed to start prompt watcher: ${e.message}`);
    }

    // 显示配置信息
    console.error('\n[3/6] 配置信息:');
    console.error(`  传输模式: ${config.transport}`);
    console.error(`  端口: ${config.port}`);
    console.error(`  主机: ${config.host}`);
    console.error(`  安全级别: ${config.securityLevel || 'relaxed'}`);
    console.error(`  Lint 预设: ${config.lintPreset || 'recommended'}`);
    console.error(`  自动连接: ${config.autoConnect ? '是' : '否'}`);
    console.error(`  API Key: ${config.apiKey ? '已启用' : '未设置'}`);
    console.error(`  调试模式: ${process.env.DEBUG === 'true' || process.env.DEBUG === '1' ? '是' : '否'}`);

    // 显示工具信息
    console.error('\n[4/6] 工具注册:');
    console.error(`  ✓ 已注册 ${tools.length} 个工具`);

    // 显示资源信息
    console.error('\n[5/6] 资源列表:');
    console.error(`  ✓ ${Object.keys(RESOURCES).length} 个资源 URI`);

    if (config.transport === 'stdio') {
        const mcpServer = createStdioServer({ tools, handleToolCall });
        const transport = new StdioServerTransport();
        const sessionId = 'stdio-session';
        sessionManager.createSession(sessionId);
        await mcpContext.run({ sessionId }, async () => {
            await mcpServer.connect(transport);
        });
        console.error('\n[6/6] 服务器就绪:');
        console.error(`  ${SERVER_NAME} 运行在 stdio 模式`);

        subMgr.setNotify((uri, _data) => {
            mcpServer.sendResourceUpdated({ uri }).catch(err => {
                logError(`Failed to send resource update: ${err.message}`);
            });
        });
    } else {
        const app = express();

        // streamable-http 模式下由 setupStreamableHttpRoutes 注册 /mcp，避免被默认路由抢先匹配
        setupRoutes(app, { registerMcpRoutes: config.transport !== 'streamable-http' });
        setLoggingNotify((level, message) => {
            for (const [sid, { server }] of sessionServers) {
                server.sendLoggingMessage({ level, data: message }, sid).catch(() => {});
            }
        });

        subMgr.setNotify((uri, _data) => {
            scheduleResourceUpdated(uri);
            for (const session of sessionManager.listActive()) {
                sessionManager.sendToClient(session.clientId, 'resource_updated', { uri });
            }
        });

        if (config.transport === 'streamable-http') {
            await initStreamableHttpServer();
            setupStreamableHttpRoutes(app);
        }

        const useSsl = !!(config.sslKey && config.sslCert);
        let httpsServer;
        if (useSsl) {
            const sslOptions = {
                key: fs.readFileSync(config.sslKey, 'utf-8'),
                cert: fs.readFileSync(config.sslCert, 'utf-8'),
            };
            httpsServer = https.createServer(sslOptions, app);
            console.error('  ✓ SSL 已启用');
        }

        const rawServer = httpsServer || http.createServer(app);
        createWebSocketServer(rawServer);

        const isLoopbackHost = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(config.host);
        if (!isLoopbackHost && !isAuthConfigured(config)) {
            console.error('\n⚠ 安全警告: 未配置 API Key 却绑定到非回环地址 ' + config.host);
            console.error('  任何能访问该地址的网络客户端都可执行任意 CAD/LISP 操作。');
            console.error('  请设置 MCP_API_KEY，或使用 --host 127.0.0.1 仅限本机访问。\n');
        }

        const lock = acquirePortLock(config.port, config.host);
        if (!lock.ok) {
            console.error(`\n错误: 端口 ${config.port} 已被另一个 atlisp-mcp 实例占用`);
            console.error(`  PID: ${lock.pid}`);
            if (lock.started) console.error(`  启动时间: ${lock.started}`);
            console.error(`请选择其他端口 (--port) 或结束占用进程后重试。\n`);
            process.exit(1);
        }

        const httpServer = rawServer.listen(config.port, config.host, async () => {
            const proto = useSsl ? 'https' : 'http';
            const mode = config.transport === 'ws' ? 'WebSocket' : config.transport === 'streamable-http' ? 'Streamable HTTP' : '多会话';

            console.error('\n[6/6] 服务器就绪:');
            console.error(`  ✓ ${proto}://${config.host}:${config.port} (${mode}模式)`);
            console.error(`  ✓ PID: ${process.pid}`);
            console.error(`  ✓ 运行时间: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);

            // 显示内存使用情况
            const memAfter = process.memoryUsage();
            console.error('\n内存使用:');
            console.error(`  RSS: ${(memAfter.rss / 1024 / 1024).toFixed(1)} MB`);
            console.error(`  堆已用: ${(memAfter.heapUsed / 1024 / 1024).toFixed(1)} MB`);
            console.error(`  堆总计: ${(memAfter.heapTotal / 1024 / 1024).toFixed(1)} MB`);
            console.error(`  外部: ${(memAfter.external / 1024 / 1024).toFixed(1)} MB`);

            console.error('\n==========================================\n');

            startHealthReporter();
        });

        async function shutdown(signal) {
            console.error(`\n收到 ${signal}，正在优雅关闭...`);
            stopHealthReporter();
            stopPluginWatcher();
            peerManager.stop();
            if (promptsWatcher) { promptsWatcher.close(); promptsWatcher = null; }
            sessionManager.closeAll();
            for (const [sid] of sessionServers) {
                removeSessionServer(sid);
            }
            await closeStreamableHttpServer();
            releasePortLock(config.port);
            await cad.disconnect();
            closeLog();
            httpServer.close(() => {
                if (httpsServer) httpsServer.close(() => process.exit(0));
                else process.exit(0);
            });
            setTimeout(() => process.exit(1), 5000);
        }
        process.on('SIGINT', () => shutdown('SIGINT'));
        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('exit', () => releasePortLock(config.port));
    }
}

    onDocumentChanged((info) => {
        const uris = [
            'atlisp://dwg/name',
            'atlisp://dwg/path',
            'atlisp://cad/dwgs',
            'atlisp://dwg/tbl',
            'atlisp://dwg/entities',
            'atlisp://dwg/block-refs',
            'atlisp://dwg/text-content',
            'atlisp://dwg/groups',
        ];
        for (const uri of uris) {
            clearCache(uri);
            subMgr.notify(uri, { docName: info.docName, docPath: info.docPath });
        }
    });

if (!process.env.VITEST) {
    await startServer();
}

export { CAD_PLATFORMS, FILE_EXTENSIONS } from './constants.js';
export const LOG_LEVELS = ['debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency'];