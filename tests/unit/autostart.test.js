// autostart.js 单测：mock child_process / os.release，XDG 目录指向临时目录，
// 覆盖 linux/darwin/win32 三分支的安装/卸载/状态与不支持平台。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { execSync, spawnSync } from 'child_process';
import os from 'os';

const TEST_HOME = `/tmp/opencode/autostart-test-${process.pid}`;
const XDG_DIR = path.join(TEST_HOME, 'xdg');

vi.mock('child_process', () => ({
  execSync: vi.fn(() => Buffer.from('ok')),
  spawnSync: vi.fn(() => ({ status: 0, stdout: Buffer.from('ok'), stderr: Buffer.from('') })),
  exec: vi.fn(),
  spawn: vi.fn(),
}));

const releaseState = vi.hoisted(() => ({ value: '6.1.7601' }));
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    default: { ...actual.default, homedir: () => TEST_HOME, release: () => releaseState.value },
    homedir: () => TEST_HOME,
    release: () => releaseState.value,
  };
});

const autostart = await import('../../src/autostart.js');

const PLIST_PATH = path.join(TEST_HOME, 'Library', 'LaunchAgents', 'com.atlisp.mcp.plist');
const DESKTOP_PATH = path.join(XDG_DIR, 'autostart', 'atlisp-mcp.desktop');

function setPlatform(p) {
  Object.defineProperty(process, 'platform', { value: p, configurable: true });
}

const REAL_PLATFORM = process.platform;

beforeEach(() => {
  vi.clearAllMocks();
  fs.rmSync(TEST_HOME, { recursive: true, force: true });
  process.env.XDG_CONFIG_HOME = XDG_DIR;
  releaseState.value = '6.1.7601';
});

afterEach(() => {
  setPlatform(REAL_PLATFORM);
  delete process.env.XDG_CONFIG_HOME;
  fs.rmSync(TEST_HOME, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('linux 分支', () => {
  beforeEach(() => setPlatform('linux'));

  it('installAutostart 写入 XDG desktop 文件', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(autostart.installAutostart()).toBe(true);
    const desktop = fs.readFileSync(DESKTOP_PATH, 'utf-8');
    expect(desktop).toContain('[Desktop Entry]');
    expect(desktop).toContain('Type=Application');
    expect(desktop).toContain(`Exec="${process.execPath}"`);
    expect(desktop).toContain('--transport http');
    expect(errSpy).toHaveBeenCalledWith('自动启动已安装 (XDG Autostart)');
  });

  it('autostartStatus 反映文件是否存在', () => {
    expect(autostart.autostartStatus()).toEqual({ installed: false });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    autostart.installAutostart();
    expect(autostart.autostartStatus()).toEqual({ installed: true });
  });

  it('uninstallAutostart 删除 desktop 文件', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    autostart.installAutostart();
    expect(autostart.uninstallAutostart()).toBe(true);
    expect(fs.existsSync(DESKTOP_PATH)).toBe(false);
    // 已删除时再次卸载也返回 true
    expect(autostart.uninstallAutostart()).toBe(true);
  });

  it('XDG_CONFIG_HOME 未设置时回退 ~/.config', () => {
    delete process.env.XDG_CONFIG_HOME;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(autostart.installAutostart()).toBe(true);
    expect(fs.existsSync(path.join(TEST_HOME, '.config', 'autostart', 'atlisp-mcp.desktop'))).toBe(true);
  });

  it('写入失败返回 false', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => { throw new Error('fs full'); });
    expect(autostart.installAutostart()).toBe(false);
  });
});

describe('win32 分支', () => {
  beforeEach(() => setPlatform('win32'));

  it('新内核（win10 ≥17763）用 conhost --headless 命令注册', () => {
    releaseState.value = '10.0.19045';
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(autostart.installAutostart()).toBe(true);
    const args = spawnSync.mock.calls[0][1];
    expect(spawnSync.mock.calls[0][0]).toBe('reg');
    expect(args[0]).toBe('add');
    const cmd = args[args.length - 2];
    expect(cmd).toContain('conhost.exe');
    expect(cmd).toContain('--headless');
  });

  it('旧内核（win7）回退 powershell -WindowStyle Hidden', () => {
    releaseState.value = '6.1.7601';
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(autostart.installAutostart()).toBe(true);
    const args = spawnSync.mock.calls[0][1];
    const cmd = args[args.length - 2];
    expect(cmd).toContain('powershell -WindowStyle Hidden');
  });

  it('win10 低于 17763 也回退 powershell', () => {
    releaseState.value = '10.0.16299';
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(autostart.installAutostart()).toBe(true);
    expect(spawnSync.mock.calls[0][1].slice(-2)[0]).toContain('powershell');
  });

  it('reg add 失败返回 false', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    spawnSync.mockReturnValueOnce({ status: 1, stdout: Buffer.from(''), stderr: Buffer.from('access denied') });
    expect(autostart.installAutostart()).toBe(false);
  });

  it('reg add 抛出系统错误返回 false', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    spawnSync.mockReturnValueOnce({ error: new Error('spawn ENOENT') });
    expect(autostart.installAutostart()).toBe(false);
  });

  it('uninstall 调 reg delete；失败返回 false', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(autostart.uninstallAutostart()).toBe(true);
    expect(spawnSync.mock.calls[0][1][0]).toBe('delete');

    spawnSync.mockReturnValueOnce({ status: 1, stdout: Buffer.from(''), stderr: Buffer.from('not found') });
    expect(autostart.uninstallAutostart()).toBe(false);
  });

  it('status 解析注册表命令中的 js 路径；reg 失败返回未安装', () => {
    execSync.mockReturnValueOnce(
      'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\n    atlisp-mcp    REG_SZ    "C:\\node\\node.exe" "C:\\srv\\atlisp-mcp.js" --transport http\n'
    );
    expect(autostart.autostartStatus()).toEqual({
      installed: true,
      command: 'C:\\srv\\atlisp-mcp.js',
      fullCommand: '"C:\\node\\node.exe" "C:\\srv\\atlisp-mcp.js" --transport http',
      trayInstalled: false,
    });

    execSync.mockImplementationOnce(() => { throw new Error('reg query failed'); });
    expect(autostart.autostartStatus()).toEqual({ installed: false, trayInstalled: false });
  });

  it('托盘自启存在时 status 标记 trayInstalled，install 给出二选一提示', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const trayLine =
      'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\n' +
      '    atlisp-mcp-tray    REG_SZ    "C:\\tray\\AtlispTray.exe" --silent\n';
    // status: 先查 atlisp-mcp（无）再查 atlisp-mcp-tray（有）；install: 再查一次 tray
    execSync
      .mockImplementationOnce(() => { throw new Error('not found'); })
      .mockImplementationOnce(() => trayLine)
      .mockImplementationOnce(() => trayLine);

    expect(autostart.autostartStatus()).toEqual({ installed: false, trayInstalled: true });

    expect(autostart.installAutostart()).toBe(true);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('托盘也注册了开机自启'));
  });

  it('旧内核命令用单引号包路径，新内核用 conhost --headless', () => {
    const oldCmd = autostart.buildWindowsAutostartCommand({
      execPath: 'C:\\Program Files\\nodejs\\node.exe',
      scriptPath: 'C:\\srv\\atlisp-mcp.js',
      release: '6.1.7601',
      systemRoot: 'C:\\Windows',
    });
    expect(oldCmd).toContain('powershell -WindowStyle Hidden');
    expect(oldCmd).toContain('C:\\srv\\atlisp-mcp.js');

    const newCmd = autostart.buildWindowsAutostartCommand({
      execPath: 'C:\\Program Files\\nodejs\\node.exe',
      scriptPath: 'C:\\srv\\atlisp-mcp.js',
      release: '10.0.19045',
      systemRoot: 'C:\\Windows',
    });
    expect(newCmd).toBe(
      '"C:\\Windows\\System32\\conhost.exe" --headless "C:\\Program Files\\nodejs\\node.exe" "C:\\srv\\atlisp-mcp.js" --transport http'
    );
  });
});

describe('darwin 分支', () => {
  beforeEach(() => setPlatform('darwin'));

  it('install 写 LaunchAgent plist 并 launchctl load', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(autostart.installAutostart()).toBe(true);
    const plist = fs.readFileSync(PLIST_PATH, 'utf-8');
    expect(plist).toContain('com.atlisp.mcp');
    expect(plist).toContain('RunAtLoad');
    expect(execSync).toHaveBeenCalledWith(expect.stringContaining('launchctl load'), expect.any(Object));
    expect(errSpy).toHaveBeenCalledWith('自动启动已安装 (LaunchAgent)');
  });

  it('install 失败返回 false', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    execSync.mockImplementationOnce(() => { throw new Error('launchctl fail'); });
    expect(autostart.installAutostart()).toBe(false);
  });

  it('uninstall 卸载并删除 plist；失败返回 false', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fs.mkdirSync(path.dirname(PLIST_PATH), { recursive: true });
    fs.writeFileSync(PLIST_PATH, '<plist/>', 'utf-8');
    expect(autostart.uninstallAutostart()).toBe(true);
    expect(fs.existsSync(PLIST_PATH)).toBe(false);

    execSync.mockImplementationOnce(() => { throw new Error('unload fail'); });
    expect(autostart.uninstallAutostart()).toBe(false);
  });

  it('status 反映 plist 存在性', () => {
    expect(autostart.autostartStatus()).toEqual({ installed: false });
    fs.mkdirSync(path.dirname(PLIST_PATH), { recursive: true });
    fs.writeFileSync(PLIST_PATH, '<plist/>', 'utf-8');
    expect(autostart.autostartStatus()).toEqual({ installed: true });
  });
});

describe('不支持的平台', () => {
  it('install 返回 false，status 带 error', () => {
    setPlatform('aix');
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(autostart.installAutostart()).toBe(false);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('不支持自动启动'));
    expect(autostart.uninstallAutostart()).toBe(false);
    expect(autostart.autostartStatus()).toEqual({ installed: false, error: 'aix 不支持自动启动' });
  });
});
