import { describe, it, expect } from 'vitest';
import { checkParens } from '../src/lisp-security.js';

describe('checkParens - 有效代码', () => {
  describe('空/无括号', () => {
    it('空字符串应返回有效', () => {
      const result = checkParens('');
      expect(result.valid).toBe(true);
    });

    it('纯字符串应返回有效', () => {
      const result = checkParens('hello world');
      expect(result.valid).toBe(true);
    });

    it('仅空白字符应返回有效', () => {
      const result = checkParens('   ');
      expect(result.valid).toBe(true);
    });
  });

  describe('简单平衡', () => {
    it('单层平衡括号应返回有效', () => {
      const result = checkParens('(+ 1 2)');
      expect(result.valid).toBe(true);
    });

    it('多组平衡括号应返回有效', () => {
      const result = checkParens('(print x) (setq y 1)');
      expect(result.valid).toBe(true);
    });

    it('相邻括号应返回有效', () => {
      const result = checkParens('()()');
      expect(result.valid).toBe(true);
    });
  });

  describe('嵌套平衡', () => {
    it('单层嵌套应返回有效', () => {
      const result = checkParens('((foo))');
      expect(result.valid).toBe(true);
    });

    it('多层嵌套应返回有效', () => {
      const result = checkParens('(((deep)))');
      expect(result.valid).toBe(true);
    });

    it('复杂嵌套应返回有效', () => {
      const result = checkParens('((a b) (c d))');
      expect(result.valid).toBe(true);
    });

    it('不规则嵌套应返回有效', () => {
      const result = checkParens('(a (b (c) d) e)');
      expect(result.valid).toBe(true);
    });
  });

  describe('字符串内括号', () => {
    it('字符串内括号应不计入', () => {
      const result = checkParens('"(foo)"');
      expect(result.valid).toBe(true);
    });

    it('多字符串内括号应不计入', () => {
      const result = checkParens('"(" ")"');
      expect(result.valid).toBe(true);
    });

    it('字符串后接代码应返回有效', () => {
      const result = checkParens('(print "hello")');
      expect(result.valid).toBe(true);
    });
  });

  describe('转义字符', () => {
    it('转义双引号应正确处理', () => {
      const result = checkParens('"foo\\"bar"');
      expect(result.valid).toBe(true);
    });

    it('转义后接括号应返回有效', () => {
      const result = checkParens('"test\\"(x)"');
      expect(result.valid).toBe(true);
    });

    it('连续反斜杠应返回有效', () => {
      const result = checkParens('"\\\\"');
      expect(result.valid).toBe(true);
    });
  });

  describe('注释中的括号', () => {
    it('行注释中的括号应不计入', () => {
      const result = checkParens('(print 1) ; (comment)');
      expect(result.valid).toBe(true);
    });

    it('多行注释应正确处理', () => {
      const result = checkParens('(a) ; comment\n(b)');
      expect(result.valid).toBe(true);
    });

    it('注释中多余括号应不报错', () => {
      const result = checkParens('(print x) ;)))');
      expect(result.valid).toBe(true);
    });
  });

  describe('混合场景', () => {
    it('字符串+代码+注释应返回有效', () => {
      const result = checkParens('(print "x(1)") ; test');
      expect(result.valid).toBe(true);
    });

    it('复杂AutoLISP代码应返回有效', () => {
      const result = checkParens('(defun test (x y) (+ x y))');
      expect(result.valid).toBe(true);
    });

    it('多行代码应返回有效', () => {
      const result = checkParens('(setq x 1)\n(setq y 2)\n(+ x y)');
      expect(result.valid).toBe(true);
    });
  });
});

describe('checkParens - 无效代码', () => {
  describe('多余右括号', () => {
    it('开头多余右括号应返回无效', () => {
      const result = checkParens(')abc');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('多余右括号 )');
      expect(result.pos).toBe(0);
    });

    it('中间多余右括号应返回无效', () => {
      const result = checkParens('a)b');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('多余右括号 )');
      expect(result.pos).toBe(1);
    });

    it('末尾多余右括号应返回无效', () => {
      const result = checkParens('(foo))');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('多余右括号 )');
      expect(result.pos).toBe(5);
    });

    it('多个多余右括号应返回无效', () => {
      const result = checkParens('((a)))');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('多余右括号 )');
    });

    it('字符串内的右括号不应报错', () => {
      const result = checkParens('")"');
      expect(result.valid).toBe(true);
    });
  });

  describe('缺少右括号', () => {
    it('缺少1个右括号应返回无效', () => {
      const result = checkParens('(foo');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('缺少 1 个右括号 )');
    });

    it('缺少2个右括号应返回无效', () => {
      const result = checkParens('((foo');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('缺少 2 个右括号 )');
    });

    it('嵌套未闭合应返回无效', () => {
      const result = checkParens('(defun foo (x)');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('缺少 1 个右括号 )');
    });

    it('多个未闭合应返回无效', () => {
      const result = checkParens('(defun (a (b');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('缺少 3 个右括号 )');
    });
  });

  describe('多余左括号', () => {
    it('多余1个左括号应返回无效', () => {
      const result = checkParens('((foo)');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('缺少 1 个右括号 )');
    });

    it('多余2个左括号应返回无效', () => {
      const result = checkParens('(((foo))');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('缺少 1 个右括号 )');
    });

    it('复杂嵌套应返回有效', () => {
      const result = checkParens('((print x) y)');
      expect(result.valid).toBe(true);
    });
  });

  describe('混合错误', () => {
    it('同时缺少和多于应返回缺少错误', () => {
      const result = checkParens('((foo)');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('缺少 1 个右括号 )');
    });
  });
});

describe('checkParens - 边界情况', () => {
  it('仅反斜杠应返回有效', () => {
    const result = checkParens('\\');
    expect(result.valid).toBe(true);
  });

  it('未闭合字符串应不计入括号', () => {
    const result = checkParens('"abc (open');
    expect(result.valid).toBe(true);
  });

  it('连续反斜杠应返回有效', () => {
    const result = checkParens('\\\\');
    expect(result.valid).toBe(true);
  });

  it('字符串内转义后有代码应正确处理', () => {
    const result = checkParens('"test\\" (code)');
    expect(result.valid).toBe(true);
  });

  it('空注释应返回有效', () => {
    const result = checkParens(';');
    expect(result.valid).toBe(true);
  });

  it('仅有换行应返回有效', () => {
    const result = checkParens('\n');
    expect(result.valid).toBe(true);
  });
});