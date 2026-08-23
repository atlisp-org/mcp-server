import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlisp-webhook-test-'));

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, default: { ...actual.default, homedir: () => tmpDir } };
});

const importEngine = () => import('../../src/webhook-engine.js');

describe('webhook-engine', () => {
  let engine;

  beforeEach(async () => {
    vi.resetModules();
    fs.rmSync(path.join(tmpDir, '.atlisp'), { recursive: true, force: true });
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    engine = await importEngine();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('registerWebhook 校验必填字段与事件类型', async () => {
    expect(() => engine.registerWebhook({})).toThrow(/URL is required/);
    expect(() => engine.registerWebhook({ url: 'http://a.com' })).toThrow(/At least one event/);
    expect(() => engine.registerWebhook({ url: 'http://a.com', events: ['bad_event'] })).toThrow(/无效的事件类型/);
    expect(() => engine.registerWebhook({ url: 'ftp://a.com', events: ['cad_connected'] })).toThrow(/不支持的协议/);
    expect(() => engine.registerWebhook({ url: '::not-a-url::', events: ['cad_connected'] })).toThrow(/无效的 URL/);
  });

  it('registerWebhook 成功注册并持久化到 webhooks.json', async () => {
    const wh = engine.registerWebhook({
      url: 'https://example.com/hook',
      events: ['tool_executed', 'error_occurred'],
      secret: 's3cret',
      name: 'my-hook',
    });
    expect(wh.id).toMatch(/^wh_/);
    expect(wh.active).toBe(true);
    expect(engine.listWebhooks()).toHaveLength(1);

    const saved = JSON.parse(fs.readFileSync(path.join(tmpDir, '.atlisp', 'webhooks.json'), 'utf-8'));
    expect(saved).toHaveLength(1);
    expect(saved[0].secret).toBe('s3cret');
  });

  it('removeWebhook 删除指定项，未知 ID 返回 false', async () => {
    const wh = engine.registerWebhook({ url: 'http://a.com/x', events: ['dwg_opened'] });
    expect(engine.removeWebhook('wh_missing')).toBe(false);
    expect(engine.removeWebhook(wh.id)).toBe(true);
    expect(engine.listWebhooks()).toHaveLength(0);
  });

  it('triggerWebhook 只触发匹配事件的活跃 webhook', async () => {
    engine.registerWebhook({ url: 'http://a.com/tool', events: ['tool_executed'] });
    engine.registerWebhook({ url: 'http://a.com/cad', events: ['cad_connected'] });
    const inactive = engine.registerWebhook({ url: 'http://a.com/off', events: ['tool_executed'] });
    inactive.active = false;

    const count = engine.triggerWebhook('tool_executed', { tool: 'eval_lisp' });
    expect(count).toBe(1);

    await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1));
    const [url, opts] = globalThis.fetch.mock.calls[0];
    expect(url).toBe('http://a.com/tool');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.event).toBe('tool_executed');
    expect(body.payload.tool).toBe('eval_lisp');
  });

  it('带 secret 时请求头包含 X-Webhook-Secret', async () => {
    engine.registerWebhook({ url: 'http://a.com/secured', events: ['dwg_saved'], secret: 'top' });
    engine.triggerWebhook('dwg_saved', {});
    await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(globalThis.fetch.mock.calls[0][1].headers['X-Webhook-Secret']).toBe('top');
  });

  it('失败时按指数退避重试并累计 failCount', async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    engine.registerWebhook({ url: 'http://a.com/fail', events: ['error_occurred'] });

    engine.triggerWebhook('error_occurred', {});
    // 1s + 2s + 4s 重试间隔
    await vi.advanceTimersByTimeAsync(8000);

    expect(globalThis.fetch).toHaveBeenCalledTimes(4); // 首次 + 3 次重试
    const [wh] = JSON.parse(fs.readFileSync(path.join(tmpDir, '.atlisp', 'webhooks.json'), 'utf-8'));
    expect(wh.failCount).toBeGreaterThan(0);
  });

  it('网络异常同样走重试路径', async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    engine.registerWebhook({ url: 'http://a.com/neterr', events: ['package_installed'] });

    engine.triggerWebhook('package_installed', {});
    await vi.advanceTimersByTimeAsync(8000);
    expect(globalThis.fetch).toHaveBeenCalledTimes(4);
  });

  it('getWebhookLog 清洗非法字符并容忍缺失文件', async () => {
    expect(engine.getWebhookLog('../../etc/passwd')).toEqual([]);
    expect(engine.getWebhookLog('wh_123_ok')).toEqual([]);
  });
});
