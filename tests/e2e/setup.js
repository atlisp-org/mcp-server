import { spawn, execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..', '..');

export function checkDockerAvailable() {
  try {
    execSync('docker info', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function checkDockerComposeAvailable() {
  try {
    execSync('docker compose version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function buildImage(composeFile = 'docker-compose.test.yml') {
  execSync(`docker compose -f ${composeFile} build`, {
    stdio: 'inherit',
    cwd: PROJECT_ROOT
  });
}

export class McpContainer {
  constructor(composeFile = 'docker-compose.test.yml') {
    this.composeFile = composeFile;
    this.child = null;
    this._responseQueue = [];
    this._pendingResolvers = new Map();
    this._nextId = 1;
    this._stdoutBuffer = '';
    this._stderrLines = [];
    this._nonJsonLines = [];
    this._started = false;
    this._closing = false;
    this._exitReason = null;
  }

  async start() {
    return new Promise((resolve, reject) => {
      this.child = spawn('docker', [
        'compose', '-f', this.composeFile,
        'run', '--rm', '-T', 'mcp-server'
      ], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: PROJECT_ROOT
      });

      this.child.on('error', (err) => {
        reject(new Error(`Failed to start container: ${err.message}`));
      });

      this.child.on('exit', (code, signal) => {
        const reason = signal ? `signal ${signal}` : `exit code ${code}`;
        this._exitReason = reason;
        // 容器挂了要立刻把在途请求打回，并带上容器 stderr——
        // 否则只会看到 15s 后的 "Timeout waiting for response"，看不到真正的死因
        for (const [id, resolver] of this._pendingResolvers) {
          clearTimeout(resolver.timer);
          resolver.reject(new Error(
            `Container exited (${reason}) while waiting for response id=${id}\n` +
            `--- container stderr (tail) ---\n${this._stderrTail()}`
          ));
        }
        this._pendingResolvers.clear();
      });

      // 容器提前退出时往 stdin 写数据会触发 'error'（EPIPE / ERR_STREAM_DESTROYED），
      // 没有监听器会直接炸掉测试进程
      this.child.stdin.on('error', () => {});

      this.child.stdout.on('data', (chunk) => {
        this._stdoutBuffer += chunk.toString();
        const lines = this._stdoutBuffer.split('\n');
        this._stdoutBuffer = lines.pop();
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const msg = JSON.parse(trimmed);
            if (msg && typeof msg.jsonrpc === 'string') {
              this._processMessage(msg);
            }
          } catch {
            // 非 JSON 行（docker 自身的输出、被污染的日志）记下来，
            // 供用例断言 stdout 只剩 JSON-RPC
            this._nonJsonLines.push(trimmed);
          }
        }
      });

      this.child.stderr.on('data', (chunk) => {
        this._stderrLines.push(...chunk.toString().split('\n').filter(Boolean));
      });

      // 直接发 initialize：容器 stdin 是管道，服务器起来后会自己读到，
      // 不用猜启动耗时（之前的固定 2s 延迟反而掩盖了「容器已崩」这种情况）
      this._started = true;
      this.sendRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'e2e-test', version: '1.0.0' }
      }).then(async (initResp) => {
        if (initResp.error) {
          reject(new Error(`Initialize failed: ${JSON.stringify(initResp.error)}`));
          return;
        }
        await this.sendNotification('notifications/initialized', {});
        resolve();
      }).catch(reject);
    });
  }

  _processMessage(msg) {
    const id = msg.id;
    if (id !== undefined && id !== null) {
      const resolver = this._pendingResolvers.get(id);
      if (resolver) {
        this._pendingResolvers.delete(id);
        clearTimeout(resolver.timer);
        resolver.resolve(msg);
      } else {
        this._responseQueue.push(msg);
      }
    }
  }

  sendRequest(method, params = {}) {
    const id = this._nextId++;
    const message = JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params
    }) + '\n';

    return new Promise((resolve, reject) => {
      if (this._exitReason) {
        reject(new Error(
          `Container already exited (${this._exitReason}) before sending ${method} (id=${id})\n` +
          `--- container stderr (tail) ---\n${this._stderrTail()}`
        ));
        return;
      }

      const timer = setTimeout(() => {
        this._pendingResolvers.delete(id);
        reject(new Error(
          `Timeout waiting for response to ${method} (id=${id})\n` +
          `--- container stderr (tail) ---\n${this._stderrTail()}`
        ));
      }, 15000);

      this._pendingResolvers.set(id, { resolve, reject, timer });
      try {
        this.child.stdin.write(message);
      } catch (e) {
        clearTimeout(timer);
        this._pendingResolvers.delete(id);
        reject(e);
      }
    });
  }

  sendNotification(method, params = {}) {
    const message = JSON.stringify({
      jsonrpc: '2.0',
      method,
      params
    }) + '\n';
    try {
      this.child.stdin.write(message);
    } catch {
      // ignore write errors for notifications
    }
  }

  getStderrHistory() {
    return [...this._stderrLines];
  }

  getStderrText() {
    return this._stderrLines.join('\n');
  }

  /** stdout 上出现的非 JSON-RPC 行（Docker 输出或日志污染） */
  getNonJsonLines() {
    return [...this._nonJsonLines];
  }

  /** 最近 N 行 stderr，用于失败信息里带出容器真正的死因 */
  _stderrTail(n = 30) {
    const lines = this._stderrLines.filter(Boolean);
    return lines.slice(-n).join('\n') || '(empty)';
  }

  async close() {
    if (this._closing) return;
    this._closing = true;
    if (!this.child) return;
    // 容器已经退出（启动失败等）就不用再等 5s 的 kill 超时
    if (this._exitReason) return;
    if (this.child.stdin && !this.child.stdin.destroyed) {
      try { this.child.stdin.end(); } catch { /* 容器已退出时 end() 可能报错，忽略 */ }
    }
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (this.child && !this.child.killed) {
          try { this.child.kill('SIGKILL'); } catch { /* 进程已消失，忽略 */ }
        }
        resolve();
      }, 5000);
      this.child.on('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
      try { this.child.kill('SIGTERM'); } catch { /* 进程已消失，忽略 */ }
    });
  }
}
