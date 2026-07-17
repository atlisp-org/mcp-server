export const tools = [
  { name: 'agent_set_context', description: '在当前会话中存一个键值对，后续对话可读取。用于跨步骤传参，如先保存用户目标再后续读取执行。用户说"记住XX/保存XX信息/暂存"时调用', inputSchema: { type: 'object', properties: { key: { type: 'string', description: '键名，如 "targetLayer"、"lastHandle"、"userChoice"、"blockName"' }, value: { type: 'string', description: '要存储的值，如图层名、句柄、用户选择结果' } }, required: ['key', 'value'] } },
  { name: 'agent_get_context', description: '读取当前会话中之前存的键值。用于恢复跨步骤数据。用户说"之前存的XX是什么/查一下XX/取出来"时调用', inputSchema: { type: 'object', properties: { key: { type: 'string', description: '要读取的键名，如 "targetLayer"。先用 agent_list_context 查看所有可用键名' } }, required: ['key'] } },
  { name: 'agent_list_context', description: '列出当前会话中所有已存的键名（不含值）。用户说"我之前存了什么/查一下上下文"时调用。再通过 agent_get_context 读取具体值', inputSchema: { type: 'object', properties: {} } },
  { name: 'agent_delete_context', description: '删除当前会话中的指定键值对。用户说"删掉XX/清除XX这个"时调用。不会影响其他已存键', inputSchema: { type: 'object', properties: { key: { type: 'string', description: '要删除的键名' } }, required: ['key'] } },
  { name: 'agent_clear_context', description: '清空当前会话的所有上下文，重置所有跨步骤状态。用户说"重置/重新开始/清空/重来"时调用。不可恢复', inputSchema: { type: 'object', properties: {} } },
];
