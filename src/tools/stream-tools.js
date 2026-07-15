export const tools = [
  {
    name: 'stream_entities',
    description: '分页读取实体数据。按type(实体类型)和/或layer(图层)过滤。offset/limit控制分页。适合大批量获取',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: '实体类型（如 LINE, CIRCLE, TEXT），可选' },
        layer: { type: 'string', description: '图层名称，可选' },
        chunk: { type: 'number', description: '每页数量，默认 100' },
        offset: { type: 'number', description: '偏移量，默认 0' }
      }
    }
  },
  {
    name: 'stream_text',
    description: '分页读取文字内容(TEXT/MTEXT)。可选按图层过滤',
    inputSchema: {
      type: 'object',
      properties: {
        layer: { type: 'string', description: '图层名称，可选' },
        offset: { type: 'number', description: '偏移量，默认 0' },
        limit: { type: 'number', description: '每页数量，默认 100' }
      }
    }
  },
  {
    name: 'stream_block_refs',
    description: '分页读取块参照数据。可选按blockName过滤',
    inputSchema: {
      type: 'object',
      properties: {
        blockName: { type: 'string', description: '块名称，可选' },
        offset: { type: 'number', description: '偏移量，默认 0' },
        limit: { type: 'number', description: '每页数量，默认 100' }
      }
    }
  },

];
