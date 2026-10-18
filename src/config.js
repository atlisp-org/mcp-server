import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import os from 'os';

const envSchema = z.object({
    PORT: z.coerce.number().optional().default(8110),
    HOST: z.string().optional().default('0.0.0.0'),
    TRANSPORT: z.enum(['http', 'stdio', 'ws']).optional().default('http'),
    MCP_API_KEY: z.string().optional().default(''),
    ENABLE_SSE: z.coerce.boolean().optional().default(true),
    MESSAGE_TIMEOUT: z.coerce.number().optional().default(60000),      // 1分钟，减少超时时间
    CAD_COMMAND_TIMEOUT: z.coerce.number().optional().default(30000),  // 30秒，减少超时时间
    STALL_COOLDOWN: z.coerce.number().optional().default(15000),       // 15秒，减少冷却时间
    HEARTBEAT_PING_TIMEOUT: z.coerce.number().optional().default(5000), // 5秒，减少心跳超时
    HEARTBEAT_INTERVAL: z.coerce.number().optional().default(15000),   // 15秒，增加心跳频率
    // worker 冷启动（edge-js 加载 CLR + 连 CAD）常超过 HEARTBEAT_PING_TIMEOUT，
    // 预热期内不做存活判定，否则新 worker 会被立刻判死并反复重启。
    HEARTBEAT_WARMUP_MS: z.coerce.number().optional().default(15000),
    // 心跳自动重启 worker 的最小间隔：CAD 停在模态对话框时重启无济于事，限频避免刷屏。
    HEARTBEAT_RESET_COOLDOWN: z.coerce.number().optional().default(60000),
    BUSY_RETRIES: z.coerce.number().optional().default(10),
    BUSY_DELAY: z.coerce.number().optional().default(500),
    ENABLE_CORS: z.coerce.boolean().optional().default(true),
    // 浏览器驱动的桥接（atlisp.org/agent/bridge）需要本机 MCP 接受来自
    // atlisp.cn 各子域与 localhost 的请求，否则预检直接 403，浏览器一步都走不出去。
    //
    // 写法是**只有 host、没有协议和端口**，这是刻意的：routes.js 的 originMatches
    // 会先剥掉 scheme 与端口再比较（getHost）。所以 `localhost` 这条已经覆盖
    // http://localhost:8100 / :8110 等本机所有端口；加了 https:// 反而看不出这一点，
    // 容易被后人「修正」成逐个端口枚举。* 开头按子域后缀匹配。
    CORS_ORIGIN: z.string().optional().default('localhost,*.atlisp.cn,atlisp.cn'),
    RATE_LIMIT_WINDOW: z.coerce.number().optional().default(60000),
    RATE_LIMIT_MAX: z.coerce.number().optional().default(100),
    RESOURCE_CACHE_TTL: z.coerce.number().optional().default(5000),
    FUNCTION_LIB_CACHE_TTL: z.coerce.number().optional().default(300000),
    DEBUG: z.coerce.boolean().optional().default(false),
    DEBUG_FILE: z.string().optional().default(''),
    FUNCTION_LIB_URL: z.string().optional().default('http://s3.atlisp.cn/json/functions.json'),
    CONFIG_FILE: z.string().optional().default(''),
    API_KEY_RATE_LIMIT: z.coerce.number().optional().default(1000),
    METRICS_ENABLED: z.coerce.boolean().optional().default(true),
    TRACING_ENABLED: z.coerce.boolean().optional().default(false),
    TRACING_ENDPOINT: z.string().optional().default('http://127.0.0.1:4318/v1/traces'),
    TOOL_CATEGORIES: z.string().optional().default(''),
    TOOL_PROFILE: z.enum(['full', 'standard', 'minimal']).optional().default('full'),
    LOCALE: z.enum(['zh-CN', 'en']).optional().default('zh-CN'),
    REQUEST_LOG_ENABLED: z.coerce.boolean().optional().default(true),
    // 错误上报：字符串形式统一解析，支持 false/0/off/no 关闭（z.coerce.boolean 无法正确处理 "false"）
    ERROR_REPORT_ENABLED: z.string().optional(),
    ERROR_REPORT_URL: z.string().optional(),
    SSL_KEY_PATH: z.string().optional().default(''),
    SSL_CERT_PATH: z.string().optional().default(''),
    LLM_API_KEY: z.string().optional().default(''),
    LLM_API_URL: z.string().optional().default('https://api.openai.com/v1/chat/completions'),
    LLM_MODEL: z.string().optional().default('gpt-4o-mini'),
    LLM_MAX_TOKENS: z.coerce.number().optional().default(4096),
    LLM_TEMPERATURE: z.coerce.number().optional().default(0.7),
    WORKER_POOL_SIZE: z.coerce.number().optional().default(2),
    LINT_PRESET: z.string().optional().default(''),
    LINT_CONFIG_PATH: z.string().optional().default(''),
    LINT_LEVEL: z.string().optional().default(''),
    NO_LINT: z.coerce.boolean().optional().default(false),
    SECURITY_LEVEL: z.string().optional().default('relaxed'),
    CLIENT_ID: z.string().optional().default(''),
    MAX_ENTITY_LIMIT: z.coerce.number().optional().default(20000),
    READ_BATCH_WINDOW: z.coerce.number().optional().default(50),
    READ_BATCH_SIZE: z.coerce.number().optional().default(10),
    AUTO_CONNECT: z.coerce.boolean().optional().default(false),
    AUTO_LAUNCH: z.coerce.boolean().optional().default(true),
    LAUNCH_TIMEOUT: z.coerce.number().optional().default(30000),
    // 连接 CAD 后自动安装/加载 @lisp 核心与函数库（false/0/off/no 可关闭）
    AUTO_INSTALL_ATLISP: z.string().optional(),
    ATLISP_BOOTSTRAP_TIMEOUT: z.coerce.number().optional().default(120000),
    ATLISP_BOOTSTRAP_RETRY: z.coerce.number().optional().default(60000),
    PEER_DISCOVERY_ENABLED: z.coerce.boolean().optional().default(true),
    PEER_DISCOVERY_PORT: z.coerce.number().optional().default(9811),
    PEER_DISCOVERY_INTERVAL: z.coerce.number().optional().default(5000),
    PEER_DISCOVERY_SILENT: z.coerce.boolean().optional().default(false),
    REMOTE_PEER_HOST: z.string().optional().default(''),
    REMOTE_PEER_PORT: z.coerce.number().optional().default(8110),
    REMOTE_PEER_API_KEY: z.string().optional().default(''),
    REMOTE_PEER_AUTO_FORWARD: z.coerce.boolean().optional().default(false),
    // 常驻进程的内存上限类参数：MCP Server 常年不重启，任何按「条数」而非「字节」
    // 淘汰的缓存都会在几小时内把 4GB 堆吃光（一次 get_entities 就能返回几十 MB）。
    SSE_REPLAY_MAX_BYTES: z.coerce.number().optional().default(8388608),   // SSE 重放缓冲 8MB
    SSE_BACKPRESSURE_MAX_BYTES: z.coerce.number().optional().default(4194304), // SSE 背压缓冲 4MB
    REPL_HISTORY_MAX: z.coerce.number().optional().default(100),          // REPL 每会话历史条数
    REPL_RESULT_MAX_CHARS: z.coerce.number().optional().default(8192),    // REPL 单条结果保留字符数
    WORKER_QUEUE_MAX: z.coerce.number().optional().default(200),          // worker 待处理队列上限
    SANDBOX_ALLOWLIST_MAX: z.coerce.number().optional().default(500),     // 会话 allowlist 条数上限
    SESSION_IDLE_TTL: z.coerce.number().optional().default(1800000),      // HTTP MCP 会话空闲 TTL 30min
    AGENT_CONTEXT_MAX_SESSIONS: z.coerce.number().optional().default(200), // agent context 最大会话数
    AGENT_CONTEXT_TTL: z.coerce.number().optional().default(1800000),     // agent context 会话 TTL 30min
});

const configSchema = z.object({
    port: z.number().optional(),
    host: z.string().optional(),
    transport: z.enum(['http', 'stdio', 'ws']).optional(),
    apiKey: z.string().optional(),
    enableSse: z.boolean().optional(),
    messageTimeout: z.number().optional(),
    cadCommandTimeout: z.number().optional(),
    stallCooldown: z.number().optional(),
    heartbeatPingTimeout: z.number().optional(),
    heartbeatInterval: z.number().optional(),
    heartbeatWarmupMs: z.number().optional(),
    heartbeatResetCooldown: z.number().optional(),
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
    tracingEnabled: z.boolean().optional(),
    tracingEndpoint: z.string().optional(),
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
    toolCategories: z.array(z.string()).optional(),
    toolProfile: z.enum(['full', 'standard', 'minimal']).optional(),
    locale: z.enum(['zh-CN', 'en']).optional().default('zh-CN'),
    securityLevel: z.enum(['strict', 'standard', 'relaxed']).optional(),
    clientId: z.string().optional(),
    errorReportEnabled: z.boolean().optional(),
    errorReportUrl: z.string().optional(),
    maxEntityLimit: z.number().optional(),
    readBatchWindow: z.number().optional(),
    readBatchSize: z.number().optional(),
    autoConnect: z.boolean().optional(),
    autoLaunch: z.boolean().optional(),
    launchTimeout: z.number().optional(),
    autoInstallAtlisp: z.boolean().optional(),
    atlispBootstrapTimeout: z.number().optional(),
    atlispBootstrapRetry: z.number().optional(),
    peerDiscovery: z.object({
        enabled: z.boolean().optional(),
        port: z.number().optional(),
        broadcastInterval: z.number().optional(),
        silent: z.boolean().optional(),
        peers: z.array(z.object({
            id: z.string().optional(),
            host: z.string(),
            port: z.number().optional(),
            hostname: z.string().optional(),
            version: z.string().optional(),
            apikey: z.string().optional(),
        })).optional(),
    }).optional(),
    remotePeer: z.object({
        host: z.string(),
        port: z.number().optional(),
        apiKey: z.string().optional(),
        autoForward: z.boolean().optional(),
    }).optional(),
    sseReplayMaxBytes: z.number().optional(),
    sseBackpressureMaxBytes: z.number().optional(),
    replHistoryMax: z.number().optional(),
    replResultMaxChars: z.number().optional(),
    workerQueueMax: z.number().optional(),
    sandboxAllowlistMax: z.number().optional(),
    sessionIdleTtl: z.number().optional(),
    agentContextMaxSessions: z.number().optional(),
    agentContextTtl: z.number().optional(),
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
            result.port = parseInt(args[i + 1], 10);
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
        } else if (args[i] === '--security-level' && args[i + 1]) {
            result.securityLevel = args[i + 1];
            i++;
        } else if (args[i] === '--tool-profile' && args[i + 1]) {
            result.toolProfile = args[i + 1];
            i++;
        } else if (args[i] === '--auto-install-atlisp') {
            result.autoInstallAtlisp = true;
        } else if (args[i] === '--no-auto-install-atlisp') {
            result.autoInstallAtlisp = false;
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

/** 宽松布尔解析：false/0/off/no/disabled 视为 false，其余非空值视为 true。 */
function parseBool(value, def) {
    if (value === undefined || value === null || value === '') return def;
    if (typeof value === 'boolean') return value;
    return !/^(0|false|no|off|disabled)$/i.test(String(value).trim());
}

const config = {
    // 优先级：CLI 参数 > 配置文件 > 环境变量。
    // cliArgs 必须排最前——envSchema 里 PORT/HOST/TRANSPORT 带 .default()，
    // env.X 恒有值，不能用来判断用户是否显式设置过；而配置文件一旦写了这些键，
    // 排在前面的 cliArgs 会被静默覆盖（--port 传了不起作用）。
    port: cliArgs.port ?? fileConfig?.port ?? env.PORT,
    host: cliArgs.host ?? fileConfig?.host ?? env.HOST,
    transport: cliArgs.transport ?? fileConfig?.transport ?? env.TRANSPORT,
    apiKey: fileConfig?.apiKey ?? env.MCP_API_KEY,
    enableSse: fileConfig?.enableSse ?? env.ENABLE_SSE,
    messageTimeout: fileConfig?.messageTimeout ?? env.MESSAGE_TIMEOUT,
    cadCommandTimeout: fileConfig?.cadCommandTimeout ?? env.CAD_COMMAND_TIMEOUT,
    stallCooldown: fileConfig?.stallCooldown ?? env.STALL_COOLDOWN,
    heartbeatPingTimeout: fileConfig?.heartbeatPingTimeout ?? env.HEARTBEAT_PING_TIMEOUT,
    heartbeatInterval: fileConfig?.heartbeatInterval ?? env.HEARTBEAT_INTERVAL,
    heartbeatWarmupMs: fileConfig?.heartbeatWarmupMs ?? env.HEARTBEAT_WARMUP_MS,
    heartbeatResetCooldown: fileConfig?.heartbeatResetCooldown ?? env.HEARTBEAT_RESET_COOLDOWN,
    busyRetries: fileConfig?.busyRetries ?? env.BUSY_RETRIES,
    busyDelay: fileConfig?.busyDelay ?? env.BUSY_DELAY,
    enableCors: fileConfig?.enableCors ?? env.ENABLE_CORS,
    corsOrigin: fileConfig?.corsOrigin ?? env.CORS_ORIGIN,
    rateLimitWindow: fileConfig?.rateLimitWindow ?? env.RATE_LIMIT_WINDOW,
    rateLimitMax: fileConfig?.rateLimitMax ?? env.RATE_LIMIT_MAX,
    resourceCacheTtl: fileConfig?.resourceCacheTtl ?? env.RESOURCE_CACHE_TTL,
    functionLibCacheTtl: fileConfig?.functionLibCacheTtl ?? env.FUNCTION_LIB_CACHE_TTL,
    debug: fileConfig?.debug ?? env.DEBUG,
    debugFile: fileConfig?.debugFile ?? env.DEBUG_FILE,
    functionLibUrl: fileConfig?.functionLibUrl ?? env.FUNCTION_LIB_URL,
    configFile: configFilePath,
    apiKeyRateLimit: fileConfig?.apiKeyRateLimit ?? env.API_KEY_RATE_LIMIT,
    apiKeys: fileConfig?.apiKeys ?? [],
    metricsEnabled: fileConfig?.metricsEnabled ?? env.METRICS_ENABLED,
    tracingEnabled: fileConfig?.tracingEnabled ?? env.TRACING_ENABLED,
    tracingEndpoint: fileConfig?.tracingEndpoint ?? env.TRACING_ENDPOINT,
    toolCategories: fileConfig?.toolCategories
      ?? (env.TOOL_CATEGORIES
        ? env.TOOL_CATEGORIES.split(',').map(s => s.trim()).filter(Boolean)
        : []),
    // 工具暴露档位：full=全部工具（默认，行为不变）；standard/minimal 按 category
    // 过滤 tools/list 暴露面以降低 token 成本，被过滤的工具仍可经 search_tools 检索。
    // 优先级同上：CLI > 配置文件 > 环境变量 > 默认 full。
    toolProfile: cliArgs.toolProfile ?? fileConfig?.toolProfile ?? env.TOOL_PROFILE,
    locale: fileConfig?.locale ?? env.LOCALE,
    requestLogEnabled: fileConfig?.requestLogEnabled ?? env.REQUEST_LOG_ENABLED,
    // ERROR 日志上报（默认开启，用于改进项目；不包含图纸/用户数据）
    errorReportEnabled: fileConfig?.errorReportEnabled ?? parseBool(env.ERROR_REPORT_ENABLED, true),
    errorReportUrl: fileConfig?.errorReportUrl ?? (env.ERROR_REPORT_URL || 'https://atlisp.cn/api/error/report'),
    sslKey: cliArgs.sslKey ?? fileConfig?.sslKey ?? env.SSL_KEY_PATH,
    sslCert: cliArgs.sslCert ?? fileConfig?.sslCert ?? env.SSL_CERT_PATH,
    llmApiKey: fileConfig?.llmApiKey ?? env.LLM_API_KEY,
    llmApiUrl: fileConfig?.llmApiUrl ?? env.LLM_API_URL,
    llmModel: fileConfig?.llmModel ?? env.LLM_MODEL,
    llmMaxTokens: fileConfig?.llmMaxTokens ?? env.LLM_MAX_TOKENS,
    llmTemperature: fileConfig?.llmTemperature ?? env.LLM_TEMPERATURE,
    maxPoolSize: fileConfig?.maxPoolSize ?? 3,
    workerPoolSize: fileConfig?.workerPoolSize ?? env.WORKER_POOL_SIZE,
    lintPreset: cliArgs.lintPreset ?? fileConfig?.lintPreset ?? (env.LINT_PRESET || undefined),
    lintConfigPath: cliArgs.lintConfigPath ?? fileConfig?.lintConfigPath ?? (env.LINT_CONFIG_PATH || undefined),
    lintLevel: cliArgs.lintLevel ?? fileConfig?.lintLevel ?? (env.LINT_LEVEL || undefined),
    noLint: cliArgs.noLint ?? fileConfig?.noLint ?? env.NO_LINT,
    securityLevel: cliArgs.securityLevel ?? fileConfig?.securityLevel ?? (env.SECURITY_LEVEL || 'relaxed'),
    clientId: fileConfig?.clientId ?? (env.CLIENT_ID || ''),
    maxEntityLimit: fileConfig?.maxEntityLimit ?? env.MAX_ENTITY_LIMIT,
    readBatchWindow: fileConfig?.readBatchWindow ?? env.READ_BATCH_WINDOW,
    readBatchSize: fileConfig?.readBatchSize ?? env.READ_BATCH_SIZE,
    autoConnect: fileConfig?.autoConnect ?? env.AUTO_CONNECT,
    autoLaunch: fileConfig?.autoLaunch ?? env.AUTO_LAUNCH,
    launchTimeout: fileConfig?.launchTimeout ?? env.LAUNCH_TIMEOUT,
    autoInstallAtlisp: cliArgs.autoInstallAtlisp ?? fileConfig?.autoInstallAtlisp ??
        parseBool(env.AUTO_INSTALL_ATLISP, true),
    atlispBootstrapTimeout: fileConfig?.atlispBootstrapTimeout ?? env.ATLISP_BOOTSTRAP_TIMEOUT,
    atlispBootstrapRetry: fileConfig?.atlispBootstrapRetry ?? env.ATLISP_BOOTSTRAP_RETRY,
    peerDiscovery: {
        enabled: fileConfig?.peerDiscovery?.enabled ?? env.PEER_DISCOVERY_ENABLED,
        port: fileConfig?.peerDiscovery?.port ?? env.PEER_DISCOVERY_PORT,
        broadcastInterval: fileConfig?.peerDiscovery?.broadcastInterval ?? env.PEER_DISCOVERY_INTERVAL,
        silent: fileConfig?.peerDiscovery?.silent ?? env.PEER_DISCOVERY_SILENT,
        peers: fileConfig?.peerDiscovery?.peers ?? [],
    },
    remotePeer: (() => {
        const host = fileConfig?.remotePeer?.host || env.REMOTE_PEER_HOST || '';
        if (!host) return null;
        return {
            host,
            port: fileConfig?.remotePeer?.port ?? env.REMOTE_PEER_PORT,
            apiKey: fileConfig?.remotePeer?.apiKey || env.REMOTE_PEER_API_KEY || '',
            autoForward: fileConfig?.remotePeer?.autoForward ?? env.REMOTE_PEER_AUTO_FORWARD,
        };
    })(),
    sseReplayMaxBytes: fileConfig?.sseReplayMaxBytes ?? env.SSE_REPLAY_MAX_BYTES,
    sseBackpressureMaxBytes: fileConfig?.sseBackpressureMaxBytes ?? env.SSE_BACKPRESSURE_MAX_BYTES,
    replHistoryMax: fileConfig?.replHistoryMax ?? env.REPL_HISTORY_MAX,
    replResultMaxChars: fileConfig?.replResultMaxChars ?? env.REPL_RESULT_MAX_CHARS,
    workerQueueMax: fileConfig?.workerQueueMax ?? env.WORKER_QUEUE_MAX,
    sandboxAllowlistMax: fileConfig?.sandboxAllowlistMax ?? env.SANDBOX_ALLOWLIST_MAX,
    sessionIdleTtl: fileConfig?.sessionIdleTtl ?? env.SESSION_IDLE_TTL,
    agentContextMaxSessions: fileConfig?.agentContextMaxSessions ?? env.AGENT_CONTEXT_MAX_SESSIONS,
    agentContextTtl: fileConfig?.agentContextTtl ?? env.AGENT_CONTEXT_TTL,
};

if (config.lintConfigPath) process.env.LINT_CONFIG_PATH = config.lintConfigPath;
if (config.lintPreset) process.env.LINT_PRESET = config.lintPreset;
if (config.lintLevel) process.env.LINT_LEVEL = config.lintLevel;
if (config.noLint) process.env.NO_LINT = 'true';
if (config.securityLevel) process.env.SECURITY_LEVEL = config.securityLevel;

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
    if (config.cadCommandTimeout < 1000) {
        errors.push(`命令超时过短: ${config.cadCommandTimeout}ms (最小 1000ms)`);
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

const configWatchers = [];
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
                    configWatchers.forEach(fn => { try { fn(config); } catch (e) { console.error('[config] watcher 回调失败:', e.message); } });
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
        configWatchers.forEach(fn => { try { fn(config); } catch (e) { console.error('[config] watcher 回调失败:', e.message); } });
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
