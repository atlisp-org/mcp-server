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
    this._started = false;
    this._closing = false;
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
        for (const [id, resolver] of this._pendingResolvers) {
          resolver.reject(new Error(`Container exited (${reason}) while waiting for response id=${id}`));
        }
        this._pendingResolvers.clear();
      });

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
            // skip non-JSON startup logs / docker output
          }
        }
      });

      this.child.stderr.on('data', (chunk) => {
        this._stderrLines.push(...chunk.toString().split('\n').filter(Boolean));
      });

      // Wait for server to be ready by sending initialize and awaiting response
      // Give the server a moment to start up first
      setTimeout(async () => {
        try {
          this._started = true;
          const initResp = await this.sendRequest('initialize', {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'e2e-test', version: '1.0.0' }
          });
          if (initResp.error) {
            reject(new Error(`Initialize failed: ${JSON.stringify(initResp.error)}`));
            return;
          }
          await this.sendNotification('notifications/initialized', {});
          resolve();
        } catch (e) {
          reject(e);
        }
      }, 2000);
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
      const timer = setTimeout(() => {
        this._pendingResolvers.delete(id);
        reject(new Error(`Timeout waiting for response to ${method} (id=${id})`));
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
    } catch (e) {
      // ignore write errors for notifications
    }
  }

  getStderrHistory() {
    return [...this._stderrLines];
  }

  getStderrText() {
    return this._stderrLines.join('\n');
  }

  async close() {
    if (this._closing) return;
    this._closing = true;
    if (this.child && this.child.stdin && !this.child.stdin.destroyed) {
      try { this.child.stdin.end(); } catch {}
    }
    return new Promise((resolve) => {
      if (!this.child) { resolve(); return; }
      const timeout = setTimeout(() => {
        if (this.child && !this.child.killed) {
          try { this.child.kill('SIGKILL'); } catch {}
        }
        resolve();
      }, 5000);
      this.child.on('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
      try { this.child.kill('SIGTERM'); } catch {}
    });
  }
}
