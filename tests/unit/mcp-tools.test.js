import { describe, expect, it, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  getStore: vi.fn(() => null),
  tools: [
    { name: 'eval_lisp', description: 'Execute LISP', inputSchema: { type: 'object' } },
    { name: 'eval_lisp_with_result', description: 'Execute LISP with result', inputSchema: { type: 'object' } },
  ],
  handleToolCall: vi.fn(),
  cad: { connected: false },
  pool: {
    onInstanceSwitch: vi.fn(),
    setActive: vi.fn(() => false),
    connect: vi.fn(async () => false),
    disconnect: vi.fn(async () => false),
    discover: vi.fn(async () => []),
    healthCheck: vi.fn(async () => []),
    getStats: vi.fn(() => ({ total: 0 })),
    listInstances: vi.fn(() => []),
    getConnection: vi.fn(() => null),
  },
  cadPlatforms: ['AutoCAD', 'ZWCAD', 'GStarCAD', 'BricsCAD'],
  cadResourceUris: [
    'mcp://resource/tables/layers',
    'mcp://resource/tables/textstyles',
    'mcp://resource/tables/linetypes',
    'mcp://resource/tables/blocks',
    'mcp://resource/tables/dimstyles',
    'mcp://resource/tables/appids',
    'mcp://resource/tables/acads',
    'mcp://resource/tables/vports',
    'mcp://resource/tables/userr',
  ],
  getHandler: vi.fn(async () => null),
  getHandlerModule: vi.fn(async () => null),
  loadAtlibFunctionLib: vi.fn(async () => null),
  clearCache: vi.fn(),
  notify: vi.fn(),
  isSubscribed: vi.fn(() => false),
  registerWatch: vi.fn(() => ({ id: 'w1' })),
  removeWatch: vi.fn(() => true),
  listWatches: vi.fn(() => []),
  waitForWatch: vi.fn(async () => ({ matched: true })),
  createAndWait: vi.fn(async () => ({ matched: true })),
  executeInSession: vi.fn(async () => ({ value: null })),
  getHistory: vi.fn(() => []),
  listSessions: vi.fn(() => []),
  closeSession: vi.fn(() => true),
  streamEntitiesByType: vi.fn(async () => ({ total: 0 })),
  streamTextContent: vi.fn(async () => ({ total: 0 })),
  streamBlockRefs: vi.fn(async () => ({ total: 0 })),
  registerWebhook: vi.fn(() => ({ id: 'wh1' })),
  removeWebhook: vi.fn(() => true),
  listWebhooks: vi.fn(() => []),
  getWebhookLog: vi.fn(() => []),
  analyzeLispCode: vi.fn(() => ({ diagnostics: [] })),
  formatCode: vi.fn(() => ''),
  lintProject: vi.fn(async () => ({ files: [] })),
  RULES: [],
  validateLispCode: vi.fn(() => ({ ok: true, threats: [] })),
  addToAllowlist: vi.fn(() => 0),
  clearSessionAllowlist: vi.fn(),
  queryAuditLog: vi.fn(() => ({ entries: [] })),
  getAuditStats: vi.fn(() => ({ total: 0 })),
  setContext: vi.fn(),
  getContext: vi.fn(() => null),
  listContext: vi.fn(() => []),
  deleteContext: vi.fn(),
  clearContext: vi.fn(),
  searchTools: vi.fn(),
  listToolsByCategory: vi.fn(),
  listToolsByIndustry: vi.fn(),
  listToolsByPriority: vi.fn(),
  getToolInfo: vi.fn(),
  listPromptsHandler: vi.fn(),
  getPromptHandler: vi.fn(),
  skillSearch: vi.fn(),
  skillInstall: vi.fn(),
  skillListInstalled: vi.fn(),
  skillUninstall: vi.fn(),
  skillListCategories: vi.fn(),
}));

vi.mock('../../src/handler-loader.js', () => ({
  getHandler: m.getHandler,
  getHandlerModule: m.getHandlerModule,
}));

vi.mock('../../src/streaming.js', () => ({
  streamEntitiesByType: m.streamEntitiesByType,
  streamTextContent: m.streamTextContent,
  streamBlockRefs: m.streamBlockRefs,
}));

vi.mock('../../src/constants.js', () => ({
  CAD_PLATFORMS: m.cadPlatforms,
  CAD_RESOURCE_URIS: m.cadResourceUris,
  SERVER_VERSION: 'test',
  BUILD_META: null,
}));

vi.mock('../../src/cad.js', () => ({
  cad: m.cad,
}));

vi.mock('../../src/cad-pool.js', () => ({
  pool: m.pool,
}));

vi.mock('../../src/tools/index.js', () => ({
  tools: m.tools,
}));

vi.mock('../../src/mcp-server-state.js', () => ({
  mcpContext: { getStore: m.getStore, run: (ctx, fn) => fn() },
}));

vi.mock('../../src/trigger-engine.js', () => ({
  registerWatch: m.registerWatch,
  removeWatch: m.removeWatch,
  listWatches: m.listWatches,
  waitForWatch: m.waitForWatch,
  createAndWait: m.createAndWait,
}));

vi.mock('../../src/lisp-security.js', () => ({
  validateLispCode: m.validateLispCode,
  addToAllowlist: m.addToAllowlist,
  clearSessionAllowlist: m.clearSessionAllowlist,
}));

vi.mock('../../src/lint-analyzer.js', () => ({
  analyzeLispCode: m.analyzeLispCode,
}));

vi.mock('@atlisp/lint/dist/formatter.js', () => ({
  formatCode: m.formatCode,
}));

vi.mock('@atlisp/lint/dist/project.js', () => ({
  lintProject: m.lintProject,
}));

vi.mock('@atlisp/lint/dist/rules.js', () => ({
  RULES: m.RULES,
}));

vi.mock('../../src/repl-engine.js', () => ({
  executeInSession: m.executeInSession,
  getHistory: m.getHistory,
  listSessions: m.listSessions,
  closeSession: m.closeSession,
}));

vi.mock('../../src/webhook-engine.js', () => ({
  registerWebhook: m.registerWebhook,
  removeWebhook: m.removeWebhook,
  listWebhooks: m.listWebhooks,
  getWebhookLog: m.getWebhookLog,
}));

vi.mock('../../src/audit-log.js', () => ({
  queryAuditLog: m.queryAuditLog,
  getAuditStats: m.getAuditStats,
}));

vi.mock('../../src/agent-context.js', () => ({
  setContext: m.setContext,
  getContext: m.getContext,
  listContext: m.listContext,
  deleteContext: m.deleteContext,
  clearContext: m.clearContext,
}));

vi.mock('../../src/handlers/resource-handlers.js', () => ({
  clearCache: m.clearCache,
}));

vi.mock('../../src/subscription-manager.js', () => ({
  isSubscribed: m.isSubscribed,
  notify: m.notify,
}));

vi.mock('../../src/handlers/skill-handlers.js', () => ({
  skill_search: m.skillSearch,
  skill_install: m.skillInstall,
  skill_list_installed: m.skillListInstalled,
  skill_uninstall: m.skillUninstall,
  skill_list_categories: m.skillListCategories,
}));

vi.mock('../../src/handlers/meta-handlers.js', () => ({
  search_tools: m.searchTools,
  list_tools_by_category: m.listToolsByCategory,
  list_tools_by_industry: m.listToolsByIndustry,
  list_tools_by_priority: m.listToolsByPriority,
  get_tool_info: m.getToolInfo,
  list_prompts_handler: m.listPromptsHandler,
  get_prompt_handler: m.getPromptHandler,
}));

vi.mock('../../src/tool-executor.js', () => ({
  handleToolCall: m.handleToolCall,
}));

import { TOOL_HANDLERS, tools, handleToolCall } from '../../src/mcp-tools.js';

const instanceSwitchCallback = m.pool.onInstanceSwitch.mock.calls[0][0];

beforeEach(() => {
  vi.resetAllMocks();
  m.cad.connected = false;
  m.RULES.length = 0;
  m.RULES.push(
    { name: 'parens', severity: 'error', description: 'Balanced', fix: true },
    { name: 'other' },
  );
  m.getStore.mockReturnValue(null);
  m.handleToolCall.mockResolvedValue({ ok: true });
  m.getHandler.mockResolvedValue(null);
  m.getHandlerModule.mockResolvedValue(null);
  m.loadAtlibFunctionLib.mockResolvedValue(null);
  m.isSubscribed.mockReturnValue(false);
  m.pool.setActive.mockReturnValue(false);
  m.pool.connect.mockResolvedValue(false);
  m.pool.disconnect.mockResolvedValue(false);
  m.pool.discover.mockResolvedValue([]);
  m.pool.healthCheck.mockResolvedValue([]);
  m.pool.getStats.mockReturnValue({ total: 0 });
  m.pool.listInstances.mockReturnValue([]);
  m.pool.getConnection.mockReturnValue(null);
  m.registerWatch.mockReturnValue({ id: 'w1' });
  m.removeWatch.mockReturnValue(true);
  m.listWatches.mockReturnValue([]);
  m.waitForWatch.mockResolvedValue({ matched: true });
  m.createAndWait.mockResolvedValue({ matched: true });
  m.executeInSession.mockResolvedValue({ value: null });
  m.getHistory.mockReturnValue([]);
  m.listSessions.mockReturnValue([]);
  m.closeSession.mockReturnValue(true);
  m.streamEntitiesByType.mockResolvedValue({ total: 0 });
  m.streamTextContent.mockResolvedValue({ total: 0 });
  m.streamBlockRefs.mockResolvedValue({ total: 0 });
  m.registerWebhook.mockReturnValue({ id: 'wh1' });
  m.removeWebhook.mockReturnValue(true);
  m.listWebhooks.mockReturnValue([]);
  m.getWebhookLog.mockReturnValue([]);
  m.analyzeLispCode.mockReturnValue({ diagnostics: [] });
  m.formatCode.mockReturnValue('');
  m.lintProject.mockResolvedValue({ files: [] });
  m.validateLispCode.mockReturnValue({ ok: true, threats: [] });
  m.addToAllowlist.mockReturnValue(0);
  m.queryAuditLog.mockReturnValue({ entries: [] });
  m.getAuditStats.mockReturnValue({ total: 0 });
  m.getContext.mockReturnValue(null);
  m.listContext.mockReturnValue([]);
});

describe('mcp-tools exports', () => {
  it('exports a tools array with tool definitions', () => {
    expect(Array.isArray(tools)).toBe(true);
    expect(tools[0].name).toBe('eval_lisp');
    expect(tools[0].inputSchema).toBeDefined();
  });

  it('re-exports handleToolCall from tool-executor', async () => {
    expect(typeof handleToolCall).toBe('function');
    await expect(handleToolCall('eval_lisp', {})).resolves.toEqual({ ok: true });
  });

  it('exposes expected TOOL_HANDLERS', () => {
    const expected = [
      'get_platform_info', 'open_cad', 'connect_cad', 'eval_lisp',
      'eval_lisp_with_result', 'at_command', 'import_funlib',
      'list_prompts', 'get_prompt',
      'search_tools', 'list_tools_by_category', 'list_tools_by_industry',
      'list_tools_by_priority', 'get_tool_info',
      'skill_search', 'skill_install', 'skill_list_installed',
      'skill_uninstall', 'skill_list_categories',
      'batch_concurrent_tasks',
      'watch_register', 'watch_remove', 'watch_list', 'watch_wait', 'watch_create_and_wait',
      'lisp_repl', 'lisp_repl_history', 'lisp_repl_list', 'lisp_repl_close',
      'stream_entities', 'stream_text', 'stream_block_refs',
      'webhook_register', 'webhook_list', 'webhook_remove', 'webhook_log',
      'analyze_lisp_code', 'format_lisp_code', 'list_lint_rules', 'lint_project',
      'sandbox_validate', 'sandbox_allowlist_add', 'sandbox_allowlist_clear',
      'audit_log_query', 'audit_log_stats',
      'cad_pool_connect', 'cad_pool_disconnect', 'cad_pool_discover',
      'cad_pool_health', 'cad_pool_stats', 'cad_pool_switch', 'cad_pool_list',
      'session_pin_instance', 'session_unpin_instance',
      'agent_set_context', 'agent_get_context', 'agent_list_context',
      'agent_delete_context', 'agent_clear_context',
    ];
    for (const key of expected) {
      expect(typeof TOOL_HANDLERS[key]).toBe('function');
    }
  });
});

describe('get_platform_info', () => {
  it('reports disconnected platform list', () => {
    const result = TOOL_HANDLERS.get_platform_info();
    expect(result.content[0].text).toBe('支持的 CAD 平台:\nAutoCAD\nZWCAD\nGStarCAD\nBricsCAD\n当前连接: 未连接');
  });

  it('reports connected state', () => {
    m.cad.connected = true;
    const result = TOOL_HANDLERS.get_platform_info();
    expect(result.content[0].text).toContain('当前连接: 已连接');
  });
});

describe('lazy handlers', () => {
  it('maps open_cad platform', async () => {
    const fake = vi.fn(async () => 'ok');
    m.getHandler.mockResolvedValue(fake);
    await TOOL_HANDLERS.open_cad({ platform: 'ZWCAD' });
    expect(m.getHandler).toHaveBeenCalledWith('open_cad');
    expect(fake).toHaveBeenCalledWith('ZWCAD');
  });

  it('maps connect_cad platform', async () => {
    const fake = vi.fn(async () => 'ok');
    m.getHandler.mockResolvedValue(fake);
    await TOOL_HANDLERS.connect_cad({ platform: 'AutoCAD', pid: 123, label: 'L', makeActive: false });
    expect(fake).toHaveBeenCalledWith('AutoCAD');
  });

  it('maps eval_lisp code', async () => {
    const fake = vi.fn(async () => 'ok');
    m.getHandler.mockResolvedValue(fake);
    await TOOL_HANDLERS.eval_lisp({ code: '(princ 1)' });
    expect(fake).toHaveBeenCalledWith('(princ 1)');
  });

  it('maps eval_lisp_with_result code and encoding', async () => {
    const fake = vi.fn(async () => 'ok');
    m.getHandler.mockResolvedValue(fake);
    await TOOL_HANDLERS.eval_lisp_with_result({ code: '(princ 1)', encoding: 'utf-8' });
    expect(fake).toHaveBeenCalledWith('(princ 1)', true, 'utf-8');
  });

  it('maps at_command command', async () => {
    const fake = vi.fn(async () => 'ok');
    m.getHandler.mockResolvedValue(fake);
    await TOOL_HANDLERS.at_command({ command: 'LINE' });
    expect(fake).toHaveBeenCalledWith('LINE');
  });

  it('maps get_system_variable name', async () => {
    const fake = vi.fn(async () => 'ok');
    m.getHandler.mockResolvedValue(fake);
    await TOOL_HANDLERS.get_system_variable({ name: 'TDCREATE' });
    expect(fake).toHaveBeenCalledWith('TDCREATE');
  });

  it('maps set_system_variable name and value', async () => {
    const fake = vi.fn(async () => 'ok');
    m.getHandler.mockResolvedValue(fake);
    await TOOL_HANDLERS.set_system_variable({ name: 'INSBASE', value: [0, 0] });
    expect(fake).toHaveBeenCalledWith('INSBASE', [0, 0]);
  });

  it('passes get_cad_info args object through', async () => {
    const fake = vi.fn(async () => 'ok');
    m.getHandler.mockResolvedValue(fake);
    await TOOL_HANDLERS.get_cad_info({});
    expect(m.getHandler).toHaveBeenCalledWith('get_cad_info');
    expect(fake).toHaveBeenCalledWith({});
  });

  it('maps get_bounding_box handle', async () => {
    const fake = vi.fn(async () => 'ok');
    m.getHandler.mockResolvedValue(fake);
    await TOOL_HANDLERS.get_bounding_box({ handle: 'e1' });
    expect(fake).toHaveBeenCalledWith('e1');
  });

  it('maps list_symbols package', async () => {
    const fake = vi.fn(async () => 'ok');
    m.getHandler.mockResolvedValue(fake);
    await TOOL_HANDLERS.list_symbols({ package: 'cad' });
    expect(fake).toHaveBeenCalledWith('cad');
  });

  it('maps search_packages query', async () => {
    const fake = vi.fn(async () => 'ok');
    m.getHandler.mockResolvedValue(fake);
    await TOOL_HANDLERS.search_packages({ query: 'plot' });
    expect(fake).toHaveBeenCalledWith('plot');
  });

  it('maps install_package packageName', async () => {
    const fake = vi.fn(async () => 'ok');
    m.getHandler.mockResolvedValue(fake);
    await TOOL_HANDLERS.install_package({ packageName: 'foo' });
    expect(fake).toHaveBeenCalledWith('foo');
  });

  it('returns error when handler is missing', async () => {
    const result = await TOOL_HANDLERS.open_cad({ platform: 'AutoCAD' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Handler not found: open_cad');
  });
});

describe('import_funlib', () => {
  it('rejects when the function handler module is missing', async () => {
    m.getHandlerModule.mockResolvedValue(null);
    await expect(TOOL_HANDLERS.import_funlib({})).rejects.toThrow(TypeError);
  });

  it('returns an error when loadAtlibFunctionLib returns no data', async () => {
    m.getHandlerModule.mockResolvedValue({ loadAtlibFunctionLib: m.loadAtlibFunctionLib });
    m.loadAtlibFunctionLib.mockResolvedValue(null);
    const result = await TOOL_HANDLERS.import_funlib({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('加载函数库失败');
  });

  it('returns JSON data by default', async () => {
    const data = { all_functions: { A: { name: 'A', description: 'Draw' } } };
    m.getHandlerModule.mockResolvedValue({ loadAtlibFunctionLib: m.loadAtlibFunctionLib });
    m.loadAtlibFunctionLib.mockResolvedValue(data);
    const result = await TOOL_HANDLERS.import_funlib({});
    expect(JSON.parse(result.content[0].text)).toEqual(data);
  });

  it('returns a simple list when format is list', async () => {
    const data = { all_functions: { A: { name: 'A', description: 'Draw' } } };
    m.getHandlerModule.mockResolvedValue({ loadAtlibFunctionLib: m.loadAtlibFunctionLib });
    m.loadAtlibFunctionLib.mockResolvedValue(data);
    const result = await TOOL_HANDLERS.import_funlib({ format: 'list' });
    expect(result.content[0].text).toBe('A: Draw');
  });

  it('list 格式带参数列表（调用方据此对齐 arity）', async () => {
    const data = {
      all_functions: {
        'entity:make-text': { name: 'entity:make-text', params: ['str', 'pt1', 'fontsize', 'ang', 'kgb', 'qx', 'dqys'], description: '生成TEXT' },
      },
    };
    m.getHandlerModule.mockResolvedValue({ loadAtlibFunctionLib: m.loadAtlibFunctionLib });
    m.loadAtlibFunctionLib.mockResolvedValue(data);
    const result = await TOOL_HANDLERS.import_funlib({ format: 'list' });
    expect(result.content[0].text).toBe('entity:make-text(str pt1 fontsize ang kgb qx dqys): 生成TEXT');
  });
});

describe('meta/skill passthrough handlers', () => {
  it('passes arguments through to meta and skill handlers', async () => {
    const expected = { ok: true };
    m.searchTools.mockResolvedValue(expected);
    m.listToolsByCategory.mockResolvedValue(expected);
    m.listToolsByIndustry.mockResolvedValue(expected);
    m.listToolsByPriority.mockResolvedValue(expected);
    m.getToolInfo.mockResolvedValue(expected);
    m.listPromptsHandler.mockResolvedValue(expected);
    m.getPromptHandler.mockResolvedValue(expected);
    m.skillSearch.mockResolvedValue(expected);
    m.skillInstall.mockResolvedValue(expected);
    m.skillListInstalled.mockResolvedValue(expected);
    m.skillUninstall.mockResolvedValue(expected);
    m.skillListCategories.mockResolvedValue(expected);

    const args = { q: 1 };
    expect(await TOOL_HANDLERS.search_tools(args)).toBe(expected);
    expect(await TOOL_HANDLERS.list_tools_by_category(args)).toBe(expected);
    expect(await TOOL_HANDLERS.list_tools_by_industry(args)).toBe(expected);
    expect(await TOOL_HANDLERS.list_tools_by_priority(args)).toBe(expected);
    expect(await TOOL_HANDLERS.get_tool_info(args)).toBe(expected);
    expect(await TOOL_HANDLERS.list_prompts(args)).toBe(expected);
    expect(await TOOL_HANDLERS.get_prompt(args)).toBe(expected);
    expect(await TOOL_HANDLERS.skill_search(args)).toBe(expected);
    expect(await TOOL_HANDLERS.skill_install(args)).toBe(expected);
    expect(await TOOL_HANDLERS.skill_list_installed(args)).toBe(expected);
    expect(await TOOL_HANDLERS.skill_uninstall(args)).toBe(expected);
    expect(await TOOL_HANDLERS.skill_list_categories(args)).toBe(expected);

    expect(m.searchTools).toHaveBeenCalledWith(args);
    expect(m.listToolsByCategory).toHaveBeenCalledWith(args);
    expect(m.listToolsByIndustry).toHaveBeenCalledWith(args);
    expect(m.listToolsByPriority).toHaveBeenCalledWith(args);
    expect(m.getToolInfo).toHaveBeenCalledWith(args);
    expect(m.listPromptsHandler).toHaveBeenCalledWith(args);
    expect(m.getPromptHandler).toHaveBeenCalledWith(args);
    expect(m.skillSearch).toHaveBeenCalledWith(args);
    expect(m.skillInstall).toHaveBeenCalledWith(args);
    expect(m.skillListInstalled).toHaveBeenCalledWith(args);
    expect(m.skillUninstall).toHaveBeenCalledWith(args);
    expect(m.skillListCategories).toHaveBeenCalledWith(args);
  });
});

describe('batch_concurrent_tasks', () => {
  it('requires a tasks array', async () => {
    for (const args of [{}, { tasks: [] }]) {
      const result = await TOOL_HANDLERS.batch_concurrent_tasks(args);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe('需要 tasks 数组');
    }
  });

  it('rejects more than 50 tasks', async () => {
    const tasks = Array.from({ length: 51 }, (_, i) => ({ tool: 'tool_' + i, args: {} }));
    const result = await TOOL_HANDLERS.batch_concurrent_tasks({ tasks });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('最多支持 50 个并发任务');
  });

  it('executes known tools via the executor and returns their results', async () => {
    m.getStore.mockReturnValue({});
    m.handleToolCall.mockResolvedValue({ content: [{ type: 'text', text: '[]' }] });
    const result = await TOOL_HANDLERS.batch_concurrent_tasks({ tasks: [{ tool: 'watch_list', args: {} }] });
    const output = JSON.parse(result.content[0].text);
    expect(output).toEqual([{ index: 0, tool: 'watch_list', ok: true, data: '[]' }]);
  });

  it('forwards executor error responses', async () => {
    m.getStore.mockReturnValue({});
    m.handleToolCall.mockResolvedValue({ content: [{ type: 'text', text: '未知工具' }], isError: true });
    const result = await TOOL_HANDLERS.batch_concurrent_tasks({ tasks: [{ tool: 'does_not_exist', args: {} }] });
    const output = JSON.parse(result.content[0].text);
    expect(output).toEqual([{ index: 0, tool: 'does_not_exist', ok: false, data: '未知工具' }]);
  });

  it('passes instance through to the executor without mutating the shared context', async () => {
    const ctx = { _toolInstance: 'prev' };
    m.getStore.mockReturnValue(ctx);
    m.handleToolCall.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });
    await TOOL_HANDLERS.batch_concurrent_tasks({
      tasks: [{ tool: 'watch_list', args: {}, instance: 'other' }],
    });
    expect(ctx._toolInstance).toBe('prev');
    expect(m.handleToolCall).toHaveBeenCalledWith('watch_list', { instance: 'other' }, { sessionId: undefined });
  });

  it('catches handler errors', async () => {
    m.getStore.mockReturnValue({});
    m.handleToolCall.mockRejectedValue(new Error('boom'));
    const result = await TOOL_HANDLERS.batch_concurrent_tasks({
      tasks: [{ tool: 'open_cad', args: { platform: 'AutoCAD' }, instance: 'i1' }],
    });
    const output = JSON.parse(result.content[0].text);
    expect(output).toEqual([{ index: 0, tool: 'open_cad', instance: 'i1', ok: false, error: 'boom' }]);
  });
});

describe('watch tools', () => {
  it('registers watches', async () => {
    const result = await TOOL_HANDLERS.watch_register({ pattern: 'p' });
    expect(m.registerWatch).toHaveBeenCalledWith({ pattern: 'p' });
    expect(JSON.parse(result.content[0].text)).toEqual({ id: 'w1' });
  });

  it('catches registration errors', async () => {
    m.registerWatch.mockImplementation(() => { throw new Error('bad'); });
    const result = await TOOL_HANDLERS.watch_register({ pattern: 'p' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('bad');
  });

  it('removes watches', async () => {
    const removed = await TOOL_HANDLERS.watch_remove({ id: 'w1' });
    expect(m.removeWatch).toHaveBeenCalledWith('w1');
    expect(removed.content[0].text).toBe('触发器 w1 已移除');
    m.removeWatch.mockReturnValue(false);
    const missing = await TOOL_HANDLERS.watch_remove({ id: 'w1' });
    expect(missing.content[0].text).toBe('触发器 w1 未找到');
  });

  it('lists watches', async () => {
    m.listWatches.mockReturnValue([{ id: 'w1' }]);
    const result = await TOOL_HANDLERS.watch_list({});
    expect(JSON.parse(result.content[0].text)).toEqual([{ id: 'w1' }]);
  });

  it('waits with default and explicit timeout', async () => {
    await TOOL_HANDLERS.watch_wait({ id: 'w1' });
    expect(m.waitForWatch).toHaveBeenCalledWith('w1', 30000);
    await TOOL_HANDLERS.watch_wait({ id: 'w1', timeout: 1234 });
    expect(m.waitForWatch).toHaveBeenCalledWith('w1', 1234);
  });

  it('catches wait errors', async () => {
    m.waitForWatch.mockRejectedValue(new Error('timed out'));
    const result = await TOOL_HANDLERS.watch_wait({ id: 'w1' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('timed out');
  });

  it('creates and waits with default and explicit timeout', async () => {
    const def = await TOOL_HANDLERS.watch_create_and_wait({ pattern: 'p' });
    expect(m.createAndWait).toHaveBeenCalledWith({ pattern: 'p' }, 30000);
    expect(JSON.parse(def.content[0].text)).toEqual({ matched: true });
    await TOOL_HANDLERS.watch_create_and_wait({ pattern: 'p', timeout: 4321 });
    expect(m.createAndWait).toHaveBeenCalledWith({ pattern: 'p', timeout: 4321 }, 4321);
    m.createAndWait.mockRejectedValue(new Error('create failed'));
    const bad = await TOOL_HANDLERS.watch_create_and_wait({ pattern: 'p' });
    expect(bad.isError).toBe(true);
    expect(bad.content[0].text).toBe('create failed');
  });
});

describe('repl tools', () => {
  it('executes code in a session', async () => {
    m.executeInSession.mockResolvedValue({ value: 1 });
    const result = await TOOL_HANDLERS.lisp_repl({ sessionId: 's1', code: '(princ 1)' });
    expect(m.executeInSession).toHaveBeenCalledWith('s1', '(princ 1)');
    expect(JSON.parse(result.content[0].text)).toEqual({ value: 1 });
  });

  it('returns session history when the session exists', async () => {
    m.getHistory.mockReturnValue([{ code: '(princ 1)' }]);
    const result = await TOOL_HANDLERS.lisp_repl_history({ sessionId: 's1' });
    expect(m.getHistory).toHaveBeenCalledWith('s1');
    expect(JSON.parse(result.content[0].text)).toEqual([{ code: '(princ 1)' }]);
  });

  it('reports missing sessions for history', async () => {
    m.getHistory.mockReturnValue(null);
    const result = await TOOL_HANDLERS.lisp_repl_history({ sessionId: 'missing' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(JSON.stringify({ error: 'Session not found' }));
  });

  it('lists sessions', async () => {
    m.listSessions.mockReturnValue([{ id: 's1' }]);
    const result = await TOOL_HANDLERS.lisp_repl_list({});
    expect(JSON.parse(result.content[0].text)).toEqual([{ id: 's1' }]);
  });

  it('closes sessions', async () => {
    const result = await TOOL_HANDLERS.lisp_repl_close({ sessionId: 's1' });
    expect(m.closeSession).toHaveBeenCalledWith('s1');
    expect(result.content[0].text).toBe(JSON.stringify({ success: true }));
  });
});

describe('streaming tools', () => {
  it('streams entities by type', async () => {
    const result = await TOOL_HANDLERS.stream_entities({ type: 'LINE', layer: '0', chunk: 100, offset: 50 });
    expect(m.streamEntitiesByType).toHaveBeenCalledWith({ type: 'LINE', layer: '0', chunk: 100, offset: 50 });
    expect(JSON.parse(result.content[0].text)).toEqual({ total: 0 });
  });

  it('streams text content', async () => {
    const result = await TOOL_HANDLERS.stream_text({ layer: '0', limit: 100, offset: 50 });
    expect(m.streamTextContent).toHaveBeenCalledWith({ layer: '0', offset: 50, limit: 100 });
    expect(JSON.parse(result.content[0].text)).toEqual({ total: 0 });
  });

  it('streams block references', async () => {
    const result = await TOOL_HANDLERS.stream_block_refs({ blockName: 'BLOCK', limit: 100, offset: 50 });
    expect(m.streamBlockRefs).toHaveBeenCalledWith({ blockName: 'BLOCK', offset: 50, limit: 100 });
    expect(JSON.parse(result.content[0].text)).toEqual({ total: 0 });
  });
});

describe('webhook tools', () => {
  it('registers webhooks', async () => {
    const result = await TOOL_HANDLERS.webhook_register({ url: 'http://example.com', event: 'changed' });
    expect(m.registerWebhook).toHaveBeenCalledWith({ url: 'http://example.com', event: 'changed' });
    expect(JSON.parse(result.content[0].text)).toEqual({ id: 'wh1' });
  });

  it('catches webhook registration errors', async () => {
    m.registerWebhook.mockImplementation(() => { throw new Error('bad url'); });
    const result = await TOOL_HANDLERS.webhook_register({ url: 'bad' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('bad url');
  });

  it('lists webhooks', async () => {
    m.listWebhooks.mockReturnValue([{ id: 'wh1' }]);
    const result = await TOOL_HANDLERS.webhook_list({});
    expect(JSON.parse(result.content[0].text)).toEqual([{ id: 'wh1' }]);
  });

  it('removes webhooks', async () => {
    const removed = await TOOL_HANDLERS.webhook_remove({ id: 'wh1' });
    expect(m.removeWebhook).toHaveBeenCalledWith('wh1');
    expect(removed.content[0].text).toBe('Webhook wh1 已移除');
    m.removeWebhook.mockReturnValue(false);
    const missing = await TOOL_HANDLERS.webhook_remove({ id: 'wh1' });
    expect(missing.content[0].text).toBe('Webhook wh1 未找到');
  });

  it('lists webhook logs', async () => {
    m.getWebhookLog.mockReturnValue([{ id: 'wh1', ok: true }]);
    const result = await TOOL_HANDLERS.webhook_log({ id: 'wh1' });
    expect(m.getWebhookLog).toHaveBeenCalledWith('wh1');
    expect(JSON.parse(result.content[0].text)).toEqual([{ id: 'wh1', ok: true }]);
  });
});

describe('lint tools', () => {
  it('analyzes code and returns JSON', async () => {
    m.analyzeLispCode.mockReturnValue({ diagnostics: [{ message: 'ok' }] });
    const result = await TOOL_HANDLERS.analyze_lisp_code({ code: '(princ 1)', config: { preset: 'strict' } });
    expect(m.analyzeLispCode).toHaveBeenCalledWith('(princ 1)', { lintConfig: { preset: 'strict' } });
    expect(JSON.parse(result.content[0].text)).toEqual({ diagnostics: [{ message: 'ok' }] });
  });

  it('formats code with default tab width', async () => {
    m.formatCode.mockReturnValue('formatted');
    const result = await TOOL_HANDLERS.format_lisp_code({ code: '(princ 1)' });
    expect(m.formatCode).toHaveBeenCalledWith('(princ 1)', { tabWidth: 2 });
    expect(result.content[0].text).toBe('formatted');
  });

  it('formats code with explicit tab width', async () => {
    m.formatCode.mockReturnValue('formatted');
    await TOOL_HANDLERS.format_lisp_code({ code: '(princ 1)', tabWidth: 4 });
    expect(m.formatCode).toHaveBeenCalledWith('(princ 1)', { tabWidth: 4 });
  });

  it('returns formatting errors', async () => {
    m.formatCode.mockImplementation(() => { throw new Error('bad code'); });
    const result = await TOOL_HANDLERS.format_lisp_code({ code: '(princ 1' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('格式化失败: bad code');
  });

  it('lists lint rules with defaults', async () => {
    const result = await TOOL_HANDLERS.list_lint_rules({});
    expect(JSON.parse(result.content[0].text)).toEqual([
      { rule: 'parens', severity: 'error', description: 'Balanced', fixable: true },
      { rule: 'other', severity: 'warn', description: '', fixable: false },
    ]);
  });

  it('requires directory for project lint', async () => {
    const result = await TOOL_HANDLERS.lint_project({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('需要 directory 参数');
  });

  it('lints a project and returns JSON', async () => {
    m.lintProject.mockResolvedValue({ files: [{ name: 'a.lsp' }] });
    const result = await TOOL_HANDLERS.lint_project({ directory: '/tmp/lsp', config: { preset: 'strict' } });
    expect(m.lintProject).toHaveBeenCalledWith('/tmp/lsp', { preset: 'strict' });
    expect(JSON.parse(result.content[0].text)).toEqual({ files: [{ name: 'a.lsp' }] });
  });

  it('returns project lint errors', async () => {
    m.lintProject.mockRejectedValue(new Error('bad project'));
    const result = await TOOL_HANDLERS.lint_project({ directory: '/tmp/lsp' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('项目分析失败: bad project');
  });
});

describe('sandbox tools', () => {
  it('validates code with an explicit session id', async () => {
    m.validateLispCode.mockReturnValue({ ok: false, threats: [{ rule: 'quit_exit' }] });
    const result = await TOOL_HANDLERS.sandbox_validate({ code: '(quit)', sessionId: 's1' });
    expect(m.validateLispCode).toHaveBeenCalledWith('(quit)', 's1');
    expect(JSON.parse(result.content[0].text)).toEqual({ ok: false, threats: [{ rule: 'quit_exit' }] });
  });

  it('validates code with a null session id when omitted', async () => {
    await TOOL_HANDLERS.sandbox_validate({ code: '(princ 1)' });
    expect(m.validateLispCode).toHaveBeenCalledWith('(princ 1)', null);
  });

  it('adds allowlist entries', async () => {
    const result = await TOOL_HANDLERS.sandbox_allowlist_add({ sessionId: 's1', ruleIndex: 3 });
    expect(m.addToAllowlist).toHaveBeenCalledWith('s1', 3);
    expect(result.content[0].text).toBe('规则索引 3 已添加到会话 s1 的 allowlist');
  });

  it('clears the session allowlist', async () => {
    const result = await TOOL_HANDLERS.sandbox_allowlist_clear({ sessionId: 's1' });
    expect(m.clearSessionAllowlist).toHaveBeenCalledWith('s1');
    expect(result.content[0].text).toBe('会话 s1 的 allowlist 已清除');
  });
});

describe('audit tools', () => {
  it('queries audit logs', async () => {
    m.queryAuditLog.mockReturnValue({ entries: [{ tool: 'eval_lisp' }] });
    const result = await TOOL_HANDLERS.audit_log_query({ tool: 'eval_lisp' });
    expect(m.queryAuditLog).toHaveBeenCalledWith({ tool: 'eval_lisp' });
    expect(JSON.parse(result.content[0].text)).toEqual({ entries: [{ tool: 'eval_lisp' }] });
  });

  it('queries audit stats', async () => {
    m.getAuditStats.mockReturnValue({ total: 3 });
    const result = await TOOL_HANDLERS.audit_log_stats({});
    expect(m.getAuditStats).toHaveBeenCalled();
    expect(JSON.parse(result.content[0].text)).toEqual({ total: 3 });
  });
});

describe('agent context tools', () => {
  it('sets context using a default session when no store is present', async () => {
    const result = await TOOL_HANDLERS.agent_set_context({ key: 'k', value: 1 });
    expect(m.setContext).toHaveBeenCalledWith('default', 'k', 1);
    expect(result.content[0].text).toBe('已设置 k');
  });

  it('sets context using the stored session id', async () => {
    m.getStore.mockReturnValue({ sessionId: 's1' });
    await TOOL_HANDLERS.agent_set_context({ key: 'k', value: 1 });
    expect(m.setContext).toHaveBeenCalledWith('s1', 'k', 1);
  });

  it('gets context values', async () => {
    m.getContext.mockReturnValue({ x: 1 });
    const result = await TOOL_HANDLERS.agent_get_context({ key: 'k' });
    expect(m.getContext).toHaveBeenCalledWith('default', 'k');
    expect(result.content[0].text).toBe('{"x":1}');

    m.getContext.mockReturnValue(undefined);
    const missing = await TOOL_HANDLERS.agent_get_context({ key: 'k' });
    expect(missing.content[0].text).toBe('nil');
  });

  it('lists context keys', async () => {
    m.listContext.mockReturnValue(['a', 'b']);
    const result = await TOOL_HANDLERS.agent_list_context({});
    expect(m.listContext).toHaveBeenCalledWith('default');
    expect(JSON.parse(result.content[0].text)).toEqual(['a', 'b']);
  });

  it('deletes and clears context', async () => {
    const del = await TOOL_HANDLERS.agent_delete_context({ key: 'k' });
    expect(m.deleteContext).toHaveBeenCalledWith('default', 'k');
    expect(del.content[0].text).toBe('已删除 k');

    const clear = await TOOL_HANDLERS.agent_clear_context({});
    expect(m.clearContext).toHaveBeenCalledWith('default');
    expect(clear.content[0].text).toBe('上下文已清除');
  });
});

describe('cad pool tools', () => {
  it('discovers CAD instances', async () => {
    m.pool.discover.mockResolvedValue([{ key: 'a' }]);
    const result = await TOOL_HANDLERS.cad_pool_discover({});
    expect(JSON.parse(result.content[0].text)).toEqual([{ key: 'a' }]);
  });

  it('switches to an existing instance and notifies subscribed resources', async () => {
    m.pool.setActive.mockReturnValue(true);
    m.isSubscribed.mockImplementation((uri) => uri === 'mcp://resource/tables/layers');
    const result = await TOOL_HANDLERS.cad_pool_switch({ key: 'a' });
    expect(m.pool.setActive).toHaveBeenCalledWith('a');
    expect(m.clearCache).toHaveBeenCalled();
    expect(m.notify).toHaveBeenCalledWith('mcp://resource/tables/layers', null);
    expect(result.content[0].text).toBe('已切换到实例 a');
  });

  it('switching to a missing instance does not clear cache or notify', async () => {
    m.pool.setActive.mockReturnValue(false);
    const result = await TOOL_HANDLERS.cad_pool_switch({ key: 'missing' });
    expect(result.content[0].text).toBe('实例 missing 不存在');
    expect(m.clearCache).not.toHaveBeenCalled();
    expect(m.notify).not.toHaveBeenCalled();
  });

  it('checks pool health', async () => {
    m.pool.healthCheck.mockResolvedValue([{ key: 'a', healthy: true }]);
    const result = await TOOL_HANDLERS.cad_pool_health({});
    expect(JSON.parse(result.content[0].text)).toEqual([{ key: 'a', healthy: true }]);
  });

  it('gets pool stats', async () => {
    m.pool.getStats.mockReturnValue({ total: 2, active: 'a' });
    const result = await TOOL_HANDLERS.cad_pool_stats({});
    expect(JSON.parse(result.content[0].text)).toEqual({ total: 2, active: 'a' });
  });

  it('lists pool instances', async () => {
    m.pool.listInstances.mockReturnValue([{ key: 'a', platform: 'AutoCAD' }]);
    const result = await TOOL_HANDLERS.cad_pool_list({});
    expect(JSON.parse(result.content[0].text)).toEqual([{ key: 'a', platform: 'AutoCAD' }]);
  });

  it('connects a pool instance with defaults', async () => {
    m.pool.connect.mockResolvedValue(true);
    const result = await TOOL_HANDLERS.cad_pool_connect({ key: 'a', platform: 'AutoCAD', label: 'a', pid: 42 });
    expect(m.pool.connect).toHaveBeenCalledWith('a', 'AutoCAD', {
      label: 'a',
      pid: 42,
      makeActive: true,
      forceLaunch: false,
    });
    expect(result.content[0].text).toBe('实例 "a" 已连接');
  });

  it('connects a pool instance without makeActive', async () => {
    m.pool.connect.mockResolvedValue(true);
    await TOOL_HANDLERS.cad_pool_connect({ key: 'a', platform: 'AutoCAD', label: 'a', makeActive: false, forceLaunch: true });
    expect(m.pool.connect).toHaveBeenCalledWith('a', 'AutoCAD', {
      label: 'a',
      pid: undefined,
      makeActive: false,
      forceLaunch: true,
    });
  });

  it('reports failed pool connection', async () => {
    m.pool.connect.mockResolvedValue(false);
    const result = await TOOL_HANDLERS.cad_pool_connect({ key: 'bad', platform: 'AutoCAD' });
    expect(result.content[0].text).toBe('实例 "bad" 连接失败');
  });

  it('disconnects a pool instance', async () => {
    m.pool.disconnect.mockResolvedValue(true);
    const ok = await TOOL_HANDLERS.cad_pool_disconnect({ key: 'a' });
    expect(m.pool.disconnect).toHaveBeenCalledWith('a');
    expect(ok.content[0].text).toBe('实例 "a" 已断开');

    m.pool.disconnect.mockResolvedValue(false);
    const fail = await TOOL_HANDLERS.cad_pool_disconnect({ key: 'a' });
    expect(fail.content[0].text).toBe('实例 "a" 未找到');
  });
});

describe('session instance binding', () => {
  it('pins a session to an instance when the main connection is available', async () => {
    m.cad.connected = true;
    const ctx = {};
    m.getStore.mockReturnValue(ctx);
    m.pool.getConnection.mockReturnValue({ key: 'a' });
    const result = await TOOL_HANDLERS.session_pin_instance({ key: 'a' });
    expect(ctx.instanceKey).toBe('a');
    expect(result.content[0].text).toBe('会话已绑定到实例 "a"');
  });

  it('cannot pin when the main connection is unavailable', async () => {
    m.cad.connected = false;
    m.getStore.mockReturnValue({});
    const result = await TOOL_HANDLERS.session_pin_instance({ key: 'a' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('实例 "a" 未连接');
  });

  it('unpins a session from its instance', async () => {
    const ctx = { instanceKey: 'a' };
    m.getStore.mockReturnValue(ctx);
    const result = await TOOL_HANDLERS.session_unpin_instance({});
    expect(ctx.instanceKey).toBeNull();
    expect(result.content[0].text).toBe('已取消实例绑定');
  });
});

describe('instance switch callback', () => {
  it('notifies only subscribed CAD resource URIs', () => {
    m.isSubscribed.mockImplementation((uri) => uri === 'mcp://resource/tables/layers');
    instanceSwitchCallback();
    expect(m.notify).toHaveBeenCalledTimes(1);
    expect(m.notify).toHaveBeenCalledWith('mcp://resource/tables/layers', null);
  });
});
