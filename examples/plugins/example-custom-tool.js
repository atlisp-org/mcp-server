/**
 * 官方示例插件：注册自定义只读工具 echo_debug
 *
 * 用途：
 *   演示通过 context.registerTool(toolDef, handler) 动态注册一个 MCP 工具。
 *   echo_debug 是只读工具：不向 CAD 发送任何 LISP，只把入参 message 原样返回，
 *   用于验证「插件 → registerTool → tools/list → 工具调用」整条链路。
 *
 * 加载方式：
 *   cp examples/plugins/example-custom-tool.js ~/.atlisp/mcp-plugins/
 *   然后重启 MCP Server（启动日志应显示「✓ 已加载 N 个插件」数量 +1）。
 *
 * 注意事项：
 *   1. 只有 .js 文件且不以 "_" 开头才会被加载。如需临时禁用本示例，改名为
 *      _example-custom-tool.js 即可（下划线前缀会被跳过），无需删除文件。
 *      本仓库中的 examples/plugins/ 只是示例源码，不在插件目录内，不会被自动加载。
 *   2. loader 仅校验 default.setup 是函数，并不会自动调用它；核心启动时
 *      initPlugins(context) 只调用 onInit(context)。因此初始化逻辑必须由
 *      onInit 转发到 setup（见 docs/plugins.md「插件格式」「可用钩子」）。
 *   3. registerTool 重名会抛错：注册前先检查 context.tools 里是否已存在同名工具
 *      （本示例即按此做幂等保护）。
 *   4. 插件注册的工具不会经过内置 addAnnotations()，请自行提供 annotations
 *      （只读标记/分类）；若配置了 toolCategories 档位过滤，缺少 annotations.category
 *      的工具不会出现在 tools/list（仍可直接调用）。
 *   5. 热重载会重新执行 onInit：旧实例注册的工具先被注销，新实例会重新注册，
 *      因此修改工具定义/handler 后保存即可生效，无需重启 MCP Server。
 *
 * 验证：
 *   - 启动日志：[1/6] 加载插件... ✓ 已加载 N 个插件
 *   - tools/list 中出现 echo_debug；调用 echo_debug {"message":"hi"} 返回 hi
 *   - 调试日志文件（默认 /tmp/mcp-server-debug.log）出现 [example-custom-tool] echo_debug 已注册
 */

export default {
  name: 'example-custom-tool',

  /**
   * 注册 echo_debug 工具。必须导出为函数（loader 的加载校验条件）；
   * 由 onInit(context) 转发调用，测试中也可直接 setup(mockContext)。
   * @param {{ log?: Function, registerTool?: Function, tools?: Array }} context
   *   核心传入的上下文：{ cad, config, log, registerTool, tools }
   * @returns {boolean} 是否完成注册（重复注册或缺少 registerTool 时返回）
   */
  setup(context) {
    if (!context || typeof context.registerTool !== 'function') return false;
    const tools = Array.isArray(context.tools) ? context.tools : [];
    // 幂等：核心 registerTool 会把工具推入同一个 tools 数组，重名注册会抛错
    if (tools.some((t) => t && t.name === 'echo_debug')) return true;

    context.registerTool(
      {
        name: 'echo_debug',
        description: '示例只读工具：把入参 message 原样返回，用于验证插件注册与调用链路',
        inputSchema: {
          type: 'object',
          properties: {
            message: { type: 'string', description: '要回显的文本' },
          },
          required: ['message'],
        },
        // 插件工具不经过内置 addAnnotations()，自行提供只读/分类标注
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          category: '其他',
        },
      },
      // handler 是 registerTool 的第二个参数：async (args) => MCP 结果对象
      async (args) => ({
        content: [{ type: 'text', text: String(args?.message ?? '') }],
      }),
    );
    if (typeof context.log === 'function') {
      context.log('[example-custom-tool] echo_debug 已注册');
    }
    return true;
  },

  /**
   * 服务器启动时由 initPlugins(context) 调用（当前核心唯一自动执行的钩子）。
   * 转发 setup 完成注册，并打印初始化日志。
   * @param {object} context - 与 setup 相同的上下文对象
   */
  onInit(context) {
    this.setup(context);
    if (context && typeof context.log === 'function') {
      const n = Array.isArray(context.tools) ? context.tools.length : 0;
      context.log(`[example-custom-tool] 初始化完成，当前工具数: ${n}`);
    }
  },
};
