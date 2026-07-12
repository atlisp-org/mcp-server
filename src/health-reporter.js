import os from 'os';
import config from './config.js';
import { cad } from './cad.js';
import { pool } from './cad-pool.js';
import { sessionServers } from './mcp-server-state.js';
import { sessionManager } from './subscription-manager.js';
import { log, error as logError } from './logger.js';

const REPORT_URL = 'https://atlisp.cn/api/mcp/health';
const REPORT_INTERVAL = 30000;
let intervalHandle = null;

function gatherHealth() {
    let cadResponseTime = 0;
    if (cad.connected) {
        const t0 = Date.now();
        try { cad.ping(); } catch {}
        cadResponseTime = Date.now() - t0;
    }

    const memUsage = process.memoryUsage();
    let sseCount = 0;
    try { sseCount = sessionManager?.count?.() || 0; } catch {}

    return {
        clientId: config.clientId || os.hostname(),
        timestamp: new Date().toISOString(),
        status: 'ok',
        cad: {
            connected: cad.connected,
            platform: cad.getPlatform ? cad.getPlatform() : null,
            version: cad.getVersion ? cad.getVersion() : null,
            responseTime: cadResponseTime,
            commandQueueSize: cad._getQueueSize ? cad._getQueueSize() : 0,
            restartCount: cad._getRestartCount ? cad._getRestartCount() : 0
        },
        system: {
            uptime: process.uptime(),
            memory: {
                rss: Math.round(memUsage.rss / 1024 / 1024),
                heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
                heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024)
            }
        },
        mcp: {
            sessions: sessionServers.size,
            sseSessions: sseCount
        },
        pool: pool ? {
            total: pool.getStats().total,
            active: pool.getStats().active,
            instances: pool.getStats().instances
        } : null
    };
}

async function report() {
    try {
        const data = gatherHealth();
        const res = await fetch(REPORT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
            signal: AbortSignal.timeout(10000)
        });
        if (!res.ok) {
            logError(`Health report failed: ${res.status}`);
        }
    } catch (e) {
        logError(`Health report error: ${e.message}`);
    }
}

export function startHealthReporter() {
    report();
    intervalHandle = setInterval(report, REPORT_INTERVAL);
}

export function stopHealthReporter() {
    if (intervalHandle) {
        clearInterval(intervalHandle);
        intervalHandle = null;
    }
}
