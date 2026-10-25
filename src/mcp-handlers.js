import {
    ListToolsRequestSchema,
    CallToolRequestSchema,
    ListResourcesRequestSchema,
    ListResourceTemplatesRequestSchema,
    ReadResourceRequestSchema,
    SubscribeRequestSchema,
    UnsubscribeRequestSchema,
    ListPromptsRequestSchema,
    GetPromptRequestSchema,
    CompleteRequestSchema,
    CancelledNotificationSchema,
    RootsListChangedNotificationSchema,
    ProgressNotificationSchema,
    ResourceListChangedNotificationSchema,
    ToolListChangedNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { listResources, readResource } from './handlers/resource-handlers.js';
import { RESOURCE_TEMPLATES } from './handlers/resource-defs.js';
import { listPrompts, getPrompt } from './handlers/prompt-handlers.js';
import { SERVER_NAME, SERVER_VERSION, SERVER_CAPABILITIES } from './constants.js';
import { subscribe, unsubscribe, list as subList } from './subscription-manager.js';
import { mcpContext } from './mcp-server-state.js';
import { trackToolCall, trackError } from './metrics.js';
import { checkToolRateLimit } from './rate-limiter.js';
import { log, error as logError } from './logger.js';

import { cad } from './cad.js';
import { setClientRoots } from './client-roots.js';
import { getVisibleTools } from './tools/index.js';

const COMPLETIONS_CACHE_TTL = 300;

async function queryCadTable(tableName) {
  try {
    const code = `(progn (setq r nil) (setq e (tblnext "${tableName.toUpperCase()}" t)) (while e (setq r (cons (cdr (assoc 2 e)) r)) (setq e (tblnext "${tableName.toUpperCase()}" nil))) (reverse r))`;
    const result = await cad.sendCommandWithResult(code);
    if (result && result !== 'nil') return parseLispList(result) || [];
    return [];
  } catch { return []; }
}

async function queryCadHandles() {
  try {
    const result = await cad.sendCommandWithResult(`(progn (setq r nil) (vlax-for e (vla-get-ModelSpace (vla-get-ActiveDocument (vlax-get-acad-object))) (setq r (cons (vla-get-Handle e) r))) (reverse r))`);
    if (result && result !== 'nil') return parseLispList(result) || [];
    return [];
  } catch { return []; }
}

function parseLispList(str) {
  if (!str || typeof str !== 'string') return null;
  const trimmed = str.trim();
  if (!trimmed.startsWith('(') || !trimmed.endsWith(')')) return null;
  const parts = trimmed.slice(1, -1).split(/\s+/).filter(Boolean);
  return parts.map(p => { if (p.startsWith('"') && p.endsWith('"')) return p.slice(1, -1); return p; });
}
const completionsCache = new Map(); // Map<refType, {values: string[], ts: number}>

export function createMcpServer(handlers = {}) {
    const { handleToolCall = () => ({ content: [] }) } = handlers;

    const server = new Server(
        { name: SERVER_NAME, version: SERVER_VERSION },
        {
            capabilities: SERVER_CAPABILITIES,
            instructions: [
                '这是 @lisp MCP 服务器，用于通过 AI Agent 控制 CAD（AutoCAD/ZWCAD/GStarCAD/BricsCAD）。',
                '首次操作先调用 open_cad（需要后台连接不切窗口时用 connect_cad）；之后再做查询或绘图。',
                '工具列表按 100 条分页返回，且可能被 profile 过滤——找不到工具时用 search_tools / list_tools_by_category 检索，再用 get_tool_info 确认参数。',
                '只读了解图纸优先用 MCP 资源（resources/list）：atlisp://dwg/context 看上下文、atlisp://dwg/analysis 看统计、atlisp://dwg/entities 看实体；需要修改图纸再用工具。',
            ].join(''),
        }
    );

    function decodeCursor(cursor) {
        if (!cursor) return 0;
        try { return parseInt(Buffer.from(cursor, 'base64').toString('utf-8'), 10); } catch { return 0; }
    }
    function encodeCursor(offset) {
        return Buffer.from(String(offset), 'utf-8').toString('base64');
    }

    server.setRequestHandler(ListToolsRequestSchema, async (request) => {
        const params = request.params || {};
        const cursor = decodeCursor(params.cursor);
        const PAGE_SIZE = 100;
        const visible = getVisibleTools();
        const page = visible.slice(cursor, cursor + PAGE_SIZE);
        const nextCursor = (cursor + PAGE_SIZE < visible.length) ? encodeCursor(cursor + PAGE_SIZE) : undefined;
        return { tools: page, nextCursor };
    });

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const startTime = Date.now();
        const { name, arguments: args, meta } = request.params;
        const progressToken = meta?.progressToken;
        const notifyProgress = progressToken ? (current, total, message) => {
            server.sendNotification({
                method: 'notifications/progress',
                params: { progressToken, progress: current, total, message }
            }).catch(() => {});
        } : null;
        try {
            const result = await handleToolCall(name, args || {}, { notifyProgress });
            trackToolCall(name, Date.now() - startTime, !result.isError);
            return result;
        } catch (e) {
            trackToolCall(name, Date.now() - startTime, false);
            trackError();
            throw e;
        }
    });

    server.setRequestHandler(ListResourcesRequestSchema, async (request) => {
        const ctx = mcpContext.getStore();
        const sessionId = ctx?.sessionId;
        const subscribedUris = sessionId ? subList(sessionId) : subList();
        const allResources = await listResources(subscribedUris);
        const params = request.params || {};
        const cursor = decodeCursor(params.cursor);
        const PAGE_SIZE = 100;
        const page = allResources.slice(cursor, cursor + PAGE_SIZE);
        const nextCursor = (cursor + PAGE_SIZE < allResources.length) ? encodeCursor(cursor + PAGE_SIZE) : undefined;
        return { resources: page, nextCursor };
    });

    server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
        resourceTemplates: RESOURCE_TEMPLATES
    }));

    server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
        const { uri } = request.params;
        try {
            const data = await readResource(uri);
            // Support both text and blob content types
            const isBlob = data && data._blob;
            const contents = isBlob
                ? [{ uri, mimeType: data.mimeType || 'application/octet-stream', blob: data._blob }]
                : [{ uri, mimeType: 'application/json', text: JSON.stringify(data) }];
            return { contents };
        } catch (e) {
            return {
                contents: [{ uri, mimeType: 'text/plain', text: `错误: ${e.message}` }],
                isError: true,
            };
        }
    });

    server.setRequestHandler(SubscribeRequestSchema, async (request) => {
        const { uri } = request.params;
        const ctx = mcpContext.getStore();
        subscribe(uri, ctx?.sessionId);
        return { success: true };
    });

    server.setRequestHandler(UnsubscribeRequestSchema, async (request) => {
        const { uri } = request.params;
        const ctx = mcpContext.getStore();
        unsubscribe(uri, ctx?.sessionId);
        return { success: true };
    });

    server.setRequestHandler(ListPromptsRequestSchema, async (request) => {
        const allPrompts = await listPrompts();
        const params = request.params || {};
        const cursor = decodeCursor(params.cursor);
        const PAGE_SIZE = 50;
        const page = allPrompts.slice(cursor, cursor + PAGE_SIZE);
        const nextCursor = (cursor + PAGE_SIZE < allPrompts.length) ? encodeCursor(cursor + PAGE_SIZE) : undefined;
        return { prompts: page, nextCursor };
    });

    server.setRequestHandler(GetPromptRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;
        return await getPrompt(name, args || {});
    });

    // Roots and Sampling are server→client requests per MCP spec.
    // The SDK's Server class provides `server.listRoots()` and `server.createMessage()`
    // methods that send requests to the client. No handler registration is needed here.

    server.setRequestHandler(CompleteRequestSchema, async (request) => {
        const rateCheck = checkToolRateLimit('completion', true);
        if (!rateCheck.allowed) {
            return { completion: { values: [], hasMore: false, total: 0 } };
        }
        const { argument, ref } = request.params;
        const values = [];
        const prefix = (argument?.value || '').toLowerCase();

        if (ref?.type === 'ref/prompt') {
            try {
                const prompts = await listPrompts();
                if (argument?.name) {
                    const prompt = prompts.find(p => p.name === ref.name);
                    if (prompt?.arguments) {
                        for (const a of prompt.arguments) {
                            if (a.name === argument.name && a.validValues) {
                                for (const v of a.validValues) {
                                    if (v.toLowerCase().startsWith(prefix)) values.push(v);
                                }
                            }
                        }
                    }
                } else {
                    for (const p of prompts) {
                        if (p.name.toLowerCase().startsWith(prefix)) values.push(p.name);
                        if (p.arguments) {
                            for (const a of p.arguments) {
                                if (a.name && a.name.toLowerCase().startsWith(prefix)) values.push(a.name);
                            }
                        }
                    }
                }
            } catch (e) { log(`Complete error: ${e.message}`); }
        } else if (ref?.type === 'ref/resource') {
            try {
                const resources = await listResources([]);
                for (const r of resources) {
                    if (r.name && r.name.toLowerCase().startsWith(prefix)) values.push(r.name);
                    if (r.uri && r.uri.toLowerCase().startsWith(prefix)) values.push(r.uri);
                }
                for (const t of RESOURCE_TEMPLATES) {
                    if (t.name.toLowerCase().startsWith(prefix)) values.push(t.name);
                    if (t.uriTemplate.toLowerCase().startsWith(prefix)) values.push(t.uriTemplate);
                }
            } catch (e) { log(`Complete error: ${e.message}`); }
        } else if (ref?.type === 'layer') {
            const cached = completionsCache.get('layer');
            let layerItems = null;
            if (cached && (Date.now() - cached.ts) < COMPLETIONS_CACHE_TTL) {
                layerItems = cached.values;
            } else {
                try {
                    const result = await cad.sendCommandWithResult(
                        `(progn (setq res nil) (while (setq e (tblnext "LAYER" (null res))) (setq res (cons (cdr (assoc 2 e)) res))) (reverse res))`
                    );
                    if (result && result !== 'nil') {
                        try {
                            layerItems = JSON.parse(result);
                            completionsCache.set('layer', { values: layerItems, ts: Date.now() });
                        } catch (e) { log(`Complete error: ${e.message}`); }
                    }
                } catch (e) { log(`Complete error: ${e.message}`); }
            }
            if (layerItems) {
                for (const l of layerItems) {
                    if (String(l).toLowerCase().startsWith(prefix)) values.push(l);
                }
            }
        } else if (ref?.type === 'block') {
            const cached = completionsCache.get('block');
            let blockItems = null;
            if (cached && (Date.now() - cached.ts) < COMPLETIONS_CACHE_TTL) {
                blockItems = cached.values;
            } else {
                try {
                    const result = await cad.sendCommandWithResult(
                        `(progn (setq res nil) (while (setq e (tblnext "BLOCK" (null res))) (setq res (cons (cdr (assoc 2 e)) res))) (reverse res))`
                    );
                    if (result && result !== 'nil') {
                        try {
                            blockItems = JSON.parse(result);
                            completionsCache.set('block', { values: blockItems, ts: Date.now() });
                        } catch (e) { log(`Complete error: ${e.message}`); }
                    }
                } catch (e) { log(`Complete error: ${e.message}`); }
            }
            if (blockItems) {
                for (const b of blockItems) {
                    if (String(b).toLowerCase().startsWith(prefix)) values.push(b);
                }
            }
        } else if (ref?.type === 'linetype') {
            const cached = completionsCache.get('linetype');
            let ltypeItems = null;
            if (cached && (Date.now() - cached.ts) < COMPLETIONS_CACHE_TTL) {
                ltypeItems = cached.values;
            } else {
                try {
                    const result = await cad.sendCommandWithResult(
                        `(progn (setq res nil) (while (setq e (tblnext "LTYPE" (null res))) (setq res (cons (cdr (assoc 2 e)) res))) (reverse res))`
                    );
                    if (result && result !== 'nil') {
                        try {
                            ltypeItems = JSON.parse(result);
                            completionsCache.set('linetype', { values: ltypeItems, ts: Date.now() });
                        } catch (e) { log(`Complete error: ${e.message}`); }
                    }
                } catch (e) { log(`Complete error: ${e.message}`); }
            }
            if (ltypeItems) {
                for (const l of ltypeItems) {
                    if (String(l).toLowerCase().startsWith(prefix)) values.push(l);
                }
            }
        } else if (ref?.type === 'textstyle') {
            const cached = completionsCache.get('textstyle');
            let styleItems = null;
            if (cached && (Date.now() - cached.ts) < COMPLETIONS_CACHE_TTL) {
                styleItems = cached.values;
            } else {
                try {
                    const result = await cad.sendCommandWithResult(
                        `(progn (setq res nil) (while (setq e (tblnext "STYLE" (null res))) (setq res (cons (cdr (assoc 2 e)) res))) (reverse res))`
                    );
                    if (result && result !== 'nil') {
                        try {
                            styleItems = JSON.parse(result);
                            completionsCache.set('textstyle', { values: styleItems, ts: Date.now() });
                        } catch (e) { log(`Complete error: ${e.message}`); }
                    }
                } catch (e) { log(`Complete error: ${e.message}`); }
            }
            if (styleItems) {
                for (const s of styleItems) {
                    if (String(s).toLowerCase().startsWith(prefix)) values.push(s);
                }
            }
        } else if (ref?.type === 'dimstyle') {
            const cached = completionsCache.get('dimstyle');
            let dimItems = null;
            if (cached && (Date.now() - cached.ts) < COMPLETIONS_CACHE_TTL) {
                dimItems = cached.values;
            } else {
                try {
                    const result = await cad.sendCommandWithResult(
                        `(progn (setq res nil) (while (setq e (tblnext "DIMSTYLE" (null res))) (setq res (cons (cdr (assoc 2 e)) res))) (reverse res))`
                    );
                    if (result && result !== 'nil') {
                        try {
                            dimItems = JSON.parse(result);
                            completionsCache.set('dimstyle', { values: dimItems, ts: Date.now() });
                        } catch (e) { log(`Complete error: ${e.message}`); }
                    }
                } catch (e) { log(`Complete error: ${e.message}`); }
            }
            if (dimItems) {
                for (const s of dimItems) {
                    if (String(s).toLowerCase().startsWith(prefix)) values.push(s);
                }
            }
        } else if (ref?.type === 'ucs') {
            const cached = completionsCache.get('ucs');
            let ucsItems = null;
            if (cached && (Date.now() - cached.ts) < COMPLETIONS_CACHE_TTL) {
                ucsItems = cached.values;
            } else {
                try {
                    const result = await cad.sendCommandWithResult(
                        '(progn (setq res nil) (while (setq e (tblnext "UCS" (null res))) (setq res (cons (cdr (assoc 2 e)) res))) (reverse res))'
                    );
                    if (result && result !== 'nil') {
                        try {
                            ucsItems = JSON.parse(result);
                            completionsCache.set('ucs', { values: ucsItems, ts: Date.now() });
                        } catch (e) { log(`Complete error: ${e.message}`); }
                    }
                } catch (e) { log(`Complete error: ${e.message}`); }
            }
            if (ucsItems) {
                for (const s of ucsItems) {
                    if (String(s).toLowerCase().startsWith(prefix)) values.push(s);
                }
            }
        } else if (ref?.type === 'layout') {
            const cached = completionsCache.get('layout');
            let layoutItems = null;
            if (cached && (Date.now() - cached.ts) < COMPLETIONS_CACHE_TTL) {
                layoutItems = cached.values;
            } else {
                try {
                    const result = await cad.sendCommandWithResult(
                        '(progn (setq res nil) (foreach x (layoutlist) (setq res (cons x res))) (reverse res))'
                    );
                    if (result && result !== 'nil') {
                        try {
                            layoutItems = JSON.parse(result);
                            completionsCache.set('layout', { values: layoutItems, ts: Date.now() });
                        } catch (e) { log(`Complete error: ${e.message}`); }
                    }
                } catch (e) { log(`Complete error: ${e.message}`); }
            }
            if (layoutItems) {
                for (const s of layoutItems) {
                    if (String(s).toLowerCase().startsWith(prefix)) values.push(s);
                }
            }
        } else if (ref?.type === 'group') {
            const cached = completionsCache.get('group');
            let groupItems = null;
            if (cached && (Date.now() - cached.ts) < COMPLETIONS_CACHE_TTL) {
                groupItems = cached.values;
            } else {
                try {
                    const result = await cad.sendCommandWithResult(
                        '(progn (setq res (dictsearch (namedobjdict) "ACAD_GROUP")) (setq names nil) (setq i 0) (while (setq e (nth i res)) (setq names (cons (car e) names)) (setq i (+ i 2))) (vl-prin1-to-string names))'
                    );
                    if (result && result !== 'nil') {
                        try {
                            groupItems = JSON.parse(result);
                            completionsCache.set('group', { values: groupItems, ts: Date.now() });
                        } catch (e) { log(`Complete error: ${e.message}`); }
                    }
                } catch (e) { log(`Complete error: ${e.message}`); }
            }
            if (groupItems) {
                for (const s of groupItems) {
                    if (String(s).toLowerCase().startsWith(prefix)) values.push(s);
                }
            }
        } else if (ref?.type === 'hatch') {
            const hatchPatterns = ['ANSI31','ANSI32','ANSI33','ANSI34','ANSI35','ANSI36','ANSI37','ANSI38','AR-B816','AR-B816C','AR-B88','AR-BRELM','AR-BRSTD','AR-CONC','AR-HBONE','AR-PARQ1','AR-RROOF','AR-RSHKE','AR-SAND','BOX','BRASS','BRICK','BRSTONE','CLAY','CORK','CROSS','DASH','DOLMIT','DOTS','EARTH','ESCHER','FLEX','GRASS','GRATE','HEX','HONEY','HOUND','INSUL','LINE','MUDST','NET','NET3','PLAST','PLASTI','SACNCR','SQUARE','STARS','STEEL','SWAMP','TRANS','TRIANG','ZIGZAG'];
            for (const p of hatchPatterns) { if (p.toLowerCase().startsWith(prefix)) values.push(p); }
        } else if (ref?.type === 'tool') {
            for (const t of getVisibleTools()) { if (t.name.toLowerCase().startsWith(prefix)) values.push(t.name); }
        } else if (ref?.type === 'ref/parameter') {
            const toolDef = getVisibleTools().find(t => t.name === ref.name);
            if (toolDef?.inputSchema?.properties) {
                const paramName = argument.name;
                const paramDef = toolDef.inputSchema.properties[paramName];
                if (paramDef?.enum) {
                    for (const opt of paramDef.enum) {
                        if (String(opt).toLowerCase().startsWith(prefix)) values.push(opt);
                    }
                } else if (/handle/i.test(paramName) && cad.connected) {
                    const handles = await queryCadHandles();
                    for (const h of handles) { if (h.toLowerCase().startsWith(prefix)) values.push(h); }
                } else if (cad.connected) {
                    let tableName = null;
                    if (/layer/i.test(paramName)) tableName = 'layer';
                    else if (/block/i.test(paramName) && /name/i.test(paramName)) tableName = 'block';
                    else if (/linetype/i.test(paramName)) tableName = 'ltype';
                    else if (/textstyle/i.test(paramName) || /style/i.test(paramName)) tableName = 'style';
                    else if (/ucs/i.test(paramName)) tableName = 'ucs';
                    else if (/layout/i.test(paramName)) tableName = 'layer';
                    if (tableName) {
                        const items = await queryCadTable(tableName);
                        for (const item of items) { if (item.toLowerCase().startsWith(prefix)) values.push(item); }
                    }
                }
            }
        }
        // Standard MCP ref types we don't support: return empty

        const hasMore = values.length > 20;
        const sliced = values.slice(0, 20);
        return {
            completion: {
                values: sliced,
                hasMore,
                total: values.length
            }
        };
    });

    server.setNotificationHandler(CancelledNotificationSchema, (notification) => {
        const { requestId, reason } = notification.params;
        log(`Request cancelled by client: id=${requestId}${reason ? ` reason=${reason}` : ''}`);
        // Cancel the current CAD command by sending ESC/Ctrl+C equivalent
        try { cad.sendCommand('(command "_.UCS" "")'); } catch (e) { logError('[mcp-handlers]', e?.message || e); }
    });

    server.setNotificationHandler(ProgressNotificationSchema, (notification) => {
        const { progressToken, progress, total, message } = notification.params;
        log(`Client progress: token=${progressToken} ${progress}/${total || '?'} ${message || ''}`);
    });

    server.setNotificationHandler(ResourceListChangedNotificationSchema, () => {
        log('Client resource list changed (no-op)');
    });

    server.setNotificationHandler(ToolListChangedNotificationSchema, () => {
        log('Client tool list changed (no-op)');
    });

    server.oninitialized = () => {
        log('MCP client initialized, session ready');
        server.listRoots().then(roots => {
            if (roots?.length) {
                setClientRoots(roots);
                log(`Client roots: ${roots.map(r => r.uri).join(', ')}`);
            }
        }).catch(() => {});
    };

    server.setNotificationHandler(RootsListChangedNotificationSchema, () => {
        log('Client roots changed');
        server.listRoots().then(roots => {
            setClientRoots(roots);
        }).catch(() => {});
    });

    return server;
}