export const tools = [
{
        name: 'find_entities_near_point',
        description: '圆形范围搜索：查找某点附近指定半径内的所有实体。当用户说"找这个点附近的实体/XX范围内的实体"时调用。返回符合条件的所有实体句柄数组（含类型和坐标信息）。适用于拾取设备、标注附近参照物等场景。',
        inputSchema: {
            type: 'object',
            properties: {
                point: { type: 'string', description: '搜索中心点坐标，如 "0,0" 或 "100,50"' },
                radius: { type: 'number', description: '搜索半径（图纸单位）。如 50=搜索半径50范围内的所有实体' }
            },
            required: ['point', 'radius']
        }
    },
{
        name: 'find_entities_in_window',
        description: '矩形窗口选择(Window)：查找完全包含在矩形窗口内的所有实体。当用户说"框选这些/窗口选择"时调用。只有完全在窗口内部的实体才会被选中（窗口边界不穿过实体）。交叉选择（含部分在窗口内的）用 find_entities_crossing。返回实体句柄数组。',
        inputSchema: {
            type: 'object',
            properties: {
                corner1: { type: 'string', description: '窗口第一个角点坐标，如 "0,0"' },
                corner2: { type: 'string', description: '窗口对角点坐标，如 "100,100"。两点定义矩形区域' }
            },
            required: ['corner1', 'corner2']
        }
    },
{
        name: 'find_entities_crossing',
        description: '交叉选择(Crossing)：查找窗口内及与窗口边界相交的所有实体。当用户说"交叉选择/窗口相交的"时调用。比 Window 选择更宽松——只要实体任何部分在窗口内或穿过窗口边界都会被选中。完全窗口内选择用 find_entities_in_window。返回实体句柄数组。',
        inputSchema: {
            type: 'object',
            properties: {
                corner1: { type: 'string', description: '交叉窗口第一个角点坐标，如 "0,0"' },
                corner2: { type: 'string', description: '交叉窗口对角点坐标，如 "100,100"' }
            },
            required: ['corner1', 'corner2']
        }
    },
{
        name: 'find_entities_intersecting',
        description: '栏选(Fence)：查找与折线（栏选线）相交的所有实体。当用户说"栏选/画线选择/折线选择"时调用。适合在复杂图形中沿着某个路径选择穿过折线的实体。不同于 Window/Crossing 的矩形区域，栏选线可以是任意折线。返回实体句柄数组。',
        inputSchema: {
            type: 'object',
            properties: {
                fencePoints: { type: 'string', description: '栏选折线顶点坐标列表，各点空格分隔。如 "0,0 100,0 100,100" 表示一条L形折线。与折线相交的实体都会被选中' }
            },
            required: ['fencePoints']
        }
    },
{
        name: 'find_entities_in_polygon',
        description: '多边形选择(WPolygon)：查找完全在多边形区域内的所有实体。当用户说"多边形选择/圈选"时调用。多边形顶点由 points 定义，只有完全在多边形内部的实体才被选中。包含边界交叉的用 find_entities_crossing（矩形）或栏选 find_entities_intersecting。返回实体句柄数组。',
        inputSchema: {
            type: 'object',
            properties: {
                points: { type: 'string', description: '多边形顶点坐标列表，各点空格分隔。如 "0,0 100,0 100,100 50,150 0,100" 定义五边形。至少3个点，自动闭合' }
            },
            required: ['points']
        }
    },
{
        name: 'get_bounding_box',
        description: '获取实体的包围盒（最小轴对齐外接矩形）信息。返回左下角 (minX,minY) 和右上角 (maxX,maxY) 坐标，以及宽高尺寸。当用户想知道"这个实体有多大/位置范围"时调用。适用于计算实体尺寸、布局排列、碰撞检测等场景。',
        inputSchema: {
            type: 'object',
            properties: {
                handle: { type: 'string', description: '要查询的实体句柄，如 "A1"' }
            },
            required: ['handle']
        }
    }
];
