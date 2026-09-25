// @ts-check
import net from 'net';
import os from 'os';
import { log } from './logger.js';
import config from './config.js';
import { PROTOCOL_VERSION, SERVER_VERSION } from './constants.js';

const DEFAULT_PORT = 8110;
const DEFAULT_TIMEOUT = 500;
const DEFAULT_CONCURRENCY = 32;
const DEFAULT_MAX_HOSTS = 254;
const SCANNER_CLIENT_NAME = 'atlisp-mcp-scanner';

/**
 * 将 IPv4 点分字符串转为 32 位无符号整数
 * @param {string} ip
 * @returns {number}
 */
function ipToInt(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return 0;
  return parts.reduce((acc, part) => ((acc << 8) + (parseInt(part, 10) & 0xff)) >>> 0, 0);
}

/**
 * 将 32 位无符号整数转为 IPv4 点分字符串
 * @param {number} int
 * @returns {string}
 */
function intToIp(int) {
  return [(int >>> 24) & 0xff, (int >>> 16) & 0xff, (int >>> 8) & 0xff, int & 0xff].join('.');
}

/**
 * 枚举本机所有 IPv4 接口所在子网的候选主机地址
 * @param {number} maxHosts - 每个子网最多枚举的主机数
 * @returns {string[]}
 */
function listTargetHosts(maxHosts = DEFAULT_MAX_HOSTS) {
  const hosts = new Set();
  const interfaces = os.networkInterfaces();

  for (const ifaces of Object.values(interfaces)) {
    for (const iface of ifaces || []) {
      if (iface.family !== 'IPv4' || iface.internal) continue;
      if (iface.address.startsWith('169.254.')) continue;

      const mask = iface.netmask ? ipToInt(iface.netmask) : 0xffffff;
      if (mask === 0) continue;

      const network = (ipToInt(iface.address) & mask) >>> 0;
      const span = (~mask) >>> 0;
      let count = 0;

      for (let i = 1; i < span && count < maxHosts; i++) {
        const ip = intToIp((network + i) >>> 0);
        if (ip === iface.address) continue;
        hosts.add(ip);
        count++;
      }
    }
  }

  return Array.from(hosts);
}

/**
 * TCP 探测端口是否开放
 * @param {string} host
 * @param {number} port
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
function probePort(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (open) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(open);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

/**
 * 解析 SSE 响应体中的首个 data 事件
 * @param {string} text
 * @returns {any}
 */
function parseSse(text) {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('data:')) {
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        return JSON.parse(payload);
      } catch {
        // 继续尝试下一行
      }
    }
  }
  return null;
}

/**
 * 通过 MCP initialize 握手探测目标是否为 MCP 服务器
 * @param {string} host
 * @param {number} port
 * @param {number} [timeoutMs]
 * @param {string} [apiKey]
 * @returns {Promise<{name: string, version: string, protocolVersion?: string}|null>}
 */
export async function probeMcp(host, port, timeoutMs = DEFAULT_TIMEOUT, apiKey) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
    };

    const key = apiKey || config.apiKey;
    if (key) {
      headers['Authorization'] = `Bearer ${key}`;
    }

    const res = await fetch(`http://${host}:${port}/mcp`, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: SCANNER_CLIENT_NAME, version: SERVER_VERSION },
        },
      }),
    });

    if (!res.ok) return null;

    const contentType = res.headers.get('content-type') || '';
    const text = await res.text();
    const data = contentType.includes('text/event-stream') ? parseSse(text) : JSON.parse(text);

    const serverInfo = data?.result?.serverInfo;
    if (!serverInfo) return null;

    return {
      name: serverInfo.name || 'unknown',
      version: serverInfo.version || 'unknown',
      protocolVersion: data.result.protocolVersion,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 扫描局域网中的 MCP 服务器
 * @param {{
 *   port?: number,
 *   timeoutMs?: number,
 *   concurrency?: number,
 *   maxHosts?: number,
 *   hosts?: string[],
 *   apiKey?: string
 * }} [opts]
 * @returns {Promise<Array<{ip: string, port: number, serverInfo?: {name: string, version: string, protocolVersion?: string}}>>}
 */
export async function scanLan(opts = {}) {
  const port = opts.port || DEFAULT_PORT;
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT;
  const concurrency = Math.max(1, opts.concurrency || DEFAULT_CONCURRENCY);
  const maxHosts = opts.maxHosts || DEFAULT_MAX_HOSTS;
  const hosts = opts.hosts && opts.hosts.length ? [...opts.hosts] : listTargetHosts(maxHosts);

  if (!hosts.length) {
    log('LAN scan skipped: no candidate hosts found');
    return [];
  }

  log(`LAN scan started: ${hosts.length} hosts, port ${port}, concurrency ${concurrency}`);

  const queue = hosts;
  const found = [];

  const worker = async () => {
    while (queue.length) {
      const ip = queue.shift();
      if (!ip) break;

      const open = await probePort(ip, port, timeoutMs);
      if (!open) continue;

      const serverInfo = await probeMcp(ip, port, timeoutMs, opts.apiKey) || undefined;
      found.push({ ip, port, serverInfo });
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, () => worker()));

  log(`LAN scan finished: ${found.length} server(s) found`);
  return found.sort((a, b) => a.ip.localeCompare(b.ip, undefined, { numeric: true }));
}

export default { probeMcp, scanLan };
