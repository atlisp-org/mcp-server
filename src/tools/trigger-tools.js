export const tools = [
    {
        name: 'watch_register',
        description: '注册CAD变更事件触发器。当用户需要监听实体数量变化/图层创建/文档名变更等CAD事件时调用。返回触发器ID。类型见 type 参数（含自定义Lisp条件）。结合 watch_wait 使用。',
        inputSchema: {
            type: 'object',
            properties: {
                type: {
                    type: 'string',
                    enum: ['entity_count', 'layer_exists', 'layer_count', 'doc_name', 'custom_lisp'],
                    description: '触发器类型: entity_count(实体数量), layer_exists(图层存在), layer_count(图层数量), doc_name(文档名称), custom_lisp(自定义 Lisp 条件)。如 entity_count'
                },
                name: { type: 'string', description: '触发器名称（可选），用于标识' },
                filter: { type: 'object', description: '实体过滤器如 { type: "LINE" }，仅 entity_count 类型使用' },
                operator: { type: 'string', enum: ['gte', 'lte', 'eq'], description: '比较运算符: gte(>=)/lte(<=)/eq(==)，默认 gte。如 gte' },
                value: { type: 'number', description: '比较阈值。如 100（entity_count/layer_count 使用）' },
                layerName: { type: 'string', description: '图层名称如 "0"（layer_exists 类型使用）' },
                pattern: { type: 'string', description: '文档名称匹配模式如 "*方案1*"，支持通配符（doc_name 类型使用）' },
                lispCode: { type: 'string', description: '自定义 Lisp 条件代码，返回非 nil 表示触发（custom_lisp 类型使用）' },
                autoRemove: { type: 'boolean', description: '触发后自动移除（默认 true），设为 false 可重复使用' },
            },
            required: ['type']
        }
    },
    {
        name: 'watch_remove',
        description: '移除已注册的触发器。当用户说"取消监控/删除触发器"时调用。通过 watch_list 获取触发器 ID。',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string', description: '要移除的触发器 ID，可通过 watch_list 获取' }
            },
            required: ['id']
        }
    },
    {
        name: 'watch_list',
        description: '列出所有已注册的触发器及其状态。当用户说"有哪些监控/查看触发器"时调用。返回触发器列表。',
        inputSchema: { type: 'object', properties: {} }
    },
    {
        name: 'watch_wait',
        description: '等待指定触发器触发，超时返回错误。当用户需要阻塞等待 CAD 事件发生时调用。需先用 watch_register 注册触发器获取 ID。timeout 默认 30 秒。',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string', description: '触发器 ID（由 watch_register 返回）' },
                timeout: { type: 'number', description: '超时时间（毫秒，默认 30000）。如 30000' }
            },
            required: ['id']
        }
    },
    {
        name: 'watch_create_and_wait',
        description: '一步完成注册触发器并等待触发。当用户需要快速监听并等待 CAD 事件时调用。等价于 watch_register + watch_wait 合并。返回触发结果。',
        inputSchema: {
            type: 'object',
            properties: {
                type: { type: 'string', description: '触发器类型: entity_count/layer_exists/layer_count/doc_name/custom_lisp。如 entity_count' },
                name: { type: 'string', description: '触发器名称（可选）' },
                filter: { type: 'object', description: '实体过滤器如 { type: "LINE" }，仅 entity_count 使用' },
                operator: { type: 'string', description: '比较运算符: gte(>=)/lte(<=)/eq(==)，默认 gte' },
                value: { type: 'number', description: '比较阈值。如 100' },
                layerName: { type: 'string', description: '图层名称如 "0"（layer_exists 使用）' },
                pattern: { type: 'string', description: '名称匹配模式如 "*方案*"（doc_name 使用）' },
                lispCode: { type: 'string', description: '自定义条件 Lisp 代码（custom_lisp 使用）' },
                timeout: { type: 'number', description: '超时时间（毫秒，默认 30000）。如 30000' },
            },
            required: ['type']
        }
    },
];
