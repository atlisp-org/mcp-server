/**
 * @file Type definitions for MCP tool definitions, handlers, and invocation results.
 */

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

/**
 * MCP tool schema definition.
 *
 * Each tool is defined in a `src/tools/*-tools.js` file as a plain
 * object with `name`, `description`, and `inputSchema`.  These are
 * aggregated in `src/tools/index.js` and annotated before being
 * served to MCP clients via `tools/list`.
 */
export interface ToolDefinition {
  /** Unique tool name (snake_case, matches the handler key). */
  name: string;

  /** Human-readable description of what the tool does. */
  description: string;

  /**
   * JSON Schema for the tool's arguments.
   *
   * - `type` is always `'object'`.
   * - `properties` maps argument names to their JSON Schema property
   *   descriptors (type, description, enum, minimum, maximum, etc.).
   * - `required` lists argument names that must be present.
   */
  inputSchema: {
    type: 'object';
    properties: Record<string, InputSchemaProperty>;
    required?: string[];
  };

  /**
   * Annotations added by `src/tools/index.js` after aggregation.
   *
   * Not part of the tool's source definition — injected by
   * `addAnnotations()`.
   */
  annotations?: ToolAnnotation;

  /** When `true`, the tool has been deprecated. */
  deprecated?: boolean;

  /** Optional title override (used for deprecated tools). */
  title?: string;
}

/**
 * A single property within a tool's `inputSchema.properties`.
 *
 * Reflects the validation logic in `validateToolArgs()` in
 * `src/mcp-tools.js`.
 */
export interface InputSchemaProperty {
  /** Expected JSON type. */
  type: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array';

  /** Description of this argument. */
  description: string;

  /** Allowed values (for string/enum arguments). */
  enum?: string[];

  /** Minimum numeric value (inclusive). */
  minimum?: number;

  /** Maximum numeric value (inclusive). */
  maximum?: number;

  /** Maximum string length. */
  maxLength?: number;
}

// ---------------------------------------------------------------------------
// Tool Annotation
// ---------------------------------------------------------------------------

/**
 * Per-tool metadata attached during tool-list construction.
 *
 * Annotations help AI clients decide whether a tool is safe to call
 * without explicit user confirmation.
 */
export interface ToolAnnotation {
  /**
   * When `true`, the tool does not modify the drawing — it only
   * reads data.
   */
  readOnlyHint: boolean;

  /**
   * When `true`, the tool performs a destructive operation (delete,
   * purge, overkill, etc.).
   */
  destructiveHint: boolean;

  /**
   * 工具分类（如 绘图与3D / 图层 / 打印）。由 getToolCategory() 生成。
   */
  category: string;

  /**
   * 行业标签（多标签）。未配置的工具默认 ['通用']。
   * 用于按行业浏览/推荐工具，见 list_tools_by_industry 与
   * atlisp://tools/industries 资源。
   */
  industry: string[];

  /**
   * 优先级分档（静态基准）：core=核心高频 / common=常规 / rare=低频专业。
   * 真实调用次数的动态微调在查询时叠加，不改变此静态值。
   */
  priority: 'core' | 'common' | 'rare';

  /** Explanation for deprecated tools. */
  deprecatedReason?: string;
}

// ---------------------------------------------------------------------------
// Tool Handler
// ---------------------------------------------------------------------------

/**
 * Tool handler function signature.
 *
 * Handlers are auto-discovered from `src/handlers/*-handlers.js` by
 * `handler-loader.js`.  Function names follow camelCase convention
 * derived from the snake_case tool name (with overrides in
 * `FUNCTION_OVERRIDES`).
 *
 * The handler receives the validated arguments object and returns a
 * {@link ToolCallResult} (or a Promise resolving to one).
 */
export type ToolHandler = (args: Record<string, unknown>) => ToolCallResult | Promise<ToolCallResult>;

// ---------------------------------------------------------------------------
// Tool Call Result
// ---------------------------------------------------------------------------

/**
 * Return value of a tool handler invocation.
 *
 * Conforms to the MCP `CallToolResult` shape.  Returned by handlers
 * and delivered to the MCP client as the response to a `tools/call`
 * request.
 */
export interface ToolCallResult {
  /**
   * Array of content blocks.
   *
   * Typically a single `{ type: 'text', text: '...' }` object, or
   * multiple blocks for rich content.
   */
  content: ContentBlock[];

  /**
   * When `true`, the call succeeded but the tool itself reports an
   * error (e.g. handler not found, invalid arguments, CAD failure).
   */
  isError?: boolean;
}

/**
 * A single piece of content returned by a tool.
 *
 * Currently only the `text` type is used; `image` and `resource`
 * types are available per the MCP specification for future use.
 */
export interface ContentBlock {
  type: 'text' | 'image' | 'resource';
  text?: string;
  data?: string;
  mimeType?: string;
  uri?: string;
}

// ---------------------------------------------------------------------------
// Tool Registry (runtime extensibility)
// ---------------------------------------------------------------------------

/**
 * Callback signature for registering a custom tool at runtime.
 *
 * See `src/tool-registry.js` — `registerTool()` adds a
 * `ToolDefinition` + handler pair that behaves identically to
 * built-in tools.
 */
export type ToolRegisterHandler = (args: Record<string, unknown>) => ToolCallResult | Promise<ToolCallResult>;
