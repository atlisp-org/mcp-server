/**
 * 本机常驻中继客户端（daemon relay）
 *
 * 页面里的中继随页面卸载而消失，所以「离开 /agent/chat 后台继续操作 CAD」
 * 不能靠浏览器。这里让已经在用户机器上常驻的 atlisp-mcp 自己连服务端：
 *
 *   atlisp-mcp ──WSS + 用户 token──▶ atlisp.cn /agent/relay/ws
 *              ◀── {type:"rpc", method, params} ──
 *              ── {type:"rpc-result", id, json} ──▶
 *
 * 帧协议与页面完全一致（见 server/api/agent-relay-ws.lisp）：
 *   · 上行 register / rpc-result / ping
 *   · 下行 rpc / registered / ping
 * 结果必须放 `json` 且是**字符串**：服务端要把它原样嵌回 JSON-RPC 响应，
 * 解码再编码会把 inputSchema 之类的驼峰键压成小写。
 *
 * 配置来自 ~/.atlisp/relay.json（由页面调用 /api/relay/pair 写入，0600），
 * 也支持 RELAY_URI / RELAY_TOKEN / RELAY_PEER 环境变量（部署/调试用）。
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { WebSocket } from 'ws';
import { log, error as logError } from './logger.js';
import { getVisibleTools } from './tools/index.js';
import { listResources, readResource } from './handlers/resource-handlers.js';
import { handleToolCall } from './mcp-tools.js';
import { validateLispCode } from './lisp-security.js';
import { cad } from './cad.js';

const ATLISP_DIR = path.join(os.homedir(), '.atlisp');
const RELAY_CONFIG_PATH = process.env.RELAY_CONFIG_PATH ||
    path.join(ATLISP_DIR, 'relay.json');
const DEFAULT_URI = 'wss://atlisp.cn/agent/relay/ws';
const PING_INTERVAL_MS = 25000;
const RECONNECT_MIN_MS = 3000;
const RECONNECT_MAX_MS = 60000;

const state = {
    ws: null,
    connected: false,
    registered: false,
    tools: 0,
    lastError: '',
    peerId: '',
    email: '',
    retryMs: RECONNECT_MIN_MS,
    pingTimer: null,
    retryTimer: null,
    registerTimer: null,
    registerWarned: false,
    stopped: true,
};

function sanitizeId(s) {
    return String(s || '').replace(/[^A-Za-z0-9_.-]/g, '-').slice(0, 80);
}

export function relayPeerId() {
    const env = sanitizeId(process.env.RELAY_PEER);
    if (env) return env;
    const host = sanitizeId(os.hostname() || 'machine');
    const h = crypto.createHash('sha1').update(host).digest('hex').slice(0, 6);
    return `daemon-${host}-${h}`;
}

export function loadRelayConfig() {
    try {
        if (!fs.existsSync(RELAY_CONFIG_PATH)) return null;
        const cfg = JSON.parse(fs.readFileSync(RELAY_CONFIG_PATH, 'utf-8'));
        if (!cfg || typeof cfg.token !== 'string' || !cfg.token) return null;
        return cfg;
    } catch (e) {
        logError(`[relay] 读取配置失败: ${e.message}`);
        return null;
    }
}

export function saveRelayConfig(cfg) {
    fs.mkdirSync(path.dirname(RELAY_CONFIG_PATH), { recursive: true });
    const tmp = `${RELAY_CONFIG_PATH}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, RELAY_CONFIG_PATH);
    try { fs.chmodSync(RELAY_CONFIG_PATH, 0o600); } catch { /* best-effort */ }
}

function effectiveConfig() {
    const file = loadRelayConfig() || {};
    const token = process.env.RELAY_TOKEN || file.token || '';
    if (!token) return null;
    return {
        uri: process.env.RELAY_URI || file.uri || DEFAULT_URI,
        token,
        peerId: sanitizeId(process.env.RELAY_PEER || file.peerId) || relayPeerId(),
        email: file.email || '',
    };
}

export function getRelayStatus() {
    const cfg = effectiveConfig();
    return {
        configured: !!cfg,
        enabled: process.env.RELAY_ENABLED !== '0',
        connected: state.connected,
        registered: state.registered,
        peerId: cfg ? cfg.peerId : relayPeerId(),
        email: cfg ? cfg.email : '',
        uri: cfg ? cfg.uri : '',
        tools: state.tools,
        cadConnected: !!cad.connected,
        lastError: state.lastError,
    };
}

function send(frame) {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return false;
    try {
        state.ws.send(JSON.stringify(frame));
        return true;
    } catch (e) {
        state.lastError = e.message;
        return false;
    }
}

function resourceResult(uri, data) {
    if (data && data._blob) {
        return { contents: [{
            uri,
            mimeType: data.mimeType || 'application/octet-stream',
            blob: data._blob,
        }] };
    }
    return { contents: [{
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(data === undefined ? null : data),
    }] };
}

/* CAD 的 COM 读不可重入（实测 8 路并发会返回 "No open document"），
   context-bundle 固定并发 3 —— 与页面里的 mapPool 保持一致。 */
async function mapPool(items, limit, fn) {
    const out = new Array(items.length);
    let cursor = 0;
    const width = Math.max(1, Math.min(limit, items.length));
    async function worker() {
        for (;;) {
            const i = cursor++;
            if (i >= items.length) return;
            out[i] = await fn(items[i], i);
        }
    }
    await Promise.all(Array.from({ length: width }, worker));
    return out;
}

async function readBundle(wantText) {
    const uris = [
        'atlisp://cad/info',
        'atlisp://dwg/name',
        'atlisp://dwg/path',
        'atlisp://dwg/context',
        'atlisp://dwg/analysis?type=summary',
    ];
    if (wantText) uris.push('atlisp://dwg/text-combined');
    const items = await mapPool(uris, 3, async (u) => {
        try {
            const data = await readResource(u);
            return { uri: u, result: resourceResult(u, data) };
        } catch (e) {
            return { uri: u, error: e.message || String(e) };
        }
    });
    return {
        contents: [{
            uri: 'atlisp://dwg/context-bundle',
            mimeType: 'application/json',
            text: JSON.stringify({ items }),
        }],
    };
}

async function handleRpc(frame) {
    const id = frame.id;
    const method = frame.method || '';
    const params = frame.params || {};
    const reply = (result) => send({
        type: 'rpc-result', id, json: JSON.stringify(result === undefined ? null : result),
    });
    const fail = (err) => send({
        type: 'rpc-result', id, error: String((err && err.message) || err || 'unknown error'),
    });

    try {
        if (method === 'tools/list') {
            reply({
                tools: getVisibleTools().map((t) => ({
                    name: t.name,
                    description: t.description || '',
                    inputSchema: t.inputSchema,
                    annotations: t.annotations || null,
                })),
            });
            return;
        }
        if (method === 'resources/list') {
            const resources = await listResources();
            reply({
                resources: resources.map((r) => ({
                    uri: r.uri,
                    name: r.name || '',
                    description: r.description || '',
                    mimeType: r.mimeType || 'application/json',
                })),
            });
            return;
        }
        if (method === 'resources/read') {
            const uri = params.uri;
            if (!uri) return fail('resources/read 缺少 uri');
            if (uri === 'atlisp://dwg/context-bundle' ||
                uri.startsWith('atlisp://dwg/context-bundle?')) {
                const wantText = /(\?|&)text=1/.test(uri);
                return reply(await readBundle(wantText));
            }
            const data = await readResource(uri);
            return reply(resourceResult(uri, data));
        }
        if (method !== 'tools/call') {
            return fail(`不支持的 MCP 方法：${method}`);
        }
        const name = params.name;
        const args = params.arguments || {};
        if (!name) return fail('tools/call 缺少 name');
        /* 与页面一致的本地预校验：代码马上要在这台机器上跑。
           只拦 code 参数里的危险写法，不替代服务端的工具级校验。 */
        if (args && typeof args.code === 'string') {
            const check = validateLispCode(args.code);
            if (check && check.valid === false) {
                return fail(`本机中继预校验拒绝执行 ${name}：${check.summary}`);
            }
        }
        const result = await handleToolCall(name, args, { sessionId: 'relay-daemon' });
        reply(result);
    } catch (e) {
        fail(e);
    }
}

function sendRegister() {
    if (!cad.connected) {
        if (!state.registerWarned) {
            state.registerWarned = true;
            log('[relay] CAD 未连接，暂不登记为对端（连上后自动登记）');
        }
        return false;
    }
    state.registerWarned = false;
    return send({
        type: 'register',
        peerId: state.peerId,
        kind: 'daemon',
        cad: true,
        tools: getVisibleTools().length,
    });
}

function scheduleReconnect(cfg) {
    if (state.stopped || state.retryTimer) return;
    const delay = state.retryMs;
    state.retryMs = Math.min(RECONNECT_MAX_MS, Math.round(state.retryMs * 1.6));
    state.retryTimer = setTimeout(() => {
        state.retryTimer = null;
        connect();
    }, delay);
    if (typeof state.retryTimer.unref === 'function') state.retryTimer.unref();
    log(`[relay] ${Math.round(delay / 1000)}s 后重连 ${cfg.uri}`);
}

function connect() {
    const cfg = effectiveConfig();
    if (!cfg) return;
    if (process.env.RELAY_ENABLED === '0') {
        log('[relay] RELAY_ENABLED=0，跳过');
        return;
    }
    if (state.ws && (state.ws.readyState === WebSocket.OPEN ||
                     state.ws.readyState === WebSocket.CONNECTING)) return;

    state.stopped = false;
    state.peerId = cfg.peerId;
    state.email = cfg.email;
    let ws;
    try {
        ws = new WebSocket(cfg.uri, {
            headers: {
                /* 用户会话 token。服务端 register 时用它解析 user-id；
                   没有它就拒绝 daemon 登记，避免未认证进程冒充 CAD 对端。 */
                Cookie: `atlisp_token=${cfg.token}`,
            },
            handshakeTimeout: 15000,
        });
    } catch (e) {
        state.lastError = e.message;
        scheduleReconnect(cfg);
        return;
    }
    state.ws = ws;

    ws.on('open', () => {
        state.connected = true;
        state.retryMs = RECONNECT_MIN_MS;
        state.lastError = '';
        log(`[relay] 已连接 ${cfg.uri}`);
        if (state.registerTimer) { clearInterval(state.registerTimer); state.registerTimer = null; }
        const tryRegister = () => {
            if (sendRegister()) {
                if (state.registerTimer) { clearInterval(state.registerTimer); state.registerTimer = null; }
            }
        };
        tryRegister();
        if (!state.registered) {
            state.registerTimer = setInterval(tryRegister, 5000);
            if (typeof state.registerTimer.unref === 'function') state.registerTimer.unref();
        }
        if (state.pingTimer) clearInterval(state.pingTimer);
        state.pingTimer = setInterval(() => {
            if (state.registered && !cad.connected) {
                /* CAD 断了：主动断开 WS，让服务端注销这个 daemon 对端，
                   避免它继续被优先选中而每次都调不通。重连后 CAD 没回来
                   就不会再 register（见 sendRegister）。 */
                log('[relay] CAD 已断开，注销后台中继');
                try { state.ws.close(); } catch { /* ignore */ }
                return;
            }
            send({ type: 'ping' });
        }, PING_INTERVAL_MS);
        if (typeof state.pingTimer.unref === 'function') state.pingTimer.unref();
    });

    ws.on('message', (raw) => {
        let frame;
        try { frame = JSON.parse(String(raw)); } catch { return; }
        if (!frame || !frame.type) return;
        if (frame.type === 'registered') {
            state.registered = true;
            state.tools = frame.tools || 0;
            state.peerId = frame.peer_id || state.peerId;
            if (state.registerTimer) { clearInterval(state.registerTimer); state.registerTimer = null; }
            log(`[relay] 后台中继已登记 peer=${state.peerId} tools=${state.tools}`);
        } else if (frame.type === 'rpc') {
            /* 不 await：一条 tools/call 可能很慢，串行会把 ping/后续 rpc 堵住。 */
            handleRpc(frame);
        } else if (frame.type === 'ping') {
            send({ type: 'ping' });
        }
    });

    ws.on('error', (e) => {
        state.lastError = e.message;
        logError(`[relay] 连接错误: ${e.message}`);
    });

    ws.on('close', () => {
        state.connected = false;
        state.registered = false;
        state.tools = 0;
        if (state.pingTimer) { clearInterval(state.pingTimer); state.pingTimer = null; }
        if (state.registerTimer) { clearInterval(state.registerTimer); state.registerTimer = null; }
        state.ws = null;
        if (!state.stopped) scheduleReconnect(cfg);
    });
}

export function startRelayClient() {
    const cfg = effectiveConfig();
    if (!cfg) {
        log('[relay] 未配置后台中继（在 /agent/chat 登录后会自动配对，或设置 RELAY_TOKEN）');
        return false;
    }
    if (process.env.RELAY_ENABLED === '0') return false;
    state.stopped = false;
    state.retryMs = RECONNECT_MIN_MS;
    connect();
    return true;
}

export function stopRelayClient() {
    state.stopped = true;
    if (state.retryTimer) { clearTimeout(state.retryTimer); state.retryTimer = null; }
    if (state.pingTimer) { clearInterval(state.pingTimer); state.pingTimer = null; }
    if (state.registerTimer) { clearInterval(state.registerTimer); state.registerTimer = null; }
    if (state.ws) {
        try { state.ws.close(); } catch { /* ignore */ }
        state.ws = null;
    }
    state.connected = false;
    state.registered = false;
}

/** 配对：页面把登录 token 交过来，校验后落盘并（重）连。 */
export async function pairRelay({ token, uri, email } = {}) {
    if (!token || typeof token !== 'string') {
        throw new Error('缺少 token');
    }
    const relayUri = /^wss?:\/\//.test(uri || '') ? uri : DEFAULT_URI;
    const httpBase = relayUri
        .replace(/^ws/, 'http')
        .replace(/\/agent\/relay\/ws.*$/, '');
    // 校验 token：必须能取到用户资料，否则 daemon 登记会被服务端拒绝。
    let info = null;
    try {
        const r = await fetch(`${httpBase}/api/user/info`, {
            headers: {
                Authorization: `Bearer ${token}`,
                'User-Agent': 'Mozilla/5.0 (atlisp-mcp relay pairing)',
            },
            // 配对不能无限挂起：服务端不可达时尽快失败并给出可读错误
            signal: AbortSignal.timeout(10000),
        });
        const d = await r.json().catch(() => null);
        if (r.ok && d && d.result === 'ok') info = d;
    } catch (e) {
        throw new Error(`连不上 ${httpBase}：${e.message}`, { cause: e });
    }
    if (!info) throw new Error('登录已失效，请重新登录后再试');

    const cfg = {
        uri: relayUri,
        token,
        peerId: relayPeerId(),
        email: email || info.email || '',
        savedAt: Date.now(),
    };
    saveRelayConfig(cfg);
    stopRelayClient();
    startRelayClient();
    return getRelayStatus();
}

export function unpairRelay() {
    try { fs.unlinkSync(RELAY_CONFIG_PATH); } catch { /* ignore */ }
    stopRelayClient();
    return getRelayStatus();
}
