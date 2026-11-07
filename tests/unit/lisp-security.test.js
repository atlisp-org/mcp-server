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

    it('危险 CAD 命令写在字符串里也能拦截（不能只看 strip 后的代码）', () => {
      expect(validateLispCodeWorker('(command "_.quit")').valid).toBe(false);
      expect(validateLispCodeWorker('(command "_.close")').valid).toBe(false);
      // 注释里的命令不算
      expect(validateLispCodeWorker('; (command "_.quit")\n(princ "ok")').valid).toBe(true);
    });

    // 逐条覆盖 SECURITY_RULES，防止正则改坏后某条规则静默失效
    it.each([
      ['(startapp "calc")', 'startapp'],
      ['(vl-bt)', 'vl-bt'],
      ['(vlax-import-type-library :tlb-filename "x")', '导入类型库'],
      ['(dos_command_string "dir")', 'dos_command_string'],
      ['(eval (read "x"))', 'eval'],
      ['(command "_.quit")', '危险 CAD 命令'],
      ['(load "x.lsp")', 'load 函数'],
      ['(read-line f)', '文件 I/O'],
      ['(vl-file-copy "a" "b")', '文件复制'],
      ['(vl-file-delete "a")', '文件删除'],
      ['(vl-file-rename "a" "b")', '文件重命名'],
      ['(vl-registry-write "HKEY" "x" "y")', '注册表'],
      ['(vl-exit-with-value 0)', 'vl-exit-with-value'],
      ['(vl-exit-with-error "x")', 'vl-exit-with-error'],
      ['(vlax-add-cmd "x" (defun x ()))', '注册新命令'],
      ['(vla-Delete obj)', '删除 vla 对象'],
      ['(vla-Save doc)', '保存文档'],
      ['(vla-deletefile fso "x")', '删除文件'],
      ['(vla-copyfile fso "a" "b")', '复制文件'],
      ['(vla-movefile fso "a" "b")', '移动文件'],
    ])('规则拦截: %s', (code, keyword) => {
      const r = validateLispCodeWorker(code);
      expect(r.valid).toBe(false);
      expect(r.error).toContain(keyword);
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

    it('会话 allowlist 有条数上限（LRU 淘汰）', () => {
      const prevMax = config.sandboxAllowlistMax;
      config.sandboxAllowlistMax = 3;
      try {
        for (let i = 0; i < 10; i++) addToAllowlist(`sess-${i}`, 0);
        // 最早的会话被淘汰
        expect(getSessionAllowlist('sess-0').size).toBe(0);
        expect(getSessionAllowlist('sess-9').has(0)).toBe(true);
      } finally {
        config.sandboxAllowlistMax = prevMax;
        for (let i = 0; i < 10; i++) clearSessionAllowlist(`sess-${i}`);
      }
    });
  });
});
