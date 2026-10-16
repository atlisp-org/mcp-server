// handlers/lint-handlers.js 单测：直接调用 4 个 handler，
// 依赖真实 @atlisp/lint（analyzeLispCode / formatCode / RULES / lintProject）。
// 注意：lintProject(dist) 的签名是 (files: string[], config, rootDir)，
// 而 handler 传入的是目录字符串——因此 directory 参数路径实际返回空数组，
// 这里按当前真实行为断言（若后续修复 src，需同步更新本测试）。
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import config from '../../src/config.js';

const {
  analyzeLispCodeHandler,
  formatLispCodeHandler,
  listLintRulesHandler,
  lintProjectHandler,
} = await import('../../src/handlers/lint-handlers.js');

function parseContent(result) {
  expect(result.isError).toBeFalsy();
  return JSON.parse(result.content[0].text);
}

const savedSecurityLevel = config.securityLevel;

beforeEach(() => {
  // 默认 securityLevel=relaxed 会短路分析；置 strict 以真正执行规则检查
  config.securityLevel = 'strict';
});

afterEach(() => {
  config.securityLevel = savedSecurityLevel;
  vi.restoreAllMocks();
});

describe('analyzeLispCodeHandler', () => {
  it('空代码直接返回 valid=true 提示', async () => {
    config.securityLevel = savedSecurityLevel;
    const r = await analyzeLispCodeHandler({ code: '   ' });
    expect(parseContent(r)).toEqual({ valid: true, issues: [], summary: '代码为空，无需分析' });
    expect((await analyzeLispCodeHandler({})).content[0].text).toContain('代码为空');
    expect((await analyzeLispCodeHandler()).content[0].text).toContain('代码为空');
  });

  it('relaxed 安全级别直接放行', async () => {
    config.securityLevel = 'relaxed';
    const r = await analyzeLispCodeHandler({ code: '(defun broken (x' });
    const data = parseContent(r);
    expect(data.valid).toBe(true);
    expect(data.summary).toContain('relaxed');
  });

  it('strict 级别下括号不平衡报出错误', async () => {
    const r = await analyzeLispCodeHandler({ code: '(defun broken (x\n  (setq y 1)' });
    const data = parseContent(r);
    expect(data.valid).toBe(false);
    expect(data.errors.length).toBeGreaterThan(0);
    expect(data.errors.some(e => e.rule === 'parens')).toBe(true);
  });

  it('strict 级别下 startapp 危险调用报错', async () => {
    const r = await analyzeLispCodeHandler({ code: '(startapp "notepad.exe")' });
    const data = parseContent(r);
    expect(data.valid).toBe(false);
    expect(JSON.stringify(data)).toContain('startapp');
  });

  it('合法代码通过', async () => {
    const r = await analyzeLispCodeHandler({
      code: '(defun add (a b)\n  "两数相加"\n  (+ a b))\n',
    });
    const data = parseContent(r);
    expect(data.valid).toBe(true);
  });
});

describe('formatLispCodeHandler', () => {
  it('缺少 code 参数返回 isError', async () => {
    const r = await formatLispCodeHandler({});
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toBe('需要 code 参数');
  });

  it('格式化合法代码返回字符串（tabWidth 透传）', async () => {
    const r = await formatLispCodeHandler({ code: '(defun f (x)\n  (+ x 1))', tabWidth: 4 });
    expect(r.isError).toBeFalsy();
    expect(r.content[0].text).toContain('defun');
  });

  it('非字符串 code 导致底层抛错 → 格式化失败', async () => {
    const r = await formatLispCodeHandler({ code: 12345 });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('格式化失败');
  });
});

describe('listLintRulesHandler', () => {
  it('返回全部规则列表（rule/severity/description/fixable）', async () => {
    const r = await listLintRulesHandler();
    const rules = parseContent(r);
    expect(Array.isArray(rules)).toBe(true);
    expect(rules.length).toBeGreaterThan(50);

    const parens = rules.find(x => x.rule === 'parens');
    expect(parens).toBeTruthy();
    expect(parens.severity).toBe('warn'); // RULES 无 severity 字段 → handler 默认 'warn'
    expect(typeof parens.description).toBe('string');
    expect(parens.description.length).toBeGreaterThan(0);
    expect(typeof parens.fixable).toBe('boolean');

    expect(rules.every(x => typeof x.rule === 'string' && x.rule.length > 0)).toBe(true);
    // 规则名唯一
    expect(new Set(rules.map(x => x.rule)).size).toBe(rules.length);
  });
});

describe('lintProjectHandler', () => {
  it('缺少 directory 参数返回 isError', async () => {
    const r = await lintProjectHandler({});
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toBe('需要 directory 参数');
  });

  it('传入目录时返回分析结果 JSON（当前实现返回空数组）', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-proj-'));
    try {
      fs.writeFileSync(path.join(dir, 'bad.lsp'), '(defun bad:f (x\n', 'utf-8');
      const r = await lintProjectHandler({ directory: dir });
      // handler 调 lintProject(directoryString, ...) 而 dist 需要文件数组 → 空结果
      expect(parseContent(r)).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('config 输入（checks/dangerous_calls 覆盖）被合并不报错', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-proj-cfg-'));
    try {
      fs.writeFileSync(path.join(dir, 'a.lsp'), '(setq x 1)\n', 'utf-8');
      const r = await lintProjectHandler({
        directory: dir,
        config: { checks: { parens: 'error' }, dangerous_calls: { quit: 'error' } },
      });
      expect(r.isError).toBeFalsy();
      expect(Array.isArray(JSON.parse(r.content[0].text))).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('目录不存在也返回空结果（文件读取失败被跳过）', async () => {
    const r = await lintProjectHandler({ directory: '/tmp/opencode/definitely-missing-dir-xyz' });
    expect(r.isError).toBeFalsy();
    expect(parseContent(r)).toEqual([]);
  });
});
