export const tools = [
  { name: 'agent_set_context', description: '在当前会话中存一个键值对，后续对话可读取。适合跨步骤传参', inputSchema: { type: 'object', properties: { key: { type: 'string', description: '键名' }, value: { type: 'string', description: '值' } }, required: ['key', 'value'] } },
  { name: 'agent_get_context', description: '读取当前会话中之前存的键值', inputSchema: { type: 'object', properties: { key: { type: 'string', description: '键名' } }, required: ['key'] } },
  { name: 'agent_list_context', description: '列出当前会话中所有键名（不含值）', inputSchema: { type: 'object', properties: {} } },
  { name: 'agent_delete_context', description: '删除当前会话中的指定键', inputSchema: { type: 'object', properties: { key: { type: 'string', description: '键名' } }, required: ['key'] } },
  { name: 'agent_clear_context', description: '清空当前会话的所有上下文', inputSchema: { type: 'object', properties: {} } },
];
