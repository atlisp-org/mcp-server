import fs from 'fs';
import path from 'path';
import { log } from '../logger.js';
import * as cadHandlers from './cad-handlers.js';
import os from 'os';
import config from '../config.js';

const FUNCTIONS_DIR = process.env.FUNCTIONS_DIR || '';
const FUNCTIONS_URL = process.env.FUNCTIONS_URL || config.functionLibUrl || 'http://s3.atlisp.cn/json/functions.json';
const CACHE_DIR = path.join(os.homedir(), '.atlisp', 'cache');
const FUNCLIB_CACHE_FILE = path.join(CACHE_DIR, 'functions.json');
const FUNCLIB_CACHE_TTL = config.functionLibCacheTtl || 24 * 60 * 60 * 1000;

let cachedFunctionLib = null;
let cachedAt = null;

function readCacheFromDisk() {
    try {
        const stat = fs.statSync(FUNCLIB_CACHE_FILE);
        if (Date.now() - stat.mtimeMs < FUNCLIB_CACHE_TTL) {
            const raw = fs.readFileSync(FUNCLIB_CACHE_FILE, 'utf-8');
            return JSON.parse(raw);
        }
    } catch (e) { log(`function-handlers: readCache error: ${e.message}`); }
    return null;
}

function writeCacheToDisk(data) {
    try {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
        fs.writeFileSync(FUNCLIB_CACHE_FILE, JSON.stringify(data), 'utf-8');
    } catch (e) {
        log(`function-handlers writeCache error: ${e.message}`);
    }
}

async function fetchFunctions() {
    const now = Date.now();
    if (cachedFunctionLib && cachedAt && (now - cachedAt) < FUNCLIB_CACHE_TTL) {
        return cachedFunctionLib;
    }

    const diskCache = readCacheFromDisk();
    if (diskCache) {
        cachedFunctionLib = diskCache;
        cachedAt = now;
        return diskCache;
    }

    try {
        const response = await fetch(FUNCTIONS_URL, {
            headers: { 'User-Agent': 'atlisp-mcp' },
            signal: AbortSignal.timeout(15000),
        });
        if (response.ok) {
            const data = await response.json();
            cachedFunctionLib = data;
            cachedAt = now;
            writeCacheToDisk(data);
            return data;
        }
    } catch (e) {
        log(`function-handlers fetch error: ${e.message}`);
    }
    return cachedFunctionLib;
}

export async function loadAtlibFunctionLib() {
    return await fetchFunctions();
}

export async function getFunctionUsage(funcName, packageName) {
    try {
        let results = [];

        const data = await fetchFunctions();
        if (data) {
            const funcs = Object.values(data.all_functions || {});
            const func = funcs.find(f => f.name === funcName || f.name === `${packageName}:${funcName}`);
            if (func) results.push(func);
        }

        if (results.length === 0 && FUNCTIONS_DIR) {
            try {
                const files = fs.readdirSync(FUNCTIONS_DIR).filter(f => f.endsWith('.json'));
                for (const file of files) {
                    const raw = fs.readFileSync(path.join(FUNCTIONS_DIR, file), 'utf-8');
                    const data = JSON.parse(raw);
                    const func = data.functions?.find(f => f.name === funcName);
                    if (func) results.push(func);
                }
            } catch (e) { log(`function-handlers: FUNCTIONS_DIR read error: ${e.message}`); }
        }

        if (results.length === 0) {
            return { content: [{ type: 'text', text: `未找到函数: ${funcName}` }], isError: true };
        }

        const f = results[0];
        const text = `函数: ${f.name}
描述: ${f.description || '-'}
参数: ${f.params?.join(', ') || '-'}
返回值: ${f.return || '-'}
示例: ${f.usage || '-'}`;

        return { content: [{ type: 'text', text }] };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function listSymbols(packageName) {
    try {
        let allFuncs = [];

        const data = await fetchFunctions();
        if (data) {
            const funcs = Object.values(data.all_functions || {});
            if (packageName) {
                allFuncs = funcs.filter(f => f.name.startsWith(`${packageName}:`));
            } else {
                allFuncs = funcs.map(f => `${f.name}: ${f.description || '-'}`);
            }
        }

        if (allFuncs.length === 0 && FUNCTIONS_DIR) {
            try {
                const files = fs.readdirSync(FUNCTIONS_DIR).filter(f => f.endsWith('.json'));
                for (const file of files) {
                    const raw = fs.readFileSync(path.join(FUNCTIONS_DIR, file), 'utf-8');
                    const data = JSON.parse(raw);
                    const funcs = Object.values(data.all_functions || {});
                    if (packageName) {
                        allFuncs = funcs.filter(f => f.name.startsWith(`${packageName}:`));
                    } else {
                        for (const f of funcs) {
                            allFuncs.push(`${f.name}: ${f.description || '-'}`);
                        }
                    }
                }
            } catch (err) {
                log(`listSymbols readDir error: ${err.message}`);
            }
        }

        if (allFuncs.length === 0) {
            return await cadHandlers.listFunctionsInCad();
        }

        if (packageName) {
            return { content: [{ type: 'text', text: `${packageName} 包函数 (${allFuncs.length}):\n${allFuncs.map(f => f.name).join('\n')}` }] };
        }

        return { content: [{ type: 'text', text: allFuncs.join('\n') }] };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}
