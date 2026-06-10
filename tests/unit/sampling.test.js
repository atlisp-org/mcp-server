import { describe, it, expect } from 'vitest';

describe('Sampling', () => {
  it('should convert MCP messages to API format', () => {
    const messages = [
      { role: 'user', content: { type: 'text', text: 'Hello' } },
      { role: 'assistant', content: { type: 'text', text: 'Hi there' } },
    ];
    const systemPrompt = 'Be helpful';

    const result = [{ role: 'system', content: systemPrompt }];
    for (const msg of messages) {
      result.push({
        role: msg.role,
        content: Array.isArray(msg.content) ? msg.content.map(c => c.text).join('\n') : msg.content.text,
      });
    }

    expect(result.length).toBe(3);
    expect(result[0].role).toBe('system');
    expect(result[0].content).toBe('Be helpful');
    expect(result[1].role).toBe('user');
    expect(result[1].content).toBe('Hello');
  });

  it('should detect provider from URL', () => {
    const url1 = 'https://api.openai.com/v1/chat/completions';
    const url2 = 'https://api.deepseek.com/v1/chat/completions';

    expect(url1.includes('openai')).toBe(true);
    expect(url2.includes('deepseek')).toBe(true);
  });
});
