export const tools = [
{
        name: 'find_entities_near_point',
        description: '查找某点附近指定半径内的所有实体',
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
        description: '窗口选择(Window)：完全在窗口内的实体',
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
        description: '交叉选择(Crossing)：窗口内及与窗口相交的实体',
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
        description: '栏选(Fence)：与折线相交的所有实体',
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
        description: '多边形选择(WPolygon)：完全在多边形内的实体',
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
        description: '获取实体的包围盒(最小外接矩形)左下角和右上角坐标',
        inputSchema: {
            type: 'object',
            properties: {
                handle: { type: 'string', description: '实体句柄' }
            },
            required: ['handle']
        }
    }
];
