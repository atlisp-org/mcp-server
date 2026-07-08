import { cad, _setInstanceResolver } from './cad.js';
import { pool } from './cad-pool.js';
import { mcpContext } from './mcp-server-state.js';

_setInstanceResolver(() => {
  const ctx = mcpContext.getStore();
  if (!ctx) return null;
  const targetKey = ctx._toolInstance || ctx.instanceKey || null;
  if (!targetKey) return null;
  return pool.getConnection(targetKey) || null;
});
