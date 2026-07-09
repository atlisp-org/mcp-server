import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import os from 'os';

const envSchema = z.object({
    PORT: z.string().optional().default('8110'),
    HOST: z.string().optional().default('0.0.0.0'),
    TRANSPORT: z.enum(['http', 'stdio', 'ws']).optional().default('http'),
    MCP_API_KEY: z.string().optional().default(''),
    ENABLE_SSE: z.string().optional().default('true'),
    MESSAGE_TIMEOUT: z.string().optional().default('60000'),
    HEARTBEAT_INTERVAL: z.string().optional().default('30000'),
    BUSY_RETRIES: z.string().optional().default('10'),
    BUSY_DELAY: z.string().optional().default('500'),
    ENABLE_CORS: z.string().optional().default('true'),
    CORS_ORIGIN: z.string().optional().default('*'),
    RATE_LIMIT_WINDOW: z.string().optional().default('60000'),
    RATE_LIMIT_MAX: z.string().optional().default('100'),
    RESOURCE_CACHE_TTL: z.string().optional().default('5000'),
    FUNCTION_LIB_CACHE_TTL: z.string().optional().default('300000'),
    DEBUG: z.string().optional().default('false'),
    DEBUG_FILE: z.string().optional().default(''),
    FUNCTION_LIB_URL: z.string().optional().default('http://s3.atlisp.cn/json/functions.json'),
    CONFIG_FILE: z.string().optional().default(''),
    API_KEY_RATE_LIMIT: z.string().optional().default('1000'),
    METRICS_ENABLED: z.string().optional().default('true'),
    REQUEST_LOG_ENABLED: z.string().optional().default('true'),
    SSL_KEY_PATH: z.string().optional().default(''),
    SSL_CERT_PATH: z.string().optional().default(''),
    LLM_API_KEY: z.string().optional().default(''),
    LLM_API_URL: z.string().optional().default('https://api.openai.com/v1/chat/completions'),
    LLM_MODEL: z.string().optional().default('gpt-4o-mini'),
    LLM_MAX_TOKENS: z.string().optional().default('4096'),
    LLM_TEMPERATURE: z.string().optional().default('0.7'),
    WORKER_POOL_SIZE: z.string().optional().default('2'),
    LINT_PRESET: z.string().optional().default(''),
    LINT_CONFIG_PATH: z.string().optional().default(''),
    LINT_LEVEL: z.string().optional().default(''),
    NO_LINT: z.string().optional().default(''),
    SECURITY_LEVEL: z.string().optional().default('strict'),
});

const configSchema = z.object({
    port: z.number().optional(),
    host: z.string().optional(),
    transport: z.enum(['http', 'stdio', 'ws']).optional(),
    apiKey: z.string().optional(),
    enableSse: z.boolean().optional(),
    messageTimeout: z.number().optional(),
    heartbeatInterval: z.number().optional(),
    busyRetries: z.number().optional(),
    busyDelay: z.number().optional(),
    enableCors: z.boolean().optional(),
    corsOrigin: z.string().optional(),
    rateLimitWindow: z.number().optional(),
    rateLimitMax: z.number().optional(),
    resourceCacheTtl: z.number().optional(),
    functionLibCacheTtl: z.number().optional(),
    debug: z.boolean().optional(),
    debugFile: z.string().optional(),
    functionLibUrl: z.string().optional(),
    configFile: z.string().optional(),
    apiKeyRateLimit: z.number().optional(),
    metricsEnabled: z.boolean().optional(),
    apiKeys: z.array(z.object({
        key: z.string(),
        limit: z.number(),
        name: z.string().optional(),
        role: z.string().optional()
    })).optional(),
    sslKey: z.string().optional(),
    sslCert: z.string().optional(),
    llmApiKey: z.string().optional(),
    llmApiUrl: z.string().optional(),
    llmModel: z.string().optional(),
    llmMaxTokens: z.number().optional(),
    llmTemperature: z.number().optional(),
    maxPoolSize: z.number().optional(),
    workerPoolSize: z.number().optional(),
    lintPreset: z.string().optional(),
    lintConfigPath: z.string().optional(),
    lintLevel: z.string().optional(),
    noLint: z.boolean().optional(),
    securityLevel: z.enum(['strict', 'standard', 'relaxed']).optional(),
});

function parseArgs() {
    const args = process.argv.slice(2);
    const result = {};
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--transport' && args[i + 1]) {
            result.transport = args[i + 1];
            i++;
        } else if (args[i] === '--stdio') {
            result.transport = 'stdio';
        } else if (args[i] === '--ws') {
            result.transport = 'ws';
        } else if (args[i] === '--port' && args[i + 1]) {
            result.port = args[i + 1];
            i++;
        } else if (args[i] === '--host' && args[i + 1]) {
            result.host = args[i + 1];
            i++;
        } else if (args[i] === '--config' && args[i + 1]) {
            result.configFile = args[i + 1];
            i++;
        } else if (args[i] === '--ssl-key' && args[i + 1]) {
            result.sslKey = args[i + 1];
            i++;
        } else if (args[i] === '--ssl-cert' && args[i + 1]) {
            result.sslCert = args[i + 1];
            i++;
        } else if (args[i] === '--debug') {
            result.debug = true;
        } else if (args[i] === '--lint-preset' && args[i + 1]) {
            result.lintPreset = args[i + 1];
            i++;
        } else if (args[i] === '--lint-config' && args[i + 1]) {
            result.lintConfigPath = args[i + 1];
            i++;
        } else if (args[i] === '--lint-level' && args[i + 1]) {
            result.lintLevel = args[i + 1];
            i++;
        } else if (args[i] === '--no-lint' || args[i] === '--lint-off') {
            result.noLint = true;
        } else if (arg === '--security-level' && args[i + 1]) {
            result.securityLevel = args[i + 1];
            i++;
        }
    }
    return result;
}

export { parseArgs };

function loadConfigFile(filePath) {
    if (!filePath || !fs.existsSync(filePath)) return null;
    try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        const result = configSchema.safeParse(parsed);
        if (result.success) {
            return result.data;
        }
        console.error('配置文件格式错误:', result.error);
    } catch (e) {
        console.error('加载配置文件失败:', e.message);
    }
    return null;
}

const cliArgs = parseArgs();
const envResult = envSchema.safeParse(process.env);

if (!envResult.success) {
    console.error('环境变量配置错误:', envResult.error.flatten().fieldErrors);
    process.exit(1);
}

const env = envResult.data;

const configFilePath = env.CONFIG_FILE || cliArgs.configFile ||
    path.join(os.homedir(), '.atlisp', 'atlisp.config.json');

const fileConfig = loadConfigFile(configFilePath);

const config = {
    port: fileConfig?.port || parseInt(cliArgs.port || env.PORT, 10),
    host: fileConfig?.host || cliArgs.host || env.HOST,
    transport: fileConfig?.transport ?? cliArgs.transport ?? env.TRANSPORT,
    apiKey: fileConfig?.apiKey || env.MCP_API_KEY,
    enableSse: fileConfig?.enableSse ?? (env.ENABLE_SSE === 'true'),
    messageTimeout: fileConfig?.messageTimeout || parseInt(env.MESSAGE_TIMEOUT, 10),
    heartbeatInterval: fileConfig?.heartbeatInterval || parseInt(env.HEARTBEAT_INTERVAL, 10),
    busyRetries: fileConfig?.busyRetries || parseInt(env.BUSY_RETRIES, 10),
    busyDelay: fileConfig?.busyDelay || parseInt(env.BUSY_DELAY, 10),
    enableCors: fileConfig?.enableCors ?? (env.ENABLE_CORS === 'true'),
    corsOrigin: fileConfig?.corsOrigin || env.CORS_ORIGIN,
    rateLimitWindow: fileConfig?.rateLimitWindow || parseInt(env.RATE_LIMIT_WINDOW, 10),
    rateLimitMax: fileConfig?.rateLimitMax || parseInt(env.RATE_LIMIT_MAX, 10),
    resourceCacheTtl: fileConfig?.resourceCacheTtl || parseInt(env.RESOURCE_CACHE_TTL, 10),
    functionLibCacheTtl: fileConfig?.functionLibCacheTtl || parseInt(env.FUNCTION_LIB_CACHE_TTL, 10),
    debug: fileConfig?.debug ?? (env.DEBUG === 'true'),
    debugFile: fileConfig?.debugFile || env.DEBUG_FILE,
    functionLibUrl: fileConfig?.functionLibUrl || env.FUNCTION_LIB_URL,
    configFile: configFilePath,
    apiKeyRateLimit: fileConfig?.apiKeyRateLimit || parseInt(env.API_KEY_RATE_LIMIT, 10),
    apiKeys: fileConfig?.apiKeys || [],
    metricsEnabled: fileConfig?.metricsEnabled ?? (env.METRICS_ENABLED === 'true'),
    requestLogEnabled: fileConfig?.requestLogEnabled ?? (env.REQUEST_LOG_ENABLED !== 'false'),
    sslKey: fileConfig?.sslKey || env.SSL_KEY_PATH || cliArgs.sslKey,
    sslCert: fileConfig?.sslCert || env.SSL_CERT_PATH || cliArgs.sslCert,
    llmApiKey: fileConfig?.llmApiKey || env.LLM_API_KEY,
    llmApiUrl: fileConfig?.llmApiUrl || env.LLM_API_URL,
    llmModel: fileConfig?.llmModel || env.LLM_MODEL,
    llmMaxTokens: fileConfig?.llmMaxTokens || parseInt(env.LLM_MAX_TOKENS, 10),
    llmTemperature: fileConfig?.llmTemperature || parseFloat(env.LLM_TEMPERATURE),
    maxPoolSize: fileConfig?.maxPoolSize || 3,
    workerPoolSize: fileConfig?.workerPoolSize || parseInt(env.WORKER_POOL_SIZE, 10),
    lintPreset: fileConfig?.lintPreset || cliArgs.lintPreset || env.LINT_PRESET || undefined,
    lintConfigPath: fileConfig?.lintConfigPath || cliArgs.lintConfigPath || env.LINT_CONFIG_PATH || undefined,
    lintLevel: fileConfig?.lintLevel || cliArgs.lintLevel || env.LINT_LEVEL || undefined,
    noLint: fileConfig?.noLint ?? cliArgs.noLint ?? (env.NO_LINT === 'true'),
    securityLevel: fileConfig?.securityLevel ?? cliArgs.securityLevel ?? (env.SECURITY_LEVEL || 'strict'),
};

if (config.lintConfigPath) process.env.LINT_CONFIG_PATH = config.lintConfigPath;
if (config.lintPreset) process.env.LINT_PRESET = config.lintPreset;
if (config.lintLevel) process.env.LINT_LEVEL = config.lintLevel;
if (config.noLint) process.env.NO_LINT = 'true';

export function validateConfig() {
    const errors = [];
    if (config.transport === 'http' || config.transport === 'ws') {
        if (config.port < 1 || config.port > 65535) {
            errors.push(`端口号无效: ${config.port}`);
        }
    }
    if (config.sslKey && !fs.existsSync(config.sslKey)) {
        errors.push(`SSL 密钥文件不存在: ${config.sslKey}`);
    }
    if (config.sslCert && !fs.existsSync(config.sslCert)) {
        errors.push(`SSL 证书文件不存在: ${config.sslCert}`);
    }
    if (config.messageTimeout < 1000) {
        errors.push(`消息超时过短: ${config.messageTimeout}ms (最小 1000ms)`);
    }
    if (config.rateLimitMax < 1) {
        errors.push(`速率限制无效: ${config.rateLimitMax}`);
    }
    if (errors.length > 0) {
        console.error('配置验证错误:');
        errors.forEach(e => console.error(`  - ${e}`));
        return false;
    }
    return true;
}

let configWatchers = [];
let configReloadLock = false;

if (configFilePath && fs.existsSync(configFilePath)) {
    try {
        fs.watch(configFilePath, (eventType) => {
            if (eventType === 'change') {
                if (configReloadLock) return;
                configReloadLock = true;
                const newFileConfig = loadConfigFile(configFilePath);
                if (newFileConfig) {
                    Object.assign(config, newFileConfig);
                    configWatchers.forEach(fn => { try { fn(config); } catch {} });
                }
                configReloadLock = false;
            }
        });
    } catch (e) { console.error(`Config file watch error: ${e.message}`); }
}

export function getConfig(key) {
    return config[key];
}

export function getAllConfig() {
    return { ...config };
}

export function reloadConfig() {
    if (configReloadLock) return false;
    configReloadLock = true;
    const newFileConfig = loadConfigFile(config.configFile);
    if (newFileConfig) {
        Object.assign(config, newFileConfig);
        configWatchers.forEach(fn => { try { fn(config); } catch {} });
        configReloadLock = false;
        return true;
    }
    configReloadLock = false;
    return false;
}

export function onConfigChange(callback) {
    configWatchers.push(callback);
}

export default config;