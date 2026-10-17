import fs from 'fs';
import { error as logError } from './logger.js';
import path from 'path';
import os from 'os';

const LOCK_DIR = path.join(os.homedir(), '.atlisp', 'locks');

function ensureDir() {
    // 目录不存在则创建（含父目录），已存在时为 no-op
    fs.mkdirSync(LOCK_DIR, { recursive: true });
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
            } catch (e) {
                // 锁文件损坏，或在竞争间隙已被删除：按陈旧锁处理
                if (e.code !== 'ENOENT') logError(`锁文件内容损坏，按陈旧锁处理: ${e.message}`);
            }
            // 陈旧锁（pid 已死亡）或内容损坏：删除后下一轮重试
            try {
                fs.unlinkSync(lp);
            } catch (e2) {
                if (e2.code !== 'ENOENT') logError(`删除陈旧锁文件失败: ${e2.message}`);
            }
        }
    }
    return { ok: false, pid: null, started: null };
}

export function releasePortLock(port) {
    const lp = lockPath(port);
    try {
        const existing = JSON.parse(fs.readFileSync(lp, 'utf-8'));
        if (existing.pid !== process.pid) return;
    } catch (e) {
        // 锁文件或锁目录不存在（如 shutdown 已释放过一次、锁从未创建）：无需处理
        if (e.code === 'ENOENT') return;
        logError(`锁文件读取失败: ${e.message}`);
    }
    try {
        fs.unlinkSync(lp);
    } catch (e) {
        // 文件在读取与删除之间被删除：视为已释放
        if (e.code !== 'ENOENT') logError(`释放锁文件失败: ${e.message}`);
    }
}
