import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import config from '../../src/config.js';
import {
  THREAT_BLOCK,
  THREAT_WARN,
  THREAT_ALLOW,
  SECURITY_LEVELS,
  stripStringsAndComments,
  checkParens,
  validateLispCodeWorker,
  validateLispCode,
  getEffectiveSeverity,
  getSessionAllowlist,
  addToAllowlist,
  removeFromAllowlist,
  clearSessionAllowlist,
  refreshConfig,
  RULES,
} from '../../src/lisp-security.js';

describe('lisp-security', () => {
  beforeEach(() => {
    config.securityLevel = 'relaxed';
    refreshConfig();
  });

  describe('常量与规则表', () => {
    it('威胁等级与安全级别定义完整', () => {
      expect(THREAT_BLOCK).toBe('block');
      expect(THREAT_WARN).toBe('warn');
      expect(THREAT_ALLOW).toBe('allow');
      expect(SECURITY_LEVELS).toEqual(['strict', 'standard', 'relaxed']);
      expect(RULES.length).toBeGreaterThanOrEqual(21);
    });

    it('默认 relaxed 模式：危险代码放行', () => {
      expect(getEffectiveSeverity()).toBe(THREAT_ALLOW);
    });
  });

  describe('stripStringsAndComments', () => {
    it('剥离字符串内容与注释', () => {
      const clean = stripStringsAndComments('(command "shell dir") ; 危险注释 (startapp)');
      expect(clean).not.toContain('shell');
      expect(clean).not.toContain('startapp');
    });

    it('保留字符串外的代码结构', () => {
      const clean = stripStringsAndComments('(setq a 1) ; comment');
      expect(clean).toContain('(setq a 1)');
    });

    it('处理转义引号', () => {
      const clean = stripStringsAndComments('(princ "say \\"hi\\"")');
      expect(clean).not.toContain('say');
    });
  });

  describe('checkParens', () => {
    it('括号平衡通过', () => {
      expect(checkParens('(defun f (x) (+ x 1))')).toEqual({ valid: true });
    });

    it('缺少右括号报错并给出位置', () => {
      const r = checkParens('(setq a 1');
      expect(r.valid).toBe(false);
      expect(r.error).toContain('缺少 1 个右括号');
    });

    it('多余右括号立即报错', () => {
      const r = checkParens('(setq a 1))');
      expect(r.valid).toBe(false);
      expect(r.error).toContain('多余右括号');
    });

    it('字符串和注释中的括号不参与计数', () => {
      expect(checkParens('(princ ")(" ) ; )')).toEqual({ valid: true });
      expect(checkParens('(princ "escaped \\" paren")')).toEqual({ valid: true });
    });
  });

  describe('validateLispCodeWorker', () => {
    beforeEach(() => {
      config.securityLevel = 'strict';
      refreshConfig();
    });

    afterEach(() => {
      config.securityLevel = 'relaxed';
      refreshConfig();
    });

    it.each([
      ['(startapp "calc")', /startapp/],
      ['(eval (read "bad"))', /eval/],
      ['(vl-file-delete "C:/x.txt")', /文件删除/],
      ['(command shell dir)', /危险 CAD 命令/],
      ['(load "evil.lsp")', /load 函数/],
    ])('阻止危险代码: %s', (code, errRe) => {
      const r = validateLispCodeWorker(code);
      expect(r.valid).toBe(false);
      expect(r.error).toMatch(errRe);
    });

    it('正常绘图代码放行', () => {
      expect(validateLispCodeWorker('(command "_.line" (getpoint) (getpoint) "")').valid).toBe(true);
      expect(validateLispCodeWorker('(entmake (list (cons 0 "LINE")))').valid).toBe(true);
    });

    it('字符串内的危险词不触发规则', () => {
      // 注释里的 startapp 被剥离
      expect(validateLispCodeWorker('; (startapp "x")\n(princ "ok")').valid).toBe(true);
    });
  });

  describe('validateLispCode + session allowlist', () => {
    const SID = 'session-ut-1';

    beforeEach(() => {
      config.securityLevel = 'strict';
      refreshConfig();
      clearSessionAllowlist(SID);
      clearSessionAllowlist('session-ut-2');
    });

    afterEach(() => {
      config.securityLevel = 'relaxed';
      refreshConfig();
    });

    it('返回逐条结果与汇总', () => {
      const r = validateLispCode('(startapp "calc")(vl-bt)', null);
      expect(r.valid).toBe(false);
      expect(r.blocked).toBe(true);
      expect(r.results.length).toBe(2);
      expect(r.results.every(x => x.blocked)).toBe(true);
      expect(r.summary).toContain('startapp');
    });

    it('allowlist 放行指定规则后 valid 恢复', () => {
      const code = '(startapp "notepad")';
      expect(validateLispCode(code, SID).valid).toBe(false);

      // startapp 是第 0 条规则
      addToAllowlist(SID, 0);
      const r = validateLispCode(code, SID);
      expect(r.valid).toBe(true);
      expect(r.results[0].allowed).toBe(true);

      removeFromAllowlist(SID, 0);
      expect(validateLispCode(code, SID).valid).toBe(false);
    });

    it('无 sessionId 时 allowlist 不生效', () => {
      addToAllowlist(SID, 0);
      expect(validateLispCode('(startapp "x")', null).valid).toBe(false);
    });

    it('getSessionAllowlist 为每个会话维护独立集合', () => {
      addToAllowlist(SID, 0);
      expect(getSessionAllowlist(SID).has(0)).toBe(true);
      expect(getSessionAllowlist('other-session').has(0)).toBe(false);
    });
  });
});
