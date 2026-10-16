// tool-registry.js 真实单测（旧 tests/unit/tool-registry.test.js 只测了内存 Map，未 import 源码）
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerTool, callCustomTool } from '../../src/tool-registry.js';
import { tools } from '../../src/tools/index.js';

let counter = 0;

describe('tool-registry', () => {
  beforeEach(() => {
    counter++;
  });

  it('registerTool 注册后加入全局 tools 列表并返回 true', () => {
    const name = `reg_tool_${counter}`;
    const toolDef = { name, description: '注册测试工具', inputSchema: { type: 'object', properties: {} } };
    const handler = vi.fn(() => ({ content: [{ type: 'text', text: 'ok' }] }));

    expect(registerTool(toolDef, handler)).toBe(true);
    expect(tools.some(t => t.name === name)).toBe(true);

    const result = callCustomTool(name, { a: 1 });
    expect(result.content[0].text).toBe('ok');
    expect(handler).toHaveBeenCalledWith({ a: 1 });
  });

  it('缺少 name 的工具定义抛错', () => {
    expect(() => registerTool(null, () => {})).toThrow('Tool definition must have a name');
    expect(() => registerTool({}, () => {})).toThrow('Tool definition must have a name');
  });

  it('重复注册同名工具抛错且不覆盖已有 handler', () => {
    const name = `dup_tool_${counter}`;
    const first = vi.fn(() => ({ content: [{ type: 'text', text: 'first' }] }));
    registerTool({ name, inputSchema: {} }, first);

    expect(() => registerTool({ name, inputSchema: {} }, vi.fn()))
      .toThrow(`Tool "${name}" is already registered`);

    expect(callCustomTool(name, {}).content[0].text).toBe('first');
  });

  it('未注册的工具 callCustomTool 返回 null；args 缺省为 {}', () => {
    expect(callCustomTool(`missing_tool_${counter}`)).toBeNull();

    const name = `noargs_tool_${counter}`;
    const handler = vi.fn(() => ({ content: [] }));
    registerTool({ name, inputSchema: {} }, handler);
    callCustomTool(name);
    expect(handler).toHaveBeenCalledWith({});
  });
});
