import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/logger.js', () => ({
  log: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}));

import config from '../../src/config.js';
import { createSamplingMessage } from '../../src/sampling.js';

const saved = {};
const CONFIG_KEYS = ['llmApiKey', 'llmApiUrl', 'llmModel', 'llmMaxTokens', 'llmTemperature'];

describe('sampling', () => {
  let fetchMock;

  beforeEach(() => {
    for (const k of CONFIG_KEYS) saved[k] = config[k];
    config.llmApiKey = '';
    config.llmApiUrl = 'https://api.openai.com/v1/chat/completions';
    config.llmModel = 'gpt-test';
    config.llmMaxTokens = 100;
    config.llmTemperature = 0.5;
    delete process.env.OPENAI_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    for (const k of CONFIG_KEYS) config[k] = saved[k];
    vi.restoreAllMocks();
  });

  describe('createSamplingMessage echo (no API key)', () => {
    it('returns echo response for array content', async () => {
      const result = await createSamplingMessage({
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }, { type: 'text', text: 'World' }] }],
      });
      expect(result.model).toBe('echo');
      expect(result.role).toBe('assistant');
      expect(result.stopReason).toBe('endTurn');
      expect(result.content.text).toBe('[echo] Hello World');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns echo response for object content', async () => {
      const result = await createSamplingMessage({
        messages: [{ role: 'user', content: { type: 'text', text: 'Hi' } }],
      });
      expect(result.content.text).toBe('[echo] Hi');
    });

    it('returns empty echo when messages empty', async () => {
      const result = await createSamplingMessage({ messages: [] });
      expect(result.content.text).toBe('[echo] ');
    });
  });

  describe('createSamplingMessage API call', () => {
    function okResponse(content, finishReason = 'stop', model) {
      return {
        ok: true,
        json: async () => ({ model, choices: [{ message: { content }, finish_reason: finishReason }] }),
      };
    }

    it('sends request with config defaults and maps endTurn', async () => {
      config.llmApiKey = 'sk-test';
      fetchMock.mockResolvedValue(okResponse('Answer', 'stop', 'gpt-test'));
      const result = await createSamplingMessage({
        messages: [{ role: 'user', content: 'ping' }],
        systemPrompt: 'Be brief',
      });
      expect(result.model).toBe('gpt-test');
      expect(result.content.text).toBe('Answer');
      expect(result.stopReason).toBe('endTurn');

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.openai.com/v1/chat/completions');
      expect(init.headers.Authorization).toBe('Bearer sk-test');
      const body = JSON.parse(init.body);
      expect(body.model).toBe('gpt-test');
      expect(body.max_tokens).toBe(100);
      expect(body.temperature).toBe(0.5);
      expect(body.stream).toBe(false);
      expect(body.messages).toEqual([
        { role: 'system', content: 'Be brief' },
        { role: 'user', content: 'ping' },
      ]);
    });

    it('omits system message when systemPrompt falsy', async () => {
      config.llmApiKey = 'sk-test';
      fetchMock.mockResolvedValue(okResponse('ok'));
      await createSamplingMessage({ messages: [{ role: 'user', content: 'x' }] });
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.messages[0].role).toBe('user');
    });

    it('joins array content parts and skips non-text parts', async () => {
      config.llmApiKey = 'sk-test';
      fetchMock.mockResolvedValue(okResponse('ok'));
      await createSamplingMessage({
        messages: [{
          role: 'user',
          content: [{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }],
        }],
      });
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.messages[0].content).toBe('a\n\nb');
    });

    it('defaults missing role to user', async () => {
      config.llmApiKey = 'sk-test';
      fetchMock.mockResolvedValue(okResponse('ok'));
      await createSamplingMessage({ messages: [{ content: 'x' }] });
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.messages[0].role).toBe('user');
    });

    it('honors modelPreferences, maxTokens, temperature, stopSequences overrides', async () => {
      config.llmApiKey = 'sk-test';
      fetchMock.mockResolvedValue(okResponse('ok'));
      const result = await createSamplingMessage({
        messages: [{ role: 'user', content: 'x' }],
        maxTokens: 42,
        temperature: 0,
        stopSequences: ['\n\n'],
        modelPreferences: { hints: [{ name: 'custom-model' }] },
      });
      expect(result.model).toBe('custom-model');
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.model).toBe('custom-model');
      expect(body.max_tokens).toBe(42);
      expect(body.temperature).toBe(0);
      expect(body.stop).toEqual(['\n\n']);
    });

    it('maps finish_reason length to maxTokens and others pass through', async () => {
      config.llmApiKey = 'sk-test';
      fetchMock.mockResolvedValue(okResponse('long', 'length'));
      const r1 = await createSamplingMessage({ messages: [{ role: 'user', content: 'x' }] });
      expect(r1.stopReason).toBe('maxTokens');

      fetchMock.mockResolvedValue(okResponse('tool', 'tool_calls'));
      const r2 = await createSamplingMessage({ messages: [{ role: 'user', content: 'x' }] });
      expect(r2.stopReason).toBe('tool_calls');
    });

    it('uses env var API key when config key empty', async () => {
      process.env.OPENAI_API_KEY = 'sk-env';
      fetchMock.mockResolvedValue(okResponse('ok'));
      await createSamplingMessage({ messages: [{ role: 'user', content: 'x' }] });
      expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer sk-env');
    });

    it('uses deepseek provider URL for deepseek api url', async () => {
      config.llmApiKey = 'sk-test';
      config.llmApiUrl = 'https://api.deepseek.com/v1/chat/completions';
      fetchMock.mockResolvedValue(okResponse('ok'));
      await createSamplingMessage({ messages: [{ role: 'user', content: 'x' }] });
      expect(fetchMock.mock.calls[0][0]).toBe('https://api.deepseek.com/v1/chat/completions');
    });

    it('throws on non-ok response', async () => {
      config.llmApiKey = 'sk-test';
      fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
      await expect(createSamplingMessage({ messages: [{ role: 'user', content: 'x' }] }))
        .rejects.toThrow('API error 500: boom');
    });

    it('throws when response has no choices', async () => {
      config.llmApiKey = 'sk-test';
      fetchMock.mockResolvedValue({ ok: true, json: async () => ({ choices: [] }) });
      await expect(createSamplingMessage({ messages: [{ role: 'user', content: 'x' }] }))
        .rejects.toThrow('No choices in API response');
    });

    it('rethrows fetch network errors', async () => {
      config.llmApiKey = 'sk-test';
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
      await expect(createSamplingMessage({ messages: [{ role: 'user', content: 'x' }] }))
        .rejects.toThrow('ECONNREFUSED');
    });
  });
});
