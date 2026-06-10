import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'crypto';
import { log, error as logError } from './logger.js';
import { createMcpServer } from './mcp-handlers.js';
import { tools, handleToolCall } from './mcp-tools.js';

let mcpServer = null;
let streamableTransport = null;

export async function initStreamableHttpServer() {
    if (mcpServer) return;
    mcpServer = createMcpServer({ tools, handleToolCall });
    streamableTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
    });
    await mcpServer.connect(streamableTransport);
    streamableTransport.onerror = (err) => logError(`Streamable HTTP transport error: ${err.message}`);
    log('Streamable HTTP transport initialized');
}

export function getStreamableTransport() {
    return streamableTransport;
}

export async function closeStreamableHttpServer() {
    if (streamableTransport) {
        await streamableTransport.close();
        streamableTransport = null;
    }
    if (mcpServer) {
        await mcpServer.close();
        mcpServer = null;
    }
}

export function setupStreamableHttpRoutes(app) {
    app.all('/mcp', async (req, res) => {
        if (!streamableTransport) {
            return res.status(503).json({ error: 'Streamable HTTP transport not initialized' });
        }
        try {
            await streamableTransport.handleRequest(req, res, req.body);
        } catch (err) {
            logError(`Streamable HTTP handle error: ${err.message}`);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Internal server error' });
            }
        }
    });

    app.all('/mcp/:path', async (req, res) => {
        if (!streamableTransport) {
            return res.status(503).json({ error: 'Streamable HTTP transport not initialized' });
        }
        try {
            await streamableTransport.handleRequest(req, res, req.body);
        } catch (err) {
            logError(`Streamable HTTP handle error: ${err.message}`);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Internal server error' });
            }
        }
    });
}
