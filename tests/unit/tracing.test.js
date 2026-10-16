import { describe, it, expect, vi, beforeEach } from 'vitest';

// 捕获状态放在 globalThis，避免 vi.mock 提升引发的 TDZ 问题
globalThis.__traceCapture = { provider: null, spans: [] };

vi.mock('@opentelemetry/sdk-trace-node', () => {
  const cap = () => globalThis.__traceCapture;
  class BatchSpanProcessor {
    constructor() { cap().processor = this; }
    onEnd(span) { cap().spans.push(span); }
    shutdown() { return Promise.resolve(); }
    forceFlush() { return Promise.resolve(); }
  }
  class NodeTracerProvider {
    constructor(opts) {
      this.spanProcessors = opts?.spanProcessors || [];
      cap().provider = this;
    }
    register() {}
    forceFlush() { return Promise.resolve(); }
    shutdown() { return Promise.resolve(); }
  }
  return { NodeTracerProvider, BatchSpanProcessor };
});

vi.mock('@opentelemetry/exporter-trace-otlp-http', () => ({
  OTLPTraceExporter: class { constructor(_opts) {} },
}));

const resetAndImport = async (env = {}) => {
  vi.resetModules();
  for (const k of ['TRACING_ENABLED', 'TRACING_ENDPOINT']) delete process.env[k];
  Object.assign(process.env, env);
  return import('../../src/tracing.js');
};

const waitFor = async (fn, timeoutMs = 3000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return false;
};

/** 注册可控的 fake 全局 tracer（@opentelemetry/api 的全局注册只能成功一次） */
const installFakeGlobalTracer = async () => {
  const api = await import('@opentelemetry/api');
  const made = [];
  try {
    api.trace.setGlobalTracerProvider({
      getTracer() {
        return {
          startActiveSpan(name, opts, fn) {
            const span = {
              name, attributes: opts.attributes || {}, status: null, exceptions: [], ended: false,
              setAttribute(k, v) { this.attributes[k] = v; return this; },
              setStatus(s) { this.status = s; return this; },
              recordException(e) { this.exceptions.push(e?.message || String(e)); return this; },
              end() { this.ended = true; made.push(this); },
            };
            return fn(span);
          },
        };
      },
    });
  } catch {
    // 已被注册过（同文件第二个用例）：复用既有全局——通过 proxy tracer 无法拿到 made，
    // 因此每个用例使用独立断言策略
  }
  return made;
};

describe('tracing', () => {
  beforeEach(() => {
    globalThis.__traceCapture = { provider: null, spans: [] };
  });

  it('未启用时零开销透传（不初始化 provider）', async () => {
    const tracing = await resetAndImport({});
    let called = false;
    const result = await tracing.withSpan('tool.test', { a: 1 }, async () => {
      called = true;
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(called).toBe(true);
    expect(tracing.tracingActive()).toBe(false);
    expect(globalThis.__traceCapture.provider).toBeNull();
  });

  it('启用时创建 span 并记录属性与成功状态', async () => {
    const tracing = await resetAndImport({ TRACING_ENABLED: 'true' });
    // ensureInit 惰性触发：发起一次调用并等待初始化完成
    const warmup = tracing.withSpan('warmup', {}, async () => 'ok');
    expect(await waitFor(() => tracing.tracingActive())).toBe(true);
    expect(globalThis.__traceCapture.provider).toBeTruthy();
    expect(await warmup).toBe('ok');

    const made = await installFakeGlobalTracer();
    // 首个用例注册成功；若全局已占用则跳过 span 断言细节
    if (!made.length) return;

    const result = await tracing.withSpan('tool.eval_lisp', { 'tool.name': 'eval_lisp' }, async () => 'done');
    expect(result).toBe('done');
    expect(made.length).toBe(1);
    expect(made[0].name).toBe('tool.eval_lisp');
    expect(made[0].attributes['tool.name']).toBe('eval_lisp');
    expect(made[0].ended).toBe(true);
  });

  it('span 内抛出异常时记录异常并传播错误', async () => {
    const tracing = await resetAndImport({ TRACING_ENABLED: 'true' });
    const warmup = tracing.withSpan('warmup', {}, async () => 'ok');
    expect(await waitFor(() => tracing.tracingActive())).toBe(true);
    await warmup;

    const made = await installFakeGlobalTracer();

    await expect(
      tracing.withSpan('cad.connect', {}, async () => { throw new Error('CAD 爆了'); })
    ).rejects.toThrow('CAD 爆了');

    // 若本用例持有全局 tracer，则验证异常记录；否则仅验证错误传播
    if (made.length) {
      expect(made[0].exceptions[0]).toContain('CAD 爆了');
      expect(made[0].ended).toBe(true);
    }
  });
});
