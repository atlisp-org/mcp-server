import { cad } from './cad.js';
import config from './config.js';

const STREAM_CHUNK_SIZE = 100;
const MAX_ENTITY_LIMIT = config.maxEntityLimit;
const UNFILTERED_WARN_THRESHOLD = 5000;

function escapeLispStr(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function streamEntities({ filterExpr, extractFields, itemMapper, offset, limit, hasFilter, warnThreshold, overLimitMsg, resultProp }) {
  const ssgetExpr = filterExpr
    ? `(ssget "_X" ${filterExpr})`
    : `(ssget "_X")`;

  const extractCode = `(list ${extractFields.join(' ')})`;

  // 最外层用 prog1 收尾清理：AutoLISP 的 setq 是全局的，ss 持有整个选择集，
  // result/elist 持有中间结果。不置 nil 的话，大图扫描后这些对象会一直挂在
  // CAD 会话里（一次全图 ssget 可能就是几十万个实体）。
  const lisp = `(prog1
    (progn
      (setq ss ${ssgetExpr})
      (setq total (if ss (sslength ss) 0))
      (if (> total ${MAX_ENTITY_LIMIT})
        (list -1 total)
        (if (>= ${offset} total)
          (list total)
          (progn
            (setq result (list total))
            (setq i ${offset})
            (setq count 0)
            (while (and (< i total) (< count ${limit}))
              (setq e (ssname ss i))
              (setq elist (entget e))
              (setq result (cons ${extractCode} result))
              (setq i (1+ i))
              (setq count (1+ count)))
            (reverse result)))))
    (setq ss nil result nil elist nil e nil count nil i nil))`;

  const raw = await cad.sendCommandWithResult(lisp);
  try {
    const parsed = JSON.parse(raw);
    const total = parsed[0] || 0;
    if (total === -1) {
      return { total: parsed[1] || 0, offset: 0, count: 0, hasMore: false,
        [resultProp]: [],
        error: `实体数量 (${parsed[1]}) 超过最大限制 (${MAX_ENTITY_LIMIT})，${overLimitMsg}` };
    }
    const items = parsed.slice(1).map(itemMapper);
    const result = { total, offset, count: items.length, hasMore: (offset + items.length) < total, [resultProp]: items };
    if (!hasFilter && total > warnThreshold) {
      result.warning = `未提供过滤条件，全图扫描了 ${total} 个实体。建议添加过滤参数以提升性能。`;
    }
    return result;
  } catch {
    return { total: 0, offset: 0, count: 0, hasMore: false, [resultProp]: [] };
  }
}

export async function streamEntitiesByType({ type = null, layer = null, chunk = STREAM_CHUNK_SIZE, offset = 0 }) {
  const filters = [];
  if (type) filters.push(`(cons 0 "${escapeLispStr(type)}")`);
  if (layer) filters.push(`(cons 8 "${escapeLispStr(layer)}")`);
  const filterExpr = filters.length > 0 ? `(list ${filters.join(' ')})` : null;

  return streamEntities({
    filterExpr,
    extractFields: ['(list (cdr (assoc 0 elist)) (cdr (assoc 5 elist)) (cdr (assoc 8 elist)))'],
    itemMapper: (item) => ({ type: item[0], handle: item[1], layer: item[2] }),
    offset, limit: chunk,
    hasFilter: !!(type || layer),
    warnThreshold: UNFILTERED_WARN_THRESHOLD,
    overLimitMsg: '请使用 type/layer 过滤',
    resultProp: 'entities',
  });
}

export async function streamTextContent({ layer = null, bbox: _bbox = null, offset = 0, limit = 100 }) {
  const textFilters = [`(cons 0 "TEXT")`, `(cons 0 "MTEXT")`];
  if (layer) textFilters.push(`(cons 8 "${escapeLispStr(layer)}")`);
  const filterExpr = `(list '(-4 . "<OR") ${textFilters.join(' ')} '(-4 . "OR>"))`;

  return streamEntities({
    filterExpr,
    extractFields: ['(list (cdr (assoc 5 elist)) (cdr (assoc 1 elist)) (cdr (assoc 10 elist)))'],
    itemMapper: (item) => ({ handle: item[0], text: item[1], point: item[2] }),
    offset, limit,
    hasFilter: !!layer,
    warnThreshold: UNFILTERED_WARN_THRESHOLD,
    overLimitMsg: '请使用 layer 过滤',
    resultProp: 'texts',
  });
}

export async function streamBlockRefs({ blockName = null, offset = 0, limit = 100 }) {
  const filters = [`(cons 0 "INSERT")`];
  if (blockName) filters.push(`(cons 2 "${escapeLispStr(blockName)}")`);
  const filterExpr = filters.length > 0 ? `(list ${filters.join(' ')})` : null;

  return streamEntities({
    filterExpr,
    extractFields: ['(list (cdr (assoc 2 elist)) (cdr (assoc 5 elist)) (cdr (assoc 10 elist)))'],
    itemMapper: (item) => ({ blockName: item[0], handle: item[1], insertionPoint: item[2] }),
    offset, limit,
    hasFilter: !!blockName,
    warnThreshold: UNFILTERED_WARN_THRESHOLD,
    overLimitMsg: '请使用 blockName 过滤',
    resultProp: 'refs',
  });
}
