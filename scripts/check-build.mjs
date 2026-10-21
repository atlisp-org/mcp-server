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

console.log(`[check-build] OK v${pkg.version} ${meta.commit || ''} ${meta.builtAt}`);
