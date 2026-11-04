// hatch_with_pattern / pattern_search 回归守卫：
//   1. 没传 scale 但给了 pitch 时，必须在 CAD 端按填充边界反推比例（auto scale）；
//   2. 显式传 scale 时不能覆盖（不能出现 getboundingbox）；
//   3. 图案索引 schema 2 的 cat/pitch/unit 要透传给调用方；
//   4. 生成的 AutoLISP 必须括号平衡（拼字符串很容易多/少一个右括号）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.PATTERN_DRY_RUN = '1';

import { hatchWithPattern, patternSearch } from '../src/handlers/pattern-handlers.js';

function dry(run) {
  return JSON.parse(run.content[0].text);
}

function balanced(code) {
  const open = (code.match(/\(/g) || []).length;
  const close = (code.match(/\)/g) || []).length;
  return { open, close, ok: open === close };
}

describe('hatch_with_pattern 比例', () => {
  it('无 scale 有 pitch → 按边界自动取比例', async () => {
    const r = dry(await hatchWithPattern({ pattern: 'AR-CONC', file: 'ACAD.PAT', pitch: 6.939767 }));
    expect(r.autoScale).toBe(true);
    expect(r.code).toContain('vla-getboundingbox');
    expect(r.code).toContain('/ @hd 15.0)');
    expect(r.code).toContain('6.939767');
    expect(balanced(r.code).ok).toBe(true);
  });

  it('下载包在 lambda + catch-all 里（老内核缺 down-by-base64 时不崩）', async () => {
    const r = dry(await hatchWithPattern({ pattern: 'AR-CONC', file: 'ACAD.PAT', pitch: 6.939767 }));
    expect(r.code).toContain('(vl-catch-all-apply');
    expect(r.code).toContain('(@::down-by-base64');
    expect(r.code).toContain('(lambda ()');
    // 不能把符号直接交给 catch-all：函数未定义时那是硬错误，接不住
    expect(r.code).not.toContain("(vl-catch-all-apply (quote @::down-by-base64)");
    expect(r.code).toContain('ERR:图案文件下载失败');
  });

  it('显式 scale 优先，不计算边界', async () => {
    const r = dry(
      await hatchWithPattern({ pattern: 'AR-CONC', file: 'ACAD.PAT', pitch: 6.939767, scale: 20 }),
    );
    expect(r.autoScale).toBe(false);
    expect(r.code).not.toContain('vla-getboundingbox');
    expect(r.code).toContain('(setq @hs 20)');
    expect(balanced(r.code).ok).toBe(true);
  });

  it('没有 pitch 时沿用 scale=1（老行为）', async () => {
    const r = dry(await hatchWithPattern({ pattern: 'AR-CONC', file: 'ACAD.PAT' }));
    expect(r.autoScale).toBe(false);
    expect(r.code).toContain('(setq @hs 1)');
    expect(balanced(r.code).ok).toBe(true);
  });

  it('pattern 为空直接报错', async () => {
    const r = await hatchWithPattern({});
    expect(r.isError).toBe(true);
  });
});

describe('pattern_search 类别过滤', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atlisp-mcp-pattern-'));

  beforeAll(() => {
    process.env.ATLISP_LIBRARY_CACHE = tmp;
    fs.writeFileSync(
      path.join(tmp, 'pattern-index.json'),
      JSON.stringify({
        schema: 2,
        items: [
          { name: 'AR-CONC', desc: 'random dot and stone pattern', file: 'ACAD.PAT', cat: '石材', pitch: 6.939767, unit: 'in', scale_hint: 1.135, lines: 12 },
          { name: '2x12木地板', desc: '2x12木地板', file: '2x12木地板.pat', cat: '木材', pitch: 304.8, unit: 'mm', scale_hint: 0.492, lines: 14 },
        ],
      }),
      'utf8',
    );
  });

  afterAll(() => {
    delete process.env.ATLISP_LIBRARY_CACHE;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('按类别只返回该类图案，并带 pitch/unit', async () => {
    const r = await patternSearch({ category: '石材' });
    const payload = JSON.parse(r.content[0].text);
    expect(payload.returned).toBe(1);
    expect(payload.items[0].name).toBe('AR-CONC');
    expect(payload.items[0].pitch).toBeCloseTo(6.939767, 5);
    expect(payload.items[0].unit).toBe('in');
  });

  it('未知类别给出可用类别', async () => {
    const r = await patternSearch({ category: '不存在' });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('石材');
  });

  it('关键字仍可按名称搜', async () => {
    const r = await patternSearch({ query: '木地板' });
    const payload = JSON.parse(r.content[0].text);
    expect(payload.items[0].name).toBe('2x12木地板');
    expect(payload.items[0].cat).toBe('木材');
  });
});
