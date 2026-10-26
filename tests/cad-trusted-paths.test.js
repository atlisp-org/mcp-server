// CAD 信任弹窗守卫：
//   长代码（>255 字符或要求返回结果）走临时 .lsp + (load ...)，在非受信任目录会弹
//   「无法验证该可执行文件的发布者，且该文件不在受信任文件夹内」（始终加载/加载一次/不加载），
//   阻断非交互执行。cad-worker.js（edge-js 内嵌 C#）与 cad-rothelper.cs（ROT 通道）都必须：
//     1) 先把 %USERPROFILE%\@lisp\tmp 追加进 TRUSTEDPATHS（COM Get/SetVariable，不占命令行）；
//     2) 该变量拿不到/改不了时（中望/浩辰可能没有这个变量、BricsCAD 的该变量只读、
//        AutoCAD 也可能被管理员锁定）绝不能用空值写回（会清掉用户已有的受信任路径），
//        改走分块通道：把代码按字符串常量注入命令行 + 内存 eval，全程不 load 文件，
//        任何 CAD 都不会触发信任检查。
//   C# 内嵌在 JS 注释块与 .cs 中，Linux 下无法执行，这里做源码级守卫，
//   并按源码里的实际命令模板静态计算单条命令长度上限（命令行 255 字符限制）。
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readSource(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

const sources = [
  // guard：判断「信任是否就绪」的调用点（worker 内联、rothelper 走 helper）
  ['src/cad-worker.js', 'edge-js 通道', 'GetVariable("TRUSTEDPATHS")'],
  ['src/cad-rothelper.cs', 'ROT 通道', 'EnsureTrustedPaths(doc, tempDir)'],
];

describe('CAD 信任弹窗：TRUSTEDPATHS 预置 + 分块回退', () => {
  for (const [rel, label, guard] of sources) {
    describe(`${rel}（${label}）`, () => {
      const src = readSource(rel);

      it('用 COM 读写 TRUSTEDPATHS（不走 255 字符受限的命令行）', () => {
        expect(src).toContain('GetVariable("TRUSTEDPATHS")');
        expect(src).toContain('SetVariable("TRUSTEDPATHS"');
        expect(src).toContain('OrdinalIgnoreCase');
      });

      it('信任目录在 (load ...) 之前就绪', () => {
        const trustIdx = src.indexOf(guard);
        const loadIdx = src.indexOf('SendCommand("(load ');
        expect(trustIdx).toBeGreaterThan(-1);
        expect(loadIdx).toBeGreaterThan(-1);
        expect(trustIdx).toBeLessThan(loadIdx);
      });

      it('读不到变量时不得用空值写回（否则清掉用户已有受信任路径）', () => {
        // 旧写法：内层 catch 把 currentTrust 置空，随后照常 SetVariable，
        // 会用「空值 + tempDir」覆盖整串受信任路径。
        expect(src).not.toMatch(/currentTrust = "";/);
        const catchBlocks = src.match(/catch \(Exception[^)]*\)\s*\{[^}]*TRUSTEDPATHS[^}]*\}/g) || [];
        for (const block of catchBlocks) {
          expect(block).not.toContain('SetVariable');
        }
      });

      it('变量不可用时改走分块通道（不 load 文件 → 不触发信任检查）', () => {
        expect(src).toContain('*atlisp_chunk*');
        expect(src).toContain('(chr 10)');
        expect(src).toContain('(eval (read (strcat "(progn " *atlisp_chunk* ")")');
        // 分块通道必须排在信任检查之后（先尝试信任，失败才回退）
        expect(src.indexOf('GetVariable("TRUSTEDPATHS")')).toBeLessThan(src.indexOf('*atlisp_chunk*'));
      });

      it('LISP 字符串转义只处理 \\ 和 "（先转义反斜杠）', () => {
        expect(src).toContain('.Replace("\\\\", "\\\\\\\\").Replace("\\"", "\\\\\\"")');
      });

      it('单条注入命令不超过命令行 255 字符上限', () => {
        // 预算：expr 最多 180 字符（packing 条件 candidate.Length > 180 时 flush）
        expect(src).toContain('> 180');
        const budget = Number((src.match(/> 180\b/) || [])[0].replace(/\D/g, ''));
        expect(budget).toBe(180);

        const firstPrefix = '(progn (setq *atlisp_chunk* (strcat ';
        const nextPrefix = '(progn (setq *atlisp_chunk* (strcat *atlisp_chunk* ';
        const suffix = ')) (princ))';
        expect(src).toContain(firstPrefix);
        expect(src).toContain(nextPrefix);

        const maxNext = nextPrefix.length + budget + suffix.length + 1; // +1 = 尾部换行
        expect(maxNext).toBeLessThanOrEqual(255);

        // 收尾命令：eval 固定文本 + 结果写文件（open/写/close 同一条命令）
        const evalCmd = src.match(/\(setq \*atlisp_ar\* \(vl-catch-all-apply[^\n"]*/);
        expect(evalCmd, '缺少 eval 收尾命令').not.toBeNull();
        expect(evalCmd[0].length).toBeLessThan(200);
        expect(src).toMatch(
          /\(progn \(setq \*atlisp_af\* \(open [\s\S]{0,200}\(princ \*atlisp_ar\* \*atlisp_af\*\) \(close \*atlisp_af\*\)/,
        );
      });
    });
  }

  it('cad-rothelper.cs 的分块命令由独立 helper 生成', () => {
    const src = readSource('src/cad-rothelper.cs');
    expect(src).toContain('static List<string> BuildChunkCommands(string code, string tempFile)');
    expect(src).toContain('static bool EnsureTrustedPaths(dynamic doc, string tempDir)');
    // 文件方式只在信任就绪时写临时文件
    const branch = src.slice(src.indexOf('if (EnsureTrustedPaths(doc, tempDir))'));
    const elseIdx = branch.indexOf('else');
    expect(branch.slice(0, elseIdx)).toContain('File.WriteAllText(userCodeFile');
    expect(branch.slice(elseIdx)).toContain('BuildChunkCommands(code, tempFile)');
  });

  it('cad-worker.js 的文件方式只在信任就绪时写临时文件', () => {
    const src = readSrcWorker();
    const start = src.indexOf('bool trustReady = false;');
    const end = src.indexOf('int retries = 10;', start);
    const body = src.slice(start, end);
    const elseIdx = body.indexOf('} else {');
    expect(elseIdx).toBeGreaterThan(-1);
    // 信任就绪分支才写 .lsp；else 分支只发分块命令
    expect(body.slice(0, elseIdx)).toContain('File.WriteAllText(userCodeFile');
    expect(body.slice(elseIdx)).not.toContain('(load \\"');
    expect(body.slice(elseIdx)).toContain('*atlisp_chunk*');
  });
});

function readSrcWorker() {
  return readSource('src/cad-worker.js');
}
