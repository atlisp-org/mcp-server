#!/usr/bin/env node
// @lisp MCP 托盘启动器（仅 Windows）
//
// npm i -g @atlisp/mcp 后执行：
//   atlisp-tray
//
// 注意：`AtlispTray.exe` / `AtlispUpdater.exe` **不在 npm 包里**（未签名 PE 会在
// `npm install` 阶段被杀软扫描）。首次运行会从 GitHub Releases 下载到
// %LOCALAPPDATA%\Programs\atlisp-mcp，并用 manifest 里的 SHA256 校验后才启动。
//
// 可用环境变量：
//   ATLISP_TRAY_BASE_URL   下载镜像前缀（默认 GitHub Releases，国内可指向自建镜像）
//
// 常用参数：
//   --force-download       忽略本地缓存，重新下载
//   --check                只打印路径/版本/下载源，不启动
//   --version              打印版本
//   --help                 帮助
// 其余参数原样传给托盘（如 --silent --start-server）。

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_BASE_URLS,
  defaultInstallDir,
  ensureBinaries,
  expandBaseUrl,
  readManifest,
  resolveBaseUrls,
} from './tray-download.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageVersion = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8')).version;
  } catch {
    return 'unknown';
  }
})();

function help() {
  console.log(`@lisp MCP 托盘启动器 v${packageVersion}

用法: atlisp-tray [选项] [托盘参数...]

选项:
  --force-download     重新下载托盘二进制（默认按 SHA256 复用本地缓存）
  --base-url <url>     下载源前缀，支持 {version} 占位符
  --check              只打印路径、版本与下载源，不启动
  -v, --version        显示版本
  -h, --help           显示帮助

环境变量:
  ATLISP_TRAY_BASE_URL 只用指定下载源（默认依次尝试 ${DEFAULT_BASE_URLS.join(' , ')}）

托盘二进制安装位置: ${defaultInstallDir()}
`);
}

function parseArgs(argv) {
  const options = { force: false, check: false, baseUrl: '', passthrough: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--version' || arg === '-v') {
      options.version = true;
    } else if (arg === '--check') {
      options.check = true;
    } else if (arg === '--force-download') {
      options.force = true;
    } else if (arg === '--base-url' && argv[i + 1]) {
      options.baseUrl = argv[++i];
    } else {
      options.passthrough.push(arg);
    }
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));

if (options.help) {
  help();
  process.exit(0);
}
if (options.version) {
  console.log(`atlisp-tray v${packageVersion}`);
  process.exit(0);
}

if (options.baseUrl) process.env.ATLISP_TRAY_BASE_URL = options.baseUrl;

const localExe = path.join(packageRoot, 'dist', 'AtlispTray.exe');
const installDir = defaultInstallDir();
const installedExe = path.join(installDir, 'AtlispTray.exe');

function launch(executable) {
  const child = spawn(executable, options.passthrough, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
}

let manifest;
try {
  manifest = readManifest(packageRoot);
} catch (error) {
  console.error(`托盘 manifest 损坏：${error.message}`);
  console.error('请重新安装 @atlisp/mcp（npm i -g @atlisp/mcp@latest）。');
  process.exit(1);
}

const bases = manifest
  ? resolveBaseUrls(manifest, process.env).map((base) => expandBaseUrl(base, manifest.version))
  : [];

// --check 在任意平台都能用（排查安装/下载问题）
if (options.check) {
  console.log(`atlisp-tray       v${packageVersion}`);
  console.log(`包内 exe          ${fs.existsSync(localExe) ? localExe : '（无，符合预期）'}`);
  console.log(`安装目录          ${installDir}`);
  console.log(`已安装 exe        ${fs.existsSync(installedExe) ? installedExe : '（无）'}`);
  console.log(`manifest 版本     ${manifest ? manifest.version : '（缺失）'}`);
  if (bases.length) {
    console.log('下载源（按顺序尝试）:');
    for (const base of bases) console.log(`  ${base}`);
  } else {
    console.log('下载源            （缺失 manifest，无法下载）');
  }
  process.exit(0);
}

if (process.platform !== 'win32') {
  console.error('@lisp MCP 托盘仅支持 Windows。');
  console.error('非 Windows 请直接用 MCP 客户端拉起：atlisp-mcp --stdio');
  process.exit(1);
}

// 兼容旧版安装包（exe 仍在 npm 包里）与源码目录里手工 build 的场景
if (!options.force && fs.existsSync(localExe)) {
  launch(localExe);
  process.exit(0);
}

if (!manifest) {
  console.error('未找到 dist/tray-manifest.json，无法确定托盘二进制的下载地址与校验值。');
  console.error('请重新安装 @atlisp/mcp；源码目录请先运行 npm run build:tray。');
  process.exit(1);
}

if (fs.existsSync(installedExe)) {
  console.log(`检查托盘二进制：${installDir}`);
}
try {
  const result = await ensureBinaries({
    installDir,
    manifest,
    force: options.force,
    log: (message) => console.log(message),
  });
  if (!result.downloaded.length) {
    console.log(`托盘已就绪（v${manifest.version}，本地缓存校验通过）`);
  } else {
    console.log(`托盘已安装 v${manifest.version} → ${installDir}`);
  }
} catch (error) {
  console.error(`托盘下载/校验失败：${error.message}`);
  console.error(`可手动下载 ${'AtlispTray.exe'} 放到：${installDir}`);
  console.error(`下载源：${bases.join(' , ')}`);
  process.exit(1);
}

launch(installedExe);
