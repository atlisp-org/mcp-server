#!/usr/bin/env node
// 构建 Windows 托盘程序：dist/AtlispTray.exe
//
// Windows：调用 tray/build.ps1，使用系统自带 .NET Framework csc.exe。
// Linux/macOS：使用 dotnet 自带的 Roslyn csc，配合 .NET Framework 4.8
//              参考程序集交叉编译（首次构建会下载约 21 MB，之后走缓存）。
//
// 这样 npm publish 在 Linux 发布机上也能把 exe 打进 npm 包。

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  const dotnet = findExecutable('dotnet');
  if (!dotnet) {
    fail('未找到 dotnet。非 Windows 发布机请安装 .NET SDK，或在 Windows 上发布。');
  }

  const sdk = findLatestSdk(dotnet);
  if (!sdk) {
    fail('未找到可用的 .NET SDK。');
  }

  const csc = path.join(sdk.root, 'Roslyn', 'bincore', 'csc.dll');
  if (!fs.existsSync(csc)) {
    fail(`未找到 Roslyn 编译器：${csc}`);
  }

  const referenceDir = await ensureNet48References();
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
    csc,
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

  log(`使用 .NET SDK ${sdk.version} 的 Roslyn 编译器编译...`);
  try {
    execFileSync(dotnet, args, { stdio: 'inherit' });
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

namespace Atlisp.Tray
{
    internal static class BuildInfo
    {
        internal const string TrayVersion = "${packageVersion}";
    }
}
`;
  const dir = path.join(root, 'tray', '.cache');
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, 'TrayBuildInfo.g.cs');
  fs.writeFileSync(target, content, 'utf8');
  return target;
}

function findExecutable(name) {  const probe = spawnSync(name, ['--version'], { stdio: 'ignore' });
  return probe.error ? null : name;
}

function findLatestSdk(dotnet) {
  let outputText;
  try {
    outputText = execFileSync(dotnet, ['--list-sdks'], { encoding: 'utf8' });
  } catch {
    return null;
  }

  const sdks = [];
  for (const line of outputText.split(/\r?\n/)) {
    const match = line.match(/^(\d+\.\d+\.\d+)\s+\[(.+)\]$/);
    if (match) {
      sdks.push({
        version: match[1],
        root: path.join(match[2], match[1])
      });
    }
  }
  sdks.sort((a, b) => compareVersion(b.version, a.version));
  return sdks[0] || null;
}

function compareVersion(a, b) {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return 0;
}

async function ensureNet48References() {
  const cacheDir = path.join(root, 'tray', '.cache');
  const extractedDir = path.join(cacheDir, 'net48');
  const referenceDir = path.join(extractedDir, 'build', '.NETFramework', 'v4.8');
  const marker = path.join(referenceDir, 'mscorlib.dll');

  if (fs.existsSync(marker)) return referenceDir;

  fs.mkdirSync(cacheDir, { recursive: true });
  const nupkg = path.join(
    cacheDir,
    'microsoft.netframework.referenceassemblies.net48.1.0.3.nupkg'
  );
  const url =
    'https://api.nuget.org/v3-flatcontainer/' +
    'microsoft.netframework.referenceassemblies.net48/1.0.3/' +
    'microsoft.netframework.referenceassemblies.net48.1.0.3.nupkg';

  if (!fs.existsSync(nupkg) || fs.statSync(nupkg).size < 1024 * 1024) {
    log('首次构建：下载 .NET Framework 4.8 参考程序集（约 21 MB）...');
    await download(url, nupkg);
  }

  fs.rmSync(extractedDir, { recursive: true, force: true });
  fs.mkdirSync(extractedDir, { recursive: true });

  let extracted = false;
  try {
    execFileSync('unzip', ['-q', '-o', nupkg, '-d', extractedDir], { stdio: 'inherit' });
    extracted = true;
  } catch {
    // 没有 unzip 时尝试 python3
  }

  if (!extracted) {
    try {
      execFileSync(
        'python3',
        ['-c', 'import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])',
          nupkg, extractedDir],
        { stdio: 'inherit' }
      );
      extracted = true;
    } catch (error) {
      fail(`解压参考程序集失败（需要 unzip 或 python3）：${error.message}`);
    }
  }

  if (!fs.existsSync(marker)) {
    fail('参考程序集目录结构异常。');
  }
  log(`参考程序集已缓存到 ${path.relative(root, referenceDir)}`);
  return referenceDir;
}

async function download(url, target) {
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': 'atlisp-mcp-build' }
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length < 1024 * 1024) {
      throw new Error(`文件过小：${buffer.length} 字节`);
    }
    fs.writeFileSync(target, buffer);
    return;
  } catch (error) {
    log(`Node 下载失败（${error.message}），尝试 curl...`);
  }

  const result = spawnSync('curl', ['-fsSL', url, '-o', target], { stdio: 'inherit' });
  if (result.status !== 0 || !fs.existsSync(target) ||
      fs.statSync(target).size < 1024 * 1024) {
    fail('下载 .NET Framework 参考程序集失败。');
  }
}
