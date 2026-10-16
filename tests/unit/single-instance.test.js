import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

/** 启动一个短暂存活的子进程，返回其 pid（用于"存活外部进程"场景） */
const spawnShortLived = () => {
  const child = spawn('sleep', ['5'], { stdio: 'ignore' });
  return child.pid;
};

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlisp-single-instance-test-'));

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, default: { ...actual.default, homedir: () => tmpDir } };
});

const importModule = () => import('../../src/single-instance.js');
const lockFile = () => path.join(tmpDir, '.atlisp', 'atlisp-mcp.lock');

describe('single-instance', () => {
  beforeEach(() => {
    fs.rmSync(lockFile(), { force: true });
    vi.resetModules();
  });

  it('无锁文件时正常写入并锁定', async () => {
    const { checkAndLock } = await importModule();
    expect(() => checkAndLock(8110)).not.toThrow();
    const content = fs.readFileSync(lockFile(), 'utf-8');
    const [pid, port] = content.split('\n');
    expect(parseInt(pid, 10)).toBe(process.pid);
    expect(port).toBe('8110');
  });

  it('同进程重复调用不退出', async () => {
    const { checkAndLock } = await importModule();
    checkAndLock(8110);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('__exit__'); });
    try {
      checkAndLock(8111);
      expect(exitSpy).not.toHaveBeenCalled();
    } finally {
      exitSpy.mockRestore();
    }
  });

  it('存活的外部进程持锁时 process.exit(1)', async () => {
    const alivePid = spawnShortLived();
    fs.mkdirSync(path.dirname(lockFile()), { recursive: true });
    fs.writeFileSync(lockFile(), `${alivePid}\n9999\n2026-01-01T00:00:00Z`, 'utf-8');

    const { checkAndLock } = await importModule();
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => { throw new Error(`__exit_${code}__`); });
    try {
      expect(() => checkAndLock(8110)).toThrow('__exit_1__');
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      exitSpy.mockRestore();
    }
  });

  it('残留死进程锁被覆盖且不退出', async () => {
    const deadPid = 4000000 + (process.pid % 100000);
    fs.mkdirSync(path.dirname(lockFile()), { recursive: true });
    fs.writeFileSync(lockFile(), `${deadPid}\n9999\n2026-01-01T00:00:00Z`, 'utf-8');

    const { checkAndLock } = await importModule();
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('__exit__'); });
    try {
      expect(() => checkAndLock(8110)).not.toThrow();
      expect(exitSpy).not.toHaveBeenCalled();
      const [pid] = fs.readFileSync(lockFile(), 'utf-8').split('\n');
      expect(parseInt(pid, 10)).toBe(process.pid);
    } finally {
      exitSpy.mockRestore();
    }
  });

  it('unlock 只清理自己的锁', async () => {
    const { checkAndLock, unlock } = await importModule();
    checkAndLock(8110);
    unlock();
    expect(fs.existsSync(lockFile())).toBe(false);

    // 他人锁不被清理
    fs.mkdirSync(path.dirname(lockFile()), { recursive: true });
    fs.writeFileSync(lockFile(), `1\n9999\n2026-01-01T00:00:00Z`, 'utf-8');
    unlock();
    expect(fs.existsSync(lockFile())).toBe(true);
  });
});
