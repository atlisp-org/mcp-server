import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlisp-lockfile-test-'));

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, default: { ...actual.default, homedir: () => tmpDir } };
});

vi.mock('../../src/logger.js', () => ({
  error: vi.fn(),
}));

const importLockfile = () => import('../../src/lockfile.js');

// 按 isAlive 的判定标准找一个确定不存活的 pid（process.kill 抛出非 EPERM 错误即视为不存在）
function findDeadPid() {
  for (let i = 0; i < 2000; i++) {
    const pid = 4000000 + i * 7919 + (process.pid % 500);
    try {
      process.kill(pid, 0); // 成功 → 进程存活，换一个
    } catch (e) {
      if (e.code !== 'EPERM') return pid; // ESRCH 等 → 确定不存在
    }
  }
  throw new Error('未找到确定不存活的测试 pid');
}

describe('lockfile', () => {
  beforeEach(() => {
    fs.rmSync(path.join(tmpDir, '.atlisp', 'locks'), { recursive: true, force: true });
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('成功获取空闲端口锁', async () => {
    const { acquirePortLock } = await importLockfile();
    const result = acquirePortLock(19999, '127.0.0.1');
    expect(result.ok).toBe(true);
  });

  it('锁被存活进程持有时获取失败并返回持有者信息', async () => {
    const { acquirePortLock } = await importLockfile();
    expect(acquirePortLock(19998, '127.0.0.1').ok).toBe(true);

    // 用另一个"进程"视角：写入一个存活 pid（当前进程 pid）
    const lockPath = path.join(tmpDir, '.atlisp', 'locks', 'atlisp-mcp-19997.lock');
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, port: 19997 }), 'utf-8');

    // 当前测试进程持有锁文件但 acquire 的 payload pid 也是 process.pid，
    // isAlive(process.pid) === true → 拒绝
    const result = acquirePortLock(19997, '127.0.0.1');
    expect(result.ok).toBe(false);
    expect(result.pid).toBe(process.pid);
  });

  it('陈旧锁（死亡 pid）被自动清理后重新获取', async () => {
    const { acquirePortLock } = await importLockfile();
    const lockPath = path.join(tmpDir, '.atlisp', 'locks', 'atlisp-mcp-19996.lock');
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    const deadPid = findDeadPid();
    fs.writeFileSync(lockPath, JSON.stringify({ pid: deadPid, port: 19996 }), 'utf-8');

    const result = acquirePortLock(19996, '127.0.0.1');
    expect(result.ok).toBe(true);
  });

  it('损坏的锁文件按陈旧锁处理', async () => {
    const { acquirePortLock } = await importLockfile();
    const lockPath = path.join(tmpDir, '.atlisp', 'locks', 'atlisp-mcp-19995.lock');
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, '{not-json!!', 'utf-8');

    const result = acquirePortLock(19995, '127.0.0.1');
    expect(result.ok).toBe(true);
  });

  it('releasePortLock 只释放自己的锁', async () => {
    const { acquirePortLock, releasePortLock } = await importLockfile();
    acquirePortLock(19994, '127.0.0.1');
    releasePortLock(19994);
    // 再次获取应成功（已释放）
    expect(acquirePortLock(19994, '127.0.0.1').ok).toBe(true);

    // 他人持有的锁：释放不应删除
    const lockPath = path.join(tmpDir, '.atlisp', 'locks', 'atlisp-mcp-19993.lock');
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid + 777777, port: 19993 }), 'utf-8');
    releasePortLock(19993);
    expect(fs.existsSync(lockPath)).toBe(true);
  });

  it('释放不存在的锁不抛错也不产生错误日志', async () => {
    const { releasePortLock } = await importLockfile();
    const { error } = await import('../../src/logger.js');
    expect(() => releasePortLock(19992)).not.toThrow();
    expect(error).not.toHaveBeenCalled();
  });

  it('重复释放（shutdown + exit 双路径）不产生错误日志', async () => {
    const { acquirePortLock, releasePortLock } = await importLockfile();
    const { error } = await import('../../src/logger.js');
    expect(acquirePortLock(19991, '127.0.0.1').ok).toBe(true);
    releasePortLock(19991); // shutdown() 路径：删除锁文件
    releasePortLock(19991); // exit 事件路径：锁已不存在，应为静默 no-op
    expect(error).not.toHaveBeenCalled();
  });

  it('锁目录被整体删除后释放不产生错误日志', async () => {
    const { acquirePortLock, releasePortLock } = await importLockfile();
    const { error } = await import('../../src/logger.js');
    acquirePortLock(19990, '127.0.0.1');
    fs.rmSync(path.join(tmpDir, '.atlisp', 'locks'), { recursive: true, force: true });
    expect(() => releasePortLock(19990)).not.toThrow();
    expect(error).not.toHaveBeenCalled();
  });
});
