// 托盘二进制的下载与校验（不依赖任何第三方包）
//
// 背景：`AtlispTray.exe` 不再随 npm 包发布（未签名 PE 会在
// `npm install` 阶段被 Defender 扫描并可能报 Wacatac/!ml）。npm 包里只放
// `tray/tray-download.js` 与 `dist/tray-manifest.json`（含 SHA256），首次执行
// `atlisp-tray` 时再按需下载到用户目录。
//
// 下载源默认是 GitHub Releases（见 manifest 的 baseUrl 或 ATLISP_TRAY_BASE_URL），
// 国内可把 ATLISP_TRAY_BASE_URL 指向自建镜像（目录结构需与被替换的 base 相同）。

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const TRAY_FILES = ['AtlispTray.exe'];

// 主源：atlisp.cn 的 /download 目录（管理员直接放文件，国内访问稳定）。
// 备用源：GitHub Release（CI 产物的原始位置，主源故障时兜底）。
export const DEFAULT_BASE_URLS = [
  'https://atlisp.cn/download',
  'https://github.com/atlisp-org/mcp-server/releases/download/v{version}',
];

/** 兼容旧调用方：默认主源（第一个）。 */
export const DEFAULT_BASE_URL = DEFAULT_BASE_URLS[0];

/**
 * 托盘二进制的安装目录（与托盘自迁移的目标一致）。
 *
 * 不用 npm 包目录：全局安装目录可能只读（Program Files），而且放包目录会让
 * 升级/替换 exe 撞上 EBUSY。
 */
export function defaultInstallDir(env = process.env) {
  const local =
    env.LOCALAPPDATA ||
    (env.USERPROFILE
      ? path.join(env.USERPROFILE, 'AppData', 'Local')
      : path.join(os.homedir(), 'AppData', 'Local'));
  return path.join(local, 'Programs', 'atlisp-mcp');
}

/** 解析并校验 manifest 结构；坏数据直接抛错，避免下载到错误的文件。 */
export function parseManifest(raw) {
  const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!data || typeof data !== 'object') throw new Error('manifest 不是对象');
  if (typeof data.version !== 'string' || !data.version) throw new Error('manifest 缺少 version');
  if (!data.files || typeof data.files !== 'object') throw new Error('manifest 缺少 files');
  for (const name of TRAY_FILES) {
    const entry = data.files[name];
    if (!entry) throw new Error(`manifest 缺少 ${name}`);
    if (!/^[0-9a-f]{64}$/i.test(entry.sha256 || '')) {
      throw new Error(`manifest 中 ${name} 的 sha256 无效`);
    }
  }
  return data;
}

/** 读取 npm 包内的 manifest；不存在返回 null（源码目录直接跑时会出现）。 */
export function readManifest(packageRoot) {
  const manifestPath = path.join(packageRoot, 'dist', 'tray-manifest.json');
  if (!fs.existsSync(manifestPath)) return null;
  return parseManifest(fs.readFileSync(manifestPath, 'utf8'));
}

/** 下载根地址列表：环境变量（单源）> manifest.baseUrls > manifest.baseUrl > 默认双源。 */
export function resolveBaseUrls(manifest, env = process.env) {
  if (env.ATLISP_TRAY_BASE_URL) {
    return [env.ATLISP_TRAY_BASE_URL.replace(/\/+$/, '')];
  }
  const list = Array.isArray(manifest?.baseUrls) && manifest.baseUrls.length
    ? manifest.baseUrls
    : manifest?.baseUrl
      ? [manifest.baseUrl]
      : DEFAULT_BASE_URLS;
  return list.map((item) => String(item).replace(/\/+$/, ''));
}

/** 兼容旧调用方：返回第一个下载源。 */
export function resolveBaseUrl(manifest, env = process.env) {
  return resolveBaseUrls(manifest, env)[0];
}

/**
 * 展开下载源模板：
 * - `{version}` 占位符替换成实际版本（版本目录）
 * - 没有 `{version}` 的扁平时源（如 https://atlisp.cn/download）自动追加 `?v=<版本>`，
 *   避免 CDN/浏览器把上一个版本的文件当缓存返回
 */
export function expandBaseUrl(base, version) {
  const raw = String(base);
  const hasVersion = raw.includes('{version}');
  const expanded = raw.replace(/\{version\}/g, version);
  if (hasVersion || /[?&]v=/.test(expanded)) return expanded;
  return `${expanded}${expanded.includes('?') ? '&' : '?'}v=${encodeURIComponent(version)}`;
}

/** 把源前缀拼成具体文件的 URL（保留 query，处理尾部斜杠）。 */
export function buildFileUrl(base, version, name) {
  const expanded = expandBaseUrl(base, version);
  try {
    const url = new URL(expanded);
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/${name}`;
    return url.toString();
  } catch {
    return `${expanded.replace(/\/+$/, '')}/${name}`;
  }
}

export async function sha256File(file) {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function fileMatches(file, entry) {
  try {
    const stat = await fs.promises.stat(file);
    if (entry.size && stat.size !== entry.size) return false;
    return (await sha256File(file)) === entry.sha256.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * 下载单个文件到 `<dest>.part`，校验 SHA256（和大小）通过才改名。
 * 校验失败直接删掉临时文件并抛错——绝不执行来源无法验证的二进制。
 */
export async function downloadVerified({
  url,
  dest,
  sha256,
  size,
  fetchImpl = globalThis.fetch,
  timeoutMs = 120_000,
  log = () => {},
}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('当前 Node 没有 fetch（需要 Node.js 20+）');
  }
  log(`下载 ${path.basename(dest)}：${url}`);
  const response = await fetchImpl(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'user-agent': '@atlisp/mcp tray-downloader' },
  });
  if (!response.ok) {
    throw new Error(`下载失败 HTTP ${response.status}：${url}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());

  const actual = createHash('sha256').update(buffer).digest('hex');
  if (actual !== String(sha256).toLowerCase()) {
    throw new Error(
      `SHA256 校验失败：${path.basename(dest)}\n  期望 ${sha256}\n  实际 ${actual}`
    );
  }
  if (size && buffer.length !== size) {
    throw new Error(`文件大小不符：${path.basename(dest)}（期望 ${size}，实际 ${buffer.length}）`);
  }

  const part = `${dest}.part`;
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  await fs.promises.writeFile(part, buffer);
  // Windows 上 rename 不能覆盖已存在文件
  await fs.promises.rm(dest, { force: true });
  await fs.promises.rename(part, dest);
}

/**
 * 确保安装目录里有可用的托盘二进制。
 *
 * - 已存在且 SHA256 与 manifest 一致 → 直接复用（不联网）
 * - 缺失或版本变化（hash 不同）→ 重新下载
 * - 任一文件校验失败 → 抛错，调用方不要启动托盘
 */
export async function ensureBinaries({
  installDir,
  manifest,
  env = process.env,
  fetchImpl,
  log = () => {},
  force = false,
  timeoutMs = 120_000,
}) {
  const bases = resolveBaseUrls(manifest, env);
  const result = { dir: installDir, downloaded: [], reused: [], sources: {} };

  for (const name of TRAY_FILES) {
    const entry = manifest.files[name];
    const dest = path.join(installDir, name);
    if (!force && (await fileMatches(dest, entry))) {
      result.reused.push(name);
      continue;
    }
    if (force) await fs.promises.rm(dest, { force: true });

    const errors = [];
    let saved = false;
    for (const base of bases) {
      try {
        await downloadVerified({
          url: buildFileUrl(base, manifest.version, name),
          dest,
          sha256: entry.sha256,
          size: entry.size,
          fetchImpl,
          timeoutMs,
          log,
        });
        result.sources[name] = base;
        saved = true;
        break;
      } catch (error) {
        errors.push(`${base}：${error.message}`);
        log(`源不可用，换下一个：${base}`);
      }
    }
    if (!saved) {
      throw new Error(
        `下载 ${name} 失败（所有下载源都不可用）：\n  ${errors.join('\n  ')}`
      );
    }
    result.downloaded.push(name);
  }

  // 托盘「关于」读这个文件显示真实版本（exe 版本资源固定 1.0.0.0）
  await fs.promises.writeFile(
    path.join(installDir, 'AtlispTray.version'),
    `${manifest.version}\n`,
    'utf8'
  );
  return result;
}
