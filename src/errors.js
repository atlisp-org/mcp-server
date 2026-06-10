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

export const ERROR_MESSAGES = {
    [ERROR_CODES.CAD_NOT_CONNECTED]: '未连接 CAD，请先调用 connect_cad',
    [ERROR_CODES.CAD_BUSY]: 'CAD 忙碌，请稍后重试',
    [ERROR_CODES.CAD_NO_DOCUMENT]: 'CAD 中没有打开的文档',
    [ERROR_CODES.LISP_PAREN_MISMATCH]: 'LISP 代码括号不匹配',
    [ERROR_CODES.TIMEOUT]: '操作超时',
    [ERROR_CODES.INVALID_PARAMS]: '无效的参数',
    [ERROR_CODES.METHOD_NOT_FOUND]: '方法不存在',
    [ERROR_CODES.RESOURCE_NOT_FOUND]: '资源不存在',
    [ERROR_CODES.PACKAGE_NOT_FOUND]: '包不存在',
    [ERROR_CODES.INTERNAL_ERROR]: '内部错误',
};

export class MCPError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.code = code;
        this.details = details;
        this.name = 'MCPError';
    }

    toJSON() {
        return {
            code: this.code,
            message: this.message,
            details: this.details
        };
    }
}

export function createError(code, details = {}) {
    const message = ERROR_MESSAGES[code] || ERROR_MESSAGES[ERROR_CODES.INTERNAL_ERROR];
    return new MCPError(code, message, details);
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
    return {
        content: [{ type: 'text', text: `[${mcpErr.code}] ${mcpErr.message}` }],
        isError: true,
    };
}

export function mcpSuccessResponse(text) {
    return { content: [{ type: 'text', text: String(text) }] };
}