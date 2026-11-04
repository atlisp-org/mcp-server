// scripts/build-tray-manifest.mjs 单测：SHA256/大小、缺文件策略、SHASUMS 格式。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { buildManifest, formatShasums } from '../../scripts/build-tray-manifest.mjs';
import { isAuthenticodeSigned } from '../../scripts/pe-signature.mjs';
import { DEFAULT_BASE_URLS } from '../../tray/tray-download.js';

const TEST_DIR = `/tmp/opencode/tray-manifest-test-${process.pid}`;

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * 造一个最小的 PE 头：MZ + e_lfanew → PE\0\0 + PE32 可选头 + 数据目录。
 * certSize > 0 表示带 Authenticode 证书表（签名）。
 */
function fakePe({ certSize = 0, length = 224 } = {}) {
  const buffer = Buffer.alloc(length);
  buffer.writeUInt16LE(0x5a4d, 0); // MZ
  const peOffset = 0x40;
  buffer.writeUInt32LE(peOffset, 0x3c);
  buffer.writeUInt32LE(0x00004550, peOffset); // PE\0\0
  buffer.writeUInt16LE(0x10b, peOffset + 24); // PE32
  // security data directory = PE32 可选头起点 + 96 + 4*8
  const certDir = peOffset + 24 + 96 + 32;
  buffer.writeUInt32LE(0, certDir); // 虚拟地址（签名表恒为 0）
  buffer.writeUInt32LE(certSize, certDir + 4);
  return buffer;
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
    expect(manifest.files['AtlispTray.exe']).toEqual({
      sha256: sha256(Buffer.from('tray')),
      size: 4,
      signed: false,
    });
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

describe('isAuthenticodeSigned（发布清单的 signed 字段 / 上传闸门）', () => {
  it('证书表长度为 0 → 未签名', () => {
    expect(isAuthenticodeSigned(fakePe({ certSize: 0 }))).toBe(false);
  });

  it('证书表非空 → 已签名', () => {
    expect(isAuthenticodeSigned(fakePe({ certSize: 512 }))).toBe(true);
  });

  it('不是 PE（HTML 错误页、被截断的下载）→ 未签名，且不抛错', () => {
    expect(isAuthenticodeSigned(Buffer.from('<html>403 Forbidden</html>'))).toBe(false);
    expect(isAuthenticodeSigned(Buffer.alloc(10))).toBe(false);
  });

  it('buildManifest 把真实签名状态写进清单', () => {
    fs.writeFileSync(path.join(TEST_DIR, 'AtlispTray.exe'), fakePe({ certSize: 1024 }));
    const manifest = buildManifest({ distDir: TEST_DIR, version: '1.2.3' });
    expect(manifest.files['AtlispTray.exe'].signed).toBe(true);
  });
});
