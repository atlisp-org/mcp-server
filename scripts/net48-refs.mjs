// 非 Windows 平台交叉编译 .NET Framework 4.8 C# 的公共辅助
// （build-tray.mjs / build-rot.mjs 共用）：
// - findRoslynCsc()：定位 .NET SDK 自带的 Roslyn csc（<sdk>/Roslyn/bincore/csc.dll）
// - ensureNet48References()：下载并解压 .NET Framework 4.8 参考程序集
//   （约 21 MB，缓存在 <root>/.cache/，首次构建后走缓存）

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const NUPKG_VERSION = '1.0.3';
const NUPKG_NAME = `microsoft.netframework.referenceassemblies.net48.${NUPKG_VERSION}.nupkg`;
const NUPKG_URL =
  'https://api.nuget.org/v3-flatcontainer/' +
  `microsoft.netframework.referenceassemblies.net48/${NUPKG_VERSION}/` +
  NUPKG_NAME;

export function findExecutable(name) {
  const probe = spawnSync(name, ['--version'], { stdio: 'ignore' });
  return probe.error ? null : name;
}

export function findLatestSdk(dotnet) {
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

/**
 * 返回 { dotnet, version, csc }；未安装 .NET SDK 或 SDK 缺少 Roslyn 时返回 null。
 */
export function findRoslynCsc() {
  const dotnet = findExecutable('dotnet');
  if (!dotnet) return null;
  const sdk = findLatestSdk(dotnet);
  if (!sdk) return null;
  const csc = path.join(sdk.root, 'Roslyn', 'bincore', 'csc.dll');
  if (!fs.existsSync(csc)) return null;
  return { dotnet, version: sdk.version, csc };
}

/**
 * 确保 net48 参考程序集就绪，返回参考程序集目录
 * （build/.NETFramework/v4.8/，含 mscorlib.dll 等）。
 * 已缓存（marker 存在）时直接返回；否则下载 nupkg 并解压到 cacheRoot。
 */
export async function ensureNet48References(cacheRoot, log = () => {}) {
  const extractedDir = path.join(cacheRoot, 'net48');
  const referenceDir = path.join(extractedDir, 'build', '.NETFramework', 'v4.8');
  const marker = path.join(referenceDir, 'mscorlib.dll');

  if (fs.existsSync(marker)) return referenceDir;

  fs.mkdirSync(cacheRoot, { recursive: true });
  const nupkg = path.join(cacheRoot, NUPKG_NAME);

  if (!fs.existsSync(nupkg) || fs.statSync(nupkg).size < 1024 * 1024) {
    log('首次构建：下载 .NET Framework 4.8 参考程序集（约 21 MB）...');
    await downloadNupkg(NUPKG_URL, nupkg, log);
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
      throw new Error(`解压参考程序集失败（需要 unzip 或 python3）：${error.message}`);
    }
  }

  if (!fs.existsSync(marker)) {
    throw new Error('参考程序集目录结构异常。');
  }
  log(`参考程序集已缓存到 ${path.basename(cacheRoot)}/net48`);
  return referenceDir;
}

async function downloadNupkg(url, target, log) {
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
    throw new Error('下载 .NET Framework 参考程序集失败。');
  }
}
