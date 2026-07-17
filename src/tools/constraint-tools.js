export const tools = [
  {
    name: 'add_geom_constraint',
    description: '在两个实体间添加几何约束(平行/垂直/相切/共线/同心/水平/竖直/固定/对称/相等)。当用户需要限制实体间几何关系时调用。示例：Parallel(平行)使两条线始终平行。结合 add_dim_constraint 使用可实现完整参数化设计',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: '几何约束类型：Parallel(平行)/Perpendicular(垂直)/Tangent(相切)/Collinear(共线)/Concentric(同心)/Horizontal(水平)/Vertical(竖直)/Fix(固定)/Symmetric(对称)/Equal(相等)。必填' },
        handle1: { type: 'string', description: '第一个实体的句柄。参与约束的主实体。通过 select_entities 或 get_entity 获取' },
        handle2: { type: 'string', description: '第二个实体的句柄（Fix 固定约束不需要此参数）。约束的从实体。通过 select_entities 获取' },
        point1: { type: 'string', description: '第一个实体上的约束点坐标，如 "50,50"（可选，默认使用实体中心/端点）' },
        point2: { type: 'string', description: '第二个实体上的约束点坐标（可选，角度/对称约束可能需要）' }
      },
      required: ['type', 'handle1']
    }
  },
  {
    name: 'add_dim_constraint',
    description: '添加标注约束(尺寸驱动)，通过数值驱动几何形状。当用户说"添加尺寸约束/参数化标注"时调用。需先用 list_constraints 查看已有约束。结合 add_geom_constraint 实现完整参数化',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: '标注约束类型：Aligned(对齐)/Horizontal(水平)/Vertical(垂直)/Radius(半径)/Diameter(直径)/Angular(角度)。必填' },
        handle: { type: 'string', description: '要约束的实体句柄。通过 get_entity 或 select_entities 获取' },
        value: { type: 'number', description: '约束数值，如 100.0。正值，单位与图形单位一致。范围 > 0' },
        point1: { type: 'string', description: '第一个约束点坐标，如 "0,0"（可选，Aligned/Linear 需要两个点）' },
        point2: { type: 'string', description: '第二个约束点坐标（可选，Angular 角度标注需要）' }
      },
      required: ['type', 'handle', 'value']
    }
  },
  {
    name: 'del_constraint',
    description: '删除实体上的所有几何和标注约束，恢复自由编辑。当用户说"删除约束/解除约束"时调用。⚠️ 不可撤销。操作后实体恢复可自由编辑状态。用 list_constraints 先查看后谨慎删除',
    inputSchema: {
      type: 'object',
      properties: {
        handle: { type: 'string', description: '要删除约束的实体句柄。通过 get_entity 或 select_entities 获取' }
      },
      required: ['handle']
    }
  },
  {
    name: 'list_constraints',
    description: '列出当前DWG中所有已定义的约束（几何约束+标注约束）。当用户说"有哪些约束/查看约束"时调用。返回约束列表含类型、关联实体等。操作前先查看可避免约束冲突',
    inputSchema: { type: 'object', properties: {} }
  }
];
