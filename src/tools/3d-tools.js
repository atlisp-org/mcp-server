export const tools = [
{
        name: 'create_box',
        description: '创建立方体/长方体3D实体。指定中心点和长宽高',
        inputSchema: {
            type: 'object',
            properties: {
                center: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'number' } }], description: '中心点 (x,y,z)' },
                length: { type: 'number', description: '长度' },
                width: { type: 'number', description: '宽度' },
                height: { type: 'number', description: '高度' }
            },
            required: ['center', 'length', 'width', 'height']
        }
    },
{
        name: 'create_sphere',
        description: '创建球体3D实体。指定中心点和半径',
        inputSchema: {
            type: 'object',
            properties: {
                center: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'number' } }], description: '中心点' },
                radius: { type: 'number', description: '半径' }
            },
            required: ['center', 'radius']
        }
    },
{
        name: 'create_cylinder',
        description: '创建圆柱体3D实体。指定中心点、半径和高度',
        inputSchema: {
            type: 'object',
            properties: {
                center: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'number' } }], description: '中心点' },
                radius: { type: 'number', description: '半径' },
                height: { type: 'number', description: '高度' }
            },
            required: ['center', 'radius', 'height']
        }
    },
{
        name: 'create_cone',
        description: '创建圆锥体3D实体。指定中心点、底面半径和高度',
        inputSchema: {
            type: 'object',
            properties: {
                center: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'number' } }], description: '中心点' },
                radius: { type: 'number', description: '半径' },
                height: { type: 'number', description: '高度' }
            },
            required: ['center', 'radius', 'height']
        }
    },
{
        name: 'create_torus',
        description: '创建圆环体3D实体。指定中心点、主半径(环)和次半径(管)',
        inputSchema: {
            type: 'object',
            properties: {
                center: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'number' } }], description: '中心点' },
                majorRadius: { type: 'number', description: '主半径' },
                minorRadius: { type: 'number', description: '次半径' }
            },
            required: ['center', 'majorRadius', 'minorRadius']
        }
    },
{
        name: 'create_wedge',
        description: '创建楔形体3D实体。指定中心点和长宽高',
        inputSchema: {
            type: 'object',
            properties: {
                center: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'number' } }], description: '中心点' },
                length: { type: 'number', description: '长度' },
                width: { type: 'number', description: '宽度' },
                height: { type: 'number', description: '高度' }
            },
            required: ['center', 'length', 'width', 'height']
        }
    },
{
        name: 'create_3d_face',
        description: '创建3D面(三个或四个顶点)。用户说"建3D面"时调用',
        inputSchema: {
            type: 'object',
            properties: {
                points: { type: 'string', description: '顶点坐标列表' }
            },
            required: ['points']
        }
    },
{
        name: 'create_mesh',
        description: '创建网格(Mesh)。指定行列数和顶点坐标',
        inputSchema: {
            type: 'object',
            properties: {
                rows: { type: 'integer', description: '行数' },
                columns: { type: 'integer', description: '列数' },
                points: { type: 'string', description: '顶点坐标列表' }
            },
            required: ['rows', 'columns', 'points']
        }
    },
{
        name: 'extrude_solid',
        description: '将闭合轮廓(面域/多段线)拉伸为3D实体。可带锥度角',
        inputSchema: {
            type: 'object',
            properties: {
                profileHandle: { type: 'string', description: '轮廓实体句柄' },
                height: { type: 'number', description: '拉伸高度' },
                taperAngle: { type: 'number', description: '锥度角度（度）' }
            },
            required: ['profileHandle', 'height']
        }
    },
{
        name: 'revolve_solid',
        description: '将轮廓绕轴旋转生成3D实体。默认360度',
        inputSchema: {
            type: 'object',
            properties: {
                profileHandle: { type: 'string', description: '轮廓实体句柄' },
                axisStart: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'number' } }], description: '旋转轴起点' },
                axisEnd: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'number' } }], description: '旋转轴终点' },
                angle: { type: 'number', description: '旋转角度（默认360）' }
            },
            required: ['profileHandle', 'axisStart', 'axisEnd']
        }
    },
{
        name: 'create_3d_polyline',
        description: '创建3D多段线(顶点可含Z坐标)',
        inputSchema: {
            type: 'object',
            properties: {
                points: { type: 'string', description: '顶点坐标列表' }
            },
            required: ['points']
        }
    },
{
        name: 'create_region',
        description: '将闭合曲线转换为面域(Region)，用于布尔运算或拉伸',
        inputSchema: {
            type: 'object',
            properties: {
                handles: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }], description: '实体句柄列表' }
            },
            required: ['handles']
        }
    },
{
        name: 'boolean_union',
        description: '多个实体合并(并集)，融为一个整体',
        inputSchema: {
            type: 'object',
            properties: {
                handles: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }], description: '实体句柄列表' }
            },
            required: ['handles']
        }
    },
{
        name: 'boolean_subtract',
        description: '从一组实体中减去另一组(差集)',
        inputSchema: {
            type: 'object',
            properties: {
                handles: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }], description: '要减去的实体句柄列表' },
                subtractFromHandles: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }], description: '从中减去的实体句柄列表（可选，默认用 handles 的第一个）' }
            },
            required: ['handles']
        }
    },
{
        name: 'boolean_intersect',
        description: '只保留多个实体的重叠部分(交集)',
        inputSchema: {
            type: 'object',
            properties: {
                handles: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }], description: '实体句柄列表' }
            },
            required: ['handles']
        }
    },
{
        name: 'slice_solid',
        description: '用一个平面剖切实体。可保留一侧或两侧',
        inputSchema: {
            type: 'object',
            properties: {
                solidHandle: { type: 'string', description: '实体句柄' },
                planePoint: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'number' } }], description: '剖切面上的点' },
                planeNormal: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'number' } }], description: '剖切面法向量' },
                keepBoth: { type: 'boolean', description: '是否保留两侧' }
            },
            required: ['solidHandle', 'planePoint', 'planeNormal']
        }
    },
{
        name: 'create_loft_surface',
        description: '在多个轮廓之间创建放样曲面。可选引导线',
        inputSchema: {
            type: 'object',
            properties: {
                profileHandles: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }], description: '轮廓实体句柄列表' },
                guideHandles: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }], description: '引导线句柄列表（可选）' }
            },
            required: ['profileHandles']
        }
    },
{
        name: 'thicken_surface',
        description: '将曲面加厚为3D实体。指定厚度值',
        inputSchema: {
            type: 'object',
            properties: {
                surfaceHandle: { type: 'string', description: '曲面句柄' },
                thickness: { type: 'number', description: '厚度' }
            },
            required: ['surfaceHandle', 'thickness']
        }
    },
{
        name: 'offset_surface',
        description: '将曲面沿法向偏移指定距离',
        inputSchema: {
            type: 'object',
            properties: {
                surfaceHandle: { type: 'string', description: '曲面句柄' },
                distance: { type: 'number', description: '偏移距离' }
            },
            required: ['surfaceHandle', 'distance']
        }
    },
{
        name: 'get_3d_solid_info',
        description: '查询3D实体的体积、表面积、质心等属性',
        inputSchema: {
            type: 'object',
            properties: {
                handle: { type: 'string', description: '实体句柄' }
            },
            required: ['handle']
        }
    }
];
