#!/usr/bin/env node
// 把托盘二进制上传到 atlisp.cn，供 https://atlisp.cn/download/<文件名> 直接下载。
//
// 用法：
//   ATLISP_UPLOAD_KEY=atlisp_xxx node scripts/upload-tray.mjs
//   ATLISP_UPLOAD_KEY=... node scripts/upload-tray.mjs --dry-run
//
// 环境变量：
//   ATLISP_UPLOAD_KEY   必填。atlisp.cn → 用户中心 → 安全 → 上传密钥（role ≥ developer）
//   ATLISP_UPLOAD_URL   默认 https://atlisp.cn/upload
//   ATLISP_TRAY_EDITION 默认 download（对应 public_html/download/）
//   ATLISP_TRAY_PKG     默认空 = 直接放 download/ 根下；设了就放到 download/<pkg>/v<version>/
//
// 上传成功后文件地址：https://atlisp.cn/download/AtlispTray.exe
// —— 与 tray-manifest.json 里的首选 baseUrl 一致（客户端会加 ?v=<版本> 防缓存）。

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const UPLOAD_URL = process.env.ATLISP_UPLOAD_URL || 'https://atlisp.cn/upload';
const API_KEY = process.env.ATLISP_UPLOAD_KEY || '';
const PKG = process.env.ATLISP_TRAY_PKG || '';
const EDITION = process.env.ATLISP_TRAY_EDITION || 'download';
const FILES = ['AtlispTray.exe', 'AtlispUpdater.exe', 'tray-manifest.json', 'SHASUMS256.txt'];
const MAX_ATTEMPTS = 3;

const dryRun = process.argv.includes('--dry-run');
// 位置参数 = 只上传指定文件（默认全部），例如：node scripts/upload-tray.mjs AtlispUpdater.exe
const only = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));

function log(message) {
  console.log(`[upload-tray] ${message}`);
}

function fail(message) {
  console.error(`[upload-tray] ${message}`);
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
// PKG 为空 → 直接落 download/ 根；否则 download/<pkg>/v<版本>/
const targetDir = PKG ? `${PKG}/v${pkg.version}` : '';
const publicBase = PKG
  ? `https://atlisp.cn/download/${targetDir}`
  : 'https://atlisp.cn/download';

async function uploadOne(file) {
  const buffer = await fs.promises.readFile(file);
  const form = new FormData();
  form.append('key', API_KEY);
  form.append('pkg-name', targetDir);
  form.append('edition', EDITION);
  form.append(
    'file',
    new Blob([buffer], { type: 'application/octet-stream' }),
    path.basename(file)
  );

  let lastError = '';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(UPLOAD_URL, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(120_000),
      });
      const text = await response.text();
      if (!response.ok) {
        lastError = `HTTP ${response.status}: ${text.slice(0, 200)}`;
      } else if (!/:result\s*\.\s*T/i.test(text)) {
        lastError = `服务端拒绝：${text.slice(0, 300)}`;
      } else {
        return;
      }
    } catch (error) {
      lastError = error.message;
    }
    if (attempt < MAX_ATTEMPTS) {
      log(`${path.basename(file)} 第 ${attempt} 次失败（${lastError}），重试...`);
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
  throw new Error(`${path.basename(file)} 上传失败：${lastError}`);
}

async function verifyOne(file) {
  const name = path.basename(file);
  const expected = createHash('sha256').update(await fs.promises.readFile(file)).digest('hex');
  const url = `${publicBase}/${name}?v=${encodeURIComponent(pkg.version)}`;
  let lastError = '';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { 'user-agent': '@atlisp/mcp tray-uploader' },
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) {
        lastError = `HTTP ${response.status}`;
      } else {
        const actual = createHash('sha256')
          .update(Buffer.from(await response.arrayBuffer()))
          .digest('hex');
        if (actual === expected) return;
        lastError = `SHA256 不一致（远端 ${actual.slice(0, 12)}…，本地 ${expected.slice(0, 12)}…）`;
      }
    } catch (error) {
      lastError = error.message;
    }
    if (attempt < MAX_ATTEMPTS) {
      log(`${name} 回读校验第 ${attempt} 次失败（${lastError}），重试...`);
      await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
    }
  }
  throw new Error(`${name} 回读校验失败：${lastError}（${url}）`);
}

async function main() {
  if (!API_KEY) fail('缺少 ATLISP_UPLOAD_KEY（atlisp.cn → 用户中心 → 安全 → 上传密钥）');

  const existing = FILES
    .map((name) => path.join(root, 'dist', name))
    .filter((file) => fs.existsSync(file))
    .filter((file) => !only.length || only.includes(path.basename(file)));
  if (!existing.length) {
    fail(only.length
      ? `dist 里没有指定文件：${only.join(', ')}`
      : 'dist 里没有可上传的文件（先生成签名产物并跑 build-tray-manifest）');
  }

  log(`目标：${UPLOAD_URL} → ${publicBase}/`);
  for (const file of existing) {
    if (dryRun) {
      log(`[dry-run] ${path.basename(file)} → ${publicBase}/${path.basename(file)}`);
      continue;
    }
    await uploadOne(file);
    log(`已上传 ${path.basename(file)}`);
  }
  if (!dryRun) {
    for (const file of existing) {
      await verifyOne(file);
      log(`回读校验通过 ${path.basename(file)}`);
    }
  }
  log(`完成：${publicBase}/`);
}

main().catch((error) => fail(error.message));
