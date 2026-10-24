#!/usr/bin/env node
// 构建 Windows 托盘程序：dist/AtlispTray.exe
//
// Windows：调用 tray/build.ps1，使用系统自带 .NET Framework csc.exe。
// Linux/macOS：使用 dotnet 自带的 Roslyn csc，配合 .NET Framework 4.8
//              参考程序集交叉编译（首次构建会下载约 21 MB，之后走缓存，
//              见 scripts/net48-refs.mjs）。
//
// 这样 npm publish 在 Linux 发布机上也能把 exe 打进 npm 包。

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
const size = fs.statSync(output).size;
if (size <= 0) {
  fail('生成的 exe 为空。');
}
log(`已生成 ${path.relative(root, output)}（${(size / 1024).toFixed(1)} KB）`);

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
    'System.Xml.dll',
    'System.IO.Compression.dll'
  ];

  const args = [
    tool.csc,
    '-nologo',
    '-target:winexe',
    '-langversion:5',
    '-platform:anycpu',
    '-codepage:65001',
    '-optimize+',
    '-warn:4',
    `-win32manifest:${manifest}`,
    `-win32icon:${icon}`,
    '-define:TRAY_VERSION_STAMPED',
    `-out:${output}`
  ];
  for (const name of references) {
    const reference = path.join(referenceDir, name);
    if (!fs.existsSync(reference)) {
      fail(`缺少参考程序集：${reference}`);
    }
    args.push(`-r:${reference}`);
  }
  args.push(source, writeBuildInfo());

  log(`使用 .NET SDK ${tool.version} 的 Roslyn 编译器编译...`);
  try {
    execFileSync(tool.dotnet, args, { stdio: 'inherit' });
  } catch (error) {
    fail(`编译失败：${error.message}`);
  }
}

/**
 * 把 npm 包版本写进托盘 exe（程序集版本 + BuildInfo.TrayVersion），
 * 供“关于/诊断”显示，也让托盘能和新包内的 exe 对比。
 */
function writeBuildInfo() {
  const numeric = packageVersion.split('-')[0].split('.').map(part => {
    const value = parseInt(part, 10);
    return Number.isFinite(value) ? value : 0;
  });
  while (numeric.length < 4) numeric.push(0);
  const fileVersion = numeric.slice(0, 4).join('.');

  const content = `[assembly: System.Reflection.AssemblyVersion("${fileVersion}")]
[assembly: System.Reflection.AssemblyFileVersion("${fileVersion}")]
[assembly: System.Reflection.AssemblyInformationalVersion("${packageVersion}")]
[assembly: System.Reflection.AssemblyTitle("AtlispTray")]
[assembly: System.Reflection.AssemblyDescription("@lisp MCP Server 托盘管理")]
[assembly: System.Reflection.AssemblyCompany("atlisp.cn")]
[assembly: System.Reflection.AssemblyProduct("@lisp MCP Server")]
[assembly: System.Reflection.AssemblyCopyright("Copyright (c) 2026 atlisp.cn")]
[assembly: System.Reflection.AssemblyTrademark("atlisp")]

namespace Atlisp.Tray
{
    internal static class BuildInfo
    {
        internal const string TrayVersion = "${packageVersion}";
    }
}
`;
  const dir = path.join(root, '.cache');
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, 'TrayBuildInfo.g.cs');
  fs.writeFileSync(target, content, 'utf8');
  return target;
}
