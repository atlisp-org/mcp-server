// 一次性 codemod：根据 eslint -f json 报告修复 no-unused-vars
// 用法:
//   npx eslint src/ -f json -o /tmp/opencode/lint.json
//   node scripts/fix-unused.mjs /tmp/opencode/lint.json <imports|catch|args>
import fs from 'node:fs';

const reportPath = process.argv[2];
const mode = process.argv[3];
if (!reportPath || !['imports', 'catch', 'args'].includes(mode)) {
  console.error('用法: node scripts/fix-unused.mjs <eslint-json> <imports|catch|args>');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const skipped = [];
let fixed = 0;

for (const file of data) {
  if (!file.messages.length) continue;
  const source = fs.readFileSync(file.filePath, 'utf8');
  const lines = source.split('\n');
  const offsets = [];
  let acc = 0;
  for (const l of lines) {
    offsets.push(acc);
    acc += l.length + 1;
  }

  const spanEdits = [];
  const lineEdits = [];

  for (const m of file.messages) {
    if (m.ruleId !== 'no-unused-vars') continue;
    const nameMatch = m.message.match(/'([^']+)'/);
    if (!nameMatch) continue;
    const name = nameMatch[1];
    const lineText = lines[m.line - 1] ?? '';
    const trimmed = lineText.trim();

    if (mode === 'imports') {
      if (!trimmed.startsWith('import ')) continue;
      const sug = m.suggestions?.find((s) => s.messageId === 'removeVar');
      if (sug?.fix) {
        spanEdits.push({ start: sug.fix.range[0], end: sug.fix.range[1], text: sug.fix.text });
        fixed++;
      } else {
        skipped.push(`${file.filePath}:${m.line} ${name}`);
      }
      continue;
    }

    if (mode === 'catch') {
      const before = lineText.slice(0, m.column - 1);
      let re = null;
      let repl = '';
      if (/catch\s*\(\s*$/.test(before)) {
        re = new RegExp(`catch\\s*\\(\\s*${name}\\s*\\)`);
        repl = 'catch';
      } else if (/\.catch\(\s*$/.test(before)) {
        re = new RegExp(`\\.catch\\(\\s*${name}\\s*=>`);
        repl = '.catch(() =>';
      }
      if (re && re.test(lineText)) {
        lineEdits.push({ idx: m.line - 1, from: lineText, to: lineText.replace(re, repl) });
        fixed++;
      }
      continue;
    }

    // args：未使用参数加 _ 前缀
    if (m.message.includes('assigned a value but never used')) continue; // 手工处理
    if (trimmed.startsWith('import ')) continue;
    if (/^_/.test(name)) continue;
    const before = lineText.slice(0, m.column - 1);
    if (/catch\s*\(\s*$/.test(before) || /\.catch\(\s*$/.test(before)) continue; // catch 模式处理
    const start = offsets[m.line - 1] + m.column - 1;
    // 校验该位置确实是这个名字（防报告过期）
    if (source.slice(start, start + name.length) !== name) {
      skipped.push(`${file.filePath}:${m.line} ${name} (span 不匹配，跳过)`);
      continue;
    }
    spanEdits.push({ start, end: start + name.length, text: `_${name}` });
    fixed++;
  }

  if (!spanEdits.length && !lineEdits.length) continue;

  let out = source;
  if (lineEdits.length) {
    const arr = out.split('\n');
    for (const le of lineEdits.reverse()) arr[le.idx] = le.to;
    out = arr.join('\n');
  }
  spanEdits.sort((a, b) => b.start - a.start);
  for (const e of spanEdits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  fs.writeFileSync(file.filePath, out);
}

console.log(`[${mode}] 修复 ${fixed} 处${skipped.length ? '，跳过:' : ''}`);
skipped.forEach((s) => console.log('  SKIP', s));
