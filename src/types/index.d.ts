/**
 * @file Re-exports all public type definitions for the
 * @lisp MCP Server.
 *
 * @example
 * ```ts
 * import type { McpConfig, ToolDefinition, CadConnection } from './src/types/index.js';
 * ```
 */

// Configuration
export type {
  McpConfig,
  ApiKeyEntry,
  EnvConfig,
} from './config.js';

// CAD connection layer
export type {
  CadConnection,
  CommandQueue,
  CommandEntry,
  CommandPriority,
  ReadBatcher,
  CadMessageType,
  CadMessageRequest,
  CadMessageResponse,
  CadResult,
  PendingRequestEntry,
  CadInstance,
} from './cad.js';

// Tools
export type {
  ToolDefinition,
  InputSchemaProperty,
  ToolAnnotation,
  ToolHandler,
  ToolCallResult,
  ContentBlock,
  ToolRegisterHandler,
} from './tools.js';

// MCP protocol
export type {
  McpRequest,
  McpSuccessResponse,
  McpErrorResponse,
  McpResponse,
  McpNotification,
  ListToolsParams,
  ListToolsResult,
  CallToolParams,
  ResourceTemplate,
  ListResourcesParams,
  Resource,
  ListResourcesResult,
  ReadResourceParams,
  ResourceContent,
  ReadResourceResult,
  SubscribeParams,
  UnsubscribeParams,
  PromptDefinition,
  PromptArgument,
  PromptMessage,
  PromptMessageContent,
  ListPromptsParams,
  ListPromptsResult,
  GetPromptParams,
  GetPromptResult,
  CompleteParams,
  CompletionRef,
  CompletionResult,
  ServerCapabilities,
  ServerInfo,
  PaginatedResult,
} from './mcp.js';
