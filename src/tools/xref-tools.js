export const tools = [
  {
    name: 'attach_xref',
    description: '附着外部参照(DWG引用)——将其他 DWG 文件作为外部参照插入当前图形（仅参照不嵌入）。可选附着型(attach)或覆盖型(overlay)。用户说"引用外部图/附着外部参照/链接DWG"时调用',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '被引用的 DWG 文件路径，如 "C:/projects/base.dwg"' },
        point: { type: 'string', description: '插入基点坐标，如 "0,0,0"（可选，默认 0,0,0）' },
        scale: { type: 'number', description: '缩放比例（可选，默认 1）如 0.5=缩小一半' },
        rotation: { type: 'number', description: '旋转角度度（可选，默认 0）如 90' },
        overlay: { type: 'boolean', description: '是否为覆盖型: true=覆盖型(overlay, 不嵌套传递), false=附着型(attach, 嵌套传递)（可选，默认 false 表示附着型）' }
      },
      required: ['path']
    }
  },
  {
    name: 'detach_xref',
    description: '拆离(删除)指定的外部参照——从图形中彻底移除参照及其所有依赖。不可撤销。用户说"删掉外部参照/拆离Xref"时调用。先 list_xrefs 查看名称',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '外部参照的名称（非文件名），如 "BASE_DWG"。先 list_xrefs 获取' }
      },
      required: ['name']
    }
  },
  {
    name: 'reload_xref',
    description: '重新加载外部参照——源 DWG 文件更新后刷新当前图形中的显示。用户说"刷新外部参照/更新参照"时调用。对比 unload_xref（临时卸载）',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '外部参照名称，如 "BASE_DWG"' }
      },
      required: ['name']
    }
  },
  {
    name: 'unload_xref',
    description: '临时卸载外部参照（从内存中移除显示，不删除参照定义）。可后续 reload_xref 重新加载。用户说"暂时隐藏外部参照"时调用',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '外部参照名称，如 "BASE_DWG"' }
      },
      required: ['name']
    }
  },
  {
    name: 'list_xrefs',
    description: '列出当前 DWG 中所有外部参照的名称、路径、状态(Loaded/Unloaded/NotFound)和类型(Attach/Overlay)。用户问"有哪些外部参照/引用了哪些图"时调用',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'bind_xref',
    description: '将外部参照绑定到当前图形中成为块定义——不再依赖外部文件。bind=绑定符号表(保留原图层名前缀), insert=插入方式(去掉图层名前缀)。不可逆！用户说"绑定外部参照/合并参照"时调用',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '外部参照名称，如 "BASE_DWG"' },
        bindType: { type: 'string', description: '绑定方式: "bind"=绑定（保留前缀,如 BASE$0$图层名）, "insert"=插入（去掉前缀,合并到当前图形）。默认 "bind"' }
      },
      required: ['name']
    }
  },
  {
    name: 'clip_xref',
    description: '用多边形裁剪边界裁剪外部参照的显示范围——只显示指定区域内的内容。用户说"裁剪外部参照/只显示参照的一部分"时调用',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '外部参照名称，如 "BASE_DWG"' },
        points: { type: 'string', description: '裁剪多边形顶点坐标（空格分隔），如 "0,0 100,0 100,100 0,100"' }
      },
      required: ['name', 'points']
    }
  },
  {
    name: 'path_xref',
    description: '修改外部参照的文件路径——当源 DWG 文件移动或重命名时更新引用路径。用户说"改外部参照路径/重新定位参照"时调用。配合 xref_path_relative 可批量转相对路径',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '外部参照名称，如 "BASE_DWG"' },
        newPath: { type: 'string', description: '新文件路径，如 "C:/new-location/base.dwg"' }
      },
      required: ['name', 'newPath']
    }
  }
];
