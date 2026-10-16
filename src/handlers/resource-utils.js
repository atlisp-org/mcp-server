import { cad } from '../cad.js';
import { createError, ERROR_CODES } from '../errors.js';

export function _parseEntity(arr) {
  if (!Array.isArray(arr) || arr.length < 5) return null;
  const [type, handle, layer, color, linetype, ...rest] = arr;
  const entity = {
    type: String(type).toUpperCase().replace(/^"|"$/g, ''),
    handle: String(handle),
    layer: String(layer),
    color,
    linetype: String(linetype)
  };
  const entType = typeof entity.type === 'string' ? entity.type.toUpperCase() : entity.type;
  if (/^(TEXT|MTEXT|ATTRIB|TCH_TEXT)$/.test(entType) && rest[0] != null) {
    entity.text = String(rest[0]);
  }
  if (/^(LINE|LWPOLYLINE|POLYLINE|ARC|CIRCLE|SPLINE|ELLIPSE|XLINE|RAY)$/.test(entType)
    && Array.isArray(rest[0])) {
    entity.points = rest[0].map(pt => {
      if (Array.isArray(pt) && pt.length >= 2)
        return { x: Number(pt[0]), y: Number(pt[1]), z: Number(pt[2] || 0) };
      return null;
    }).filter(Boolean);
  }
  if (entType === 'INSERT' && rest[0] != null) {
    entity.blockName = String(rest[0]);
  }
  return entity;
}

export function _parseVlaEntity(obj) {
  if (!obj || typeof obj !== 'object') return null;
  return {
    type: obj.type || null,
    handle: obj.handle || null,
    layer: obj.layer || '0',
    color: obj.color !== undefined ? obj.color : 256,
    linetype: obj.linetype || 'ByLayer'
  };
}

export function propertyPairsToObject(pairs) {
  if (!Array.isArray(pairs)) return null;
  const obj = {};
  for (const pair of pairs) {
    if (Array.isArray(pair) && pair.length >= 2) {
      obj[String(pair[0])] = pair[1] !== null && pair[1] !== undefined ? pair[1] : null;
    }
  }
  return obj;
}

export async function ensureCad() {
  if (!cad.connected) await cad.connect();
  if (!cad.connected) throw createError(ERROR_CODES.CAD_NOT_CONNECTED);
}
