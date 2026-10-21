#!/usr/bin/env node
// 写入 dist/build-meta.json：记录本次构建对应的包版本、git 提交和构建时间。
//
// 背景：常量 SERVER_VERSION 运行时从 package.json 读取，所以即使 dist 是旧构建，
// 服务也会报告新版本号。.53 上就出现过「package.json=1.11.7、dist 仍是 1.11.6」
// 导致 @lisp 探测代码是旧的、自动安装永远 blocked。运行时比对 build-meta 可以
// 发现这种“版本号对了但代码是旧的”情况。
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

let commit = '';
try {
  commit = execSync('git rev-parse --short HEAD', { cwd: root, encoding: 'utf8' }).trim();
} catch {
  commit = '';
}

let dirty = false;
try {
  dirty = execSync('git status --porcelain', { cwd: root, encoding: 'utf8' }).trim().length > 0;
} catch {
  dirty = false;
}

const meta = {
  version: pkg.version,
  commit,
  dirty,
  builtAt: new Date().toISOString(),
};

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(
  path.join(root, 'dist', 'build-meta.json'),
  `${JSON.stringify(meta, null, 2)}\n`,
  'utf8'
);
console.log(`[build-meta] v${meta.version} ${meta.commit || '(no git)'}${meta.dirty ? ' (dirty)' : ''}`);
