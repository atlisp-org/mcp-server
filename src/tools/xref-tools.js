export const tools = [
  {
    name: 'attach_xref',
    description: '附着外部参照',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'DWG 文件路径' },
        point: { type: 'string', description: '插入点，如 0,0,0（可选）' },
        scale: { type: 'number', description: '缩放比例（可选，默认 1）' },
        rotation: { type: 'number', description: '旋转角度（可选，默认 0）' },
        overlay: { type: 'boolean', description: '是否为覆盖型（可选，默认 false 表示附着型）' }
      },
      required: ['path']
    }
  },
  {
    name: 'detach_xref',
    description: '拆离外部参照',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '外部参照名称' }
      },
      required: ['name']
    }
  },
  {
    name: 'reload_xref',
    description: '重载外部参照',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '外部参照名称' }
      },
      required: ['name']
    }
  },
  {
    name: 'unload_xref',
    description: '卸载外部参照',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '外部参照名称' }
      },
      required: ['name']
    }
  },
  {
    name: 'list_xrefs',
    description: '列出所有外部参照',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'bind_xref',
    description: '绑定外部参照',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '外部参照名称' },
        bindType: { type: 'string', description: '绑定类型: bind（绑定）/ insert（插入），默认 bind' }
      },
      required: ['name']
    }
  },
  {
    name: 'clip_xref',
    description: '裁剪外部参照',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '外部参照名称' },
        points: { type: 'string', description: '裁剪边界点序列，如 0,0 100,0 100,100 0,100' }
      },
      required: ['name', 'points']
    }
  },
  {
    name: 'path_xref',
    description: '修改外部参照路径',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '外部参照名称' },
        newPath: { type: 'string', description: '新路径' }
      },
      required: ['name', 'newPath']
    }
  }
];
