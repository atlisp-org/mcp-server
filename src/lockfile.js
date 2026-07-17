import fs from 'fs';
import path from 'path';
import os from 'os';

const LOCK_DIR = path.join(os.homedir(), '.atlisp', 'locks');

function ensureDir() {
    if (!fs.existsSync(LOCK_DIR)) {
        fs.mkdirSync(LOCK_DIR, { recursive: true });
    }
}

function lockPath(port) {
    return path.join(LOCK_DIR, `atlisp-mcp-${port}.lock`);
}

function isAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (e) {
        return e.code === 'EPERM';
    }
}

export function acquirePortLock(port, host) {
    ensureDir();
    const lp = lockPath(port);
    const payload = JSON.stringify({ pid: process.pid, port, host, started: new Date().toISOString() });

    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const fd = fs.openSync(lp, 'wx');
            fs.writeSync(fd, payload, 0, 'utf-8');
            fs.closeSync(fd);
            return { ok: true };
        } catch (err) {
            if (err.code !== 'EEXIST') throw err;
            try {
                const existing = JSON.parse(fs.readFileSync(lp, 'utf-8'));
                if (existing.pid && isAlive(existing.pid)) {
                    return { ok: false, pid: existing.pid, started: existing.started };
                }
            } catch {}
            try { fs.unlinkSync(lp); } catch {}
        }
    }
    return { ok: false, pid: null, started: null };
}

export function releasePortLock(port) {
    try {
        const lp = lockPath(port);
        try {
            const existing = JSON.parse(fs.readFileSync(lp, 'utf-8'));
            if (existing.pid !== process.pid) return;
        } catch {}
        fs.unlinkSync(lp);
    } catch {}
}
