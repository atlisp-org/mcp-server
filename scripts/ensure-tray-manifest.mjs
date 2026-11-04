#!/usr/bin/env node
// 确保 dist/tray-manifest.json 存在且与 package.json 版本一致。
//
// 为什么需要它：npm 包里的 `atlisp-tray`（bin 注册的托盘启动器）靠这份清单
// 定位下载地址并校验 SHA256。清单一旦缺失，托盘自更新会以「包内没有
// tray\atlisp-tray.js / tray-manifest.json」静默失败——v1.12.20 把启动器与
// 清单一起从包里删掉时就是这个症状。
//
// 行为：
//   1. dist 里已有清单（build:tray / CI 签名产物）→ 只把 version 改成本次
//      发布的版本；哈希与 tray/exe-baseline.json 不同则告警（白名单要重提）。
//   2. dist 里没有清单 → 用基线里的冻结哈希补一份。发版机器上不需要那个
//      178 KB 的 exe，也保证发出去的就是白名单里那份文件的哈希。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_BASE_URLS } from '../tray/tray-download.js';
import { formatShasums } from './build-tray-manifest.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function ensureTrayManifest({
  rootDir = root,
  version,
  baseUrls = DEFAULT_BASE_URLS,
  log = (message) => console.log(`[tray-manifest] ${message}`),
} = {}) {
  const distDir = path.join(rootDir, 'dist');
  const manifestPath = path.join(distDir, 'tray-manifest.json');
  const baselinePath = path.join(rootDir, 'tray', 'exe-baseline.json');

  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  const targetVersion = version || pkg.version;
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));

  fs.mkdirSync(distDir, { recursive: true });

  let manifest = null;
  if (fs.existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch {
      manifest = null;
    }
  }

  const exe = manifest && manifest.files && manifest.files['AtlispTray.exe'];
  if (exe) {
    manifest.version = targetVersion;
    const actual = String(exe.sha256 || '').toLowerCase();
    if (baseline.sha256 && actual !== String(baseline.sha256).toLowerCase()) {
      log(
        `警告：exe 哈希 (${actual.slice(0, 12)}…) 与基线 (${String(baseline.sha256).slice(0, 12)}…) 不同；` +
        '重建后要重新提交误报并更新 tray/exe-baseline.json'
      );
    }
  } else {
    if (!baseline.sha256 || !baseline.size) {
      throw new Error('缺少 tray/exe-baseline.json（sha256/size），无法生成发布清单');
    }
    manifest = {
      version: targetVersion,
      generatedAt: new Date().toISOString(),
      baseUrls,
      baseUrl: baseUrls[0],
      files: {
        'AtlispTray.exe': {
          sha256: baseline.sha256,
          size: baseline.size,
          signed: baseline.signed === true,
        },
      },
    };
    log(
      `dist 里没有清单，已按基线生成 v${targetVersion}（${String(baseline.sha256).slice(0, 12)}…）`
    );
  }

  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(distDir, 'SHASUMS256.txt'), formatShasums(manifest), 'utf8');
  return manifest;
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  try {
    const manifest = ensureTrayManifest();
    console.log(`[tray-manifest] OK v${manifest.version}（${Object.keys(manifest.files).join(', ')}）`);
  } catch (error) {
    console.error(`[tray-manifest] ${error.message}`);
    process.exit(1);
  }
}
