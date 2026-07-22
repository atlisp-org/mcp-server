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
import { CAD_PLATFORMS, FILE_EXTENSIONS, PROTOCOL_VERSION, SERVER_NAME, SERVER_VERSION } from './constants.js';
import { log, error as logError, closeLog, setLoggingNotify } from './logger.js';
import { listResources, readResource, RESOURCES, clearCache } from './handlers/resource-handlers.js';
import * as subMgr from './subscription-manager.js';
import { sessionManager } from './subscription-manager.js';
import { SseSession } from './sse-session.js';

import config from './config.js';
import { setupRoutes } from './routes.js';
import { mcpContext, getOrCreateSessionServer, removeSessionServer, broadcastToAllSessions, sessionServers, createStdioServer } from './mcp-server-state.js';
import { tools, handleToolCall } from './mcp-tools.js';
import { createWebSocketServer } from './websocket-transport.js';
import { loadPlugins, initPlugins, getPlugins, onPluginChange, startPluginWatcher, stopPluginWatcher } from './plugin-loader.js';
import { registerTool, callCustomTool, getCustomHandlers } from './tool-registry.js';
import { broadcastToolListChanged, broadcastResourcesListChanged, broadcastPromptsListChanged, scheduleResourceUpdated } from './mcp-server-state.js';
import { startHealthReporter, stopHealthReporter } from './health-reporter.js';

import { initStreamableHttpServer, setupStreamableHttpRoutes, closeStreamableHttpServer } from './streamable-http.js';
import { acquirePortLock, releasePortLock } from './lockfile.js';
import { installAutostart, uninstallAutostart, autostartStatus } from './autostart.js';

export { tools, handleToolCall } from './mcp-tools.js';
export { loadAtlibFunctionLib } from './handlers/function-handlers.js';

const isMcpScript = process.argv[1]?.includes('atlisp-mcp');
if (isMcpScript) {
    const cliArgs = process.argv.slice(2);
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
  --security-level <type>      Security level: strict, standard, relaxed (default: strict)
  --install-autostart          Register server to auto-start after user login
  --uninstall-autostart        Remove auto-start registration
  --autostart-status           Check if auto-start is installed

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
  SECURITY_LEVEL        Security level: strict, standard, relaxed (default: strict)
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
    await loadPlugins();
    initPlugins({ cad, config, log, registerTool, tools });

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
        }
    } catch (e) {
        logError(`Failed to start prompt watcher: ${e.message}`);
    }

    if (config.transport === 'stdio') {
        const mcpServer = createStdioServer({ tools, handleToolCall });
        const transport = new StdioServerTransport();
        const sessionId = 'stdio-session';
        sessionManager.createSession(sessionId);
        await mcpContext.run({ sessionId }, async () => {
            await mcpServer.connect(transport);
        });
        console.error(`${SERVER_NAME} 运行在 stdio 模式`);

        subMgr.setNotify((uri, data) => {
            mcpServer.sendResourceUpdated({ uri }).catch(err => {
                logError(`Failed to send resource update: ${err.message}`);
            });
        });
    } else {
        const app = express();

        setupRoutes(app);
        setLoggingNotify((level, message) => {
            for (const [sid, { server }] of sessionServers) {
                server.sendLoggingMessage({ level, data: message }, sid).catch(() => {});
            }
        });

        subMgr.setNotify((uri, data) => {
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
        }

        const rawServer = httpsServer || http.createServer(app);
        createWebSocketServer(rawServer);

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
            console.error(`@lisp MCP Server 启动 - ${proto}://${config.host}:${config.port} (${mode}模式)`);
            startHealthReporter();
        });

        async function shutdown(signal) {
            console.error(`\n收到 ${signal}，正在优雅关闭...`);
            stopHealthReporter();
            stopPluginWatcher();
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