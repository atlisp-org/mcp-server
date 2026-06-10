export const tools = [
{
        name: 'find_entities_near_point',
        description: '查找点附近的实体',
        inputSchema: {
            type: 'object',
            properties: {
                point: { type: 'string', description: '搜索点坐标' },
                radius: { type: 'number', description: '搜索半径' }
            },
            required: ['point', 'radius']
        }
    },
{
        name: 'find_entities_in_window',
        description: '窗口选择实体',
        inputSchema: {
            type: 'object',
            properties: {
                corner1: { type: 'string', description: '窗口第一个角点坐标' },
                corner2: { type: 'string', description: '窗口对角点坐标' }
            },
            required: ['corner1', 'corner2']
        }
    },
{
        name: 'find_entities_crossing',
        description: '交叉选择实体',
        inputSchema: {
            type: 'object',
            properties: {
                corner1: { type: 'string', description: '交叉窗口第一个角点坐标' },
                corner2: { type: 'string', description: '交叉窗口对角点坐标' }
            },
            required: ['corner1', 'corner2']
        }
    },
{
        name: 'find_entities_intersecting',
        description: '栏选实体',
        inputSchema: {
            type: 'object',
            properties: {
                fencePoints: { type: 'string', description: '栏选线顶点坐标列表' }
            },
            required: ['fencePoints']
        }
    },
{
        name: 'find_entities_in_polygon',
        description: '多边形选择实体',
        inputSchema: {
            type: 'object',
            properties: {
                points: { type: 'string', description: '多边形顶点坐标列表' }
            },
            required: ['points']
        }
    },
{
        name: 'get_bounding_box',
        description: '获取实体包围盒',
        inputSchema: {
            type: 'object',
            properties: {
                handle: { type: 'string', description: '实体句柄' }
            },
            required: ['handle']
        }
    }
];
