#!/usr/bin/env node
// 构建 Windows 托盘程序：dist/AtlispTray.exe
//
// Windows：调用 tray/build.ps1，使用系统自带 .NET Framework csc.exe。
// Linux/macOS：使用 dotnet 自带的 Roslyn csc，配合 .NET Framework 4.8
//              参考程序集交叉编译（首次构建会下载约 21 MB，之后走缓存，
//              见 scripts/net48-refs.mjs）。
//
// exe 不再随 npm 包发布：构建产物由 CI/发布机上传到 atlisp.cn 与 GitHub Release。

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findRoslynCsc, ensureNet48References } from './net48-refs.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'tray', 'AtlispTray.cs');
const manifest = path.join(root, 'tray', 'AtlispTray.manifest');
const icon = path.join(root, 'tray', 'atlisp.ico');
const outDir = path.join(root, 'dist');
const output = path.join(outDir, 'AtlispTray.exe');
const packageVersion = JSON.parse(
  fs.readFileSync(path.join(root, 'package.json'), 'utf8')
).version;

function log(message) {
  console.log(`[build:tray] ${message}`);
}

function fail(message) {
  console.error(`[build:tray] ${message}`);
  process.exit(1);
}

if (!fs.existsSync(source)) {
  fail(`找不到源文件：${source}`);
}
fs.mkdirSync(outDir, { recursive: true });

if (process.platform === 'win32') {
  const script = path.join(root, 'tray', 'build.ps1');
  const result = spawnSync(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Output', output],
    { stdio: 'inherit' }
  );
  if (result.error) {
    fail(`调用 PowerShell 失败：${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(`tray/build.ps1 退出码 ${result.status}`);
  }
} else {
  await buildWithDotnet();
}

if (!fs.existsSync(output)) {
  fail(`构建结束但未找到 ${output}`);
}
for (const artifact of [output]) {
  const size = fs.existsSync(artifact) ? fs.statSync(artifact).size : 0;
  if (size <= 0) {
    fail(`生成的 ${path.basename(artifact)} 为空。`);
  }
  log(`已生成 ${path.relative(root, artifact)}（${(size / 1024).toFixed(1)} KB）`);
}

async function buildWithDotnet() {
  const tool = findRoslynCsc();
  if (!tool) {
    fail('未找到 dotnet 或 .NET SDK 自带的 Roslyn 编译器。非 Windows 发布机请安装 .NET SDK，或在 Windows 上发布。');
  }

  const referenceDir = await ensureNet48References(path.join(root, '.cache'), log);
  const references = [
    'mscorlib.dll',
    'System.dll',
    'System.Core.dll',
    'System.Drawing.dll',
    'System.Windows.Forms.dll',
    'System.Web.Extensions.dll',
    'System.Xml.dll'
  ];

  log(`使用 .NET SDK ${tool.version} 的 Roslyn 编译器编译（v${packageVersion}）...`);
  compile({
    tool,
    referenceDir,
    references,
    sources: [writeStamp(), source],
    out: output,
    manifest,
  });
}

function compile({ tool, referenceDir, references, sources, out, manifest: manifestPath }) {
  const args = [
    tool.csc,
    '-nologo',
    '-target:winexe',
    '-langversion:5',
    '-platform:anycpu',
    '-codepage:65001',
    '-optimize+',
    '-warn:4',
    // 关键：源码不变时产出字节一致（hash 稳定，杀软信誉能累积）。
    // 同时把源码路径映射掉，避免构建机路径进入二进制。
    '-deterministic',
    `-pathmap:${root}=/atlisp-mcp`,
    `-win32icon:${icon}`,
    `-out:${out}`
  ];
  if (manifestPath) args.push(`-win32manifest:${manifestPath}`);
  for (const name of references) {
    const reference = path.join(referenceDir, name);
    if (!fs.existsSync(reference)) {
      fail(`缺少参考程序集：${reference}`);
    }
    args.push(`-r:${reference}`);
  }
  args.push(...sources);

  try {
    execFileSync(tool.dotnet, args, { stdio: 'inherit' });
  } catch (error) {
    fail(`编译失败：${path.basename(out)}：${error.message}`);
  }
}

/**
 * 生成固定版本的程序集属性文件。
 *
 * 刻意**不把 npm 包版本写进 exe**：版本烧进二进制会让每次发版都产出新 hash，
 * Defender/SmartScreen 对每个新 hash 都从 0 开始攒信誉。这里固定 1.0.0.0，
 * 真实版本号由 atlisp-tray 写到同目录的 AtlispTray.version，
 * 托盘启动时读它显示（见 Program.ResolveAppVersion）。
 * 只有真的改动托盘源码时产物才会变，hash 得以跨版本保持稳定。
 */
function writeStamp() {
  const content = `[assembly: System.Reflection.AssemblyVersion("1.0.0.0")]
[assembly: System.Reflection.AssemblyFileVersion("1.0.0.0")]
[assembly: System.Reflection.AssemblyTitle("AtlispTray")]
[assembly: System.Reflection.AssemblyDescription("@lisp MCP Server 托盘管理")]
[assembly: System.Reflection.AssemblyCompany("atlisp.cn")]
[assembly: System.Reflection.AssemblyProduct("@lisp MCP Server")]
[assembly: System.Reflection.AssemblyCopyright("Copyright (c) 2026 atlisp.cn")]
[assembly: System.Reflection.AssemblyTrademark("atlisp")]
`;
  const dir = path.join(root, '.cache');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'TrayStamp.g.cs');
  fs.writeFileSync(file, content, 'utf8');
  return file;
}
