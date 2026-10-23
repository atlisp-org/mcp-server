// 编译 src/cad-rothelper.cs → dist/cad-rothelper.dll（edge-js CAD ROT 枚举帮助器）
//
// Windows：使用系统自带的 .NET Framework csc.exe。
// Linux/macOS：使用 dotnet 自带的 Roslyn csc 配合 .NET Framework 4.8 参考程序集
//              交叉编译（与 build-tray.mjs 同一方案），让 Linux 发布机也能把 dll
//              打进 npm 包。非 Windows 平台未安装 .NET SDK 时跳过并告警（CI 友好）；
//              发布机需安装 .NET SDK，否则包内缺 dll，Windows 用户的 CAD 实例发现
//              （ROT）将不可用。

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findRoslynCsc, ensureNet48References } from './net48-refs.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'src', 'cad-rothelper.cs');
const outDir = path.join(root, 'dist');
const output = path.join(outDir, 'cad-rothelper.dll');

function log(message) {
  console.log(`[build:rot] ${message}`);
}

function fail(message) {
  console.error(`[build:rot] ${message}`);
  process.exit(1);
}

if (!fs.existsSync(source)) {
  fail(`找不到源文件：${source}`);
}
fs.mkdirSync(outDir, { recursive: true });

if (process.platform === 'win32') {
  const CANDIDATES = [
    'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
    'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe',
  ];
  const csc = CANDIDATES.find((p) => fs.existsSync(p));
  if (!csc) {
    fail('未找到 csc.exe（需要 .NET Framework v4.0.30319）');
  }
  execFileSync(csc, ['/target:library', `/out:${output}`, source], {
    stdio: 'inherit',
  });
} else {
  const tool = findRoslynCsc();
  if (!tool) {
    console.warn('[build:rot] 未找到 dotnet，跳过 cad-rothelper.dll 编译（发布机请安装 .NET SDK）');
    process.exit(0);
  }

  const referenceDir = await ensureNet48References(path.join(root, '.cache'), log);
  // 显式引用（与 build-tray.mjs 同一风格）。cad-rothelper.cs 用到
  // System.Runtime.InteropServices/ComTypes/Threading.Tasks 与 dynamic
  // （dynamic 的 CallSite 绑定需要 Microsoft.CSharp）。
  const references = [
    'mscorlib.dll',
    'System.dll',
    'System.Core.dll',
    'Microsoft.CSharp.dll'
  ];

  const args = [
    tool.csc,
    '-nologo',
    '-target:library',
    '-langversion:5',
    '-platform:anycpu',
    '-codepage:65001',
    '-optimize+',
    `-out:${output}`,
    ...references.map((name) => {
      const reference = path.join(referenceDir, name);
      if (!fs.existsSync(reference)) {
        fail(`缺少参考程序集：${reference}`);
      }
      return `-r:${reference}`;
    }),
    source
  ];

  log(`使用 .NET SDK ${tool.version} 的 Roslyn 编译器交叉编译...`);
  try {
    execFileSync(tool.dotnet, args, { stdio: 'inherit' });
  } catch (error) {
    fail(`编译失败：${error.message}`);
  }
}

if (!fs.existsSync(output)) {
  fail('构建结束但未找到 dist/cad-rothelper.dll');
}
const size = fs.statSync(output).size;
if (size <= 0) {
  fail('生成的 dll 为空。');
}
log(`dist/cad-rothelper.dll 编译完成（${(size / 1024).toFixed(1)} KB）`);
