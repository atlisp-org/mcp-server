export const tools = [
{
        name: 'create_box',
        description: '创建长方体 3D 实体',
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
        description: '创建球体 3D 实体',
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
        description: '创建圆柱体 3D 实体',
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
        description: '创建圆锥体 3D 实体',
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
        description: '创建圆环体 3D 实体',
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
        description: '创建楔体 3D 实体',
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
        description: '创建 3D 面',
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
        description: '创建网格',
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
        description: '拉伸成实体',
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
        description: '旋转成实体',
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
        description: '创建 3D 多段线',
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
        description: '创建面域',
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
        description: '布尔运算 - 并集',
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
        description: '布尔运算 - 差集',
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
        description: '布尔运算 - 交集',
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
        description: '剖切实体',
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
        description: '创建放样曲面',
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
        description: '曲面加厚成实体',
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
        description: '曲面偏移',
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
        description: '获取 3D 实体信息（体积、表面积等）',
        inputSchema: {
            type: 'object',
            properties: {
                handle: { type: 'string', description: '实体句柄' }
            },
            required: ['handle']
        }
    }
];
