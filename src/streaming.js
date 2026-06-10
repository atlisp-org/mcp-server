import { cad } from './cad.js';

const STREAM_CHUNK_SIZE = 100;
const MAX_ENTITY_LIMIT = 50000;

export async function streamEntitiesByType({ type = null, layer = null, chunk = STREAM_CHUNK_SIZE, offset = 0 }) {
  const filters = [];
  if (type) filters.push(`(cons 0 "${type}")`);
  if (layer) filters.push(`(cons 8 "${layer}")`);
  const ssgetExpr = filters.length > 0
    ? `(ssget "_X" (list ${filters.join(' ')}))`
    : `(ssget "_X")`;

  const lisp = `(progn
    (setq ss ${ssgetExpr})
    (setq total (if ss (sslength ss) 0))
    (if (> total ${MAX_ENTITY_LIMIT})
      (list -1 total)
      (progn
        (setq result (list total))
        (setq i ${offset})
        (setq count 0)
        (while (and (< i total) (< count ${chunk}))
          (setq e (ssname ss i))
          (setq elist (entget e))
          (setq result (cons (list (cdr (assoc 0 elist)) (cdr (assoc 5 elist)) (cdr (assoc 8 elist))) result))
          (setq i (1+ i))
          (setq count (1+ count)))
        (reverse result))))`;

  const raw = await cad.sendCommandWithResult(lisp);
  try {
    const parsed = JSON.parse(raw);
    const total = parsed[0] || 0;
    if (total === -1) {
      return { total: parsed[1] || 0, offset: 0, count: 0, hasMore: false, entities: [],
        error: `实体数量 (${parsed[1]}) 超过最大限制 (${MAX_ENTITY_LIMIT})，请使用 type/layer 过滤` };
    }
    const entities = parsed.slice(1);
    return {
      total,
      offset,
      count: entities.length,
      hasMore: (offset + entities.length) < total,
      entities
    };
  } catch {
    return { total: 0, offset: 0, count: 0, hasMore: false, entities: [] };
  }
}

export async function streamTextContent({ layer = null, bbox = null, offset = 0, limit = 100 }) {
  const filters = [
    `'(-4 . "<OR")`,
    `'(0 . "TEXT")`,
    `'(0 . "MTEXT")`,
    `'(-4 . "OR>")`,
  ];
  if (layer) filters.push(`(cons 8 "${layer}")`);

  const lisp = `(progn
    (setq ss (ssget "_X" (list ${filters.join(' ')})))
    (setq total (if ss (sslength ss) 0))
    (if (> total ${MAX_ENTITY_LIMIT})
      (list -1 total)
      (progn
        (setq result (list total))
        (setq i ${offset})
        (setq count 0)
        (while (and (< i total) (< count ${limit}))
          (setq e (ssname ss i))
          (setq elist (entget e))
          (setq txt (cdr (assoc 1 elist)))
          (setq result (cons (list (cdr (assoc 5 elist)) txt (cdr (assoc 10 elist))) result))
          (setq i (1+ i))
          (setq count (1+ count)))
        (reverse result))))`;

  const raw = await cad.sendCommandWithResult(lisp);
  try {
    const parsed = JSON.parse(raw);
    const total = parsed[0] || 0;
    if (total === -1) {
      return { total: parsed[1] || 0, offset: 0, count: 0, hasMore: false, texts: [],
        error: `实体数量 (${parsed[1]}) 超过最大限制 (${MAX_ENTITY_LIMIT})，请使用过滤条件` };
    }
    const texts = parsed.slice(1).map(t => ({ handle: t[0], text: t[1], point: t[2] }));
    return { total, offset, count: texts.length, hasMore: (offset + texts.length) < total, texts };
  } catch {
    return { total: 0, offset: 0, count: 0, hasMore: false, texts: [] };
  }
}

export async function streamBlockRefs({ blockName = null, offset = 0, limit = 100 }) {
  const filters = [`(cons 0 "INSERT")`];
  if (blockName) filters.push(`(cons 2 "${blockName}")`);
  const filter = `(ssget "_X" (list ${filters.join(' ')}))`;

  const lisp = `(progn
    (setq ss ${filter})
    (setq total (if ss (sslength ss) 0))
    (if (> total ${MAX_ENTITY_LIMIT})
      (list -1 total)
      (progn
        (setq result (list total))
        (setq i ${offset})
        (setq count 0)
        (while (and (< i total) (< count ${limit}))
          (setq e (ssname ss i))
          (setq elist (entget e))
          (setq result (cons (list (cdr (assoc 2 elist)) (cdr (assoc 5 elist)) (cdr (assoc 10 elist))) result))
          (setq i (1+ i))
          (setq count (1+ count)))
        (reverse result))))`;

  const raw = await cad.sendCommandWithResult(lisp);
  try {
    const parsed = JSON.parse(raw);
    const total = parsed[0] || 0;
    if (total === -1) {
      return { total: parsed[1] || 0, offset: 0, count: 0, hasMore: false, refs: [],
        error: `实体数量 (${parsed[1]}) 超过最大限制 (${MAX_ENTITY_LIMIT})，请使用 blockName 过滤` };
    }
    const refs = parsed.slice(1).map(r => ({ blockName: r[0], handle: r[1], insertionPoint: r[2] }));
    return { total, offset, count: refs.length, hasMore: (offset + refs.length) < total, refs };
  } catch {
    return { total: 0, offset: 0, count: 0, hasMore: false, refs: [] };
  }
}
