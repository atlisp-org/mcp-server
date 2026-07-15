export const tools = [
  {
    name: 'attach_xref',
    description: '附着外部参照(DWG引用)。用户可以选附着型(attach)或覆盖型(overlay)',
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
    description: '拆离指定外部参照',
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
    description: '重新加载外部参照（源文件变更后刷新显示）',
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
    description: '临时卸载外部参照（不删除，可重新加载）',
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
    description: '列出当前DWG中所有外部参照及其状态',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'bind_xref',
    description: '将外部参照绑定到当前图形成为块定义。bind=绑定符号表, insert=插入方式',
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
    description: '用多边形裁剪边界裁剪外部参照的显示范围',
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
    description: '修改外部参照的路径（文件位置变更时使用）',
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
