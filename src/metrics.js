import config from './config.js';
import { metrics as otelMetrics } from '@opentelemetry/api';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { log, error as logError } from './logger.js';

const MAX_HISTORY_VALUES = 1000;

let otelMeter = null;
let otelInitDone = false;

function initOtel() {
  if (otelInitDone) return;
  otelInitDone = true;
  try {
    const exporter = new PrometheusExporter({
      port: 9464,
      endpoint: '/metrics',
      preventServerStart: false,
    });
    const meterProvider = new MeterProvider({
      readers: [new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 10000 })],
    });
    otelMetrics.setGlobalMeterProvider(meterProvider);
    otelMeter = otelMetrics.getMeter('atlisp-mcp');
  } catch (e) {
    logError('OpenTelemetry init error:', e.message);
  }
}

function getOtelMeter() {
  if (!otelMeter) initOtel();
  return otelMeter;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil(p * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

class Metrics {
    constructor() {
        this.counters = new Map();
        this.histograms = new Map();
        this.startTime = Date.now();
        this.otelCounterCache = new Map();
        this.otelHistogramCache = new Map();
    }

    getOtelCounter(name, labels = {}) {
        try {
            const meter = getOtelMeter();
            if (!meter) return null;
            const key = `${name}:${Object.entries(labels).sort().map(([k,v])=>`${k}=${v}`).join(',')}`;
            if (this.otelCounterCache.has(key)) return this.otelCounterCache.get(key);
            const counter = meter.createCounter(name, { description: name });
            this.otelCounterCache.set(key, counter);
            return counter;
        } catch { return null; }
    }

    getOtelHistogram(name, labels = {}) {
        try {
            const meter = getOtelMeter();
            if (!meter) return null;
            const key = `${name}:${Object.entries(labels).sort().map(([k,v])=>`${k}=${v}`).join(',')}`;
            if (this.otelHistogramCache.has(key)) return this.otelHistogramCache.get(key);
            const hist = meter.createHistogram(name, { description: name, unit: 'ms' });
            this.otelHistogramCache.set(key, hist);
            return hist;
        } catch { return null; }
    }

    increment(name, labels = {}) {
        const key = this.makeKey(name, labels);
        const current = this.counters.get(key) || 0;
        this.counters.set(key, current + 1);
        const otelCounter = this.getOtelCounter(name.replace(/-/g,'_'), labels);
        if (otelCounter) otelCounter.add(1, labels);
    }

    histogram(name, value, labels = {}) {
        const key = this.makeKey(name, labels);
        const bucket = this.histograms.get(key) || {
            count: 0,
            sum: 0,
            min: Infinity,
            max: -Infinity,
            values: [],
        };
        bucket.count++;
        bucket.sum += value;
        bucket.min = Math.min(bucket.min, value);
        bucket.max = Math.max(bucket.max, value);
        bucket.values.push(value);
        if (bucket.values.length > MAX_HISTORY_VALUES) {
            bucket.values.shift();
        }
        this.histograms.set(key, bucket);
        const otelHist = this.getOtelHistogram(name.replace(/-/g,'_'), labels);
        if (otelHist) otelHist.record(value, labels);
    }

    makeKey(name, labels) {
        const labelStr = Object.entries(labels).sort().map(([k, v]) => `${k}="${v}"`).join(',');
        return labelStr ? `${name}{${labelStr}}` : name;
    }

    getMetrics() {
        const lines = [];
        const uptime = Math.floor((Date.now() - this.startTime) / 1000);

        lines.push('# HELP atlisp_mcp_uptime Server uptime in seconds');
        lines.push('# TYPE atlisp_mcp_uptime gauge');
        lines.push(`atlisp_mcp_uptime ${uptime}`);

        lines.push('# HELP atlisp_mcp_requests_total Total number of requests');
        lines.push('# TYPE atlisp_mcp_requests_total counter');
        lines.push(`atlisp_mcp_requests_total ${this.counters.get('requests_total') || 0}`);

        lines.push('# HELP atlisp_mcp_tool_calls_total Total number of tool calls');
        lines.push('# TYPE atlisp_mcp_tool_calls_total counter');
        for (const [key, value] of this.counters) {
            if (key.startsWith('tool_call')) {
                lines.push(`atlisp_mcp_${key} ${value}`);
            }
        }

        lines.push('# HELP atlisp_mcp_tool_duration_ms Tool call duration in milliseconds');
        lines.push('# TYPE atlisp_mcp_tool_duration_ms histogram');
        for (const [key, bucket] of this.histograms) {
            if (key.startsWith('tool_duration')) {
                const avg = bucket.count > 0 ? bucket.sum / bucket.count : 0;
                const sorted = [...bucket.values].sort((a, b) => a - b);
                const p50 = percentile(sorted, 0.5);
                const p90 = percentile(sorted, 0.9);
                const p99 = percentile(sorted, 0.99);
                lines.push(`atlisp_mcp_${key}_count ${bucket.count}`);
                lines.push(`atlisp_mcp_${key}_sum ${bucket.sum.toFixed(2)}`);
                lines.push(`atlisp_mcp_${key}_avg ${avg.toFixed(2)}`);
                lines.push(`atlisp_mcp_${key}_min ${bucket.min.toFixed(2)}`);
                lines.push(`atlisp_mcp_${key}_max ${bucket.max.toFixed(2)}`);
                lines.push(`atlisp_mcp_${key}_p50 ${p50.toFixed(2)}`);
                lines.push(`atlisp_mcp_${key}_p90 ${p90.toFixed(2)}`);
                lines.push(`atlisp_mcp_${key}_p99 ${p99.toFixed(2)}`);
            }
        }

        lines.push('# HELP atlisp_mcp_cad_commands_total Total CAD commands sent');
        lines.push('# TYPE atlisp_mcp_cad_commands_total counter');
        lines.push(`atlisp_mcp_cad_commands_total ${this.counters.get('cad_commands_total') || 0}`);

        lines.push('# HELP atlisp_mcp_errors_total Total number of errors');
        lines.push('# TYPE atlisp_mcp_errors_total counter');
        lines.push(`atlisp_mcp_errors_total ${this.counters.get('errors_total') || 0}`);

        lines.push('# HELP atlisp_mcp_sessions_active Active sessions');
        lines.push('# TYPE atlisp_mcp_sessions_active gauge');
        lines.push(`atlisp_mcp_sessions_active ${this.counters.get('sessions_active') || 0}`);

        lines.push('# HELP atlisp_mcp_cad_connected CAD connection status');
        lines.push('# TYPE atlisp_mcp_cad_connected gauge');
        lines.push(`atlisp_mcp_cad_connected ${this.counters.get('cad_connected') || 0}`);

        return lines.join('\n');
    }

    reset() {
        this.counters.clear();
        this.histograms.clear();
        this.startTime = Date.now();
    }
}

export const metrics = new Metrics();

export function trackRequest() {
    metrics.increment('requests_total');
}

export function trackMcpMethod(method) {
    metrics.increment('mcp_method_total', { method });
}

export function trackToolCall(toolName, durationMs, success = true) {
    metrics.increment('tool_call_total', { tool: toolName, result: success ? 'success' : 'error' });
    metrics.histogram('tool_duration_ms', durationMs, { tool: toolName });
}

export function trackCadCommand() {
    metrics.increment('cad_commands_total');
}

export function trackError() {
    metrics.increment('errors_total');
}

export function setActiveSessions(count) {
    metrics.counters.set('sessions_active', count);
}

export function setCadConnected(connected) {
    metrics.counters.set('cad_connected', connected ? 1 : 0);
}