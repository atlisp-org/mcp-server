#!/usr/bin/env node
// 发布前校验：dist 必须存在，且 build-meta.json 的版本与 package.json 一致。
//
// 用于 prepublishOnly：`npm publish --ignore-scripts` 会跳过 prepack 和本脚本，
// 那种情况无法拦截；但正常发布时它能避免把旧 dist 一起发出去。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const dist = path.join(root, 'dist', 'atlisp-mcp.js');
const metaPath = path.join(root, 'dist', 'build-meta.json');

function fail(message) {
  console.error(`[check-build] ${message}`);
  process.exit(1);
}

if (!fs.existsSync(dist)) {
  fail('dist/atlisp-mcp.js 不存在，请先运行 npm run build');
}

let meta;
try {
  meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
} catch {
  fail('缺少 dist/build-meta.json，请先运行 npm run build');
}

if (meta.version !== pkg.version) {
  fail(
    `dist 版本 (${meta.version}) 与 package.json (${pkg.version}) 不一致：` +
    '请重新运行 npm run build，确认 npm config get ignore-scripts 不为 true'
  );
}

if (!meta.commit) {
  console.warn('[check-build] build-meta 没有 git commit（发布目录不是 git 仓库？）');
}

/* 托盘启动器与清单必须一起发（v1.12.20 曾把两者从包里删掉，结果托盘自更新
   静默失败：「包内没有 tray\atlisp-tray.js」）。三样缺一不可，发布前钉住。 */
if (!pkg.bin || !pkg.bin['atlisp-tray']) {
  fail('package.json 的 bin 缺少 atlisp-tray（托盘自更新要调用它）');
}
if (!Array.isArray(pkg.files) || !pkg.files.includes('tray/atlisp-tray.js')) {
  fail('package.json 的 files 没有收录 tray/atlisp-tray.js');
}
if (!Array.isArray(pkg.files) || pkg.files.includes('!dist/tray-manifest.json')) {
  fail('package.json 的 files 不能排除 dist/tray-manifest.json（atlisp-tray 靠它校验下载）');
}

const trayManifestPath = path.join(root, 'dist', 'tray-manifest.json');
if (!fs.existsSync(trayManifestPath)) {
  fail('缺少 dist/tray-manifest.json：先运行 node scripts/ensure-tray-manifest.mjs');
}
let trayManifest;
try {
  trayManifest = JSON.parse(fs.readFileSync(trayManifestPath, 'utf8'));
} catch (error) {
  fail(`dist/tray-manifest.json 不是合法 JSON：${error.message}`);
}
if (trayManifest.version !== pkg.version) {
  fail(
    `托盘清单版本 (${trayManifest.version}) 与 package.json (${pkg.version}) 不一致：` +
    '请运行 node scripts/ensure-tray-manifest.mjs'
  );
}
const trayEntry = trayManifest.files && trayManifest.files['AtlispTray.exe'];
if (!trayEntry || !/^[0-9a-f]{64}$/i.test(trayEntry.sha256 || '') || !trayEntry.size) {
  fail('dist/tray-manifest.json 缺少 AtlispTray.exe 的 sha256/size');
}
try {
  const baseline = JSON.parse(fs.readFileSync(path.join(root, 'tray', 'exe-baseline.json'), 'utf8'));
  if (baseline.sha256 && trayEntry.sha256.toLowerCase() !== baseline.sha256.toLowerCase()) {
    console.warn(
      '[check-build] 警告：托盘 exe 哈希与 tray/exe-baseline.json 不同。' +
      '白名单按文件哈希生效，换了哈希就要重新提交误报（见 tray/false-positive-submission.md）'
    );
  }
} catch {
  console.warn('[check-build] 警告：读不到 tray/exe-baseline.json，无法核对误报基线');
}

console.log(`[check-build] OK v${pkg.version} ${meta.commit || ''} ${meta.builtAt}`);
