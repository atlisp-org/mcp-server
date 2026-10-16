// =============================================================================
// frame-handlers.js — 图框识别 handler（list_frames）
//
// 唯一实现在 resource-snapshot.js 的 getFrames()（与资源 atlisp://dwg/frames 共用，
// 避免资源/工具两套 LISP 与解析逻辑漂移）；这里只做「契约响应 → MCP 工具结果」的包装：
// content 是 JSON 文本（向后兼容）+ structuredContent（声明了 outputSchema 的工具必须两者都给）。
// =============================================================================
import { mcpError } from '../handler-utils.js';
import { getFrames } from './resource-snapshot.js';

export async function listFrames(args = {}) {
  let result;
  try {
    result = await getFrames(args || {});
  } catch (e) {
    return mcpError(`图框识别失败: ${e.message}`);
  }

  // 连接失败/识别失败：结构化结果不可用（isError 结果不带 structuredContent，
  // 客户端会跳过 outputSchema 校验），只回文本错误信息并保留原因链。
  if (result.connected === false || result.error) {
    const reason = result.error || '图框识别失败';
    return mcpError(result.connected === false ? `未连接 CAD：${reason}` : `图框识别失败：${reason}`);
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    structuredContent: result,
  };
}
