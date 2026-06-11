import { cad } from '../cad.js';
import { log, error as logError } from '../logger.js';
import { mcpSuccess, mcpError, ensureCadConnected } from '../handler-utils.js';
import { handleToolCall } from '../mcp-tools.js';

export async function batchTransaction({ operations }) {
  try {
    await ensureCadConnected();

    if (!operations || !Array.isArray(operations) || operations.length === 0) {
      return mcpError('operations 必须是非空数组');
    }

    log(`batch_transaction: starting ${operations.length} operations`);

    await cad.sendCommand('(command "_.UNDO" "_BEGIN")');

    const results = [];
    let hasError = false;

    for (let i = 0; i < operations.length; i++) {
      const op = operations[i];
      log(`batch_transaction: step ${i + 1}/${operations.length} -> ${op.tool}`);

      try {
        const result = await handleToolCall(op.tool, op.args || {});
        results.push({
          step: i,
          tool: op.tool,
          success: !result.isError,
          result,
        });
        if (result.isError) {
          hasError = true;
        }
      } catch (e) {
        logError(`batch_transaction: step ${i} (${op.tool}) threw: ${e.message}`);
        results.push({
          step: i,
          tool: op.tool,
          success: false,
          error: e.message,
        });
        hasError = true;
      }
    }

    try {
      await cad.sendCommand('(command "_.UNDO" "_END")');
    } catch (e) {
      logError(`batch_transaction: UNDO _END failed: ${e.message}`);
    }

    if (hasError) {
      try {
        await cad.sendCommand('(command "_.UNDO" "1")');
        log('batch_transaction: rolled back due to errors');
      } catch (e) {
        logError(`batch_transaction: UNDO rollback failed: ${e.message}`);
      }
      return mcpError(`批量事务部分操作失败，已回滚: ${JSON.stringify(results)}`);
    }

    log(`batch_transaction: all ${operations.length} operations succeeded`);
    return mcpSuccess(JSON.stringify(results));
  } catch (e) {
    logError(`batch_transaction: outer error: ${e.message}`);
    return mcpError(`批量事务错误: ${e.message}`);
  }
}
