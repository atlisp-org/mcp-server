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

import { initStreamableHttpServer, setupStreamableHttpRoutes, closeStreamableHttpServer } from './streamable-http.js';

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
  -v, --version           Show version number
  -h, --help             Show this help message
   --transport <type>     Transport: http, stdio, or ws (default: http)
  --port <port>         HTTP port (default: 8110)
  --host <host>         HTTP host (default: 0.0.0.0)
   --stdio                Shorthand for --transport stdio
   --ws                   Shorthand for --transport ws
   --config <path>       Path to config file (default: ~/.atlisp/atlisp.config.json)
   --ssl-key <path>     SSL key file path (enables HTTPS)
   --ssl-cert <path>    SSL certificate file path
   --debug               Enable debug mode

Environment Variables:
   TRANSPORT             Transport mode (http/stdio/ws)
   PORT                  HTTP port
   HOST                  HTTP host
   MCP_API_KEY           API key for authentication
   ENABLE_SSE            Enable SSE (true/false)
   DEBUG                 Enable debug logging (true/false)
   METRICS_ENABLED      Enable /metrics endpoint (true/false)
   SSL_KEY_PATH          SSL key file path
   SSL_CERT_PATH         SSL certificate file path

Examples:
  atlisp-mcp                       Start HTTP server on port 8110
  atlisp-mcp --port 3000          Start HTTP server on port 3000
  atlisp-mcp --stdio               Start in stdio mode for MCP clients
  atlisp-mcp --config ~/my.json   Use custom config file
  atlisp-mcp --debug              Enable debug output
  TRANSPORT=stdio atlisp-mcp      Via env var for stdio mode
  atlisp-mcp --ws                 Start WebSocket server on port 8110
  TRANSPORT=ws atlisp-mcp         Via env var for WebSocket mode

API Endpoints:
  GET  /health    Health check
  GET  /metrics   Prometheus metrics (if enabled)
  POST /mcp       MCP JSON-RPC endpoint
  GET  /sse       Server-Sent Events endpoint
  POST /message   SSE message endpoint
  WS   /ws        WebSocket endpoint
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
        }
    }
}

if (config.apiKey) log('API Key authentication enabled');

async function initCadConnection() {
    log('Attempting to connect to CAD on startup...');
    try {
        const connected = await cad.connect();
        if (connected) {
            log(`Auto-connected to CAD: ${cad.getPlatform()} ${cad.getVersion()}`);
            console.error(`已自动连接到 CAD: ${cad.getPlatform()} ${cad.getVersion()}`);
        } else {
            log('No CAD found on startup');
        }
    } catch (e) {
        logError(`Auto-connect failed: ${e.message}`);
    }
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
        await initCadConnection();
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

        const httpServer = rawServer.listen(config.port, config.host, async () => {
            await initCadConnection();
            const proto = useSsl ? 'https' : 'http';
            const mode = config.transport === 'ws' ? 'WebSocket' : config.transport === 'streamable-http' ? 'Streamable HTTP' : '多会话';
            console.error(`@lisp MCP Server 启动 - ${proto}://${config.host}:${config.port} (${mode}模式)`);
        });

        async function shutdown(signal) {
            console.error(`\n收到 ${signal}，正在优雅关闭...`);
            stopPluginWatcher();
            if (promptsWatcher) { promptsWatcher.close(); promptsWatcher = null; }
            sessionManager.closeAll();
            for (const [sid] of sessionServers) {
                removeSessionServer(sid);
            }
            await closeStreamableHttpServer();
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