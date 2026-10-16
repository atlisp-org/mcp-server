import { withCadConnection, mcpSuccess, mcpError } from '../handler-utils.js';
import {
  createSession, getSession, closeSession,
  loadHelpers, fastForward, executeStep, continueExecution, evaluateExpression,
} from '../debug-engine.js';

export const debugStart = withCadConnection(async (args) => {
  try {
    const { code, chunks, encoding } = args || {};
    if (!code) return mcpError('Missing required argument: code');
    if (!chunks || !Array.isArray(chunks)) return mcpError('Missing required argument: chunks (must be an array)');

    const sessionId = await createSession(code, chunks, encoding);
    const session = getSession(sessionId);
    if (!session) return mcpError('Failed to create debug session');

    await loadHelpers(session);

    const ffResult = await fastForward(session);

    if (session.state === 'error') {
      await closeSession(sessionId);
      return mcpError(session.error);
    }

    return mcpSuccess(JSON.stringify({
      sessionId,
      totalChunks: session.totalChunks,
      ...ffResult,
    }));
  } catch (e) {
    return mcpError(e.message);
  }
});

export const debugStep = withCadConnection(async (args) => {
  try {
    const { sessionId, action } = args || {};
    if (!sessionId) return mcpError('Missing required argument: sessionId');
    if (!action) return mcpError('Missing required argument: action');

    const session = getSession(sessionId);
    if (!session) return mcpError(`Debug session not found: ${sessionId}`);

    if (session.state !== 'paused' && session.state !== 'ready') {
      return mcpError(`Invalid state: ${session.state} (expected paused or ready)`);
    }

    let result;
    if (action === 'step') {
      result = await executeStep(session);
    } else if (action === 'continue') {
      result = await continueExecution(session);
    } else {
      return mcpError(`Invalid action: ${action} (expected step or continue)`);
    }

    if (session.state === 'error') {
      return mcpError(session.error);
    }

    return mcpSuccess(JSON.stringify(result));
  } catch (e) {
    return mcpError(e.message);
  }
});

export const debugEvaluate = withCadConnection(async (args) => {
  try {
    const { sessionId, expression } = args || {};
    if (!sessionId) return mcpError('Missing required argument: sessionId');
    if (!expression) return mcpError('Missing required argument: expression');

    const session = getSession(sessionId);
    if (!session) return mcpError(`Debug session not found: ${sessionId}`);

    if (session.state !== 'paused') {
      return mcpError(`Invalid state: ${session.state} (expected paused)`);
    }

    const result = await evaluateExpression(session, expression);
    if (result.error) return mcpError(result.error);

    return mcpSuccess(JSON.stringify({ value: result.value }));
  } catch (e) {
    return mcpError(e.message);
  }
});

export async function debugGetState(args) {
  try {
    const { sessionId } = args || {};
    if (!sessionId) return mcpError('Missing required argument: sessionId');

    const session = getSession(sessionId);
    if (!session) return mcpError(`Debug session not found: ${sessionId}`);

    const checkpoint = session.lastCheckpoint;
    return mcpSuccess(JSON.stringify({
      state: session.state,
      currentIndex: session.currentIndex,
      totalChunks: session.totalChunks,
      currentCheckpoint: checkpoint || undefined,
      error: session.error,
    }));
  } catch (e) {
    return mcpError(e.message);
  }
}

export async function debugStop(args) {
  try {
    const { sessionId } = args || {};
    if (!sessionId) return mcpError('Missing required argument: sessionId');

    const session = getSession(sessionId);
    if (!session) {
      return mcpError(`Debug session not found: ${sessionId}`);
    }

    const ok = await closeSession(sessionId);
    return mcpSuccess(JSON.stringify({ success: ok }));
  } catch (e) {
    return mcpError(e.message);
  }
}
