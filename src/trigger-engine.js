import { cad } from './cad.js';
import { log, error as logError } from './logger.js';
import { parseLispList } from './handler-utils.js';

const watches = new Map();
const watchResults = new Map();
let pollTimer = null;
let watchIdCounter = 0;
let pollingInProgress = false;

const POLL_INTERVAL = 2000;

const WATCH_TYPES = {
    ENTITY_COUNT: 'entity_count',
    LAYER_EXISTS: 'layer_exists',
    LAYER_COUNT: 'layer_count',
    DOC_NAME: 'doc_name',
    DOC_PATH: 'doc_path',
    ENTITY_SELECTED: 'entity_selected',
    CUSTOM_LISP: 'custom_lisp',
};

function escapeLispStr(v) {
    if (typeof v !== 'string') return v;
    return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function buildFilterExpr(filter) {
    if (!filter || typeof filter !== 'object') return 'nil';
    const parts = [];
    if (filter.type) {
        parts.push(`(cons 0 "${escapeLispStr(filter.type)}")`);
    }
    if (filter.layer) {
        parts.push(`(cons 8 "${escapeLispStr(filter.layer)}")`);
    }
    if (parts.length === 0) return 'nil';
    return `(list ${parts.join(' ')})`;
}

function compare(count, operator, threshold) {
    const v = threshold != null ? threshold : 1;
    switch (operator) {
        case 'gte': return count >= v;
        case 'lte': return count <= v;
        case 'eq':  return count === v;
        default:    return count >= v;
    }
}

function parseSingleInt(result) {
    try {
        const arr = parseLispList(result);
        if (arr && arr.length > 0) return Number(arr[0]);
    } catch {}
    const n = Number(result);
    return isNaN(n) ? 0 : n;
}

async function evaluateWatch(watch) {
    try {
        let result;
        switch (watch.type) {
            case 'entity_count': {
                const filterExpr = buildFilterExpr(watch.filter);
                result = await cad.sendCommandWithResult(
                    `(progn (setq _ecnt 0) (if (setq _ess (ssget "_X" ${filterExpr})) (setq _ecnt (sslength _ess))) (list _ecnt))`
                );
                const count = parseSingleInt(result);
                const matched = compare(count, watch.operator, watch.value);
                return { matched, data: { count } };
            }

            case 'layer_count': {
                result = await cad.sendCommandWithResult(
                    `(progn (setq _lcnt 0) (setq _l (tblnext "LAYER" T)) (while _l (setq _lcnt (1+ _lcnt)) (setq _l (tblnext "LAYER"))) (list _lcnt))`
                );
                const count = parseSingleInt(result);
                const matched = compare(count, watch.operator, watch.value);
                return { matched, data: { count } };
            }

            case 'layer_exists': {
                const lName = escapeLispStr(watch.layerName || '');
                result = await cad.sendCommandWithResult(
                    `(progn (if (tblsearch "LAYER" "${lName}") (list 1) (list 0)))`
                );
                const exists = parseSingleInt(result) !== 0;
                return { matched: exists, data: { exists, layerName: watch.layerName } };
            }

            case 'doc_name': {
                const pattern = escapeLispStr(watch.pattern || '*');
                result = await cad.sendCommandWithResult(
                    `(progn (setq _dn (getvar "dwgname")) (setq _dm (if (wcmatch _dn "${pattern}") 1 0)) (list _dm _dn))`
                );
                const arr = parseLispList(result) || [];
                const matched = Number(arr[0]) !== 0;
                const name = String(arr[1] || '');
                return { matched, data: { matched: Boolean(matched), name } };
            }

            case 'doc_path': {
                const pattern = escapeLispStr(watch.pattern || '*');
                result = await cad.sendCommandWithResult(
                    `(progn (setq _dp (getvar "dwgprefix")) (setq _dm (if (wcmatch _dp "${pattern}") 1 0)) (list _dm _dp))`
                );
                const arr = parseLispList(result) || [];
                const matched = Number(arr[0]) !== 0;
                const path = String(arr[1] || '');
                return { matched, data: { matched: Boolean(matched), path } };
            }

            case 'entity_selected': {
                result = await cad.sendCommandWithResult(
                    `(progn (if (ssget "_I") (list 1) (list 0)))`
                );
                const selected = parseSingleInt(result) !== 0;
                return { matched: selected, data: { selected } };
            }

            case 'custom_lisp': {
                if (!watch.lispCode) {
                    return { matched: false, data: { error: 'No lispCode provided' } };
                }
                const code = watch.lispCode.trim();
                result = await cad.sendCommandWithResult(
                    `(progn (setq _cr ${code}) (if _cr (list 1) (list 0)))`
                );
                const matched = parseSingleInt(result) !== 0;
                return { matched, data: { matched: Boolean(matched) } };
            }

            default:
                return { matched: false, data: { error: `Unknown watch type: ${watch.type}` } };
        }
    } catch (e) {
        logError(`evaluateWatch error [${watch.id}]: ${e.message}`);
        return { matched: false };
    }
}

async function pollWatches() {
    if (watches.size === 0) return;
    if (pollingInProgress) return;
    pollingInProgress = true;
    try {
        for (const [id, watch] of watches) {
            if (watch.fired) continue;
            const outcome = await evaluateWatch(watch);
            if (outcome.matched) {
                watch.fired = true;
                watch.matchedAt = new Date().toISOString();
                watch.result = outcome.data;
                watchResults.set(id, outcome.data);
                if (watch.onMatch) {
                    try { watch.onMatch({ id, type: watch.type, data: outcome.data }); } catch (e) { logError(`Trigger onMatch callback error [${id}]: ${e.message}`); }
                }
                log(`Trigger fired: ${watch.name || id} (type: ${watch.type})`);
            }
        }
    } finally {
        pollingInProgress = false;
    }
}

function ensurePolling() {
    if (pollTimer) return;
    if (watches.size === 0) return;
    pollTimer = setInterval(pollWatches, POLL_INTERVAL);
}

function stopPollingIfNeeded() {
    if (watches.size === 0 && pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
}

export function registerWatch(params) {
    const id = `watch_${++watchIdCounter}`;
    if (!WATCH_TYPES[params.type?.toUpperCase()] && params.type !== 'custom_lisp') {
        throw new Error(`不支持的触发器类型: ${params.type}. 支持的类型: ${Object.keys(WATCH_TYPES).join(', ')}`);
    }
    const watch = {
        id,
        name: params.name || id,
        type: params.type,
        filter: params.filter || {},
        operator: params.operator || 'gte',
        value: params.value != null ? params.value : 1,
        layerName: params.layerName,
        pattern: params.pattern,
        lispCode: params.lispCode,
        fired: false,
        matchedAt: null,
        result: null,
        createdAt: new Date().toISOString(),
        autoRemove: params.autoRemove !== false,
        onMatch: null,
    };
    watches.set(id, watch);
    ensurePolling();
    log(`Watch registered: ${watch.name} (${id})`);
    return { id, name: watch.name, type: watch.type, createdAt: watch.createdAt };
}

export function removeWatch(id) {
    const removed = watches.delete(id);
    watchResults.delete(id);
    stopPollingIfNeeded();
    return removed;
}

export function listWatches() {
    return Array.from(watches.values()).map(w => ({
        id: w.id,
        name: w.name,
        type: w.type,
        fired: w.fired,
        matchedAt: w.matchedAt,
        result: w.result,
        createdAt: w.createdAt,
    }));
}

export function getWatchResult(id) {
    return watchResults.get(id) || null;
}

export function clearFiredWatches() {
    for (const [id, watch] of watches) {
        if (watch.fired && watch.autoRemove) {
            watches.delete(id);
            watchResults.delete(id);
        }
    }
    stopPollingIfNeeded();
}

export function waitForWatch(id, timeout = 30000) {
    return new Promise((resolve, reject) => {
        const watch = watches.get(id);
        if (!watch) return reject(new Error(`Watch "${id}" not found`));
        if (watch.fired) return resolve(watch.result);
        const timer = setTimeout(() => {
            removeWatch(id);
            reject(new Error(`Watch "${id}" timed out after ${timeout}ms`));
        }, timeout);
        watch.onMatch = (data) => {
            clearTimeout(timer);
            resolve(data);
        };
    });
}

export async function createAndWait(params, timeout = 30000) {
    const { id } = registerWatch(params);
    return waitForWatch(id, timeout);
}

export function resetAllWatches() {
    watches.clear();
    watchResults.clear();
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
}

export { WATCH_TYPES };
