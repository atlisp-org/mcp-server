export const tools = [
  {
    name: 'add_geom_constraint',
    description: '在两个实体间添加几何约束(平行/垂直/相切/共线/同心/水平/竖直/固定/对称/相等)',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: '约束类型: Parallel/Perpendicular/Tangent/Collinear/Concentric/Horizontal/Vertical/Fix/Symmetric/Equal' },
        handle1: { type: 'string', description: '第一个实体的句柄' },
        handle2: { type: 'string', description: '第二个实体的句柄（可选，Fix 不需要）' },
        point1: { type: 'string', description: '第一个实体上的约束点（可选）' },
        point2: { type: 'string', description: '第二个实体上的约束点（可选）' }
      },
      required: ['type', 'handle1']
    }
  },
  {
    name: 'add_dim_constraint',
    description: '添加标注约束(尺寸驱动)，指定类型、值和约束点',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: '约束类型: Aligned/Horizontal/Vertical/Radius/Diameter/Angular' },
        handle: { type: 'string', description: '实体句柄' },
        value: { type: 'number', description: '约束值' },
        point1: { type: 'string', description: '第一个约束点（可选）' },
        point2: { type: 'string', description: '第二个约束点（可选，角度需要）' }
      },
      required: ['type', 'handle', 'value']
    }
  },
  {
    name: 'del_constraint',
    description: '删除实体上的所有几何和标注约束',
    inputSchema: {
      type: 'object',
      properties: {
        handle: { type: 'string', description: '实体句柄' }
      },
      required: ['handle']
    }
  },
  {
    name: 'list_constraints',
    description: '列出当前DWG中所有已定义的约束',
    inputSchema: { type: 'object', properties: {} }
  }
];
