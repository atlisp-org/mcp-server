export const tools = [
{
        name: 'trim_entity',
        description: '修剪实体',
        inputSchema: {
            type: 'object',
            properties: {
                handle: { type: 'string', description: '要修剪的实体句柄' },
                cuttingEdgeHandle: { type: 'string', description: '剪切边实体句柄' }
            },
            required: ['handle', 'cuttingEdgeHandle']
        }
    },
{
        name: 'extend_entity',
        description: '延伸实体',
        inputSchema: {
            type: 'object',
            properties: {
                handle: { type: 'string', description: '要延伸的实体句柄' },
                boundaryHandle: { type: 'string', description: '边界实体句柄' }
            },
            required: ['handle', 'boundaryHandle']
        }
    },
{
        name: 'fillet',
        description: '圆角连接',
        inputSchema: {
            type: 'object',
            properties: {
                handle1: { type: 'string', description: '第一个实体句柄' },
                handle2: { type: 'string', description: '第二个实体句柄' },
                radius: { type: 'number', description: '圆角半径' }
            },
            required: ['handle1', 'handle2', 'radius']
        }
    },
{
        name: 'chamfer',
        description: '倒角连接',
        inputSchema: {
            type: 'object',
            properties: {
                handle1: { type: 'string', description: '第一个实体句柄' },
                handle2: { type: 'string', description: '第二个实体句柄' },
                distance1: { type: 'number', description: '第一个倒角距离' },
                distance2: { type: 'number', description: '第二个倒角距离' }
            },
            required: ['handle1', 'handle2', 'distance1', 'distance2']
        }
    },
{
        name: 'break_entity',
        description: '打断实体',
        inputSchema: {
            type: 'object',
            properties: {
                handle: { type: 'string', description: '要打断的实体句柄' },
                point1: { type: 'string', description: '第一个打断点坐标' },
                point2: { type: 'string', description: '第二个打断点坐标' }
            },
            required: ['handle', 'point1', 'point2']
        }
    },
{
        name: 'join_entities',
        description: '合并实体',
        inputSchema: {
            type: 'object',
            properties: {
                handles: { type: 'array', description: '要合并的实体句柄列表' }
            },
            required: ['handles']
        }
    },
{
        name: 'stretch',
        description: '拉伸实体',
        inputSchema: {
            type: 'object',
            properties: {
                handles: { type: 'array', description: '要拉伸的实体句柄列表' },
                basePoint: { type: 'string', description: '基点坐标' },
                displacement: { type: 'string', description: '位移坐标' }
            },
            required: ['handles', 'basePoint', 'displacement']
        }
    }
];
