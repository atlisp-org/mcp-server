import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config.js', () => ({ default: { metricsEnabled: true } }));

const { metrics, trackRequest, trackToolCall, trackCadCommand, trackError, setActiveSessions, setCadConnected } = await import('../src/metrics.js');

describe('metrics', () => {
  beforeEach(() => { metrics.reset(); });

  it('trackRequest increments requests_total', () => {
    trackRequest();
    trackRequest();
    expect(metrics.getMetrics()).toContain('atlisp_mcp_requests_total 2');
  });

  it('trackToolCall tracks per-tool counters', () => {
    trackToolCall('eval_lisp', 50, true);
    trackToolCall('get_info', 10, false);
    const out = metrics.getMetrics();
    expect(out).toContain('tool="eval_lisp"');
    expect(out).toContain('result="error"');
  });

  it('trackToolCall records histogram with percentiles', () => {
    for (let i = 1; i <= 100; i++) trackToolCall('p_tool', i, true);
    const out = metrics.getMetrics();
    expect(out).toContain('_p50');
    expect(out).toContain('_p90');
    expect(out).toContain('_p99');
    expect(out).toContain('_min');
    expect(out).toContain('_max');
  });

  it('trackCadCommand increments counter', () => {
    trackCadCommand();
    expect(metrics.getMetrics()).toContain('atlisp_mcp_cad_commands_total 1');
  });

  it('trackError increments errors_total', () => {
    trackError();
    expect(metrics.getMetrics()).toContain('atlisp_mcp_errors_total 1');
  });

  it('setActiveSessions sets gauge', () => {
    setActiveSessions(5);
    expect(metrics.getMetrics()).toContain('atlisp_mcp_sessions_active 5');
  });

  it('setCadConnected sets gauge', () => {
    setCadConnected(true);
    expect(metrics.getMetrics()).toContain('atlisp_mcp_cad_connected 1');
    setCadConnected(false);
    expect(metrics.getMetrics()).toContain('atlisp_mcp_cad_connected 0');
  });

  it('outputs valid prometheus format', () => {
    const out = metrics.getMetrics();
    expect(out).toContain('HELP');
    expect(out).toContain('TYPE');
    expect(out).toContain('atlisp_mcp_uptime');
  });

  it('prometheus format with alphabetical labels', () => {
    trackToolCall('my_tool', 42, true);
    const out = metrics.getMetrics();
    expect(out).toContain('atlisp_mcp_tool_call_total{result="success",tool="my_tool"} 1');
  });
});
