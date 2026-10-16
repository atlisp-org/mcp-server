import config from './config.js';

class RateLimiter {
    constructor() {
        this.windowMs = config.rateLimitWindow || 60000;
        this.defaultLimit = config.rateLimitMax || 100;
        this.keyLimits = new Map();
    }

    getKeyLimit(apiKey) {
        if (!apiKey) return this.defaultLimit;

        if (config.apiKeys && config.apiKeys.length > 0) {
            const found = config.apiKeys.find(k => k.key === apiKey);
            if (found) return found.limit;
        }

        if (config.apiKey && apiKey === config.apiKey) {
            return config.apiKeyRateLimit || 1000;
        }

        return this.defaultLimit;
    }

    getKeyInfo(apiKey) {
        if (!apiKey) return { name: 'anonymous', limit: this.defaultLimit };

        if (config.apiKeys && config.apiKeys.length > 0) {
            const found = config.apiKeys.find(k => k.key === apiKey);
            if (found) return { name: found.name || apiKey, limit: found.limit };
        }

        if (config.apiKey && apiKey === config.apiKey) {
            return { name: 'admin', limit: config.apiKeyRateLimit || 1000 };
        }

        return { name: 'unknown', limit: this.defaultLimit };
    }

    isAllowed(apiKey = null) {
        const key = apiKey || '__anonymous__';
        const limit = this.getKeyLimit(apiKey);
        const keyInfo = this.getKeyInfo(apiKey);
        const now = Date.now();

        const entry = this.keyLimits.get(key);

        if (!entry || now - entry.windowStart > this.windowMs) {
            this.keyLimits.set(key, { count: 1, windowStart: now, limit, name: keyInfo.name });
            return { allowed: true, remaining: limit - 1, resetIn: this.windowMs, keyName: keyInfo.name };
        }

        if (entry.count >= limit) {
            const retryAfter = Math.ceil((entry.windowStart + this.windowMs - now) / 1000);
            return {
                allowed: false,
                remaining: 0,
                resetIn: entry.windowStart + this.windowMs - now,
                retryAfter,
                keyName: keyInfo.name
            };
        }

        entry.count++;
        return {
            allowed: true,
            remaining: limit - entry.count,
            resetIn: entry.windowStart + this.windowMs - now,
            keyName: keyInfo.name
        };
    }

    getStatus(apiKey = null) {
        const key = apiKey || '__anonymous__';
        const entry = this.keyLimits.get(key);
        const limit = this.getKeyLimit(apiKey);
        const keyInfo = this.getKeyInfo(apiKey);

        if (!entry) {
            return { limit, remaining: limit, resetIn: this.windowMs, keyName: keyInfo.name };
        }

        const now = Date.now();
        if (now - entry.windowStart > this.windowMs) {
            return { limit, remaining: limit, resetIn: this.windowMs, keyName: keyInfo.name };
        }

        return {
            limit,
            remaining: Math.max(0, limit - entry.count),
            resetIn: entry.windowStart + this.windowMs - now,
            keyName: keyInfo.name
        };
    }

    reset(apiKey = null) {
        if (apiKey) {
            this.keyLimits.delete(apiKey);
        } else {
            this.keyLimits.clear();
        }
    }
}

export const rateLimiter = new RateLimiter();

// Per-category rate limiters for tool-level control
export const readLimiter = new RateLimiter();
export const writeLimiter = new RateLimiter();

export function createRateLimitMiddleware() {
    return (req, res, next) => {
        const apiKey = req.get('Authorization')?.replace('Bearer ', '');
        const result = rateLimiter.isAllowed(apiKey);

        res.set('X-RateLimit-Limit', result.limit);
        res.set('X-RateLimit-Remaining', result.remaining);
        res.set('X-RateLimit-Reset', Math.ceil((Date.now() + result.resetIn) / 1000));

        if (!result.allowed) {
            res.set('Retry-After', result.retryAfter);
            return res.status(429).json({
                error: 'Rate limit exceeded',
                message: `Too many requests. Limit: ${result.limit} requests per ${Math.round(rateLimiter.windowMs / 1000)} seconds`,
                retryAfter: result.retryAfter
            });
        }

        next();
    };
}

/**
 * Check tool-level rate limit based on read/write category.
 * Read tools: default limit 200/msq. Write tools: default limit 50/msq.
 */
export function checkToolRateLimit(toolName, isReadOnly, apiKey = null) {
    const limiter = isReadOnly ? readLimiter : writeLimiter;
    // Set appropriate defaults if config doesn't have them
    if (!limiter.defaultLimit) {
        limiter.defaultLimit = isReadOnly ? 200 : 50;
    }
    return limiter.isAllowed(apiKey);
}

/**
 * Get overall rate limit status (backward-compat shape).
 */
export function getRateLimitStatus(apiKey = null) {
    return rateLimiter.getStatus(apiKey);
}

export function getDetailedRateLimitStatus(apiKey = null) {
    return {
        overall: rateLimiter.getStatus(apiKey),
        read: readLimiter.getStatus(apiKey),
        write: writeLimiter.getStatus(apiKey),
    };
}

export function resetRateLimit(apiKey = null) {
    rateLimiter.reset(apiKey);
    readLimiter.reset(apiKey);
    writeLimiter.reset(apiKey);
}