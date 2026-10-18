import { describe, it, expect } from 'vitest';
import { parseLispRecursive } from '../../src/handler-utils.js';

describe('parseLispRecursive — 字符串转义', () => {
  it('保留未知转义的反斜杠（CAD 控制码不是 Lisp 转义）', () => {
    /* AutoCAD 的 \U+0084（天正钢筋符号）、MTEXT 的 \P/\H2.5x; 都是内容控制码。
       旧实现会丢掉反斜杠，agent 收到字面量 U+0084 / P，既洗不掉也认不出。 */
    expect(parseLispRecursive('"\\U+0084"')).toBe('\\U+0084');
    expect(parseLispRecursive('"a\\Pb"')).toBe('a\\Pb');
    expect(parseLispRecursive('"\\H2.5x;文字"')).toBe('\\H2.5x;文字');
  });

  it('仍处理标准转义', () => {
    expect(parseLispRecursive('"a\\\\b"')).toBe('a\\b');
    expect(parseLispRecursive('"a\\\"b"')).toBe('a"b');
    expect(parseLispRecursive('"a\\nb"')).toBe('a\nb');
    expect(parseLispRecursive('"a\\tb"')).toBe('a\tb');
  });

  it('列表里的转义同样保留', () => {
    const parsed = parseLispRecursive('("text" "3\\U+008412" "type" "TEXT")');

    expect(parsed).toEqual(['text', '3\\U+008412', 'type', 'TEXT']);
  });
});
