export const ERROR_CODES = {
    CAD_NOT_CONNECTED: 'CAD_NOT_CONNECTED',
    CAD_BUSY: 'CAD_BUSY',
    CAD_NO_DOCUMENT: 'CAD_NO_DOCUMENT',
    LISP_PAREN_MISMATCH: 'LISP_PAREN_MISMATCH',
    TIMEOUT: 'TIMEOUT',
    INVALID_PARAMS: 'INVALID_PARAMS',
    INVALID_ARGS: 'INVALID_ARGS',
    METHOD_NOT_FOUND: 'METHOD_NOT_FOUND',
    HANDLER_NOT_FOUND: 'HANDLER_NOT_FOUND',
    RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
    PACKAGE_NOT_FOUND: 'PACKAGE_NOT_FOUND',
    OPERATION_FAILED: 'OPERATION_FAILED',
    RATE_LIMITED: 'RATE_LIMITED',
    SESSION_NOT_FOUND: 'SESSION_NOT_FOUND',
    INTERNAL_ERROR: 'INTERNAL_ERROR',
};

export const ERROR_DEFS = {
    [ERROR_CODES.CAD_NOT_CONNECTED]: {
        message: '未连接 CAD，请先调用 connect_cad',
        hint: '请先调用 connect_cad 工具连接 AutoCAD/ZWCAD/GStarCAD/BricsCAD，也可尝试 cad_pool_discover 自动发现',
        tools: ['connect_cad', 'cad_pool_discover', 'cad_pool_connect'],
    },
    [ERROR_CODES.CAD_BUSY]: {
        message: 'CAD 忙碌或停滞，请稍后重试',
        hint: 'CAD 正在处理之前的命令或等待输入（弹窗/命令挂起）。请人工处理 CAD 窗口，或调用 cad_pool_connect(key, platform, forceLaunch:true) 打开全新 CAD 实例继续任务。可用 get_system_status 或资源 atlisp://system/cad-status 查看停滞状态',
        tools: ['get_system_status', 'cad_pool_connect', 'cad_pool_switch'],
    },
    [ERROR_CODES.CAD_NO_DOCUMENT]: {
        message: 'CAD 中没有打开的文档',
        hint: '请先调用 open_dwg 打开现有文件，或调用 new_document 创建新文档',
        tools: ['open_dwg', 'new_document'],
    },
    [ERROR_CODES.LISP_PAREN_MISMATCH]: {
        message: 'LISP 代码括号不匹配',
        hint: '检查代码中的括号是否成对出现，可使用 analyze_lisp_code 工具预检代码',
        tools: ['analyze_lisp_code'],
    },
    [ERROR_CODES.TIMEOUT]: {
        message: '操作超时',
        hint: '操作耗时超过限制。可重试，或检查 CAD 是否响应正常',
        tools: ['get_system_status', 'get_cad_info'],
    },
    [ERROR_CODES.INVALID_PARAMS]: {
        message: '无效的参数',
        hint: '请检查工具参数格式是否正确。使用 search_tools 或 list_tools_by_category 查看工具参数要求',
        tools: ['search_tools', 'list_tools_by_category'],
    },
    [ERROR_CODES.INVALID_ARGS]: {
        message: '参数校验失败',
        hint: '工具所需参数缺失或格式错误。请检查参数类型和必填字段，使用 search_tools 查看工具参数要求',
        tools: ['search_tools', 'list_tools_by_category'],
    },
    [ERROR_CODES.HANDLER_NOT_FOUND]: {
        message: '工具未找到',
        hint: '工具名称不存在。使用 search_tools 搜索可用工具，或 list_tools_by_category 浏览全部分类',
        tools: ['search_tools', 'list_tools_by_category'],
    },
    [ERROR_CODES.OPERATION_FAILED]: {
        message: '操作执行失败',
        hint: '工具执行过程中发生错误。可重试操作，或检查日志获取详细信息',
        tools: ['get_system_status', 'get_cad_info'],
    },
    [ERROR_CODES.RATE_LIMITED]: {
        message: '调用频率超限',
        hint: '工具调用过于频繁。请等待一段时间后再试',
        tools: [],
    },
    [ERROR_CODES.SESSION_NOT_FOUND]: {
        message: '会话未找到',
        hint: '指定 ID 的会话不存在。请检查 sessionId 参数是否正确',
        tools: ['lisp_repl_list'],
    },
    [ERROR_CODES.METHOD_NOT_FOUND]: {
        message: '方法不存在',
        hint: '工具名称输入错误。使用 search_tools 搜索可用工具，或 list_tools_by_category 浏览全部分类',
        tools: ['search_tools', 'list_tools_by_category'],
    },
    [ERROR_CODES.RESOURCE_NOT_FOUND]: {
        message: '资源不存在',
        hint: '资源 URI 不存在。可使用 list_resource_templates 查看可用资源模板',
        tools: [],
    },
    [ERROR_CODES.PACKAGE_NOT_FOUND]: {
        message: '包不存在',
        hint: '指定的 @lisp 包不存在。使用 search_packages 搜索可用包',
        tools: ['search_packages', 'list_packages'],
    },
    [ERROR_CODES.INTERNAL_ERROR]: {
        message: '内部错误',
        hint: '服务器内部发生错误。可尝试重新操作，或检查日志获取详细信息',
        tools: ['get_system_status'],
    },
};

export const ERROR_MESSAGES = Object.fromEntries(
    Object.entries(ERROR_DEFS).map(([k, v]) => [k, v.message])
);

export class MCPError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.code = code;
        this.details = details;
        this.name = 'MCPError';
    }

    toJSON() {
        const def = ERROR_DEFS[this.code];
        return {
            code: this.code,
            message: this.message,
            hint: def?.hint || '',
            suggestedTools: def?.tools || [],
            details: this.details,
        };
    }
}

export function createError(code, details = {}) {
    const def = ERROR_DEFS[code] || ERROR_DEFS[ERROR_CODES.INTERNAL_ERROR];
    return new MCPError(code, def.message, details);
}

export function toMcpError(error) {
    if (error instanceof MCPError) return error;
    if (error instanceof Error) {
        return new MCPError(ERROR_CODES.INTERNAL_ERROR, error.message, { stack: error.stack });
    }
    return new MCPError(ERROR_CODES.INTERNAL_ERROR, String(error));
}

export function mcpErrorResponse(error) {
    const mcpErr = toMcpError(error);
    const json = mcpErr.toJSON();
    return {
        content: [{ type: 'text', text: `[${json.code}] ${json.message}\n提示: ${json.hint}\n建议工具: ${json.suggestedTools.join(', ') || '无'}` }],
        isError: true,
    };
}

export function mcpSuccessResponse(text) {
    return { content: [{ type: 'text', text: String(text) }] };
}
