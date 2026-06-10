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
  getPackages,
  getPlatforms,
  getDwgList,
  getDraftingStandards,
  getCodingStandards,
  getCadEvents,
} from './resource-readers.js';

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

function parseTemplateUri(uri) {
  const entityMatch = uri.match(/^atlisp:\/\/dwg\/entity\/([^?]+)$/);
  if (entityMatch) return { type: 'entity', handle: entityMatch[1] };

  const tblMatch = uri.match(/^atlisp:\/\/dwg\/tbl\/([^?]+)$/);
  if (tblMatch) return { type: 'tbl', tblName: tblMatch[1] };

  const blockRefMatch = uri.match(/^atlisp:\/\/dwg\/block-refs\/([^?]+)$/);
  if (blockRefMatch) return { type: 'block-refs', blockName: blockRefMatch[1] };

  return null;
}

export async function listResources(subscribedUris = []) {
  return RESOURCES.map(r => ({
    uri: r.uri,
    name: r.name,
    description: r.description,
    mimeType: r.mimeType,
    subscribed: subscribedUris.includes(r.uri)
  }));
}

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
      const { blockName } = templateMatch;
      const queryIdx = uri.indexOf('?');
      const queryParams = {};
      if (queryIdx !== -1) {
        uri.substring(queryIdx + 1).split('&').forEach(p => {
          const eqIdx = p.indexOf('=');
          const k = eqIdx === -1 ? p : p.substring(0, eqIdx);
          const v = eqIdx === -1 ? '' : p.substring(eqIdx + 1);
          if (k) queryParams[k] = decodeURIComponent(v);
        });
      }
      const refs = await getBlockRefs({ blockName });
      const offset = parseInt(queryParams.offset, 10) || 0;
      const limit = parseInt(queryParams.limit, 10) || 0;
      if (limit > 0 && Array.isArray(refs)) return refs.slice(offset, offset + limit);
      return refs;
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
    default:
      throw new Error(`资源不存在: ${uri}`);
  }
}

export { RESOURCES, clearCache };
