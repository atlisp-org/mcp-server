/**
 * @file Type definitions for CAD connection layer.
 *
 * Covers {@link CadConnection}, the command queue, read batching,
 * circuit breaker, and the message protocol between the Node.js
 * host and `cad-worker.js` subprocesses.
 */

import type { ChildProcess } from 'node:child_process';

// ---------------------------------------------------------------------------
// CadConnection
// ---------------------------------------------------------------------------

/**
 * Manages a single CAD instance via one primary worker subprocess and
 * (optionally) multiple read-only workers.
 *
 * Public API is exposed through the module-level `cad` proxy and the
 * `CadConnectionPool` in `cad-pool.js`.
 */
export declare class CadConnection {
  /** Whether the primary worker is connected to a live CAD session. */
  connected: boolean;

  /** @internal Platform string (e.g. "AutoCAD", "ZWCAD"). Set after connect(). */
  _platform: string | null;

  /** @internal CAD version string. */
  _version: string | null;

  /** @internal Human-readable product name. */
  _product: string | null;

  /** @internal Per-instance command queue. */
  _commandQueue: CommandQueue;

  /** @internal Primary (read-write) worker child process. */
  _primaryWorker: ChildProcess | null;

  /** @internal Pool of read-only worker child processes. */
  _readWorkers: ChildProcess[];

  /** @internal Round-robin index for read-worker dispatching. */
  _readWorkerIndex: number;

  /** @internal Circuit breaker state (CB_CLOSED / CB_OPEN / CB_HALF_OPEN). */
  _cbState: number;

  /** @internal Consecutive failure counter for circuit breaker. */
  _cbFailureCount: number;

  /** @internal Timestamp of last circuit-breaker failure. */
  _cbLastFailureTime: number;

  /** @internal Heartbeat interval timer. */
  _heartbeatTimer: ReturnType<typeof setInterval> | null;

  /** @internal Pending request map (requestId → PendingEntry). */
  _pendingRequests: Map<string, PendingRequestEntry>;

  /** @internal Restart attempt counter for primary worker. */
  _restartCount: number;

  /** @internal Backoff timer for worker restart. */
  _restartTimer: ReturnType<typeof setTimeout> | null;

  /** @internal Whether document-change monitor has been started. */
  _monitorStarted: boolean;

  /** @internal Short connection identifier (first 8 chars of UUID). */
  _connectionId: string;

  /** Connect to a running CAD instance, optionally targeting a specific platform. */
  connect(platform?: string | null): Promise<boolean>;

  /** Send Lisp code for execution (fire-and-forget). */
  sendCommand(code: string): Promise<boolean>;

  /** Send Lisp code and return the evaluated result string. */
  sendCommandWithResult(code: string, encoding?: string | null): Promise<string>;

  /** Check if the current platform (win32) supports CAD connectivity. */
  isAvailable(): boolean;

  /** Check if CAD is currently executing a command. */
  isBusy(): Promise<boolean>;

  /** Check whether CAD has an open document. */
  hasDoc(): Promise<{ hasDoc: boolean; docCount: number }>;

  /** Create a new blank document. */
  newDoc(): Promise<boolean>;

  /** Bring the CAD application window to the foreground. */
  bringToFront(): Promise<boolean>;

  /** Get the active document name and path. */
  getActiveDocInfo(): Promise<{ docName: string; docPath: string; docCount: number }>;

  /** Get a human-readable status string. */
  getInfo(): Promise<string>;

  /** Disconnect and reset all workers. */
  disconnect(): Promise<void>;

  /** Ping the CAD instance; returns true if alive. */
  ping(): Promise<boolean>;

  /** Get the CAD platform string (e.g. "AutoCAD"). */
  getPlatform(): string | null;

  /** Get the CAD version string. */
  getVersion(): string | null;

  /** Get the short connection ID. */
  getConnectionId(): string;

  /** @internal Reset internal state without full teardown. */
  _reset(): void;

  /** @internal Get current command queue depth. */
  _getQueueSize(): number;

  /** @internal Get restart attempt count. */
  _getRestartCount(): number;

  /** @internal Record a successful request (close circuit breaker). */
  _cbSuccess(): void;

  /** @internal Record a failed request (advance circuit breaker). */
  _cbFailure(): void;

  /** @internal Check if a new request is allowed under current breaker state. */
  _cbAllowRequest(): boolean;
}

// ---------------------------------------------------------------------------
// Command Queue
// ---------------------------------------------------------------------------

/** Priority levels for command queue ordering. */
export type CommandPriority = 0 | 1 | 2;

/**
 * Priority-ordered command queue with deduplication and optional
 * read-command batching.
 */
export declare class CommandQueue {
  /** Enqueue a command at the given priority (lowest index = highest priority). */
  enqueue(command: CommandEntry, priority?: CommandPriority): void;

  /** Enqueue directly into the high-priority queue. */
  enqueueHighPriority(command: CommandEntry): void;

  /** Enable read-command batching through a {@link ReadBatcher}. */
  enableBatcher(): void;

  /** Clear all queued commands and reject their promises. */
  clear(): void;

  /** Get the total number of queued commands. */
  size(): number;
}

/** Internal entry placed on the command queue. */
export interface CommandEntry {
  /** Message type for the worker protocol. */
  type: CadMessageType;

  /** Lisp code to execute (only for 'send' / 'sendResult'). */
  code?: string;

  /** Target CAD platform string. */
  platform?: string | null;

  /** Output encoding hint (only for 'sendResult'). */
  encoding?: string;

  /** Resolve callback — delivers the {@link CadResult}. */
  resolve: (value: CadResult) => void;

  /** Reject callback — delivers an Error. */
  reject: (err: Error) => void;
}

// ---------------------------------------------------------------------------
// Read Batcher
// ---------------------------------------------------------------------------

/**
 * Coalesces read-only Lisp commands within a short time window
 * (default 50 ms, max 10 commands) into a single `sendResult`
 * message to reduce IPC overhead.
 */
export declare class ReadBatcher {
  /**
   * Try to add a read command to the current batch.
   * Returns `true` if the command was batched (and should not be
   * placed on the regular queue).
   */
  add(command: CommandEntry, dedupKey?: string | null): boolean;
}

// ---------------------------------------------------------------------------
// Worker Message Protocol
// ---------------------------------------------------------------------------

/** All message types exchanged between the host and `cad-worker.js`. */
export type CadMessageType =
  | 'connect'
  | 'send'
  | 'sendResult'
  | 'ping'
  | 'isBusy'
  | 'hasdoc'
  | 'newdoc'
  | 'bringToFront'
  | 'getActiveDocInfo'
  | 'startMonitor'
  | 'event';

/** Message sent to the CAD worker subprocess. */
export interface CadMessageRequest {
  type: CadMessageType;
  requestId: string;
  code?: string;
  platform?: string | null;
  encoding?: string;
}

/** Response received from the CAD worker subprocess. */
export interface CadMessageResponse {
  requestId: string;
  success?: boolean;
  error?: string;
  result?: string;
  pong?: boolean;
  isBusy?: boolean;
  hasDoc?: boolean;
  docCount?: number;
  docName?: string;
  docPath?: string;
  platform?: string;
  version?: string;
  type?: string;
  eventType?: string;
}

/** Shape delivered to enqueued command `resolve` callbacks. */
export interface CadResult {
  success: boolean;
  error?: string;
  result?: string;
  pong?: boolean;
  isBusy?: boolean;
  hasDoc?: boolean;
  docCount?: number;
  docName?: string;
  docPath?: string;
  platform?: string;
  version?: string;
}

/** Internal entry stored in the pending-requests map. */
export interface PendingRequestEntry {
  resolve: (value: CadResult) => void;
  reject: (err: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
  /** If true, circuit-breaker updates are suppressed for this entry. */
  _skipCb?: boolean;
}

/** CAD instance entry stored in the connection pool. */
export interface CadInstance {
  key: string;
  connection: CadConnection;
  platform: string | null;
  version: string | null;
  connected: boolean;
  lastPing: number;
  createdAt: number;
  label: string;
  autoReconnect: boolean;
}
