// OpenTelemetry 分布式追踪（TRACING_ENABLED=true 时启用，默认关闭零开销）
// 用法: await withSpan('tool.eval_lisp', { 'session.id': sid }, async () => { ... })
import './config.js';
import config from './config.js';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { error as logError } from './logger.js';

const TRACER_NAME = 'atlisp-mcp';

let initPromise = null;
/** @type {import('@opentelemetry/sdk-trace-base').NodeTracerProvider|null} */
let provider = null;
let active = false;

async function ensureInit() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    if (!config.tracingEnabled) return;
    try {
      const { NodeTracerProvider, BatchSpanProcessor } = await import('@opentelemetry/sdk-trace-node');
      const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http');
      const exporter = new OTLPTraceExporter(
        config.tracingEndpoint ? { url: config.tracingEndpoint } : {}
      );
      provider = new NodeTracerProvider({
        spanProcessors: [new BatchSpanProcessor(exporter)],
      });
      provider.register();
      active = true;
    } catch (e) {
      logError('OpenTelemetry tracing 初始化失败:', e.message);
    }
  })();
  return initPromise;
}

/** 追踪是否已启用 */
export function tracingActive() {
  return active;
}

/**
 * 在 span 中执行异步函数。未启用时直接透传（零开销、无额外微任务）。
 * @template T
 * @param {string} name
 * @param {Record<string, string|number|boolean>} [attributes]
 * @param {(span?: import('@opentelemetry/api').Span) => T} fn
 * @returns {T}
 */
export function withSpan(name, attributes, fn) {
  // 快速路径：未配置追踪时同步透传，不引入任何异步延迟
  if (!active && !config.tracingEnabled) return fn();
  return _enabledWithSpan(name, attributes, fn);
}

async function _enabledWithSpan(name, attributes, fn) {
  await ensureInit();
  if (!active) return fn();
  const tracer = trace.getTracer(TRACER_NAME);
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (e) {
      span.recordException(e);
      span.setAttribute('error.message', e?.message || String(e));
      span.setStatus({ code: SpanStatusCode.ERROR, message: e?.message });
      throw e;
    } finally {
      span.end();
    }
  });
}

/** 刷新并关闭 tracer provider（进程退出前调用） */
export async function shutdownTracing() {
  if (provider) {
    try {
      await provider.forceFlush();
      await provider.shutdown();
    } catch (e) {
      logError('tracing shutdown error:', e.message);
    }
    provider = null;
    active = false;
  }
}
