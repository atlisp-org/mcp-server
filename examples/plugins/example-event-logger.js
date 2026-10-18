/**
 * 官方示例插件：CAD 事件 / 图纸变更观察器
 *
 * 用途：
 *   1. onInit 时读取 context 的实际能力（cad / config / tools）记录 CAD 初始状态；
 *   2. 实现 onCadConnected、onCadDisconnected、onDocumentChanged、onError 钩子，
 *      收到事件时用 context.log 打日志，并在内存里留存事件列表（getEvents() 取回）。
 *
 * 加载方式：
 *   cp examples/plugins/example-event-logger.js ~/.atlisp/mcp-plugins/
 *   然后重启 MCP Server（启动日志应显示「✓ 已加载 N 个插件」数量 +1）。
 *
 * 注意事项：
 *   1. 只有 .js 文件且不以 "_" 开头才会被加载。如需临时禁用本示例，改名为
 *      _example-event-logger.js 即可（下划线前缀会被跳过），无需删除文件。
 *      本仓库中的 examples/plugins/ 只是示例源码，不在插件目录内，不会被自动加载。
 *   2. 事件钩子按 docs/plugins.md「可用钩子」的 payload 约定实现：
 *      onCadConnected { platform, version } / onCadDisconnected { reason } /
 *      onDocumentChanged { name, action } / onError { message, source, code }。
 *      分发入口是 plugin-loader 的 callPluginHook(hookName, ...payload)——
 *      核心当前只自动调用 onInit(context)，CAD/文档事件需由调用方执行
 *      callPluginHook('onDocumentChanged', info) 分发（核心尚未接入该分发，
 *      也可由其他插件/扩展代码手动触发；插件间的调用错误会被隔离记录）。
 *   3. MCP resources/list 的「资源变更」目前没有对应的插件钩子（onPluginChange 是
 *      插件文件监听，属核心内部 API）；热重载插件文件时核心会自动广播
 *      resources/tools/prompts 的 list changed。观察图纸（DWG 文档）变更请用
 *      onDocumentChanged。
 *   4. 不要在此类事件插件里起 setInterval 轮询：插件没有卸载/销毁钩子，热重载后
 *      旧实例的定时器无法清理，会造成泄漏。需要周期性任务请评估后自行保证只注册一次。
 *   5. 热重载会整体替换插件对象（已留存的事件随之清空），且不会重新执行 onInit。
 *
 * 验证：
 *   - 启动日志：[1/6] 加载插件... ✓ 已加载 N 个插件
 *   - 调试日志文件出现 [example-event-logger] 初始化完成 / CAD 事件
 *   - callPluginHook('onDocumentChanged', { name: 'x.dwg', action: 'opened' }) 后
 *     getEvents() 可见记录
 */

export default {
  name: 'example-event-logger',

  /**
   * 初始化事件缓存。必须导出为函数（loader 的加载校验条件）；
   * 由 onInit(context) 转发调用，测试中也可直接 setup()。
   * @returns {boolean}
   */
  setup() {
    this.events = [];
    this.ctx = null;
    return true;
  },

  /**
   * 服务器启动时由 initPlugins(context) 调用（当前核心唯一自动执行的钩子）。
   * 记录 context 实际暴露的能力：{ cad, config, log, registerTool, tools }。
   * @param {object} context - 核心上下文
   */
  onInit(context) {
    this.setup();
    this.ctx = {
      log: context && typeof context.log === 'function' ? context.log : () => {},
    };
    const cad = (context && context.cad) || {};
    const config = (context && context.config) || {};
    const tools = context && Array.isArray(context.tools) ? context.tools : [];
    this._record('init', {
      connected: !!safeCall(() => cad.connected),
      platform: safeCall(() => cad.getPlatform()),
      version: safeCall(() => cad.getVersion()),
      transport: config.transport ?? null,
      toolCount: tools.length,
    });
    this.ctx.log(
      `[example-event-logger] 初始化完成 CAD=${safeCall(() => cad.getPlatform()) || '未连接'}` +
        ` transport=${config.transport ?? '?'} 工具数=${tools.length}`,
    );
  },

  /**
   * CAD 连接成功。分发方式：callPluginHook('onCadConnected', { platform, version })
   * @param {{ platform?: string, version?: string }} info
   */
  onCadConnected(info) {
    const payload = info || {};
    this._record('cad-connected', payload);
    this._log(`[example-event-logger] CAD 已连接: ${payload.platform || '?'} ${payload.version || ''}`.trim());
  },

  /**
   * CAD 断开连接。分发方式：callPluginHook('onCadDisconnected', { reason })
   * @param {{ reason?: string }} info
   */
  onCadDisconnected(info) {
    const payload = info || {};
    this._record('cad-disconnected', payload);
    this._log(`[example-event-logger] CAD 已断开: ${payload.reason || '未知原因'}`);
  },

  /**
   * 图纸（DWG 文档）变更。分发方式：callPluginHook('onDocumentChanged', { name, action })
   * @param {{ name?: string, action?: string }} info
   */
  onDocumentChanged(info) {
    const payload = info || {};
    this._record('document-changed', payload);
    this._log(`[example-event-logger] 图纸变更: ${payload.name || '?'} (${payload.action || '?'})`);
  },

  /**
   * 错误事件。分发方式：callPluginHook('onError', { message, source, code })
   * @param {{ message?: string, source?: string, code?: string|number }} info
   */
  onError(info) {
    const payload = info || {};
    this._record('error', payload);
    this._log(`[example-event-logger] 错误事件 [${payload.source || '?'}]: ${payload.message || ''}`);
  },

  /**
   * 取回事件记录副本。
   * @returns {Array<{ type: string, payload: object, timestamp: string }>}
   */
  getEvents() {
    return Array.isArray(this.events) ? [...this.events] : [];
  },

  /** 内部：追加一条事件（懒初始化，防止 setup 未被调用时抛错） */
  _record(type, payload) {
    if (!Array.isArray(this.events)) this.events = [];
    this.events.push({ type, payload, timestamp: new Date().toISOString() });
  },

  /** 内部：onInit 之前收到事件时静默丢弃日志，不抛错 */
  _log(message) {
    if (this.ctx && typeof this.ctx.log === 'function') this.ctx.log(message);
  },
};

/** 安全执行 cad 查询（thunk）：未连接/异常时返回 null，不让钩子抛错 */
function safeCall(fn) {
  try {
    return fn() ?? null;
  } catch {
    return null;
  }
}
