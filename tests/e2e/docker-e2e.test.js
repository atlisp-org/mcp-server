import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  checkDockerAvailable,
  checkDockerComposeAvailable,
  buildImage,
  McpContainer
} from './setup.js';

const SKIP_REASON = 'Docker not available or docker compose not found';

describe.sequential('MCP Server Docker E2E Tests', () => {
  let container;

  beforeAll(async () => {
    if (!checkDockerAvailable() || !checkDockerComposeAvailable()) {
      console.warn(`Skipping Docker E2E tests: ${SKIP_REASON}`);
      return;
    }
    buildImage();
    container = new McpContainer();
    await container.start();
  }, 120000);

  afterAll(async () => {
    if (container) {
      await container.close();
    }
  }, 15000);

  // ====================== Initialize ======================

  describe('initialize', () => {
    it('already completed in beforeAll - server started and initialized', () => {
      if (!container) return;
      const stderr = container.getStderrText();
      expect(stderr).toContain('stdio');
    });
  });

  // ====================== Tools ======================

  describe('tools/list', () => {
    it('returns tools array with correct structure', async () => {
      if (!container) return;
      const resp = await container.sendRequest('tools/list', {});
      expect(resp).toHaveProperty('result');
      expect(resp.result).toHaveProperty('tools');
      expect(Array.isArray(resp.result.tools)).toBe(true);
      expect(resp.result.tools.length).toBeGreaterThan(0);
    });

    it('each tool has name and inputSchema', async () => {
      if (!container) return;
      const resp = await container.sendRequest('tools/list', {});
      for (const tool of resp.result.tools.slice(0, 10)) {
        expect(tool).toHaveProperty('name');
        expect(typeof tool.name).toBe('string');
        expect(tool).toHaveProperty('inputSchema');
        expect(tool.inputSchema).toHaveProperty('type', 'object');
      }
    });

    it('includes known tools', async () => {
      if (!container) return;
      const resp = await container.sendRequest('tools/list', {});
      const names = resp.result.tools.map(t => t.name);
      expect(names).toContain('search_tools');
      expect(names).toContain('eval_lisp');
      expect(names).toContain('draw_line');
      expect(names).toContain('sandbox_validate');
      expect(names).toContain('agent_set_context');
    });

    it('supports cursor-based pagination', async () => {
      if (!container) return;
      const page1 = await container.sendRequest('tools/list', {});
      if (page1.result.nextCursor) {
        expect(typeof page1.result.nextCursor).toBe('string');
        const page2 = await container.sendRequest('tools/list', {
          cursor: page1.result.nextCursor
        });
        expect(page2.result).toHaveProperty('tools');
        expect(Array.isArray(page2.result.tools)).toBe(true);
        // Ensure no overlap in page1 and page2 tool names
        const names1 = new Set(page1.result.tools.map(t => t.name));
        const names2 = page2.result.tools.map(t => t.name);
        for (const name of names2) {
          expect(names1.has(name)).toBe(false);
        }
      }
    });
  });

  // ====================== Tools/Call ======================

  describe('tools/call', () => {
    it('calls search_tools successfully', async () => {
      if (!container) return;
      const resp = await container.sendRequest('tools/call', {
        name: 'search_tools',
        arguments: { query: 'line' }
      });
      expect(resp).toHaveProperty('result');
      expect(resp.result).toHaveProperty('content');
      expect(resp.result.content[0]).toHaveProperty('type', 'text');
      expect(resp.result.content[0].text).toContain('draw_line');
    });

    it('calls sandbox_validate successfully', async () => {
      if (!container) return;
      const resp = await container.sendRequest('tools/call', {
        name: 'sandbox_validate',
        arguments: { code: '(+ 1 2)' }
      });
      expect(resp).toHaveProperty('result');
      const text = resp.result.content[0].text;
      const result = JSON.parse(text);
      expect(result).toHaveProperty('safe');
      expect(result).toHaveProperty('issues');
    });

    it('calls sandbox_validate and detects dangerous code', async () => {
      if (!container) return;
      const resp = await container.sendRequest('tools/call', {
        name: 'sandbox_validate',
        arguments: { code: '(startapp "cmd.exe")' }
      });
      expect(resp).toHaveProperty('result');
      const text = resp.result.content[0].text;
      const result = JSON.parse(text);
      expect(result.safe).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
    });

    it('calls agent_set_context and agent_get_context', async () => {
      if (!container) return;
      const setResp = await container.sendRequest('tools/call', {
        name: 'agent_set_context',
        arguments: { key: 'e2e-test-key', value: 'hello-world' }
      });
      expect(setResp.result.content[0].text).toContain('e2e-test-key');

      const getResp = await container.sendRequest('tools/call', {
        name: 'agent_get_context',
        arguments: { key: 'e2e-test-key' }
      });
      expect(getResp.result.content[0].text).toContain('hello-world');
    });

    it('calls get_system_status (no CAD, returns status)', async () => {
      if (!container) return;
      const resp = await container.sendRequest('tools/call', {
        name: 'get_system_status',
        arguments: {}
      });
      expect(resp).toHaveProperty('result');
      const text = resp.result.content[0].text;
      const status = JSON.parse(text);
      expect(status).toHaveProperty('cad');
      expect(status.cad.connected).toBe(false);
      expect(status).toHaveProperty('worker');
    });

    it('calls get_cad_info (no CAD, returns friendly message)', async () => {
      if (!container) return;
      const resp = await container.sendRequest('tools/call', {
        name: 'get_cad_info',
        arguments: {}
      });
      expect(resp).toHaveProperty('result');
      expect(resp.result.content[0].text).toMatch(/未连接|已断开/);
    });
  });

  // ====================== Prompts ======================

  describe('prompts/list', () => {
    it('returns prompts array', async () => {
      if (!container) return;
      const resp = await container.sendRequest('prompts/list', {});
      expect(resp).toHaveProperty('result');
      expect(resp.result).toHaveProperty('prompts');
      expect(Array.isArray(resp.result.prompts)).toBe(true);
      expect(resp.result.prompts.length).toBeGreaterThan(0);
    });

    it('includes known prompts', async () => {
      if (!container) return;
      const resp = await container.sendRequest('prompts/list', {});
      const names = resp.result.prompts.map(p => p.name);
      expect(names).toContain('analyze-drawing');
      expect(names).toContain('manage-layers');
    });
  });

  describe('prompts/get', () => {
    it('returns analyze-drawing prompt', async () => {
      if (!container) return;
      const resp = await container.sendRequest('prompts/get', {
        name: 'analyze-drawing',
        arguments: {}
      });
      expect(resp).toHaveProperty('result');
      expect(resp.result).toHaveProperty('messages');
      expect(resp.result.messages[0]).toHaveProperty('role', 'user');
      expect(resp.result.messages[0].content).toHaveProperty('type', 'text');
    });

    it('errors for unknown prompt', async () => {
      if (!container) return;
      const resp = await container.sendRequest('prompts/get', {
        name: 'nonexistent-prompt-xyz',
        arguments: {}
      });
      expect(resp.result).toHaveProperty('isError', true);
    });
  });

  // ====================== Resources ======================

  describe('resources/list', () => {
    it('returns resources array', async () => {
      if (!container) return;
      const resp = await container.sendRequest('resources/list', {});
      expect(resp).toHaveProperty('result');
      expect(resp.result).toHaveProperty('resources');
      expect(Array.isArray(resp.result.resources)).toBe(true);
    });
  });

  describe('resources/templates/list', () => {
    it('returns resource templates', async () => {
      if (!container) return;
      const resp = await container.sendRequest('resources/templates/list', {});
      expect(resp).toHaveProperty('result');
      expect(resp.result).toHaveProperty('resourceTemplates');
      expect(Array.isArray(resp.result.resourceTemplates)).toBe(true);
    });
  });

  // ====================== Error Handling ======================

  describe('error handling', () => {
    it('returns error for invalid tool name', async () => {
      if (!container) return;
      const resp = await container.sendRequest('tools/call', {
        name: 'nonexistent_tool_xyz',
        arguments: {}
      });
      // MCP SDK returns an error response or the tool handler returns an error
      expect(resp).toHaveProperty('result');
      // The result should be an error - either through result.isError or jsonrpc error
      const isError =
        resp.result?.isError === true ||
        (resp.result?.content?.[0]?.text || '').includes('not found') ||
        (resp.result?.content?.[0]?.text || '').includes('未找到') ||
        resp.error !== undefined;
      expect(isError).toBe(true);
    });

    it('returns error for missing required args', async () => {
      if (!container) return;
      const resp = await container.sendRequest('tools/call', {
        name: 'draw_line',
        arguments: {}
        // missing p1 and p2
      });
      // Should get an error about missing required parameters
      if (resp.result?.isError) {
        expect(resp.result.isError).toBe(true);
      } else {
        // MCP SDK might also reject at validation level
        expect(resp.error || resp.result?.isError).toBeTruthy();
      }
    });

    it('handles invalid JSON-RPC message gracefully', async () => {
      if (!container) return;
      // Write raw invalid JSON to stdin
      const id = 9999;
      const badMsg = 'not-valid-json\n';
      const message = JSON.stringify({
        jsonrpc: '2.0',
        id,
        method: 'invalid/format/test',
        params: {}
      }) + '\n';

      // Send valid request after to confirm server still alive
      container.child.stdin.write(badMsg);
      const resp = await container.sendRequest('tools/list', {});

      expect(resp).toHaveProperty('result');
      expect(resp.result).toHaveProperty('tools');
    });
  });

  // ====================== Completion ======================

  describe('completion/complete', () => {
    it('returns completions for tool ref type', async () => {
      if (!container) return;
      const resp = await container.sendRequest('completion/complete', {
        ref: { type: 'ref/tool' },
        argument: { name: 'toolName', value: 'dr' }
      });
      expect(resp).toHaveProperty('result');
      expect(resp.result).toHaveProperty('completion');
      expect(resp.result.completion).toHaveProperty('values');
      expect(Array.isArray(resp.result.completion.values)).toBe(true);
    });

    it('returns completions for prompt ref type', async () => {
      if (!container) return;
      const resp = await container.sendRequest('completion/complete', {
        ref: { type: 'ref/prompt' },
        argument: { name: 'promptName', value: 'ana' }
      });
      expect(resp).toHaveProperty('result');
      expect(resp.result.completion.values).toBeTruthy();
    });
  });
});
