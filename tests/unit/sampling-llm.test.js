// sampling.js 真实单测：mock fetch 直接驱动 createSamplingMessage 的
// 无 key echo / 成功 / 非 2xx / 无 choices / 网络失败等分支。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import config from '../../src/config.js';

vi.mock('../../src/logger.js', () => ({
  log: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  closeLog: vi.fn(),
}));

const { createSamplingMessage } = await import('../../src/sampling.js');
const { log, error: logError } = await import('../../src/logger.js');

const originalFetch = globalThis.fetch;
const saved = {
  llmApiKey: config.llmApiKey,
  llmApiUrl: config.llmApiUrl,
  llmModel: config.llmModel,
  llmMaxTokens: config.llmMaxTokens,
  llmTemperature: config.llmTemperature,
};

function okResponse(data) {
  return { ok: true, json: async () => data, text: async () => JSON.stringify(data) };
}

beforeEach(() => {
  vi.clearAllMocks();
  config.llmApiKey = '';
  config.llmApiUrl = '';
  config.llmModel = '';
  config.llmMaxTokens = 1024;
  config.llmTemperature = 0.7;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  Object.assign(config, saved);
});

describe('createSamplingMessage — 无 API key 回退 echo', () => {
  it('字符串 content → [echo] 前缀', async () => {
    const result = await createSamplingMessage({
      messages: [{ role: 'user', content: { type: 'text', text: 'hello' } }],
    });
    expect(result.model).toBe('echo');
    expect(result.role).toBe('assistant');
    expect(result.stopReason).toBe('endTurn');
    expect(result.content.text).toBe('[echo] hello');
  });

  it('数组 content 拼接文本（空 text 块产生空串），忽略非 text 块', async () => {
    const result = await createSamplingMessage({
      messages: [{
        role: 'user',
        content: [{ type: 'text', text: 'a' }, { type: 'image', data: 'x' }, { type: 'text', text: 'b' }],
      }],
    });
    expect(result.content.text).toBe('[echo] a  b'); // join(' ')：非 text 块映射为 ''
  });

  it('messages 为空 → 空文本 echo', async () => {
    const result = await createSamplingMessage({ messages: [] });
    expect(result.content.text).toBe('[echo] ');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('no API key'));
  });
});

describe('createSamplingMessage — 调用 LLM API', () => {
  beforeEach(() => {
    config.llmApiKey = 'sk-test';
    config.llmApiUrl = 'https://api.openai.com/v1/chat/completions';
    config.llmModel = 'gpt-4o';
  });

  it('成功返回并映射 finish_reason=stop → endTurn', async () => {
    globalThis.fetch = vi.fn(async () => okResponse({
      model: 'gpt-4o-mini',
      choices: [{ message: { content: '答案' }, finish_reason: 'stop' }],
    }));

    const result = await createSamplingMessage({
      messages: [{ role: 'user', content: { type: 'text', text: 'q' } }],
      systemPrompt: 'sys',
    });

    expect(result.model).toBe('gpt-4o-mini');
    expect(result.content.text).toBe('答案');
    expect(result.stopReason).toBe('endTurn');

    const [url, init] = globalThis.fetch.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer sk-test');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('gpt-4o');
    expect(body.messages[0]).toEqual({ role: 'system', content: 'sys' });
    expect(body.stream).toBe(false);
    expect(body.max_tokens).toBe(1024);
    expect(body.temperature).toBe(0.7);
  });

  it('数组 content 合并为纯文本并透传 maxTokens/temperature/stop', async () => {
    globalThis.fetch = vi.fn(async () => okResponse({
      choices: [{ message: { content: 'x' }, finish_reason: 'length' }],
    }));

    const result = await createSamplingMessage({
      messages: [{ role: 'user', content: [{ type: 'text', text: 'p1' }, { type: 'text', text: 'p2' }] }],
      maxTokens: 55,
      temperature: 0.1,
      stopSequences: ['###'],
    });

    expect(result.stopReason).toBe('maxTokens');
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body.messages).toEqual([{ role: 'user', content: 'p1\np2' }]);
    expect(body.max_tokens).toBe(55);
    expect(body.temperature).toBe(0.1);
    expect(body.stop).toEqual(['###']);
  });

  it('未知 finish_reason 原样透传，缺省 model 字段回退配置值', async () => {
    globalThis.fetch = vi.fn(async () => okResponse({
      choices: [{ message: { content: '' }, finish_reason: 'tool_calls' }],
    }));
    const result = await createSamplingMessage({ messages: [{ role: 'user', content: 'x' }] });
    expect(result.stopReason).toBe('tool_calls');
    expect(result.model).toBe('gpt-4o');
  });

  it('modelPreferences.hints 覆盖模型名', async () => {
    globalThis.fetch = vi.fn(async () => okResponse({
      choices: [{ message: { content: 'y' }, finish_reason: 'stop' }],
    }));
    await createSamplingMessage({
      messages: [{ role: 'user', content: 'x' }],
      modelPreferences: { hints: [{ name: 'deepseek-chat' }] },
    });
    expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body).model).toBe('deepseek-chat');
  });

  it('deepseek URL 识别 provider 且 OPENAI key env 可用', async () => {
    config.llmApiKey = '';
    config.llmApiUrl = 'https://api.deepseek.com/v1/chat/completions';
    process.env.DEEPSEEK_API_KEY = 'dk-env';
    globalThis.fetch = vi.fn(async () => okResponse({
      choices: [{ message: { content: 'd' }, finish_reason: 'stop' }],
    }));
    try {
      const result = await createSamplingMessage({ messages: [{ role: 'user', content: 'x' }] });
      expect(result.content.text).toBe('d');
      expect(globalThis.fetch.mock.calls[0][0]).toBe('https://api.deepseek.com/v1/chat/completions');
      expect(globalThis.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer dk-env');
    } finally {
      delete process.env.DEEPSEEK_API_KEY;
    }
  });

  it('非 2xx 抛出 API error 并记录日志', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 429,
      text: async () => 'rate limited',
    }));
    await expect(createSamplingMessage({ messages: [{ role: 'user', content: 'x' }] }))
      .rejects.toThrow('API error 429: rate limited');
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('Sampling error'));
  });

  it('响应缺少 choices 抛错', async () => {
    globalThis.fetch = vi.fn(async () => okResponse({ choices: [] }));
    await expect(createSamplingMessage({ messages: [{ role: 'user', content: 'x' }] }))
      .rejects.toThrow('No choices in API response');
  });

  it('网络失败原样抛出并记录日志', async () => {
    globalThis.fetch = vi.fn(async () => { throw new TypeError('fetch failed'); });
    await expect(createSamplingMessage({ messages: [{ role: 'user', content: 'x' }] }))
      .rejects.toThrow('fetch failed');
    expect(logError).toHaveBeenCalledWith('Sampling error: fetch failed');
  });
});

describe('createSamplingMessage — 自定义 provider', () => {
  it('非 openai/deepseek URL 用配置的 llmModel 与自定义地址', async () => {
    config.llmApiKey = 'custom-key';
    config.llmApiUrl = 'http://127.0.0.1:11434/v1/chat/completions';
    config.llmModel = 'qwen3';
    globalThis.fetch = vi.fn(async () => okResponse({
      choices: [{ message: { content: 'c' }, finish_reason: 'stop' }],
    }));
    const result = await createSamplingMessage({ messages: [{ role: 'user', content: 'x' }] });
    expect(result.model).toBe('qwen3');
    expect(globalThis.fetch.mock.calls[0][0]).toContain('127.0.0.1');
  });
});
