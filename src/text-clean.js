/**
 * CAD 文本清洗（TEXT / MTEXT / ATTRIB / 天正 TCH_*）。
 *
 * 与 agent `src/shared/analysis-core.js` 的 cleanCadText 保持同一套规则：
 *   - MTEXT：`\P`/`\~`/`\S`/`\f`/`\H`/`\W`/`\Q`/`\T`/`\A`/`\C`/`\p`、`\U+XXXX`；
 *   - TEXT：`%%d`/`%%p`/`%%c`/`%%u`/`%%o`；
 *   - 天正：`%%130~133` 钢筋符号、`%%140~143` 上下标、`U+0082~0085` 钢筋符号。
 *
 * 放在 MCP 侧是为了让 **所有客户端**（浏览器、VSCode、CLI、其他 MCP 客户端）
 * 拿到同一份可读文本；`text` 仍保留原始串，`plainText` 是清洗结果。
 */
const MTEXT_PARAM_CODE = /\\[fFHhWwQqTtAaCcPp][^;]*;/g;
const MTEXT_TOGGLE_CODE = /\\[LOloKk]/g;
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const WHITESPACE = /[ \t\f\v\u00A0\u3000]+/g;

export function cleanCadText(input) {
  if (input === null || input === undefined) return '';

  let s = typeof input === 'string' ? input : String(input);
  if (!s) return '';

  s = s.replace(/\\U\+([0-9A-Fa-f]{4,6})/g, (_, hex) => {
    const cp = parseInt(hex, 16);
    if (cp >= 0x82 && cp <= 0x85) return 'Φ';
    if (cp >= 0x80 && cp <= 0x9f) return '';
    try { return String.fromCodePoint(cp); } catch { return ''; }
  });

  /* MCP 解析器会保留未知转义的反斜杠；但历史客户端可能已经收到字面量 U+0084。 */
  s = s.replace(/U\+008[2-5]/g, 'Φ');
  s = s.replace(/U\+([0-9A-Fa-f]{4,6})/g, (_, hex) => {
    const cp = parseInt(hex, 16);
    if (cp >= 0x80 && cp <= 0x9f) return '';
    try { return String.fromCodePoint(cp); } catch { return ''; }
  });

  s = s.replace(/\\P/g, '\n').replace(/\\~/g, ' ');
  s = s.replace(/\\S([^;]*);/g, '$1');
  s = s.replace(MTEXT_PARAM_CODE, '');
  s = s.replace(MTEXT_TOGGLE_CODE, '');
  s = s
    .replace(/\\\\/g, '\u0000')
    .replace(/\\\{/g, '{')
    .replace(/\\\}/g, '}')
    .replace(/\u0000/g, '\\');

  s = s
    .replace(/%%13[0-3]/g, 'Φ')
    .replace(/%%14[01]/g, (m) => (m === '%%140' ? '^' : ''))
    .replace(/%%14[23]/g, (m) => (m === '%%142' ? '_' : ''))
    .replace(/%%[dD]/g, '°')
    .replace(/%%[pP]/g, '±')
    .replace(/%%[cC]/g, '⌀')
    .replace(/%%%/g, '%')
    .replace(/%%[uUoO]/g, '');

  s = s.replace(/[{}]/g, '');
  s = s.replace(/\r\n?/g, '\n').replace(CONTROL_CHARS, '');
  s = s
    .replace(WHITESPACE, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();

  return s.normalize('NFC');
}

export default cleanCadText;
