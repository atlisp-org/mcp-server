import { describe, it, expect } from 'vitest';

describe('Tool Registry', () => {
  const registered = new Map();

  it('should register a tool', () => {
    const toolDef = { name: 'test_tool', description: 'A test tool' };
    const handler = () => ({ content: [{ type: 'text', text: 'ok' }] });

    expect(registered.has(toolDef.name)).toBe(false);
    registered.set(toolDef.name, handler);
    expect(registered.has('test_tool')).toBe(true);
  });

  it('should call a registered tool', () => {
    const handler = registered.get('test_tool');
    expect(handler).toBeDefined();
    const result = handler();
    expect(result.content[0].text).toBe('ok');
  });
});
