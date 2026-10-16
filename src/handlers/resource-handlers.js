// =============================================================================
// resource-handlers.js — MCP Resources 注册入口（handler-loader 按 *-handlers.js
// 自动发现，本文件是 resource 域唯一注册的 handler 模块）。
//
// 职责：资源 URI 解析与分发（listResources / readResource），以及 RESOURCES、
// clearCache 的对外再导出。各域实现按职责拆分到以下模块（均为非 *-handlers.js
// 命名，不会被自动发现重复注册）：
//   - resource-readers.js    DWG/CAD 资源读取（实体/文本/块引用/表/事件等）
//   - metadata-readers.js    包/平台/图纸列表/CAD 状态元数据读取
//   - standards-readers.js   制图规范/编码规范读取
//   - resource-snapshot.js   CAD 快照与图纸上下文/深度分析/规范检查
//   - resource-tool-meta.js  工具分类/行业/协作关系元数据
//   - lisp-code-builders.js / resource-utils.js  共享 LISP 代码构建与工具函数
// =============================================================================
import '../config.js';
import { cad } from '../cad.js';
import { RESOURCES } from './resource-defs.js';
import { clearCache } from './resource-cache.js';
import {
  getEntityByHandle,
  getCadInfo,
  getEntities,
  getTextContent,
  combineText,
  getDwgName,
  getDwgPath,
  getBlockRefs,
  getTables,
  getCadEvents,
} from './resource-readers.js';
import { getPackages, getPlatforms, getDwgList, getCadStatus } from './metadata-readers.js';
import { getDraftingStandards, getCodingStandards } from './standards-readers.js';
import {
  getCadSnapshot,
  getDwgContext,
  getDrawingAnalysis,
  getFrames,
  checkDrawingStandards,
} from './resource-snapshot.js';
import {
  getToolCategories,
  getToolIndustries,
  getToolRelationships,
} from './resource-tool-meta.js';

// =============================================================================
// URI Parsing Helpers
// =============================================================================

function parseQuery(uri) {
  const qIdx = uri.indexOf('?');
  if (qIdx === -1) return { base: uri, params: {} };
  const base = uri.substring(0, qIdx);
  const params = {};
  uri.substring(qIdx + 1).split('&').forEach(p => {
    const eqIdx = p.indexOf('=');
    const k = eqIdx === -1 ? p : p.substring(0, eqIdx);
    const v = eqIdx === -1 ? '' : p.substring(eqIdx + 1);
    if (k) params[k] = decodeURIComponent(v);
  });
  return { base, params };
}

// 调用方（如 agent 的 readResourceTemplate）会对路径参数做 encodeURIComponent，
// 而块名里大量出现 `$`、中文、空格；decodeURIComponent 对畸形 % 序列会抛异常，
// 因此退回原值而不是让整个 readResource 失败。
function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseTemplateUri(uri) {
  // 先剥离 query（?offset/limit），否则 `([^?]+)$` 永远匹配不上带参数的路径模板
  // —— 这正是 `atlisp://dwg/block-refs/A1?limit=2` 报「资源不存在」的原因。
  const queryIdx = uri.indexOf('?');
  const pathOnly = queryIdx === -1 ? uri : uri.substring(0, queryIdx);

  const entityMatch = pathOnly.match(/^atlisp:\/\/dwg\/entity\/(.+)$/);
  if (entityMatch) return { type: 'entity', handle: safeDecode(entityMatch[1]) };

  const tblMatch = pathOnly.match(/^atlisp:\/\/dwg\/tbl\/(.+)$/);
  if (tblMatch) return { type: 'tbl', tblName: safeDecode(tblMatch[1]) };

  const blockRefMatch = pathOnly.match(/^atlisp:\/\/dwg\/block-refs\/(.+)$/);
  if (blockRefMatch) return { type: 'block-refs', blockName: safeDecode(blockRefMatch[1]) };

  return null;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Returns the current state of resources with live CAD data embedded.
 * Queries CAD for entity counts, layer names, DWG info, etc. and enriches
 * resource descriptors with actual data in description and annotations fields.
 */
export async function listResources(subscribedUris = []) {
  let snapshot = null;

  // Attempt to get a live CAD snapshot (fast, non-blocking on failure)
  try {
    const isConnected = cad.connected;
    if (isConnected) {
      snapshot = await getCadSnapshot();
    }
  } catch {
    snapshot = null;
  }

  const hasLive = snapshot && snapshot.cadConnected;

  return RESOURCES.map(r => {
    const entry = {
      uri: r.uri,
      name: r.name,
      description: r.description,
      mimeType: r.mimeType,
      subscribed: subscribedUris.includes(r.uri),
    };

    if (hasLive) {
      switch (r.uri) {
        case 'atlisp://cad/info':
          entry.description = `CAD 连接信息 (${snapshot.platform || '未知平台'}${snapshot.dwgName ? ', ' + snapshot.dwgName : ''})`;
          break;
        case 'atlisp://dwg/entities':
          entry.description = `图元列表。${snapshot.entityCount} 个实体，${snapshot.layerCount} 个图层。支持 ?type=LINE&layer=0&bbox=0,0,100,100`;
          break;
        case 'atlisp://dwg/name':
          entry.description = `当前 DWG 文件名: ${snapshot.dwgName || '(未命名)'}`;
          break;
        case 'atlisp://dwg/path':
          entry.description = snapshot.dwgPath ? `文件完整路径: ${snapshot.dwgPath}` : '文件完整路径';
          break;
        case 'atlisp://dwg/tbl':
          entry.description = `CAD 表数据 (${snapshot.layerCount} 个图层)。支持路径方式 atlisp://dwg/tbl/layer`;
          break;
        case 'atlisp://dwg/context':
          entry.description = `当前图纸上下文: ${snapshot.dwgName || '(未命名)'}，${snapshot.entityCount} 实体，${snapshot.layerCount} 图层`;
          break;
        default: break;
      }
    }

    return entry;
  });
}

/**
 * Reads a resource by URI.
 * Supports both static URIs and template URIs with path parameters.
 */
export async function readResource(uri) {
  const templateMatch = parseTemplateUri(uri);
  if (templateMatch) {
    if (templateMatch.type === 'entity') {
      return await getEntityByHandle(templateMatch.handle);
    }
    if (templateMatch.type === 'tbl') {
      return await getTables({ tbl: templateMatch.tblName });
    }
    if (templateMatch.type === 'block-refs') {
      // 分页下沉到 getBlockRefs（在 CAD 内切片），且响应统一为
      // { total, offset, limit, blockRefs }，便于调用方断言 collected === total。
      const { params } = parseQuery(uri);
      return await getBlockRefs({ blockName: templateMatch.blockName, ...params });
    }
  }

  const { base, params } = parseQuery(uri);

  switch (base) {
    case 'atlisp://cad/info':
      return await getCadInfo();
    case 'atlisp://dwg/entities': {
      const entityData = await getEntities(params);
      // Support pagination via offset/limit params
      const offset = parseInt(params.offset, 10) || 0;
      const limit = parseInt(params.limit, 10) || 0;
      if (limit > 0 && Array.isArray(entityData)) {
        return entityData.slice(offset, offset + limit);
      }
      return entityData;
    }
    case 'atlisp://dwg/text-content':
      return await getTextContent(params);
    case 'atlisp://dwg/text-combined':
      return await combineText(params);
    case 'atlisp://dwg/name':
      return await getDwgName();
    case 'atlisp://dwg/path':
      return await getDwgPath();
    case 'atlisp://dwg/block-refs':
      return await getBlockRefs(params);
    case 'atlisp://dwg/tbl':
      return await getTables(params);
    case 'atlisp://cad/dwgs':
      return await getDwgList();
    case 'atlisp://packages':
      return await getPackages(params.name);
    case 'atlisp://platforms':
      return getPlatforms();
    case 'atlisp://standards/drafting':
      return getDraftingStandards();
    case 'atlisp://standards/coding':
      return getCodingStandards();
    case 'atlisp://cad/events':
      return await getCadEvents(params);
    case 'atlisp://dwg/context':
      return await getDwgContext();
    case 'atlisp://tools/relationships':
      return getToolRelationships();
    case 'atlisp://dwg/analysis':
      return await getDrawingAnalysis(params);
    case 'atlisp://dwg/frames':
      // 图框识别：?layer=&minSize=&scales=&tolRatio=&tolLen=&includeInner=&includeUnmatched=&offset=&limit=
      return await getFrames(params);
    case 'atlisp://tools/categories':
      return getToolCategories();
    case 'atlisp://tools/industries':
      return getToolIndustries(params.name);
    case 'atlisp://dwg/standards/check':
      return await checkDrawingStandards();
    case 'atlisp://system/cad-status':
      return await getCadStatus();
    default:
      throw new Error(`资源不存在: ${uri}`);
  }
}

export { RESOURCES, clearCache };
