import config from '../config.js';

const CLEANUP_INTERVAL = 60000;

let cleanupTimer = null;
let _instanceKey = null;

// instance -> Map(key -> {data, timestamp})
const _instanceCaches = new Map();
const _defaultKey = '__default__';

function _getCache() {
  const key = _instanceKey || _defaultKey;
  if (!_instanceCaches.has(key)) {
    _instanceCaches.set(key, new Map());
  }
  return _instanceCaches.get(key);
}

function _ttl() {
  return config.resourceCacheTtl;
}

function ensureCleanup() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    const ttl = _ttl();
    for (const cache of _instanceCaches.values()) {
      for (const [key, entry] of cache) {
        if (now - entry.timestamp >= ttl) {
          cache.delete(key);
        }
      }
    }
  }, CLEANUP_INTERVAL);
  cleanupTimer.unref();
}

ensureCleanup();

export function stopCleanup() {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

export function setInstanceKey(key) {
  _instanceKey = key || null;
}

const URI_CACHE_PREFIX = {
  'atlisp://cad/info': 'cad:info',
  'atlisp://dwg/entities': 'dwg:entities',
  'atlisp://dwg/text-content': 'dwg:text-content',
  'atlisp://dwg/name': 'dwg:name',
  'atlisp://dwg/path': 'dwg:path',
  'atlisp://dwg/block-refs': 'dwg:block-refs',
  'atlisp://dwg/tbl': 'dwg:tbl',
  'atlisp://cad/dwgs': 'cad:dwgs',
  'atlisp://packages': 'packages',
};

function getCached(key) {
  const cache = _getCache();
  const entry = cache.get(key);
  if (entry && Date.now() - entry.timestamp < _ttl()) {
    return entry.data;
  }
  cache.delete(key);
  return null;
}

function setCache(key, data) {
  _getCache().set(key, { data, timestamp: Date.now() });
}

export function clearCache(uri) {
  const basePrefix = URI_CACHE_PREFIX[uri];
  if (basePrefix) {
    const cache = _getCache();
    for (const key of cache.keys()) {
      if (key === basePrefix || key.startsWith(basePrefix + ':')) {
        cache.delete(key);
      }
    }
  } else if (!uri) {
    const key = _instanceKey || _defaultKey;
    _instanceCaches.delete(key);
    _instanceCaches.set(key, new Map());
  }
}

export { getCached, setCache };
