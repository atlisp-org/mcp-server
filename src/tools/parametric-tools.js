export const tools = [
  {
    name: 'get_dynamic_block_properties',
    description: '获取动态块所有属性（可见性状态、拉伸点、翻转状态等）',
    inputSchema: {
      type: 'object',
      properties: {
        blockHandle: { type: 'string', description: '块引用实体句柄' }
      },
      required: ['blockHandle']
    }
  },
  {
    name: 'set_dynamic_block_property',
    description: '设置动态块属性值',
    inputSchema: {
      type: 'object',
      properties: {
        blockHandle: { type: 'string', description: '块引用实体句柄' },
        propertyName: { type: 'string', description: '属性名称' },
        value: { type: 'string', description: '属性值' }
      },
      required: ['blockHandle', 'propertyName', 'value']
    }
  },
  {
    name: 'get_block_parameters',
    description: '获取块参数及其当前值',
    inputSchema: {
      type: 'object',
      properties: {
        blockHandle: { type: 'string', description: '块引用实体句柄' }
      },
      required: ['blockHandle']
    }
  },
  {
    name: 'set_block_parameter',
    description: '设置块参数值',
    inputSchema: {
      type: 'object',
      properties: {
        blockHandle: { type: 'string', description: '块引用实体句柄' },
        parameterName: { type: 'string', description: '参数名称' },
        value: { type: 'string', description: '参数值' }
      },
      required: ['blockHandle', 'parameterName', 'value']
    }
  },
  {
    name: 'list_visibility_states',
    description: '列出动态块的可见性状态',
    inputSchema: {
      type: 'object',
      properties: {
        blockHandle: { type: 'string', description: '块引用实体句柄' }
      },
      required: ['blockHandle']
    }
  },
  {
    name: 'set_visibility_state',
    description: '设置动态块当前可见性状态',
    inputSchema: {
      type: 'object',
      properties: {
        blockHandle: { type: 'string', description: '块引用实体句柄' },
        stateName: { type: 'string', description: '可见性状态名称' }
      },
      required: ['blockHandle', 'stateName']
    }
  }
];
