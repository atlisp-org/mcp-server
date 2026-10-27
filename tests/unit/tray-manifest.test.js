// scripts/build-tray-manifest.mjs 单测：SHA256/大小、缺文件策略、SHASUMS 格式。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { buildManifest, formatShasums } from '../../scripts/build-tray-manifest.mjs';
import { DEFAULT_BASE_URLS } from '../../tray/tray-download.js';

const TEST_DIR = `/tmp/opencode/tray-manifest-test-${process.pid}`;

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

beforeEach(() => {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('buildManifest', () => {
  it('记录托盘 exe 的 sha256 与大小', () => {
    fs.writeFileSync(path.join(TEST_DIR, 'AtlispTray.exe'), 'tray');

    const manifest = buildManifest({ distDir: TEST_DIR, version: '1.2.3' });

    expect(manifest.version).toBe('1.2.3');
    expect(manifest.baseUrls).toEqual(DEFAULT_BASE_URLS);
    expect(manifest.baseUrl).toBe(DEFAULT_BASE_URLS[0]);
    expect(manifest.files['AtlispTray.exe']).toEqual({ sha256: sha256(Buffer.from('tray')), size: 4 });
  });

  it('requireAll 时缺文件即失败', () => {
    expect(() => buildManifest({ distDir: TEST_DIR, version: '1.0.0', requireAll: true }))
      .toThrow(/缺少待发布文件/);
  });

  it('目录里一个 exe 都没有时失败', () => {
    expect(() => buildManifest({ distDir: TEST_DIR, version: '1.0.0' }))
      .toThrow(/没有任何托盘二进制/);
  });

  it('支持自定义 baseUrls（多源顺序）', () => {
    fs.writeFileSync(path.join(TEST_DIR, 'AtlispTray.exe'), 'tray');
    const manifest = buildManifest({
      distDir: TEST_DIR,
      version: '1.0.0',
      baseUrls: ['https://mirror.example/tray/v{version}', 'https://github.com/x/y/releases/download/v{version}'],
    });
    expect(manifest.baseUrls).toEqual([
      'https://mirror.example/tray/v{version}',
      'https://github.com/x/y/releases/download/v{version}',
    ]);
    expect(manifest.baseUrl).toBe('https://mirror.example/tray/v{version}');
  });
});

describe('formatShasums', () => {
  it('按文件名排序，输出 sha256sum 兼容格式', () => {
    const manifest = {
      files: {
        'AtlispTray.exe': { sha256: 'a'.repeat(64), size: 1 },
      },
    };
    expect(formatShasums(manifest)).toBe(`${'a'.repeat(64)}  AtlispTray.exe\n`);
  });
});
