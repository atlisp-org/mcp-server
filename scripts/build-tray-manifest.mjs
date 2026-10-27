#!/usr/bin/env node
// 生成托盘二进制的发布清单：
//   dist/tray-manifest.json  — 随 npm 包发布，`atlisp-tray` 据此下载 + 校验
//   dist/SHASUMS256.txt      — 随 GitHub Release 一起上传，供人工核对
//
// 用法：
//   node scripts/build-tray-manifest.mjs                 # 缺文件只告警
//   node scripts/build-tray-manifest.mjs --require-all   # 缺任一文件即失败（CI 用）
//   node scripts/build-tray-manifest.mjs --base-urls https://a/v{version},https://b/v{version}
//
// 默认下载源顺序：atlisp.cn/download（国内主源，由 scripts/upload-tray.mjs 上传）
// → GitHub Releases（兜底）。
// 只在签名之后生成：发布 job 里先用已签名的 exe 覆盖 dist/，再跑本脚本，
// 这样 manifest 里的 SHA256 才对得上用户下载到的那一份。

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_BASE_URLS, TRAY_FILES } from '../tray/tray-download.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * 生成 manifest 对象（不落盘，便于单测）。
 * 缺失文件在 requireAll=false 时跳过；返回的 files 只包含实际存在的文件。
 */
export function buildManifest({
  distDir,
  version,
  baseUrls = DEFAULT_BASE_URLS,
  requireAll = false,
  log = () => {},
}) {
  const files = {};
  const missing = [];

  for (const name of TRAY_FILES) {
    const file = path.join(distDir, name);
    if (!fs.existsSync(file)) {
      missing.push(name);
      continue;
    }
    const buffer = fs.readFileSync(file);
    files[name] = { sha256: sha256(buffer), size: buffer.length };
  }

  if (missing.length && requireAll) {
    throw new Error(`缺少待发布文件：${missing.join(', ')}（目录 ${distDir}）`);
  }
  if (missing.length) log(`跳过不存在的文件：${missing.join(', ')}`);
  if (!Object.keys(files).length) {
    throw new Error(`dist 里没有任何托盘二进制：${distDir}`);
  }

  const urls = (Array.isArray(baseUrls) ? baseUrls : [baseUrls]).filter(Boolean);
  return {
    version,
    generatedAt: new Date().toISOString(),
    // 下载源按顺序尝试：atlisp.cn/download（国内主源）→ GitHub Release（兜底）
    baseUrls: urls,
    baseUrl: urls[0], // 旧版启动器只认单个 baseUrl
    files,
  };
}

export function formatShasums(manifest) {
  return Object.entries(manifest.files)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, entry]) => `${entry.sha256}  ${name}`)
    .join('\n') + '\n';
}

function parseArgs(argv) {
  const options = { requireAll: false, baseUrls: [...DEFAULT_BASE_URLS] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--require-all') options.requireAll = true;
    else if (argv[i] === '--base-url' && argv[i + 1]) options.baseUrls = [argv[++i]];
    else if (argv[i] === '--base-urls' && argv[i + 1]) {
      options.baseUrls = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    }
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const distDir = path.join(root, 'dist');

  const manifest = buildManifest({
    distDir,
    version: pkg.version,
    baseUrls: options.baseUrls,
    requireAll: options.requireAll,
    log: (message) => console.warn(`[tray-manifest] ${message}`),
  });

  fs.writeFileSync(
    path.join(distDir, 'tray-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  );
  fs.writeFileSync(path.join(distDir, 'SHASUMS256.txt'), formatShasums(manifest), 'utf8');

  console.log(
    `[tray-manifest] v${manifest.version}：` +
    Object.keys(manifest.files).join(', ')
  );
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch((error) => {
    console.error(`[tray-manifest] ${error.message}`);
    process.exit(1);
  });
}
