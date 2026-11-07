import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import config from '../../src/config.js';

vi.mock('../../src/logger.js', () => ({
  log: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  closeLog: vi.fn(),
}));

const { createSamplingMessage, estimateCostUsd, parseProviderList } = await import('../../src/sampling.js');

const originalFetch = globalThis.fetch;
const saved = {
  llmApiKey: config.llmApiKey,
  llmApiUrl: config.llmApiUrl,
  llmModel: config.llmModel,
  samplingProviders: config.samplingProviders,
  llmStream: config.llmStream,
};

function sseResponse(chunks) {
  const encoder = new TextEncoder();
  return {
    ok: true,
    body: new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    text: async () => chunks.join(''),
  };
}

function okResponse(data) {
  return { ok: true, json: async () => data, text: async () => JSON.stringify(data) };
}

beforeEach(() => {
  vi.clearAllMocks();
  config.llmApiKey = 'sk-test';
  config.llmApiUrl = 'https://api.openai.com/v1/chat/completions';
  config.llmModel = 'gpt-4o';
  config.samplingProviders = '';
  config.llmStream = false;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  Object.assign(config, saved);
  delete process.env.OPENAI_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
});

describe('sampling 流式输出', () => {
  it('stream:true 解析 SSE 增量与 usage', async () => {
    globalThis.fetch = vi.fn(async () => sseResponse([
      'data: {"model":"gpt-4o-mini","choices":[{"delta":{"content":"你"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"好"},"finish_reason":"stop"}]}\n\n',
      'data: {"usage":{"prompt_tokens":10,"completion_tokens":2}}\n\n',
      'data: [DONE]\n\n',
    ]));

    const result = await createSamplingMessage({
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
    });

    expect(result.content.text).toBe('你好');
    expect(result.model).toBe('gpt-4o-mini');
    expect(result.stopReason).toBe('endTurn');
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 2 });

    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
  });

  it('坏事件被跳过，不中断整段流', async () => {
    globalThis.fetch = vi.fn(async () => sseResponse([
      'data: not-json\n\n',
      'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\n',
    ]));
    const result = await createSamplingMessage({
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
    });
    expect(result.content.text).toBe('ok');
  });
});

describe('sampling 降级链', () => {
  it('按 SAMPLING_PROVIDERS 顺序降级，第一个失败后继续', async () => {
    config.llmApiUrl = '';
    config.samplingProviders = 'openai,deepseek';
    process.env.OPENAI_API_KEY = 'oa-key';
    process.env.DEEPSEEK_API_KEY = 'ds-key';
    globalThis.fetch = vi.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(okResponse({
        model: 'deepseek-chat',
        choices: [{ message: { content: 'fallback ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 3, completion_tokens: 4 },
      }));

    const result = await createSamplingMessage({ messages: [{ role: 'user', content: 'q' }] });
    expect(result.content.text).toBe('fallback ok');
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(globalThis.fetch.mock.calls[0][0]).toContain('openai');
    expect(globalThis.fetch.mock.calls[1][0]).toContain('deepseek');
  });

  it('全部 provider 失败时回退 echo', async () => {
    config.llmApiUrl = '';
    config.samplingProviders = 'openai,deepseek';
    process.env.OPENAI_API_KEY = 'oa-key';
    process.env.DEEPSEEK_API_KEY = 'ds-key';
    globalThis.fetch = vi.fn(async () => { throw new TypeError('down'); });

    const result = await createSamplingMessage({
      messages: [{ role: 'user', content: { type: 'text', text: 'hello' } }],
    });
    expect(result.model).toBe('echo');
    expect(result.content.text).toBe('[echo] hello');
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('parseProviderList 过滤未知 provider', () => {
    expect(parseProviderList('vllm, deepseek, unknown, openai')).toEqual(['vllm', 'deepseek', 'openai']);
    expect(parseProviderList('')).toEqual([]);
  });
});

describe('sampling 成本估算', () => {
  it('按模型价格换算美元', () => {
    expect(estimateCostUsd('gpt-4o-mini', 1_000_000, 0)).toBeCloseTo(0.15);
    expect(estimateCostUsd('gpt-4o', 0, 1_000_000)).toBeCloseTo(10);
    expect(estimateCostUsd('unknown-model', 1000, 1000)).toBe(0);
  });
});
