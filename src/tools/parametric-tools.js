export const tools = [
  {
    name: 'get_dynamic_block_properties',
    description: '获取动态块的所有可调属性（可见性/拉伸/翻转/对齐等参数列表及当前值）。当用户说"查看动态块属性/这个块能调什么"时调用。返回属性名、类型、当前值列表。配合 set_dynamic_block_property 使用',
    inputSchema: {
      type: 'object',
      properties: {
        blockHandle: { type: 'string', description: '块参照实体句柄。通过 select_entities 或 get_entity 获取。注意：必须是动态块实例，非普通块参照' }
      },
      required: ['blockHandle']
    }
  },
  {
    name: 'set_dynamic_block_property',
    description: '修改动态块的属性值（修改尺寸/切换可见性状态/翻转等）。当用户说"改动态块/拉伸块/切换可见性"时调用。⚠️ 不可撤销。先调用 get_dynamic_block_properties 获取可用属性名和合法值范围',
    inputSchema: {
      type: 'object',
      properties: {
        blockHandle: { type: 'string', description: '块参照实体句柄。通过 get_entity 或 select_entities 获取' },
        propertyName: { type: 'string', description: '要修改的属性名称。从 get_dynamic_block_properties 返回值中获取。区分大小写' },
        value: { type: 'string', description: '属性新值。字符串格式：数值直接传数字字符串如"2000"，可见性传状态名如"开启"。根据 get_dynamic_block_properties 返回的可用值列表填写' }
      },
      required: ['blockHandle', 'propertyName', 'value']
    }
  },
  {
    name: 'get_block_parameters',
    description: '获取块的所有参数化参数（ParametricConstraint参数）及其当前值。当用户说"查看块参数/参数值"时调用。返回参数名、表达式、当前值列表。配合 set_block_parameter 修改参数值',
    inputSchema: {
      type: 'object',
      properties: {
        blockHandle: { type: 'string', description: '块参照实体句柄。通过 select_entities 获取。注意：与动态块属性(get_dynamic_block_properties)不同，这是参数化约束参数' }
      },
      required: ['blockHandle']
    }
  },
  {
    name: 'set_block_parameter',
    description: '设置块参数化参数(ParametricConstraint)的值。当用户说"改参数值/设置参数"时调用。先调用 get_block_parameters 获取参数名。⚠️ 不可撤销，修改后参数表达式会更新',
    inputSchema: {
      type: 'object',
      properties: {
        blockHandle: { type: 'string', description: '块参照实体句柄。通过 get_entity 或 select_entities 获取' },
        parameterName: { type: 'string', description: '参数名称。从 get_block_parameters 返回值中获取。区分大小写，如 "d1"、"角度1"' },
        value: { type: 'string', description: '参数新值。数值字符串，如 "150.0"。单位与图形单位一致' }
      },
      required: ['blockHandle', 'parameterName', 'value']
    }
  },
  {
    name: 'list_visibility_states',
    description: '列出动态块的所有可见性状态名称列表。当用户说"有哪些可见性状态/这个块有多少种显示方式"时调用。返回字符串数组。配合 set_visibility_state 切换可见性',
    inputSchema: {
      type: 'object',
      properties: {
        blockHandle: { type: 'string', description: '块参照实体句柄。必须是动态块且包含可见性参数。通过 select_entities 获取' }
      },
      required: ['blockHandle']
    }
  },
  {
    name: 'set_visibility_state',
    description: '切换动态块的可见性状态，显示/隐藏块的不同部分。当用户说"切换显示状态/显示XX部分/隐藏XX"时调用。先调用 list_visibility_states 获取可用状态名列表。⚠️ 不可撤销',
    inputSchema: {
      type: 'object',
      properties: {
        blockHandle: { type: 'string', description: '块参照实体句柄。必须是含可见性参数的动态块。通过 select_entities 获取' },
        stateName: { type: 'string', description: '可见性状态名称。从 list_visibility_states 返回值中获取。区分大小写，如 "开启"、"关闭"、"款式A"' }
      },
      required: ['blockHandle', 'stateName']
    }
  }
];
