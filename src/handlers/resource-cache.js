import config from '../config.js';

const CACHE_TTL = config.resourceCacheTtl;
const resourceCache = new Map();
const CLEANUP_INTERVAL = 60000;

let cleanupTimer = null;

function ensureCleanup() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of resourceCache) {
      if (now - entry.timestamp >= CACHE_TTL) {
        resourceCache.delete(key);
      }
    }
  }, CLEANUP_INTERVAL);
  cleanupTimer.unref();
}

ensureCleanup();

// 每个资源 URI 对应的 cache key 前缀映射
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
  const entry = resourceCache.get(key);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL) {
    return entry.data;
  }
  resourceCache.delete(key);
  return null;
}

function setCache(key, data) {
  resourceCache.set(key, { data, timestamp: Date.now() });
}

export function clearCache(uri) {
  const prefix = URI_CACHE_PREFIX[uri];
  if (prefix) {
    for (const key of resourceCache.keys()) {
      if (key === prefix || key.startsWith(prefix + ':')) {
        resourceCache.delete(key);
      }
    }
  } else if (!uri) {
    resourceCache.clear();
  }
}

export { getCached, setCache };
