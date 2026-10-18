// text-clean.js 单测：覆盖 MTEXT 控制码、Unicode/天正符号、字面转义与空白归一化。
import { describe, it, expect } from 'vitest';
import { cleanCadText } from '../../src/text-clean.js';

describe('cleanCadText / 输入归一化', () => {
  it('null/undefined/空串返回空串', () => {
    expect(cleanCadText(null)).toBe('');
    expect(cleanCadText(undefined)).toBe('');
    expect(cleanCadText('')).toBe('');
  });

  it('非字符串转成字符串', () => {
    expect(cleanCadText(0)).toBe('0');
    expect(cleanCadText(12.5)).toBe('12.5');
  });

  it('输出 NFC', () => {
    expect(cleanCadText('e\u0301')).toBe('é');
  });
});

describe('cleanCadText / Unicode 转义', () => {
  it('\\U+XXXX 转字符', () => {
    expect(cleanCadText('\\U+4E2D\\U+6587')).toBe('中文');
  });

  it('天正 C1 区钢筋符号 U+0082~0085 转 Φ', () => {
    expect(cleanCadText('\\U+0082')).toBe('Φ');
    expect(cleanCadText('\\U+0085')).toBe('Φ');
  });

  it('其它 C1 控制字符丢弃', () => {
    expect(cleanCadText('\\U+0086')).toBe('');
  });

  it('解析器吞掉反斜杠后的字面量 U+0084 也能识别', () => {
    expect(cleanCadText('U+0084')).toBe('Φ');
  });

  it('非法/越界码点安全处理', () => {
    expect(cleanCadText('\\U+ZZZZ')).toBe('\\U+ZZZZ');
    expect(cleanCadText('\\U+110000')).toBe('');
  });
});

describe('cleanCadText / MTEXT 控制码', () => {
  it('\\P 换行、\\~ 空格', () => {
    expect(cleanCadText('A\\PB')).toBe('A\nB');
    expect(cleanCadText('A\\~B')).toBe('A B');
  });

  it('\\S 堆叠取内容', () => {
    expect(cleanCadText('\\S1^2;')).toBe('1^2');
    expect(cleanCadText('公差\\S+0.1^-0.1;mm')).toBe('公差+0.1^-0.1mm');
  });

  it('带参数字体/字高/宽度码被移除', () => {
    expect(cleanCadText('\\H2.5x;Hello')).toBe('Hello');
    expect(cleanCadText('\\fArial|b0|i0;Hi')).toBe('Hi');
    expect(cleanCadText('\\W0.8;窄字')).toBe('窄字');
    expect(cleanCadText('\\C1;红')).toBe('红');
  });

  it('切换类控制码被移除', () => {
    expect(cleanCadText('\\Lunder\\l')).toBe('under');
    expect(cleanCadText('\\Oover\\o')).toBe('over');
    expect(cleanCadText('\\Kstrike\\k')).toBe('strike');
  });

  it('分组花括号移除，转义花括号保留为字面量', () => {
    expect(cleanCadText('plain {group} text')).toBe('plain group text');
    expect(cleanCadText('\\{literal\\} {group}')).toBe('{literal} group');
    expect(cleanCadText('a\\{b\\}c')).toBe('a{b}c');
  });

  it('反斜杠转义还原', () => {
    expect(cleanCadText('a\\\\b')).toBe('a\\b');
  });
});

describe('cleanCadText / 天正与 AutoCAD 符号', () => {
  it('%%130~133 钢筋符号转 Φ', () => {
    expect(cleanCadText('%%130%%131%%132%%133')).toBe('ΦΦΦΦ');
  });

  it('%%140~143 上下标', () => {
    expect(cleanCadText('%%140x%%141')).toBe('^x');
    expect(cleanCadText('%%142y%%143')).toBe('_y');
  });

  it('%%d/%%p/%%c/%%%/%%u/%%o', () => {
    expect(cleanCadText('30%%d')).toBe('30°');
    expect(cleanCadText('%%p0.5')).toBe('±0.5');
    expect(cleanCadText('%%c20')).toBe('⌀20');
    expect(cleanCadText('100%%%')).toBe('100%');
    expect(cleanCadText('%%u下划线%%o')).toBe('下划线');
  });
});

describe('cleanCadText / 空白与控制字符', () => {
  it('连续空白归一为单个空格', () => {
    expect(cleanCadText('  a   b\t c ')).toBe('a b c');
    expect(cleanCadText('a\u00A0\u3000b')).toBe('a b');
  });

  it('CRLF / CR 归一为 LF，压缩空行', () => {
    expect(cleanCadText('a\r\nb\rc')).toBe('a\nb\nc');
    expect(cleanCadText('a\n\n\n b')).toBe('a\nb');
  });

  it('控制字符被移除', () => {
    expect(cleanCadText('\u0007bell\u001f')).toBe('bell');
    expect(cleanCadText('a\u007Fb')).toBe('ab');
  });

  it('换行两侧空格被裁掉', () => {
    expect(cleanCadText('a   \n   b')).toBe('a\nb');
  });
});
