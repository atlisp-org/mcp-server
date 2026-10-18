/**
 * 官方示例插件：工具调用生命周期审计（观察者）
 *
 * 用途：
 *   演示如何实现工具调用生命周期钩子：onToolCall（调用前）与 onToolExecuted
 *   （调用后），把每次调用的名称/参数/耗时/结果摘要记录到内存数组，
 *   通过 getRecords() 取回。本示例是纯观察者——只记录，不改写任何返回值。
 *
 * 加载方式：
 *   cp examples/plugins/example-audit-hook.js ~/.atlisp/mcp-plugins/
 *   然后重启 MCP Server（启动日志应显示「✓ 已加载 N 个插件」数量 +1）。
 *
 * 注意事项：
 *   1. 只有 .js 文件且不以 "_" 开头才会被加载。如需临时禁用本示例，改名为
 *      _example-audit-hook.js 即可（下划线前缀会被跳过），无需删除文件。
 *      本仓库中的 examples/plugins/ 只是示例源码，不在插件目录内，不会被自动加载。
 *   2. 真实分发 API 是 plugin-loader 的 callPluginHook(hookName, ...args)：
 *      它对每个已加载插件查找「与 hookName 同名的方法」并调用，收集
 *      { plugin, result }；插件抛错会被隔离为 { plugin, error }，不影响其他插件。
 *   3. 核心当前只自动调用 onInit(context)（由 initPlugins 触发）；onToolCall /
 *      onToolExecuted 等生命周期钩子按 docs/plugins.md「可用钩子」的 payload 约定
 *      实现，需由调用方执行 callPluginHook('onToolCall', name, args) 分发
 *      （核心的工具执行路径尚未接入分发，也可由其他插件/扩展代码手动触发）。
 *   4. 钩子的返回值只进入 callPluginHook 的结果数组，当前核心不消费它，
 *      所以实际效果是「观察」而非改写工具结果。
 *   5. 热重载会整体替换插件对象（已记录的审计数据随之清空），且不会重新执行 onInit。
 *
 * 验证：
 *   - 启动日志：[1/6] 加载插件... ✓ 已加载 N 个插件
 *   - 调试日志文件出现 [example-audit-hook] 就绪：等待 callPluginHook...
 *   - 在扩展代码中调用 callPluginHook('onToolExecuted', {...}) 后，getRecords() 可见记录
 */

export default {
  name: 'example-audit-hook',

  /**
   * 初始化审计缓存。必须导出为函数（loader 的加载校验条件）；
   * 由 onInit(context) 转发调用，测试中也可直接 setup()。
   * @returns {boolean}
   */
  setup() {
    this.records = [];
    return true;
  },

  /**
   * 服务器启动时由 initPlugins(context) 调用（当前核心唯一自动执行的钩子）。
   * @param {{ log?: Function }} context - 核心上下文 { cad, config, log, registerTool, tools }
   */
  onInit(context) {
    this.setup();
    if (context && typeof context.log === 'function') {
      context.log('[example-audit-hook] 就绪：等待 callPluginHook("onToolCall"/"onToolExecuted") 分发');
    }
  },

  /**
   * 调用前观察点。分发方式：callPluginHook('onToolCall', name, args)
   * @param {string} name - 工具名
   * @param {object} args - 调用参数
   * @returns {{ observed: boolean, tool: string }}
   */
  onToolCall(name, args) {
    this._push({ phase: 'before', tool: name, args });
    return { observed: true, tool: name };
  },

  /**
   * 调用后观察点。分发方式：
   * callPluginHook('onToolExecuted', { name, args, result, duration, success })
   * @param {{ name: string, args?: object, result?: unknown, duration?: number, success?: boolean }} payload
   */
  onToolExecuted(payload) {
    const info = payload || {};
    this._push({
      phase: 'after',
      tool: info.name,
      args: info.args,
      duration: info.duration,
      success: info.success,
      resultPreview: preview(info.result),
    });
  },

  /**
   * 取回审计记录副本。
   * @returns {Array<object>} 每条含 { phase, tool, ..., timestamp }
   */
  getRecords() {
    return Array.isArray(this.records) ? [...this.records] : [];
  },

  /** 内部：追加一条记录（懒初始化，防止 setup 未被调用时抛错） */
  _push(record) {
    if (!Array.isArray(this.records)) this.records = [];
    this.records.push({ ...record, timestamp: new Date().toISOString() });
  },
};

/** 结果摘要：JSON 序列化后截断，避免把大结果整块留在内存/日志里 */
function preview(value) {
  let text;
  try {
    text = JSON.stringify(value);
  } catch {
    text = String(value);
  }
  if (text === undefined) return null;
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}
