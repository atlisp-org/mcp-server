export const tools = [
    {
        name: 'watch_register',
        description: '注册 CAD 变更触发器。当条件满足时触发，支持实体数量/图层/文档等事件',
        inputSchema: {
            type: 'object',
            properties: {
                type: {
                    type: 'string',
                    enum: ['entity_count', 'layer_exists', 'layer_count', 'doc_name', 'custom_lisp'],
                    description: '触发器类型: entity_count(实体数量), layer_exists(图层存在), layer_count(图层数量), doc_name(文档名称), custom_lisp(自定义 Lisp 条件)'
                },
                name: { type: 'string', description: '触发器名称（可选）' },
                filter: { type: 'object', description: '实体过滤器，如 { type: "LINE" }（仅 entity_count 使用）' },
                operator: { type: 'string', enum: ['gte', 'lte', 'eq'], description: '比较运算符: gte(>=), lte(<=), eq(==)，默认 gte' },
                value: { type: 'number', description: '比较阈值（entity_count/layer_count 使用）' },
                layerName: { type: 'string', description: '图层名称（layer_exists 使用）' },
                pattern: { type: 'string', description: '文档名称匹配模式（doc_name 使用）' },
                lispCode: { type: 'string', description: '自定义 Lisp 条件代码，返回非 nil 表示触发（custom_lisp 使用）' },
                autoRemove: { type: 'boolean', description: '触发后自动移除（默认 true）' },
            },
            required: ['type']
        }
    },
    {
        name: 'watch_remove',
        description: '移除已注册的触发器',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string', description: '触发器 ID' }
            },
            required: ['id']
        }
    },
    {
        name: 'watch_list',
        description: '列出所有已注册的触发器',
        inputSchema: { type: 'object', properties: {} }
    },
    {
        name: 'watch_wait',
        description: '等待指定触发器触发（阻塞直到条件满足或超时）',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string', description: '触发器 ID' },
                timeout: { type: 'number', description: '超时时间（毫秒，默认 30000）' }
            },
            required: ['id']
        }
    },
    {
        name: 'watch_create_and_wait',
        description: '注册触发器并等待触发（合并操作）',
        inputSchema: {
            type: 'object',
            properties: {
                type: { type: 'string', description: '触发器类型' },
                name: { type: 'string', description: '触发器名称' },
                filter: { type: 'object', description: '过滤器' },
                operator: { type: 'string', description: '比较运算符' },
                value: { type: 'number', description: '比较阈值' },
                layerName: { type: 'string', description: '图层名称' },
                pattern: { type: 'string', description: '名称模式' },
                lispCode: { type: 'string', description: '自定义条件 Lisp' },
                timeout: { type: 'number', description: '超时时间' },
            },
            required: ['type']
        }
    },
];
