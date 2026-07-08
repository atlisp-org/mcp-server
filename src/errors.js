export const ERROR_CODES = {
    CAD_NOT_CONNECTED: 'CAD_NOT_CONNECTED',
    CAD_BUSY: 'CAD_BUSY',
    CAD_NO_DOCUMENT: 'CAD_NO_DOCUMENT',
    LISP_PAREN_MISMATCH: 'LISP_PAREN_MISMATCH',
    TIMEOUT: 'TIMEOUT',
    INVALID_PARAMS: 'INVALID_PARAMS',
    METHOD_NOT_FOUND: 'METHOD_NOT_FOUND',
    RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
    PACKAGE_NOT_FOUND: 'PACKAGE_NOT_FOUND',
    INTERNAL_ERROR: 'INTERNAL_ERROR',
};

export const ERROR_DEFS = {
    [ERROR_CODES.CAD_NOT_CONNECTED]: {
        message: '未连接 CAD，请先调用 connect_cad',
        hint: '请先调用 connect_cad 工具连接 AutoCAD/ZWCAD/GStarCAD/BricsCAD，也可尝试 cad_pool_discover 自动发现',
        tools: ['connect_cad', 'cad_pool_discover', 'cad_pool_connect'],
    },
    [ERROR_CODES.CAD_BUSY]: {
        message: 'CAD 忙碌，请稍后重试',
        hint: 'CAD 正在处理之前的命令，等待片刻后重试。可使用 get_system_status 检查 CAD 状态',
        tools: ['get_system_status'],
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
