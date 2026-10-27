// tray/tray-download.js 单测：manifest 校验、下载后的 SHA256 校验、缓存复用。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  DEFAULT_BASE_URLS,
  buildFileUrl,
  defaultInstallDir,
  ensureBinaries,
  expandBaseUrl,
  parseManifest,
  resolveBaseUrls,
  sha256File,
} from '../../tray/tray-download.js';

const TEST_DIR = `/tmp/opencode/tray-download-test-${process.pid}`;

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function fakeFetch(files, { status = 200, calls } = {}) {
  return vi.fn(async (url) => {
    if (calls) calls.push(url);
    const name = String(url).split('?')[0].split('/').pop();
    const buffer = files[name];
    if (!buffer || status >= 400) {
      return { ok: false, status: status >= 400 ? status : 404, arrayBuffer: async () => new ArrayBuffer(0) };
    }
    const copy = Buffer.from(buffer);
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () =>
        copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength),
    };
  });
}

const TRAY = Buffer.from('fake-tray-binary');

function manifestFor(tray = TRAY, overrides = {}) {
  return {
    version: '1.2.3',
    baseUrls: DEFAULT_BASE_URLS,
    files: {
      'AtlispTray.exe': { sha256: sha256(tray), size: tray.length },
    },
    ...overrides,
  };
}

beforeEach(() => {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('parseManifest', () => {
  it('接受合法 manifest（字符串或对象）', () => {
    const manifest = manifestFor();
    expect(parseManifest(JSON.stringify(manifest)).version).toBe('1.2.3');
    expect(parseManifest(manifest).files['AtlispTray.exe'].sha256).toBe(sha256(TRAY));
  });

  it('拒绝缺字段或非法 sha256', () => {
    expect(() => parseManifest({ files: {} })).toThrow(/version/);
    expect(() => parseManifest({ version: '1.0.0', files: {} })).toThrow(/AtlispTray\.exe/);
    const bad = manifestFor();
    bad.files['AtlispTray.exe'].sha256 = 'not-a-hash';
    expect(() => parseManifest(bad)).toThrow(/sha256/);
  });
});

describe('下载地址', () => {
  it('默认双源：atlisp.cn/download 优先，GitHub 兜底', () => {
    expect(resolveBaseUrls(manifestFor(), {})).toEqual(DEFAULT_BASE_URLS);
    expect(DEFAULT_BASE_URLS[0]).toBe('https://atlisp.cn/download');
  });

  it('环境变量强制单源，并去掉尾部斜杠', () => {
    expect(resolveBaseUrls(manifestFor(), { ATLISP_TRAY_BASE_URL: 'https://mirror.example/tray/' }))
      .toEqual(['https://mirror.example/tray']);
  });

  it('旧 manifest 的单个 baseUrl 仍可用', () => {
    expect(resolveBaseUrls({ baseUrl: 'https://old.example/v{version}' }, {}))
      .toEqual(['https://old.example/v{version}']);
  });

  it('{version} 占位符被替换', () => {
    expect(expandBaseUrl('https://x/v{version}', '1.2.3')).toBe('https://x/v1.2.3');
  });

  it('没有版本占位符的扁平时源追加 ?v= 防缓存', () => {
    expect(expandBaseUrl('https://atlisp.cn/download', '1.2.3'))
      .toBe('https://atlisp.cn/download?v=1.2.3');
    expect(expandBaseUrl('https://x/dl?v=9.9.9', '1.2.3')).toBe('https://x/dl?v=9.9.9');
  });

  it('buildFileUrl 拼接文件名并保留 query', () => {
    expect(buildFileUrl('https://atlisp.cn/download', '1.2.3', 'AtlispTray.exe'))
      .toBe('https://atlisp.cn/download/AtlispTray.exe?v=1.2.3');
    expect(buildFileUrl('https://github.com/o/r/releases/download/v{version}', '1.2.3', 'AtlispTray.exe'))
      .toBe('https://github.com/o/r/releases/download/v1.2.3/AtlispTray.exe');
  });
});

describe('ensureBinaries', () => {
  it('首次下载并写版本 sidecar', async () => {
    const fetchImpl = fakeFetch({ 'AtlispTray.exe': TRAY });
    const result = await ensureBinaries({
      installDir: TEST_DIR,
      manifest: manifestFor(),
      fetchImpl,
    });

    expect(result.downloaded).toEqual(['AtlispTray.exe']);
    expect(fs.readFileSync(path.join(TEST_DIR, 'AtlispTray.exe'))).toEqual(TRAY);
    expect(fs.readFileSync(path.join(TEST_DIR, 'AtlispTray.version'), 'utf8').trim()).toBe('1.2.3');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe('https://atlisp.cn/download/AtlispTray.exe?v=1.2.3');
  });

  it('本地文件 hash 一致时复用缓存，不联网', async () => {
    fs.writeFileSync(path.join(TEST_DIR, 'AtlispTray.exe'), TRAY);
    const fetchImpl = fakeFetch({});

    const result = await ensureBinaries({
      installDir: TEST_DIR,
      manifest: manifestFor(),
      fetchImpl,
    });

    expect(result.downloaded).toEqual([]);
    expect(result.reused).toEqual(['AtlispTray.exe']);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('版本变化（hash 不同）时重新下载', async () => {
    fs.writeFileSync(path.join(TEST_DIR, 'AtlispTray.exe'), Buffer.from('old'));
    const fetchImpl = fakeFetch({ 'AtlispTray.exe': TRAY });

    const result = await ensureBinaries({
      installDir: TEST_DIR,
      manifest: manifestFor(),
      fetchImpl,
    });

    expect(result.downloaded).toEqual(['AtlispTray.exe']);
    expect(fs.readFileSync(path.join(TEST_DIR, 'AtlispTray.exe'))).toEqual(TRAY);
  });

  it('主源不可用时自动切换备用源', async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url) => {
      calls.push(String(url));
      if (String(url).includes('atlisp.cn')) {
        return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
      }
      const buffer = Buffer.from(TRAY);
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () =>
          buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
      };
    });

    const result = await ensureBinaries({
      installDir: TEST_DIR,
      manifest: manifestFor(),
      fetchImpl,
    });

    expect(result.sources['AtlispTray.exe']).toContain('github.com');
    expect(calls.filter((u) => u.includes('atlisp.cn'))).toHaveLength(1);
    expect(fs.readFileSync(path.join(TEST_DIR, 'AtlispTray.exe'))).toEqual(TRAY);
  });

  it('所有源都失败时抛错并列出每个源的错误', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 503,
      arrayBuffer: async () => new ArrayBuffer(0),
    }));
    await expect(ensureBinaries({
      installDir: TEST_DIR,
      manifest: manifestFor(),
      fetchImpl,
    })).rejects.toThrow(/所有下载源都不可用/);
  });

  it('SHA256 不符时抛错且不落盘', async () => {
    const fetchImpl = fakeFetch({ 'AtlispTray.exe': Buffer.from('tampered') });
    await expect(ensureBinaries({
      installDir: TEST_DIR,
      manifest: manifestFor(),
      fetchImpl,
    })).rejects.toThrow(/SHA256 校验失败/);
    expect(fs.existsSync(path.join(TEST_DIR, 'AtlispTray.exe'))).toBe(false);
    expect(fs.existsSync(path.join(TEST_DIR, 'AtlispTray.exe.part'))).toBe(false);
  });

  it('HTTP 404 时抛错', async () => {
    const fetchImpl = fakeFetch({}, { status: 404 });
    await expect(ensureBinaries({
      installDir: TEST_DIR,
      manifest: manifestFor(),
      fetchImpl,
    })).rejects.toThrow(/HTTP 404/);
  });
});

describe('路径与哈希工具', () => {
  it('defaultInstallDir 优先 LOCALAPPDATA', () => {
    expect(defaultInstallDir({ LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local' }))
      .toBe(path.join('C:\\Users\\a\\AppData\\Local', 'Programs', 'atlisp-mcp'));
  });

  it('sha256File 与内存哈希一致', async () => {
    const file = path.join(TEST_DIR, 'x.bin');
    fs.writeFileSync(file, TRAY);
    expect(await sha256File(file)).toBe(sha256(TRAY));
  });
});
