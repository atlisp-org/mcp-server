import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/cad.js', () => ({
  cad: {
    connected: true,
    sendCommandWithResult: vi.fn().mockResolvedValue('((("LINE" . 10) ("CIRCLE" . 5)))'),
  },
  resolveCadConnection: vi.fn(),
}));

vi.mock('../src/logger.js', () => ({ log: vi.fn() }));

const { listPrompts, getPrompt } = await import('../src/handlers/prompt-handlers.js');

describe('prompt-handlers', () => {
  describe('listPrompts', () => {
    it('returns at least the 14 built-in prompts', async () => {
      const prompts = await listPrompts();
      expect(prompts.length).toBeGreaterThanOrEqual(14);
    });

    it('each prompt has name and description', async () => {
      const prompts = await listPrompts();
      for (const p of prompts) {
        expect(p).toHaveProperty('name');
        expect(p).toHaveProperty('description');
      }
    });

    it('includes analyze-drawing prompt', async () => {
      const prompts = await listPrompts();
      const names = prompts.map(p => p.name);
      expect(names).toContain('analyze-drawing');
      expect(names).toContain('manage-layers');
      expect(names).toContain('string-process');
    });
  });

  describe('getPrompt', () => {
    it('returns analyze-drawing prompt messages', async () => {
      const result = await getPrompt('analyze-drawing');
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe('user');
      expect(result.messages[0].content.type).toBe('text');
      expect(result.messages[0].content.text).toContain('图纸分析');
    });

    it('returns batch-draw-lines with defaults', async () => {
      const result = await getPrompt('batch-draw-lines', {});
      expect(result.messages[0].content.text).toContain('批量绘制');
    });

    it('returns batch-draw-lines with custom args', async () => {
      const result = await getPrompt('batch-draw-lines', { count: '10', length: '500' });
      expect(result.messages[0].content.text).toContain('10');
      expect(result.messages[0].content.text).toContain('500');
    });

    it('throws for unknown prompt', async () => {
      await expect(getPrompt('nonexistent-prompt', {})).rejects.toThrow('Unknown prompt');
    });
  });

  describe('generated prompts contain LISP code', () => {
    it('manage-layers list contains lisp code', async () => {
      const result = await getPrompt('manage-layers', { action: 'list' });
      expect(result.messages[0].content.text).toContain('lisp');
    });

    it('string-process format prompt works', async () => {
      const result = await getPrompt('string-process', { action: 'format', input: 'Hello {0}', arg1: 'World' });
      expect(result.messages[0].content.text).toContain('Hello');
      expect(result.messages[0].content.text).toContain('World');
    });
  });
});
