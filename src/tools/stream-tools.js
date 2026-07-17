export const tools = [
  {
    name: 'stream_entities',
    description: '分页读取当前图形的实体数据，支持按类型和/或图层过滤。当用户说"列出所有实体/获取图元数据"时调用。返回实体列表含句柄/类型/图层/坐标等。offset/chunk 控制分页。适合大批量获取（上限50000实体）。对比 select_entities 只返回句柄，本工具返回完整属性',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: '实体类型过滤，如 "LINE"、"CIRCLE"、"TEXT"、"ARC"、"LWPOLYLINE"、"INSERT(块参照)"。可选，不传返回所有类型' },
        layer: { type: 'string', description: '图层名称过滤，只返回该图层上的实体。可选，不传返回所有图层。如 "0"、"墙体"、"标注"' },
        chunk: { type: 'number', description: '每页返回的实体数量，默认 100，范围 1-5000。值越大单次返回数据越多但响应越慢' },
        offset: { type: 'number', description: '分页偏移量(从第几个开始)，默认 0。配合 chunk 实现翻页：下一页 offset+=chunk' }
      }
    }
  },
  {
    name: 'stream_text',
    description: '分页读取当前图形中的文字内容(TEXT单行文字/MTEXT多行文字)，按图层过滤可选。当用户说"列出所有文字/获取文本内容"时调用。返回文字实体的句柄、内容字符串、插入点等。配合 find_text 搜索特定文字',
    inputSchema: {
      type: 'object',
      properties: {
        layer: { type: 'string', description: '图层名称过滤，只返回该图层上的文字。可选，如 "文字"、"标注"。不传返回所有图层文字' },
        offset: { type: 'number', description: '分页偏移量，默认 0。配合 limit 翻页：下一页 offset+=limit' },
        limit: { type: 'number', description: '每页文字数量，默认 100，范围 1-5000' }
      }
    }
  },
  {
    name: 'stream_block_refs',
    description: '分页读取当前图形中的块参照数据，可按块名过滤。当用户说"列出块实例/获取块参照数据"时调用。返回块名称、插入点、旋转角度、缩放比例、属性等。配合 get_block_attributes 获取单个块属性详情',
    inputSchema: {
      type: 'object',
      properties: {
        blockName: { type: 'string', description: '块名称过滤，如 "门"、"窗"、"A1图框"。可选，不传返回所有块参照。从 get_blocks 获取可用块名列表' },
        offset: { type: 'number', description: '分页偏移量，默认 0。配合 limit 翻页：下一页 offset+=limit' },
        limit: { type: 'number', description: '每页块参照数量，默认 100，范围 1-5000' }
      }
    }
  },

];
