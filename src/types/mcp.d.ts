/**
 * @file Type definitions for the MCP protocol layer.
 *
 * These types describe the JSON-RPC 2.0 request/response envelopes,
 * resource templates, prompt definitions, and completion (auto-fill)
 * structures used by the MCP server implementation
 * (`src/mcp-handlers.js`).
 */

import type { ToolCallResult, ToolDefinition } from './tools.js';

// ---------------------------------------------------------------------------
// Request / Response Envelopes
// ---------------------------------------------------------------------------

/**
 * JSON-RPC 2.0 request received from an MCP client.
 *
 * Dispatched by the MCP SDK server; `method` determines which
 * handler processes the request in `src/mcp-handlers.js`.
 */
export interface McpRequest<
  TParams extends Record<string, unknown> = Record<string, unknown>
> {
  jsonrpc: '2.0';
  /** Request identifier (opaque string or number). */
  id: string | number;
  /** MCP method name (e.g. 'tools/list', 'tools/call'). */
  method: string;
  /** Method-specific parameters. */
  params?: TParams;
}

/**
 * JSON-RPC 2.0 success response.
 */
export interface McpSuccessResponse<
  TResult = unknown
> {
  jsonrpc: '2.0';
  /** Echoes the request id. */
  id: string | number;
  /** Method-specific result data. */
  result: TResult;
}

/**
 * JSON-RPC 2.0 error response.
 */
export interface McpErrorResponse {
  jsonrpc: '2.0';
  id: string | number;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/** Union of success and error responses. */
export type McpResponse<TResult = unknown> =
  | McpSuccessResponse<TResult>
  | McpErrorResponse;

/** JSON-RPC 2.0 notification (no id field, no response expected). */
export interface McpNotification<TParams = Record<string, unknown>> {
  jsonrpc: '2.0';
  method: string;
  params?: TParams;
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

/** Parameters for the `tools/list` request. */
export interface ListToolsParams {
  /** Pagination cursor (base64-encoded offset). */
  cursor?: string;
}

/** Result of a `tools/list` request. */
export interface ListToolsResult {
  tools: ToolDefinition[];
  /** Present when more tools are available beyond this page. */
  nextCursor?: string;
}

/** Parameters for the `tools/call` request. */
export interface CallToolParams {
  /** Name of the tool to invoke. */
  name: string;
  /** Tool arguments (validated against `inputSchema` by the server). */
  arguments?: Record<string, unknown>;
  /** Metadata including optional progress tracking. */
  _meta?: {
    progressToken?: string | number;
  };
}

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

/**
 * An MCP resource template — a URI pattern that clients can
 * instantiate to read dynamic data.
 *
 * Defined as a static array of `RESOURCE_TEMPLATES` in
 * `src/mcp-handlers.js`.
 */
export interface ResourceTemplate {
  /** URI template with `{placeholder}` variables. */
  uriTemplate: string;

  /** Human-readable name for this resource category. */
  name: string;

  /** Description of what the resource provides. */
  description: string;

  /** Expected MIME type of the resolved resource. */
  mimeType: string;
}

/** Parameters for the `resources/list` request. */
export interface ListResourcesParams {
  cursor?: string;
}

/** A single resource entry returned by `resources/list`. */
export interface Resource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

/** Result of a `resources/list` request. */
export interface ListResourcesResult {
  resources: Resource[];
  nextCursor?: string;
}

/** Parameters for the `resources/read` request. */
export interface ReadResourceParams {
  /** Fully-resolved resource URI. */
  uri: string;
}

/** A single content item within a `resources/read` response. */
export interface ResourceContent {
  uri: string;
  mimeType?: string;
  /** Text content (for JSON/plain resources). */
  text?: string;
  /** Base64-encoded blob content. */
  blob?: string;
}

/** Result of a `resources/read` request. */
export interface ReadResourceResult {
  contents: ResourceContent[];
  isError?: boolean;
  error?: {
    code: number;
    message: string;
  };
}

/** Parameters for the `resources/subscribe` request. */
export interface SubscribeParams {
  uri: string;
}

/** Parameters for the `resources/unsubscribe` request. */
export interface UnsubscribeParams {
  uri: string;
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

/**
 * An MCP prompt definition loaded from `src/prompts/definitions/`.
 *
 * Each prompt is a JSON file containing name, description, optional
 * arguments, and message templates.  Served to clients via
 * `prompts/list` and `prompts/get`.
 */
export interface PromptDefinition {
  /** Unique prompt name. */
  name: string;

  /** Human-readable description. */
  description?: string;

  /** Argument definitions that the prompt accepts. */
  arguments?: PromptArgument[];

  /** Pre-formatted message templates. */
  messages: PromptMessage[];
}

/** A single prompt argument definition. */
export interface PromptArgument {
  /** Argument name. */
  name: string;

  /** Human-readable description. */
  description?: string;

  /** Whether the argument must be supplied. */
  required?: boolean;
}

/** A message template within a prompt. */
export interface PromptMessage {
  /** Role (e.g. 'user', 'assistant'). */
  role: 'user' | 'assistant';

  /** Message content — may contain `{{placeholder}}` templates. */
  content: PromptMessageContent;
}

/** Message content block (text template or structured object). */
export interface PromptMessageContent {
  type: 'text';
  text: string;
}

/** Parameters for the `prompts/list` request. */
export interface ListPromptsParams {
  cursor?: string;
}

/** Result of a `prompts/list` request. */
export interface ListPromptsResult {
  prompts: PromptDefinition[];
  nextCursor?: string;
}

/** Parameters for the `prompts/get` request. */
export interface GetPromptParams {
  name: string;
  arguments?: Record<string, string>;
}

/** Result of a `prompts/get` request. */
export interface GetPromptResult {
  messages: PromptMessage[];
  description?: string;
}

// ---------------------------------------------------------------------------
// Completions (Auto-fill)
// ---------------------------------------------------------------------------

/** Parameters for the `completion/complete` request. */
export interface CompleteParams {
  /** Reference type determining what values to suggest. */
  ref: CompletionRef;
  /** The argument being completed. */
  argument: {
    /** Partial string entered by the user. */
    name: string;
    value: string;
  };
}

/** Reference descriptor for a completion context. */
export interface CompletionRef {
  /**
   * Ref type — determines which domain to query for suggestions.
   *
   * Standard MCP ref types: `ref/prompt`, `ref/resource`.
   * Atlisp-specific ref types: `layer`, `block`, `linetype`,
   * `textstyle`, `dimstyle`, `ucs`, `layout`, `group`, `hatch`,
   * `tool`.
   */
  type: string;
}

/** Result of a `completion/complete` request. */
export interface CompletionResult {
  completion: {
    /** Suggested completion strings up to 20 items. */
    values: string[];

    /** Total number of matching values (may exceed `values.length`). */
    total: number;

    /** When `true`, more values are available beyond this page. */
    hasMore: boolean;
  };
}

// ---------------------------------------------------------------------------
// Server Capabilities
// ---------------------------------------------------------------------------

/** Server capability descriptor sent during initialization. */
export interface ServerCapabilities {
  tools?: { listChanged?: boolean };
  resources?: { subscribe?: boolean; listChanged?: boolean };
  prompts?: { listChanged?: boolean };
  logging?: Record<string, never>;
  completions?: Record<string, never>;
}

/** Server info advertised during the MCP handshake. */
export interface ServerInfo {
  name: string;
  version: string;
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

/**
 * Generic paginated response helper.
 *
 * Used for tools/list, resources/list, and prompts/list — each
 * response may include a `nextCursor` for the client to request the
 * next page.
 */
export interface PaginatedResult<TItem> {
  items: TItem[];
  nextCursor?: string;
}
