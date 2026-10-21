// 结果文件编码回归守卫：
//   AutoLISP (open ... "w") 一律按系统 ANSI 代码页（中文系统 GBK/936）写结果文件，
//   从不写 UTF-8。旧实现用「UTF-8 解码无替换字符 → 按 UTF-8」启发式自动判定，
//   而 GBK 字节对常恰好构成合法 UTF-8 双字节序列（如「暖通」C5AF CDA8 解成 UTF-8
//   是合法字符），导致中文结果被解成乱码（线上症状：DWGNAME 5-ůͨ_...）。
//   修复后：默认按系统 ANSI 代码页解码（与写 .lsp 用的编码一致），仅带 UTF-8 BOM
//   时才按 UTF-8。C# 代码内嵌在 cad-worker.js 的注释块与 cad-rothelper.cs 中，
//   Linux 下无法直接执行，这里做源码级守卫防止启发式被改回来。
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tools as cadTools } from '../src/tools/cad-tools.js';
import { tools as debugTools } from '../src/tools/debug-tools.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readSource(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function assertAnsiFirstDecoding(src, label) {
  // 旧的 UTF-8 优先启发式必须不存在
  expect(src, `${label}: 旧的 UTF-8 优先启发式应已移除`).not.toContain('utf8Result');
  // 新逻辑必须存在：BOM 检查 + 按偏移解码 + 系统 ANSI 代码页
  expect(src, `${label}: 应有 UTF-8 BOM 检查`).toContain('bytes[1] == 0xBB && bytes[2] == 0xBF');
  expect(src, `${label}: 应按偏移解码（跳过 BOM）`).toContain('enc.GetString(bytes, offset, bytes.Length - offset)');
  expect(src, `${label}: 默认应按系统 ANSI 代码页解码`).toContain('TextInfo.ANSICodePage)');
}

describe('cad-worker 结果文件编码', () => {
  it('cad-worker.js 内嵌 C#：ANSI 优先，仅 BOM 走 UTF-8', () => {
    assertAnsiFirstDecoding(readSource('src/cad-worker.js'), 'cad-worker.js');
  });

  it('cad-rothelper.cs：ANSI 优先，仅 BOM 走 UTF-8', () => {
    assertAnsiFirstDecoding(readSource('src/cad-rothelper.cs'), 'cad-rothelper.cs');
  });

  it('eval_lisp_with_result 工具描述不再推荐 utf-8', () => {
    const tool = cadTools.find((t) => t.name === 'eval_lisp_with_result');
    expect(tool, 'eval_lisp_with_result 工具应存在').toBeTruthy();
    const desc = tool.inputSchema.properties.encoding.description;
    expect(desc).not.toContain('utf-8（推荐）');
    expect(desc).toContain('ANSI');
  });

  it('debug_start 工具描述不再默认推荐 gbk 参数', () => {
    const tool = debugTools.find((t) => t.name === 'debug_start');
    expect(tool, 'debug_start 工具应存在').toBeTruthy();
    const desc = tool.inputSchema.properties.encoding.description;
    expect(desc).not.toContain('有中文时建议 gbk');
    expect(desc).toContain('ANSI');
  });
});
