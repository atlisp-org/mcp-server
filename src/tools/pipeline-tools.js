export const tools = [
    {
        name: 'pipeline_execute',
        description: '执行工具管道链。按顺序执行多个工具调用，支持 $ref:stepName.property 引用前一步输出作为后续输入',
        inputSchema: {
            type: 'object',
            properties: {
                steps: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            name: { type: 'string', description: '步骤名称，用于 $ref 引用' },
                            tool: { type: 'string', description: '要调用的工具名称' },
                            args: { type: 'object', description: '工具参数，支持 $ref:stepName.property 引用语法' },
                            condition: { type: 'string', description: '条件表达式，例如 $ref:step1.success 控制是否执行' },
                            continueOnError: { type: 'boolean', description: '出错时是否继续后续步骤' },
                            timeout: { type: 'number', description: '步骤超时时间（毫秒）' }
                        },
                        required: ['tool']
                    },
                    description: '要执行的步骤列表'
                }
            },
            required: ['steps']
        }
    },
    {
        name: 'pipeline_save',
        description: '保存管道定义到本地文件',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: '管道名称' },
                steps: { type: 'array', description: '管道步骤列表（与 pipeline_execute 格式相同）' }
            },
            required: ['name', 'steps']
        }
    },
    {
        name: 'pipeline_list',
        description: '列出所有已保存的管道',
        inputSchema: { type: 'object', properties: {} }
    },
    {
        name: 'pipeline_run',
        description: '运行已保存的管道',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: '管道名称' }
            },
            required: ['name']
        }
    },
    {
        name: 'pipeline_delete',
        description: '删除已保存的管道',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: '管道名称' }
            },
            required: ['name']
        }
    }
];
