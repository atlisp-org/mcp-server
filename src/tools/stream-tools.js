export const tools = [
  {
    name: 'stream_entities',
    description: 'Stream entities by type/layer with pagination. 按类型和图层分页流式读取实体数据。',
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
    description: 'Stream text content (TEXT/MTEXT) with pagination. 分页流式读取文字内容。',
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
    description: 'Stream block references with pagination. 分页流式读取块参照。',
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
