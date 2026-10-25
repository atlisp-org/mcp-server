import { cad, getActiveConnection } from '../cad.js';
import config from '../config.js';
import { pool } from '../cad-pool.js';
import { CAD_PLATFORMS, FILE_EXTENSIONS } from '../constants.js';
import { getCached, setCache } from './resource-cache.js';
import { log } from '../logger.js';
import { parseLispList, parseLispRecursive } from '../handler-utils.js';
import { ensureCad } from './resource-utils.js';
import { buildBlockRefsCode, buildTablesCode, parseTableRecord } from './lisp-code-builders.js';

export async function getBlockRefs(params = {}) {
  // 与 resource-readers.js 的 getBlockRefs 保持一致：分页下沉到 CAD 端，
  // 响应回填 total/offset/limit。limit 未给则保持历史行为（一次返回全部）。
  const offset = Math.max(0, parseInt(params.offset, 10) || 0);
  const rawLimit = parseInt(params.limit, 10) || 0;
  const maxLimit = Number(config.maxEntityLimit) || 20000;
  const limit = rawLimit > 0 ? Math.min(rawLimit, maxLimit) : 0;

  // 缓存键带上 offset/limit，否则第一页会命中整表缓存并冒充后续页
  const cacheKey = `dwg:block-refs:${params.blockName || 'all'}:${offset}:${limit}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  await ensureCad();

  try {
    const code = buildBlockRefsCode(params.blockName, offset, limit);
    const resultStr = await cad.sendCommandWithResult(code);

    const parsed = parseLispRecursive(resultStr);
    if (!parsed || !Array.isArray(parsed)) {
      throw new Error(`block-refs: 解析 Lisp 结果失败: raw="${String(resultStr).substring(0, 500)}"`);
    }

    const result = {};
    for (const pair of parsed) {
      if (Array.isArray(pair) && pair.length >= 2) {
        result[String(pair[0])] = pair[1];
      }
    }
    const blockRefs = Array.isArray(result.blockRefs) ? result.blockRefs : [];
    const finalResult = {
      // total 为全量条数（不受 offset/limit 影响），便于调用方断言 collected === total
      total: typeof result.total === 'number' ? result.total : blockRefs.length,
      offset: typeof result.offset === 'number' ? result.offset : offset,
      limit: typeof result.limit === 'number' ? result.limit : limit,
      // 下一页的 offset（绝对下标）：按它翻页，不要用 offset + blockRefs.length
      nextOffset: typeof result.nextOffset === 'number' ? result.nextOffset : offset + blockRefs.length,
      blockRefs: blockRefs.map(br => {
        const obj = {};
        if (Array.isArray(br)) {
          br.forEach(pair => {
            if (Array.isArray(pair) && pair.length >= 2) {
              const key = pair[0];
              let val = pair.length === 2 ? pair[1] : pair.slice(1);
              if (key === 'insertionPoint' && Array.isArray(val)) {
                val = val.map(v => typeof v === 'number' ? v : 0);
              } else if (key === 'scale' && Array.isArray(val)) {
                val = val.map(v => typeof v === 'number' ? v : 1);
              } else if (key === 'isDynamic') {
                val = val === true || val === 'true' || val === 1;
              } else if (key === 'attrReadFailed') {
                // 有属性但 ActiveX 读取失败：显式可见，不静默当成「无属性」
                val = val === true || val === 'true' || val === 1;
              } else if (key === 'attributes' && Array.isArray(val)) {
                const o = {};
                val.forEach(p => { if (Array.isArray(p) && p.length >= 2) o[String(p[0])] = p[1]; });
                val = o;
              } else if (key === 'dynamicProperties' && Array.isArray(val)) {
                const o = {};
                val.forEach(p => { if (Array.isArray(p) && p.length >= 2) o[String(p[0])] = p[1]; });
                val = o;
              }
              obj[key] = val;
            }
          });
        }
        return obj;
      })
    };
    setCache(cacheKey, finalResult);
    return finalResult;
  } catch (e) {
    log(`getBlockRefs error: ${e.message}`);
    throw e;
  }
}

export async function getTables(params = {}) {
  const tblName = params.tbl || params.type || 'all';
  const cacheKey = `dwg:tbl:${tblName}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  await ensureCad();

  try {
    const code = buildTablesCode(tblName);
    const resultStr = await cad.sendCommandWithResult(code);

    if (!resultStr || resultStr === '' || resultStr === 'nil') {
      return { table: tblName, data: [] };
    }

    const parsed = parseLispRecursive(resultStr);
    if (!parsed || !Array.isArray(parsed)) {
      return { table: tblName, total: 0, data: [] };
    }

    let result;
    if (parsed.length >= 3 && parsed[0] && String(parsed[0][0]).toUpperCase() === 'TABLE') {
      const tableName = String(parsed[0][1]).toLowerCase();
      let total = 0;
      let tblData = [];
      for (const item of parsed) {
        if (Array.isArray(item) && item.length >= 2) {
          const key = String(item[0]).toUpperCase();
          if (key === 'TOTAL') total = typeof item[1] === 'number' ? item[1] : 0;
          else if (key === 'DATA') {
            if (Array.isArray(item[1]) && item[1].length > 0) {
              tblData = item[1];
            }
          }
        }
      }
      if (tblData.length === 0 && parsed.length > 2) {
        tblData = parsed.slice(2);
      }
      result = {
        table: tableName,
        total: total,
        data: tblData.map(r => parseTableRecord(r, tableName)).filter(Boolean)
      };
    } else {
      const allData = {};
      parsed.forEach(item => {
        if (!Array.isArray(item) || item.length < 2) return;
        let tableKey = null;
        const entry = { total: 0, data: [] };
        if (Array.isArray(item[0]) && item[0].length >= 2 && String(item[0][0]).toLowerCase() === 'table') {
          tableKey = String(item[0][1]).toLowerCase();
          for (let i = 1; i < item.length; i++) {
            const sub = item[i];
            if (!Array.isArray(sub) || sub.length < 2) continue;
            const subKey = String(sub[0]).toUpperCase();
            if (subKey === 'TOTAL') entry.total = typeof sub[1] === 'number' ? sub[1] : 0;
            else if (subKey === 'DATA') {
              const raw = Array.isArray(sub[1]) ? sub[1] : sub.slice(1);
              entry.data = raw.map(r => parseTableRecord(r, tableKey)).filter(Boolean);
            }
          }
        } else {
          tableKey = String(item[0]).toLowerCase();
          for (let i = 1; i < item.length; i++) {
            const sub = item[i];
            if (!Array.isArray(sub) || sub.length < 2) continue;
            const subKey = String(sub[0]).toUpperCase();
            if (subKey === 'TOTAL') {
              entry.total = typeof sub[1] === 'number' ? sub[1] : 0;
            } else if (subKey === 'DATA') {
              const raw = Array.isArray(sub[1]) ? sub[1] : sub.slice(1);
              entry.data = raw.map(r => parseTableRecord(r, tableKey)).filter(Boolean);
            }
          }
        }
        if (tableKey) allData[tableKey] = entry;
      });
      result = allData;
    }

    setCache(cacheKey, result);
    return result;
  } catch (e) {
    log(`getTables error: ${e.message}`);
    return { table: tblName, data: [] };
  }
}

/**
 * 已安装包列表。
 * @param {string|{name?: string, search?: string}|null} filter
 *   - 字符串：按包名精确过滤（历史调用方式）
 *   - 对象：name = 精确匹配；search = 对 name/description/fullName 做大小写不敏感的子串匹配
 *   - null：返回全部
 */
export async function getPackages(filter = null) {
  const opts = filter && typeof filter === 'object' ? filter : { name: filter };
  const nameFilter = opts.name ? String(opts.name) : '';
  const searchFilter = opts.search ? String(opts.search).toLowerCase() : '';
  // 缓存键带上过滤形态（对象参数的键名），避免「无过滤」与「未知键过滤」互相污染
  const shape = filter && typeof filter === 'object' ? Object.keys(filter).sort().join(',') : '';
  const cacheKey = `packages:${nameFilter}:${searchFilter}:${shape}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  await ensureCad();

  try {
    const code = `(mapcar 'cdr @::*local-pkgs*)`;
    const result = await cad.sendCommandWithResult(code);

    if (!result || result === '' || result === 'nil') {
      return [];
    }

    let raw = [];
    try {
      raw = JSON.parse(result);
    } catch {
      raw = parseLispList(result) || [];
    }
    if (!Array.isArray(raw)) raw = [];

    const packages = raw.map(item => {
      if (Array.isArray(item)) {
        const pkg = { name: '', version: '0.0.0', description: '', loaded: true };
        for (const entry of item) {
          if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
            const [[key, val]] = Object.entries(entry);
            const k = String(key);
            const v = String(val);
            if (k === ':NAME') pkg.name = v;
            else if (k === ':VERSION') pkg.version = v;
            else if (k === ':DESCRIPTION') pkg.description = v;
            else if (k === ':FULL-NAME') pkg.fullName = v;
            else if (k === ':AUTHOR') pkg.author = v;
            else if (k === ':CATEGORY') pkg.category = v;
            else if (k === ':URL') pkg.url = v;
          }
        }
        return pkg;
      }
      if (typeof item === 'string' || typeof item === 'number') {
        return { name: String(item), version: '0.0.0', loaded: true };
      }
      if (item && typeof item === 'object') {
        const pkg = { name: '', version: '0.0.0', description: '', loaded: true };
        const nameVal = item.name || item.Name || item.NAME || item[':NAME'];
        if (nameVal) pkg.name = String(nameVal);
        const verVal = item.version || item.Version || item.VERSION || item[':VERSION'];
        if (verVal) pkg.version = String(verVal);
        const descVal = item.description || item.Description || item.DESCRIPTION || item[':DESCRIPTION'];
        if (descVal) pkg.description = String(descVal);
        if (item.fullName || item.full_name) pkg.fullName = String(item.fullName || item.full_name);
        if (item.author || item.Author) pkg.author = String(item.author || item.Author);
        if (item.category || item.Category) pkg.category = String(item.category || item.Category);
        if (item.url || item.Url || item.URL) pkg.url = String(item.url || item.Url || item.URL);
        return pkg;
      }
      return null;
    }).filter(Boolean);

    if (nameFilter || searchFilter) {
      const filtered = packages.filter(p => {
        if (nameFilter && p.name !== nameFilter) return false;
        if (searchFilter) {
          const haystack = `${p.name} ${p.description || ''} ${p.fullName || ''}`.toLowerCase();
          if (!haystack.includes(searchFilter)) return false;
        }
        return true;
      });
      setCache(cacheKey, filtered);
      return filtered;
    }
    setCache(cacheKey, packages);
    return packages;
  } catch {
    return [];
  }
}

export function getPlatforms() {
  return CAD_PLATFORMS.map(name => ({
    name,
    extensions: FILE_EXTENSIONS[name] || []
  }));
}

export async function getCadStatus() {
  const stats = pool.getStats();
  const instances = stats.instances.map(i => ({
    key: i.key,
    connected: i.connected,
    platform: i.platform,
    version: i.version,
    label: i.label,
    queueSize: i.queueSize,
    stall: i.stall || { stalled: false, reason: null, remainingMs: 0 },
  }));

  const activeConn = getActiveConnection();
  if (activeConn && activeConn !== pool.getConnection(stats.active)) {
    instances.push({
      key: stats.active || 'default',
      connected: activeConn.connected,
      platform: activeConn.getPlatform(),
      version: activeConn.getVersion(),
      label: '默认连接',
      queueSize: activeConn._getQueueSize ? activeConn._getQueueSize() : 0,
      stall: activeConn.getStallInfo ? activeConn.getStallInfo() : { stalled: false, reason: null, remainingMs: 0 },
      isActive: true,
    });
  }

  return { active: stats.active, total: stats.total, instances };
}

export async function getDwgList() {
  const cacheKey = 'cad:dwgs';
  const cached = getCached(cacheKey);
  if (cached) return cached;

  await ensureCad();

  try {
    const code = `(progn
      (vl-load-com)
      (setq result nil)
      (vlax-for doc (vla-get-Documents (vla-get-Application (vlax-get-acad-object)))
        (setq result (cons (list (vla-get-Name doc) (vla-get-FullName doc)) result))
      )
      (reverse result)
    )`;
    const result = await cad.sendCommandWithResult(code);

    if (!result || result === "" || result === "nil") {
      return [];
    }

    let parsed = [];
    try {
      parsed = JSON.parse(result);
    } catch {
      const listResult = parseLispRecursive(result);
      if (Array.isArray(listResult)) {
        parsed = listResult;
      }
    }

    if (!Array.isArray(parsed)) parsed = [];

    const dwgList = parsed.map(item => {
      if (Array.isArray(item) && item.length >= 2) {
        return { name: String(item[0]), path: String(item[1]) };
      }
      return null;
    }).filter(Boolean);

    setCache(cacheKey, dwgList);
    return dwgList;
  } catch {
    return [];
  }
}
