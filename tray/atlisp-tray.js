#!/usr/bin/env node
// @lisp MCP 托盘启动器（仅 Windows）
//
// npm i -g @atlisp/mcp 后执行：
//   atlisp-tray

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32') {
  console.error('@lisp MCP 托盘仅支持 Windows。');
  process.exit(1);
}

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const executable = path.join(packageRoot, 'dist', 'AtlispTray.exe');

if (!fs.existsSync(executable)) {
  console.error(`未找到托盘程序：${executable}`);
  console.error('请重新安装 @atlisp/mcp，或运行 npm run build:tray 后重试。');
  process.exit(1);
}

const child = spawn(executable, [], {
  detached: true,
  stdio: 'ignore',
  windowsHide: true
});
child.unref();
