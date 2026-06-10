export const tools = [
  { name: 'agent_set_context', description: '在会话中存储键值对', inputSchema: { type: 'object', properties: { key: { type: 'string', description: '键名' }, value: { type: 'string', description: '值' } }, required: ['key', 'value'] } },
  { name: 'agent_get_context', description: '从会话中获取值', inputSchema: { type: 'object', properties: { key: { type: 'string', description: '键名' } }, required: ['key'] } },
  { name: 'agent_list_context', description: '列出会话中的所有键', inputSchema: { type: 'object', properties: {} } },
  { name: 'agent_delete_context', description: '删除会话中的键', inputSchema: { type: 'object', properties: { key: { type: 'string', description: '键名' } }, required: ['key'] } },
  { name: 'agent_clear_context', description: '清除当前会话的所有上下文', inputSchema: { type: 'object', properties: {} } },
];
