export const tools = [
{
        name: 'create_box',
        description: '创建立方体/长方体3D实体。用户说"建长方体/立方体"时调用。返回新实体句柄。示例: center="0,0,0", length=100, width=50, height=30。创建后可配合 extrude_solid 进一步编辑或使用 boolean_* 进行布尔运算',
        inputSchema: {
            type: 'object',
            properties: {
                center: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'number' } }], description: '中心点坐标，如 0,0,0 或 [0,0,0]' },
                length: { type: 'number', description: 'X方向长度（正数），如 100' },
                width: { type: 'number', description: 'Y方向宽度（正数），如 50' },
                height: { type: 'number', description: 'Z方向高度（正数），如 30' }
            },
            required: ['center', 'length', 'width', 'height']
        }
    },
{
        name: 'create_sphere',
        description: '创建球体3D实体。用户说"建球体/画球"时调用。返回新实体句柄。示例: center="0,0,0", radius=50。先用 get_3d_solid_info 查询体积，再用 boolean_* 进行组合',
        inputSchema: {
            type: 'object',
            properties: {
                center: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'number' } }], description: '球心坐标，如 0,0,0 或 [0,0,0]' },
                radius: { type: 'number', description: '球体半径（正数），如 50' }
            },
            required: ['center', 'radius']
        }
    },
{
        name: 'create_cylinder',
        description: '创建圆柱体3D实体。用户说"建圆柱/画柱子"时调用。返回新实体句柄。示例: center="0,0,0", radius=30, height=100。可配合 boolean_subtract 挖孔或用 slice_solid 剖切',
        inputSchema: {
            type: 'object',
            properties: {
                center: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'number' } }], description: '底面中心坐标，如 0,0,0 或 [0,0,0]' },
                radius: { type: 'number', description: '底面圆半径（正数），如 30' },
                height: { type: 'number', description: '圆柱高度（正数，沿Z轴），如 100' }
            },
            required: ['center', 'radius', 'height']
        }
    },
{
        name: 'create_cone',
        description: '创建圆锥体3D实体。用户说"建圆锥/画锥体"时调用。返回新实体句柄。示例: center="0,0,0", radius=40, height=80。可与 boolean_union 合并为组合体',
        inputSchema: {
            type: 'object',
            properties: {
                center: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'number' } }], description: '底面中心坐标，如 0,0,0 或 [0,0,0]' },
                radius: { type: 'number', description: '底面圆半径（正数），如 40' },
                height: { type: 'number', description: '圆锥高度（正数，沿Z轴），如 80' }
            },
            required: ['center', 'radius', 'height']
        }
    },
{
        name: 'create_torus',
        description: '创建圆环体3D实体（甜甜圈形状）。用户说"建圆环/画甜甜圈"时调用。返回新实体句柄。示例: center="0,0,0", majorRadius=60（环中心到管中心）, minorRadius=20（管子粗细）',
        inputSchema: {
            type: 'object',
            properties: {
                center: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'number' } }], description: '环体中心坐标，如 0,0,0 或 [0,0,0]' },
                majorRadius: { type: 'number', description: '主半径——环中心到管中心距离（正数），决定环大小，如 60' },
                minorRadius: { type: 'number', description: '次半径——管道截面半径（正数），决定粗细，如 20' }
            },
            required: ['center', 'majorRadius', 'minorRadius']
        }
    },
{
        name: 'create_wedge',
        description: '创建楔形体3D实体（三棱柱/坡面体）。用户说"建楔形/画斜坡"时调用。返回新实体句柄。示例: center="0,0,0", length=100, width=60, height=40。斜面沿X轴方向由高到低',
        inputSchema: {
            type: 'object',
            properties: {
                center: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'number' } }], description: '楔形体中心坐标，如 0,0,0 或 [0,0,0]' },
                length: { type: 'number', description: 'X方向长度（正数），如 100' },
                width: { type: 'number', description: 'Y方向宽度（正数），如 60' },
                height: { type: 'number', description: 'Z方向高度（正数，斜面最高点），如 40' }
            },
            required: ['center', 'length', 'width', 'height']
        }
    },
{
        name: 'create_3d_face',
        description: '创建3D面(三个或四个顶点)。用户说"建3D面"时调用。返回新实体句柄。示例: points="0,0,0 100,0,0 100,100,0 0,100,0"（四个顶点空格分隔）。创建后可用 create_mesh 组合成复杂曲面',
        inputSchema: {
            type: 'object',
            properties: {
                points: { type: 'string', description: '顶点坐标序列，如 0,0,0 100,0,0 100,100,0（空格分隔，3或4个顶点）' }
            },
            required: ['points']
        }
    },
{
        name: 'create_mesh',
        description: '创建多边形网格(Mesh)。用户说"建网格/曲面网格"时调用。返回新实体句柄。示例: rows=3, columns=4。顶点数必须等于 rows×columns。创建后可转换为面域或拉伸为实体',
        inputSchema: {
            type: 'object',
            properties: {
                rows: { type: 'integer', description: '网格行数（>=2），如 3' },
                columns: { type: 'integer', description: '网格列数（>=2），如 4' },
                points: { type: 'string', description: '以空格分隔的顶点坐标，顺序逐行排列，总数=rows×columns。如 0,0,0 100,0,0 200,0,0' }
            },
            required: ['rows', 'columns', 'points']
        }
    },
{
        name: 'extrude_solid',
        description: '将闭合轮廓(面域/多段线)拉伸为3D实体。用户说"拉伸/挤出"时调用。返回新实体句柄。示例: profileHandle="ABC", height=100, taperAngle=5。先用 create_region 将闭合曲线转为面域。锥度角>0时顶部缩小',
        inputSchema: {
            type: 'object',
            properties: {
                profileHandle: { type: 'string', description: '闭合轮廓句柄（面域或多段线），如 "ABC"' },
                height: { type: 'number', description: '沿法向拉伸距离，正数向上负数向下。如 100' },
                taperAngle: { type: 'number', description: '侧面倾斜角度（度），0=直壁，>0顶部缩小。如 5' }
            },
            required: ['profileHandle', 'height']
        }
    },
{
        name: 'revolve_solid',
        description: '将轮廓绕轴旋转生成3D实体（旋转体）。用户说"旋转/回转体"时调用。返回新实体句柄。示例: profileHandle="ABC", axisStart="0,0,0", axisEnd="0,0,100", angle=360。先用 create_region 准备轮廓，angle<360 生成部分旋转体',
        inputSchema: {
            type: 'object',
            properties: {
                profileHandle: { type: 'string', description: '闭合轮廓句柄（面域或多段线），如 "ABC"' },
                axisStart: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'number' } }], description: '旋转轴起点坐标，如 0,0,0 或 [0,0,0]' },
                axisEnd: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'number' } }], description: '旋转轴终点坐标，如 0,0,100 或 [0,0,100]' },
                angle: { type: 'number', description: '旋转角度（度），默认360。如 180 生成半圆体' }
            },
            required: ['profileHandle', 'axisStart', 'axisEnd']
        }
    },
{
        name: 'create_3d_polyline',
        description: '创建3D多段线(顶点可含Z坐标)。用户说"建3D多段线/画空间线"时调用。返回新实体句柄。示例: points="0,0,0 100,50,20 200,0,50"。与 draw_polyline(2D)区别是本工具支持Z坐标。创建后可转换为样条曲线',
        inputSchema: {
            type: 'object',
            properties: {
                points: { type: 'string', description: '3D顶点坐标序列（必含Z值），如 0,0,0 100,50,20 200,0,50（空格分隔）' }
            },
            required: ['points']
        }
    },
{
        name: 'create_region',
        description: '将闭合曲线转换为面域(Region)。用户说"建面域/转面域"时调用。返回新面域句柄列表。示例: handles=["ABC","DEF"]。创建后可用 extrude_solid/revolve_solid 拉伸为3D，或用 boolean_* 做布尔运算。handle 可传字符串或数组',
        inputSchema: {
            type: 'object',
            properties: {
                handles: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }], description: '闭合曲线句柄（字符串或数组），如 "ABC" 或 ["ABC","DEF"]' }
            },
            required: ['handles']
        }
    },
{
        name: 'boolean_union',
        description: '多个实体合并为整体(并集/UNION)。用户说"合并/求和/融为一体"时调用。不可撤销！返回合并后实体句柄。示例: handles=["ABC","DEF","GHI"]。与 boolean_subtract(求差)/boolean_intersect(求交)配合使用',
        inputSchema: {
            type: 'object',
            properties: {
                handles: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }], description: '要合并的实体句柄（字符串或数组），如 ["ABC","DEF"]' }
            },
            required: ['handles']
        }
    },
{
        name: 'boolean_subtract',
        description: '从一组实体中减去另一组(差集/SUBTRACT)。用户说"挖洞/减去/打孔"时调用。不可撤销！默认 handles 的第一个实体作为被减对象。与 boolean_union(求和)/boolean_intersect(求交)配合使用',
        inputSchema: {
            type: 'object',
            properties: {
                handles: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }], description: '要减去的实体句柄（被减去的工具实体），如 ["drillBit"]' },
                subtractFromHandles: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }], description: '被减的源实体句柄列表，如 ["mainBody"]。不传时默认使用 handles 的第一个作为被减对象' }
            },
            required: ['handles']
        }
    },
{
        name: 'boolean_intersect',
        description: '只保留多个实体的重叠部分(交集/INTERSECT)。用户说"求交/取交集"时调用。不可撤销！示例: handles=["ABC","DEF"]。只保留所有实体重叠区域，无重叠则实体被删除',
        inputSchema: {
            type: 'object',
            properties: {
                handles: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }], description: '求交实体句柄（字符串或数组），如 ["ABC","DEF"]' }
            },
            required: ['handles']
        }
    },
{
        name: 'slice_solid',
        description: '用平面剖切实体(SLICE)。用户说"剖切/切开/切割"时调用。不可撤销！示例: solidHandle="ABC", planePoint="0,0,0", planeNormal="1,0,0", keepBoth=true。keepBoth=true时生成两个实体，false时只保留一侧',
        inputSchema: {
            type: 'object',
            properties: {
                solidHandle: { type: 'string', description: '要剖切的3D实体句柄，如 "ABC"' },
                planePoint: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'number' } }], description: '剖切平面上的一点，如 0,0,0 或 [0,0,0]' },
                planeNormal: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'number' } }], description: '剖切面法向量，如 1,0,0（沿X轴切开）或 [0,1,0]（沿Y轴切开）' },
                keepBoth: { type: 'boolean', description: 'true=保留两侧各成实体，false=只保留一侧（默认false）' }
            },
            required: ['solidHandle', 'planePoint', 'planeNormal']
        }
    },
{
        name: 'create_loft_surface',
        description: '在多个轮廓之间创建放样曲面(LOFT)。用户说"放样/过渡曲面"时调用。返回新曲面句柄。示例: profileHandles=["剖面1","剖面2","剖面3"], guideHandles=["引导线1"]。轮廓应平行排列，引导线控制曲面走向。创建后可用 thicken_surface 加厚为实体',
        inputSchema: {
            type: 'object',
            properties: {
                profileHandles: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }], description: '放样轮廓句柄列表，按顺序排列。如 ["轮廓A","轮廓B","轮廓C"]' },
                guideHandles: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }], description: '引导曲线句柄列表（可选），控制曲面走向。如 ["引导线1","引导线2"]' }
            },
            required: ['profileHandles']
        }
    },
{
        name: 'thicken_surface',
        description: '将曲面加厚为3D实体。用户说"加厚/增厚"时调用。返回新实体句柄。示例: surfaceHandle="ABC", thickness=10。正厚度沿法向加厚，负厚度沿法向反向。可与 create_loft_surface 配合，放样后加厚为实体',
        inputSchema: {
            type: 'object',
            properties: {
                surfaceHandle: { type: 'string', description: '要加厚的曲面句柄，如 "ABC"' },
                thickness: { type: 'number', description: '加厚距离，正数沿法向加厚，负数反向。如 10' }
            },
            required: ['surfaceHandle', 'thickness']
        }
    },
{
        name: 'offset_surface',
        description: '将曲面沿法向偏移指定距离。用户说"偏移曲面"时调用。返回新曲面句柄。示例: surfaceHandle="ABC", distance=20。正距离沿法向偏移，负距离反向偏移。与 thicken_surface(加厚为实体)不同，本工具保持曲面类型',
        inputSchema: {
            type: 'object',
            properties: {
                surfaceHandle: { type: 'string', description: '要偏移的曲面句柄，如 "ABC"' },
                distance: { type: 'number', description: '沿法向偏移距离，正数向外负数向内。如 20' }
            },
            required: ['surfaceHandle', 'distance']
        }
    },
{
        name: 'get_3d_solid_info',
        description: '查询3D实体的体积、表面积、质心等属性。用户问"这个3D体多大/多重/质心在哪"时调用。返回JSON含 volume(体积)、area(表面积)、centroid(质心坐标)、moments(惯性矩)等。只读操作不修改实体',
        inputSchema: {
            type: 'object',
            properties: {
                handle: { type: 'string', description: '要查询的3D实体句柄，如 "ABC"' }
            },
            required: ['handle']
        }
    }
];
