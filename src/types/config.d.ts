/**
 * @file Type definitions for @lisp MCP Server configuration.
 */

/**
 * Runtime configuration object assembled from environment variables,
 * config file, and CLI arguments (three-layer priority).
 *
 * Corresponds to `config` object in `src/config.js`.
 */
export interface McpConfig {
  /** HTTP/WebSocket server port (default 8110) */
  port: number;

  /** Server bind address (default '0.0.0.0') */
  host: string;

  /** Transport mode: HTTP, stdio, or WebSocket */
  transport: 'http' | 'stdio' | 'ws';

  /** Global API key for client authentication */
  apiKey: string;

  /** Enable Server-Sent Events (default true) */
  enableSse: boolean;

  /** Timeout for worker messages in ms (default 60000) */
  messageTimeout: number;

  /** Heartbeat ping interval in ms (default 30000) */
  heartbeatInterval: number;

  /** Number of retries when CAD is busy (default 10) */
  busyRetries: number;

  /** Delay between busy retries in ms (default 500) */
  busyDelay: number;

  /** Enable CORS headers */
  enableCors: boolean;

  /** Allowed CORS origin (default '*') */
  corsOrigin: string;

  /** Rate-limit sliding window in ms (default 60000) */
  rateLimitWindow: number;

  /** Max requests per rate-limit window (default 100) */
  rateLimitMax: number;

  /** Resource list cache TTL in ms (default 5000) */
  resourceCacheTtl: number;

  /** Function library HTTP cache TTL in ms (default 300000) */
  functionLibCacheTtl: number;

  /** Enable debug logging */
  debug: boolean;

  /** Debug output file path (empty = console only) */
  debugFile: string;

  /** URL to fetch @lisp function library JSON */
  functionLibUrl: string;

  /** Path to the active config file */
  configFile: string;

  /** Rate limit override for authenticated API keys */
  apiKeyRateLimit: number;

  /** Per-key API credentials with optional limits */
  apiKeys: ApiKeyEntry[];

  /** Enable Prometheus-style metrics collection */
  metricsEnabled: boolean;

  /** Enable per-request logging */
  requestLogEnabled: boolean;

  /** Path to SSL private key file */
  sslKey: string;

  /** Path to SSL certificate file */
  sslCert: string;

  /** LLM API key for built-in AI features */
  llmApiKey: string;

  /** LLM API endpoint URL */
  llmApiUrl: string;

  /** LLM model identifier (default 'gpt-4o-mini') */
  llmModel: string;

  /** LLM max completion tokens (default 4096) */
  llmMaxTokens: number;

  /** LLM sampling temperature (default 0.7) */
  llmTemperature: number;

  /** Max number of CAD instances in connection pool (default 3) */
  maxPoolSize: number;

  /** Number of read-worker subprocesses per CAD instance (default 2) */
  workerPoolSize: number;
}

/**
 * Authenticated API key entry for per-key rate limiting and role
 * attribution.
 */
export interface ApiKeyEntry {
  /** The API key secret */
  key: string;

  /** Rate limit ceiling for this key */
  limit: number;

  /** Optional human-readable label */
  name?: string;

  /** Optional role tag for audit / authorization */
  role?: string;
}

/**
 * Raw environment variable schema (all values are strings).
 *
 * Parsed in `src/config.js` via Zod `envSchema`; numeric/boolean
 * values are coerced before final `McpConfig` assembly.
 */
export interface EnvConfig {
  PORT: string;
  HOST: string;
  TRANSPORT: 'http' | 'stdio' | 'ws';
  MCP_API_KEY: string;
  ENABLE_SSE: string;
  MESSAGE_TIMEOUT: string;
  HEARTBEAT_INTERVAL: string;
  BUSY_RETRIES: string;
  BUSY_DELAY: string;
  ENABLE_CORS: string;
  CORS_ORIGIN: string;
  RATE_LIMIT_WINDOW: string;
  RATE_LIMIT_MAX: string;
  RESOURCE_CACHE_TTL: string;
  FUNCTION_LIB_CACHE_TTL: string;
  DEBUG: string;
  DEBUG_FILE: string;
  FUNCTION_LIB_URL: string;
  CONFIG_FILE: string;
  API_KEY_RATE_LIMIT: string;
  METRICS_ENABLED: string;
  REQUEST_LOG_ENABLED: string;
  SSL_KEY_PATH: string;
  SSL_CERT_PATH: string;
  LLM_API_KEY: string;
  LLM_API_URL: string;
  LLM_MODEL: string;
  LLM_MAX_TOKENS: string;
  LLM_TEMPERATURE: string;
  WORKER_POOL_SIZE: string;
}
