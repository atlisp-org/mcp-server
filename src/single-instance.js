import fs from 'fs';
import path from 'path';
import os from 'os';

const LOCK_DIR = path.join(os.homedir(), '.atlisp');
const LOCK_FILE = path.join(LOCK_DIR, 'atlisp-mcp.lock');

function getPidInfo() {
  try {
    if (!fs.existsSync(LOCK_FILE)) return null;
    const content = fs.readFileSync(LOCK_FILE, 'utf8').trim();
    const [pid, port, started] = content.split('\n');
    return { pid: parseInt(pid, 10), port, started };
  } catch {
    return null;
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function checkAndLock(port) {
  if (!fs.existsSync(LOCK_DIR)) {
    fs.mkdirSync(LOCK_DIR, { recursive: true });
  }

  const existing = getPidInfo();
  if (existing && existing.pid !== process.pid) {
    if (isProcessAlive(existing.pid)) {
      console.error(`\n\x1b[31m[ERR]  @lisp MCP Server 已在运行 (PID ${existing.pid}, port ${existing.port})\x1b[0m`);
      console.error(`       Lock file: ${LOCK_FILE}`);
      console.error(`       如需启动新实例，先停止旧进程或删除锁文件。\n`);
      process.exit(1);
    }
    console.error(`\x1b[33m[WARN] 发现残留锁文件 (PID ${existing.pid} 已不存在)，覆盖中...\x1b[0m`);
  }

  try {
    fs.writeFileSync(LOCK_FILE, `${process.pid}\n${port}\n${new Date().toISOString()}`, 'utf8');
    if (!existing) {
      console.error(`\x1b[36m[INFO] PID: ${process.pid}, lock: ${LOCK_FILE}\x1b[0m`);
    }
  } catch (e) {
    console.error(`\x1b[33m[WARN] 无法写入锁文件 ${LOCK_FILE}: ${e.message}\x1b[0m`);
  }
}

export function unlock() {
  try {
    const existing = getPidInfo();
    if (existing && existing.pid === process.pid) {
      fs.unlinkSync(LOCK_FILE);
      console.error(`锁文件已清理: ${LOCK_FILE}`);
    }
  } catch {}
}
