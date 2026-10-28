#!/usr/bin/env node
import edge from 'edge-js';
import process from 'process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { validateLispCodeWorker, checkParens } from './lisp-security.js';
import config from './config.js';
import { enableConsoleTimestamp } from './console-timestamp.js';

// 运行时日志每行带时间（stdout 协议通道走 process.stdout.write，不受影响）
enableConsoleTimestamp();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const _dllPath = path.join(__dirname, '..', 'dist', 'cad-rothelper.dll');

function _loadDll(methodName) {
  try {
    return edge.func({
      assemblyFile: _dllPath,
      typeName: 'CadRotHelper.ConnectionManager',
      methodName,
    });
  } catch {
    return null;
  }
}

function _loadEnum() {
  try {
    return edge.func({
      assemblyFile: _dllPath,
      typeName: 'CadRotHelper.RotEnumerator',
      methodName: 'EnumerateAll',
    });
  } catch {
    return null;
  }
}

const _rotConnect = _loadDll('RotConnect');
const _rotDisconnect = _loadDll('RotDisconnect');
const _rotSendCmd = _loadDll('RotSendCommand');
const _rotSendResult = _loadDll('RotSendWithResult');
const _rotIsBusy = _loadDll('RotIsBusy');
const _rotHasDoc = _loadDll('RotHasDoc');
const _rotDocInfo = _loadDll('RotGetActiveDocInfo');
const _rotBringToFront = _loadDll('RotBringToFront');
const _rotSendEsc = _loadDll('RotSendEsc');
const _rotNewDoc = _loadDll('RotNewDoc');
const _rotOpenDoc = _loadDll('RotOpenDoc');
const _rotSaveDoc = _loadDll('RotSaveDoc');
const _rotEnum = _loadEnum();

let _monikerSession = null;

const BUSY_RETRIES = parseInt(process.env.BUSY_RETRIES || '5', 10);
const BUSY_DELAY = parseInt(process.env.BUSY_DELAY || '300', 10);

const LISP_CACHE = new Map();
const LISP_CACHE_MAX = parseInt(process.env.LISP_CACHE_MAX || '500', 10);
const CACHE_TTL = parseInt(process.env.LISP_CACHE_TTL || '300000', 10);

function getCachedLisp(code) {
  const hash = crypto.createHash('sha256').update(code).digest('hex');
  const entry = LISP_CACHE.get(hash);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) {
    LISP_CACHE.delete(hash);
    return null;
  }
  entry.ts = Date.now();
  LISP_CACHE.delete(hash);
  LISP_CACHE.set(hash, entry);
  return entry.compiled;
}

function setCachedLisp(code, compiled) {
  const hash = crypto.createHash('sha256').update(code).digest('hex');
  if (LISP_CACHE.has(hash)) LISP_CACHE.delete(hash);
  if (LISP_CACHE.size >= LISP_CACHE_MAX) {
    LISP_CACHE.delete(LISP_CACHE.keys().next().value);
  }
  LISP_CACHE.set(hash, { compiled, ts: Date.now() });
  return compiled;
}

const DEBUG_FILE = process.env.DEBUG_FILE || path.join(process.env.TEMP || '/tmp', 'cad-worker-debug.log');

function log(msg) {
    const entry = `${new Date().toISOString()} ${msg}\n`;
    if (process.env.DEBUG) {
        fs.appendFile(DEBUG_FILE, entry, () => {});
    }
}

// 内存监控
const MEMORY_CHECK_INTERVAL = 10000; // 每 10 秒检查一次
const MEMORY_WARNING_THRESHOLD = 100 * 1024 * 1024; // 100MB 警告阈值
const MEMORY_CRITICAL_THRESHOLD = 200 * 1024 * 1024; // 200MB 严重阈值

function checkMemoryUsage() {
    const memUsage = process.memoryUsage();
    const heapUsed = memUsage.heapUsed;
    
    if (heapUsed > MEMORY_CRITICAL_THRESHOLD) {
        log(`[Worker] 内存严重: ${(heapUsed / 1024 / 1024).toFixed(2)}MB，建议重启 worker`);
        // 尝试强制垃圾回收
        if (global.gc) {
            global.gc();
            log(`[Worker] 已执行强制垃圾回收`);
        }
    } else if (heapUsed > MEMORY_WARNING_THRESHOLD) {
        log(`[Worker] 内存警告: ${(heapUsed / 1024 / 1024).toFixed(2)}MB`);
    }
    
    return heapUsed;
}

// 定期检查内存使用
setInterval(checkMemoryUsage, MEMORY_CHECK_INTERVAL);

const cadConnect = edge.func(function() {/*
  async (input) => {
      try {
          dynamic cad = System.Runtime.InteropServices.Marshal.GetActiveObject("AutoCAD.Application");
          if (cad != null) {
              string ver = cad.Version.ToString();
              return new { success = true, platform = "AutoCAD", version = ver };
          }
      } catch (Exception ex) {
          System.Diagnostics.Debug.WriteLine("AutoCAD connect error: " + ex.Message);
      }
      try {
          dynamic cad = System.Runtime.InteropServices.Marshal.GetActiveObject("ZWCAD.Application");
          if (cad != null) {
              string ver = cad.Version.ToString();
              return new { success = true, platform = "ZWCAD", version = ver };
          }
      } catch (Exception ex) {
          System.Diagnostics.Debug.WriteLine("ZWCAD connect error: " + ex.Message);
      }
      try {
          dynamic cad = System.Runtime.InteropServices.Marshal.GetActiveObject("GStarCAD.Application");
          if (cad != null) {
              string ver = cad.Version.ToString();
              return new { success = true, platform = "GStarCAD", version = ver };
          }
      } catch (Exception ex) {
          System.Diagnostics.Debug.WriteLine("GStarCAD connect error: " + ex.Message);
      }
      try {
          dynamic cad = System.Runtime.InteropServices.Marshal.GetActiveObject("BricscadApp.AcadApplication");
          if (cad != null) {
              string ver = cad.Version.ToString();
              return new { success = true, platform = "BricsCAD", version = ver };
          }
      } catch (Exception ex) {
          System.Diagnostics.Debug.WriteLine("BricsCAD connect error: " + ex.Message);
      }
      return new { success = false, error = "No CAD found" };
  }
*/});

const cadLaunch = edge.func(function() {/*
  async (input) => {
      string[] platforms = { "AutoCAD", "ZWCAD", "GStarCAD", "BricsCAD" };
      string[] progIds = { "AutoCAD.Application", "ZWCAD.Application", "GStarCAD.Application", "BricscadApp.AcadApplication" };

      for (int i = 0; i < platforms.Length; i++) {
          try {
              dynamic cad = System.Runtime.InteropServices.Marshal.GetActiveObject(progIds[i]);
              if (cad != null) {
                  string ver = cad.Version.ToString();
                  return new { success = true, platform = platforms[i], version = ver, launched = false };
              }
          } catch {}
      }

      for (int i = 0; i < platforms.Length; i++) {
          try {
              var type = System.Type.GetTypeFromProgID(progIds[i]);
              if (type != null) {
                  dynamic cad = System.Activator.CreateInstance(type);
                  if (cad != null) {
                      for (int retry = 0; retry < 60; retry++) {
                          await System.Threading.Tasks.Task.Delay(500);
                          try {
                              string ver = cad.Version.ToString();
                              return new { success = true, platform = platforms[i], version = ver, launched = true };
                          } catch {}
                      }
                  }
              }
          } catch (Exception ex) {
               System.Diagnostics.Debug.WriteLine("cadLaunch create " + progIds[i] + " error: " + ex.Message);
          }
      }

      return new { success = false, error = "No CAD found" };
  }
*/});

const cadSend = edge.func(function() {/*
  async (input) => {
      try {
          dynamic d = input;
string code = d.code.ToString();
          string platform = d.platform.ToString();
          string progId = platform == "BricsCAD" ? "BricscadApp.AcadApplication" : platform + ".Application";
          dynamic cad = System.Runtime.InteropServices.Marshal.GetActiveObject(progId);
          if (cad != null) {
              dynamic doc = cad.ActiveDocument;
              if (doc != null) {
                  doc.SendCommand(code);
                  return new { success = true };
              }
          }
      } catch (Exception ex) {
          System.Diagnostics.Debug.WriteLine("cadSend error: " + ex.Message);
      }
      return new { success = false };
  }
 */});

const cadSendWithResult = edge.func(function() {/*
  async (input) => {
      string tempFile = null;
      string lispFile = null;
      string userCodeFile = null;
      try {
          dynamic d = input;
          string code = d.code.ToString();
          string platform = d.platform.ToString();
string encoding = d.encoding != null ? d.encoding.ToString() : "";
          string codeHash = d.codeHash != null ? d.codeHash.ToString() : "";
          bool cacheEnabled = d.cacheEnabled != null && d.cacheEnabled.ToString() == "True";
          bool hasCacheKey = cacheEnabled && !string.IsNullOrEmpty(codeHash);
          string progId = platform == "BricsCAD" ? "BricscadApp.AcadApplication" : platform + ".Application";
          string tempDir = System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "@lisp", "tmp");
          System.IO.Directory.CreateDirectory(tempDir);

          tempFile = System.IO.Path.Combine(tempDir, "atlisp_result_" + System.Guid.NewGuid().ToString("N") + ".txt");

          string fileKey = hasCacheKey ? codeHash : System.Guid.NewGuid().ToString("N");
          userCodeFile = System.IO.Path.Combine(tempDir, "atlisp_user_" + fileKey + ".lsp");
          lispFile = System.IO.Path.Combine(tempDir, "atlisp_code_" + fileKey + ".lsp");

          dynamic cad = System.Runtime.InteropServices.Marshal.GetActiveObject(progId);
          if (cad != null) {
              dynamic doc = cad.ActiveDocument;
              if (doc != null) {
                  // 前提：把 tempDir 追加进受信任路径（参照 kernel/src/setup.lsp 的
                  // @::add-path-in-trustedpaths 语义）。否则文件方式的 (load ...) 会弹
                  // 「无法验证该可执行文件的发布者，且该文件不在受信任文件夹内」对话框，
                  // 阻断非交互执行。COM Get/SetVariable 不占命令行、无 255 字符限制、同步生效。
                  // 中望/浩辰可能没有这个变量，BricsCAD 的该变量只读，AutoCAD 也可能被管理员锁定；
                  // 拿不到或改不了（trustReady=false）就改走分块通道：不 load 任何文件，
                  // 任何 CAD 都不会触发信任检查。
                  bool trustReady = false;
                  try {
                      // 读失败时绝不能写：否则会用「空值 + tempDir」覆盖用户已有的整串受信任路径
                      object trustValue = doc.GetVariable("TRUSTEDPATHS");
                      string currentTrust = trustValue as string ?? "";
                      foreach (string trustEntry in currentTrust.Split(';')) {
                          if (string.Equals(trustEntry.Trim(), tempDir, System.StringComparison.OrdinalIgnoreCase)) { trustReady = true; break; }
                      }
                      if (!trustReady) {
                          string newTrust = string.IsNullOrEmpty(currentTrust) ? tempDir : currentTrust.TrimEnd(';') + ";" + tempDir;
                          doc.SetVariable("TRUSTEDPATHS", newTrust);
                          trustReady = true;
                      }
                  } catch (Exception trustEx) {
                      trustReady = false;
                      System.Diagnostics.Debug.WriteLine("TRUSTEDPATHS unavailable: " + trustEx.Message);
                  }

                  if (trustReady) {
                      // ── 文件方式：临时 .lsp + (load ...)，要求 tempDir 已在受信任路径里 ──
                      bool useCachedUserCode = false;
                      if (hasCacheKey) {
                          if (System.IO.File.Exists(userCodeFile)) {
                              var userFileInfo = new System.IO.FileInfo(userCodeFile);
                              if ((DateTime.Now - userFileInfo.LastWriteTime).TotalHours < 1) {
                                  useCachedUserCode = true;
                              }
                          }
                      }

                      if (!useCachedUserCode) {
                          System.IO.File.WriteAllText(userCodeFile, code, System.Text.Encoding.GetEncoding(System.Globalization.CultureInfo.CurrentCulture.TextInfo.ANSICodePage));
                      }

                      string lispCode = "(progn"
                          + "(setq f(open \"" + tempFile.Replace("\\", "\\\\") + "\" \"w\"))"
                          + "(setq r(vl-catch-all-apply '(lambda ()(load \"" + userCodeFile.Replace("\\", "\\\\") + "\"))))"
                          + "(if (vl-catch-all-error-p r)"
                          + "(princ(strcat \"ERROR:\"(vl-catch-all-error-message r)) f)"
                          + "(princ r f))"
                          + "(close f)"
                          + "(princ))";

                      System.IO.File.WriteAllText(lispFile, lispCode, System.Text.Encoding.GetEncoding(System.Globalization.CultureInfo.CurrentCulture.TextInfo.ANSICodePage));

                      doc.SendCommand("(load \"" + lispFile.Replace("\\", "\\\\") + "\")\n");
                  } else {
                      // ── 分块方式：不 load 文件，所以不触发任何信任检查 ──
                      // 把代码按「LISP 字符串常量分块累积」注入命令行，最后用
                      // (eval (read (strcat "(progn " *atlisp_chunk* ")"))) 在内存里执行。
                      // 每条命令 ≤ 250 字符（命令行 255 上限）。
                      // AutoLISP 字符串字面量只保证 \\ 和 \" 两种转义，换行必须用 (chr 10) 还原；
                      // 按行拆、按 180 硬切都只是切字符串常量内容，不改变语义。
                      System.Func<string, string> escLisp = (s) => s.Replace("\\", "\\\\").Replace("\"", "\\\"");
                      var chunkTokens = new System.Collections.Generic.List<string>();
                      string[] codeLines = code.Replace("\r\n", "\n").Replace("\r", "\n").Split('\n');
                      for (int li = 0; li < codeLines.Length; li++) {
                          if (li > 0) chunkTokens.Add("(chr 10)");
                          string codeLine = codeLines[li];
                          int pos = 0;
                          while (pos < codeLine.Length) {
                              int take = System.Math.Min(180, codeLine.Length - pos);
                              string lit = "\"" + escLisp(codeLine.Substring(pos, take)) + "\"";
                              while (take > 1 && lit.Length > 180) {
                                  take--;
                                  lit = "\"" + escLisp(codeLine.Substring(pos, take)) + "\"";
                              }
                              chunkTokens.Add(lit);
                              pos += take;
                          }
                      }

                      var chunkCmds = new System.Collections.Generic.List<string>();
                      string chunkExpr = "";
                      bool firstChunkCmd = true;
                      foreach (string chunkToken in chunkTokens) {
                          string candidate = chunkExpr.Length == 0 ? chunkToken : chunkExpr + " " + chunkToken;
                          if (chunkExpr.Length > 0 && candidate.Length > 180) {
                              chunkCmds.Add(firstChunkCmd
                                  ? "(progn (setq *atlisp_chunk* (strcat " + chunkExpr + ")) (princ))"
                                  : "(progn (setq *atlisp_chunk* (strcat *atlisp_chunk* " + chunkExpr + ")) (princ))");
                              firstChunkCmd = false;
                              chunkExpr = chunkToken;
                          } else {
                              chunkExpr = candidate;
                          }
                      }
                      if (chunkExpr.Length > 0) {
                          chunkCmds.Add(firstChunkCmd
                              ? "(progn (setq *atlisp_chunk* (strcat " + chunkExpr + ")) (princ))"
                              : "(progn (setq *atlisp_chunk* (strcat *atlisp_chunk* " + chunkExpr + ")) (princ))");
                      }
                      if (chunkCmds.Count == 0) {
                          chunkCmds.Add("(progn (setq *atlisp_chunk* \"\") (princ))");
                      }
                      chunkCmds.Add("(setq *atlisp_ar* (vl-catch-all-apply '(lambda () (eval (read (strcat \"(progn \" *atlisp_chunk* \")\"))))))");
                      chunkCmds.Add("(setq *atlisp_ar* (if (vl-catch-all-error-p *atlisp_ar*) (strcat \"ERROR:\" (vl-catch-all-error-message *atlisp_ar*)) *atlisp_ar*))");
                      // 结果文件必须等 eval 结束才创建：open/写/close 放同一条命令，
                      // 否则轮询会在 eval 期间读到空文件（和文件方式的行为对齐）
                      chunkCmds.Add("(progn (setq *atlisp_af* (open \"" + tempFile.Replace("\\", "\\\\") + "\" \"w\")) (princ *atlisp_ar* *atlisp_af*) (close *atlisp_af*) (princ))");
                      chunkCmds.Add("(progn (setq *atlisp_chunk* nil) (princ))");
                      foreach (string chunkCmd in chunkCmds) {
                          doc.SendCommand(chunkCmd + "\n");
                          System.Threading.Thread.Sleep(10);
                      }
                  }

                  int retries = 10;
                  string result = "";
                  string rawBase64 = "";
                  while (retries > 0 && !System.IO.File.Exists(tempFile)) {
                      System.Threading.Thread.Sleep(200);
                      retries--;
                  }
                  if (System.IO.File.Exists(tempFile)) {
                      retries = 5;
                      while (retries > 0) {
                          try {
                              byte[] bytes = System.IO.File.ReadAllBytes(tempFile);
                              rawBase64 = System.Convert.ToBase64String(bytes);
                              System.Text.Encoding enc;
                              int offset = 0;

                              if (!string.IsNullOrEmpty(encoding)) {
                                  enc = System.Text.Encoding.GetEncoding(encoding);
                              } else if (bytes.Length >= 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF) {
                                  // 带 UTF-8 BOM 才按 UTF-8 解码（AutoLISP 不会写 BOM，此处仅作兜底）
                                  enc = System.Text.Encoding.UTF8;
                                  offset = 3;
                              } else {
                                  // AutoLISP (open ... "w") 一律按系统 ANSI 代码页（中文系统 GBK/936）写结果文件，
                                  // 不可能是 UTF-8；GBK 字节对常恰好构成合法 UTF-8 双字节序列，
                                  // 旧「无替换字符 -> UTF-8」启发式会把大量中文误判成 UTF-8 解出乱码。
                                  // 因此默认用系统 ANSI 代码页（与上方写 .lsp 文件用的编码一致）。
                                  try {
                                      enc = System.Text.Encoding.GetEncoding(System.Globalization.CultureInfo.CurrentCulture.TextInfo.ANSICodePage);
                                  } catch {
                                      try {
                                          enc = System.Text.Encoding.GetEncoding("gbk");
                                      } catch {
                                          enc = System.Text.Encoding.UTF8;
                                      }
                                  }
                              }

                              result = enc.GetString(bytes, offset, bytes.Length - offset).Trim();

                              if (result.StartsWith("ERROR:")) {
                                  return new { success = false, error = result.Substring(6).Trim() };
                              }

                              try { System.IO.File.Delete(tempFile); } catch {}
                              try { System.IO.File.Delete(lispFile); } catch {}
                              if (!hasCacheKey) { try { if (System.IO.File.Exists(userCodeFile)) System.IO.File.Delete(userCodeFile); } catch {} }
                              break;
                          } catch (System.IO.IOException) {
                              System.Threading.Thread.Sleep(200);
                              retries--;
                          }
                      }
                      if (!string.IsNullOrEmpty(result)) {
                          return new { success = true, result = result, rawBase64 = rawBase64 };
                      }
                      return new { success = true, result = "", rawBase64 = rawBase64 };
                  }
                  return new { success = true, result = "" };
              }
          }
      } catch (Exception ex) {
          System.Diagnostics.Debug.WriteLine("cadSendWithResult error: " + ex.Message);
          if (tempFile != null) {
              try { if (System.IO.File.Exists(tempFile)) System.IO.File.Delete(tempFile); } catch {}
          }
          if (lispFile != null) {
              try { if (System.IO.File.Exists(lispFile)) System.IO.File.Delete(lispFile); } catch {}
          }
          if (userCodeFile != null) {
              try { if (System.IO.File.Exists(userCodeFile)) System.IO.File.Delete(userCodeFile); } catch {}
          }
          return new { success = false, error = ex.Message };
      }
      if (tempFile != null) {
          try { if (System.IO.File.Exists(tempFile)) System.IO.File.Delete(tempFile); } catch {}
      }
      if (lispFile != null) {
          try { if (System.IO.File.Exists(lispFile)) System.IO.File.Delete(lispFile); } catch {}
      }
      if (userCodeFile != null) {
          try { if (System.IO.File.Exists(userCodeFile)) System.IO.File.Delete(userCodeFile); } catch {}
      }
      return new { success = false };
  }
  */});

const cadGetActiveDocInfo = edge.func(function() {/*
  async (input) => {
      try {
          string platform = input.ToString();
          string progId = platform == "BricsCAD" ? "BricscadApp.AcadApplication" : platform + ".Application";
          dynamic cad = System.Runtime.InteropServices.Marshal.GetActiveObject(progId);
          if (cad != null) {
              int docCount = cad.Documents.Count;
              string docName = "";
              string docPath = "";
              try {
                  docName = cad.ActiveDocument.Name;
                  docPath = cad.ActiveDocument.FullName;
              } catch {}
              return new { hasDoc = docCount > 0, docCount = docCount, docName = docName, docPath = docPath };
          }
      } catch (Exception ex) {
          System.Diagnostics.Debug.WriteLine("cadGetActiveDocInfo error: " + ex.Message);
      }
      return new { hasDoc = false, docCount = 0, docName = "", docPath = "" };
  }
 */});

const cadStartMonitor = edge.func(function() {/*
  async (input) => {
      try {
          string platform = input.ToString();
          string progId = platform == "BricsCAD" ? "BricscadApp.AcadApplication" : platform + ".Application";
          dynamic cad = System.Runtime.InteropServices.Marshal.GetActiveObject(progId);
          if (cad == null) return new { success = false, error = "CAD not found" };

          string prevName = "";
          var timer = new System.Threading.Timer((_) => {
              try {
                  string docName = cad.ActiveDocument.Name;
                  if (docName != prevName) {
                      prevName = docName;
                      string docPath = "";
                      try { docPath = cad.ActiveDocument.FullName; } catch {}
                      string json = "{\"type\":\"event\",\"eventType\":\"documentChanged\",\"docName\":\"" +
                          docName.Replace("\\", "\\\\").Replace("\"", "\\\"") +
                          "\",\"docPath\":\"" +
                          docPath.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"}";
                      Console.WriteLine(json);
                  }
              } catch (Exception ex) {
                  System.Diagnostics.Debug.WriteLine("cadMonitor timer error: " + ex.Message);
              }
          }, null, 3000, 3000);

          return new { success = true };
      } catch (Exception ex) {
          return new { success = false, error = ex.Message };
      }
  }
 */});

process.stdin.setEncoding('utf8');

// Worker进程稳定性：添加错误处理和进程管理
process.on('uncaughtException', (err) => {
  log(`[Worker] Uncaught exception: ${err.message}`);
  // 不要立即退出，等待当前请求完成
});

process.on('unhandledRejection', (reason) => {
  log(`[Worker] Unhandled rejection: ${reason}`);
});

let stdinBuffer = '';
let isProcessing = false;
const requestQueue = [];
const QUEUE_TIMEOUT = 30000; // 单个请求默认超时时间 30 秒（可由 msg.timeoutMs 覆盖）
// 单个 worker 是串行的：一个 COM 调用耗时数秒时，父进程仍会继续往 stdin 灌，
// 队列条数没有上限就会一直涨（每条都持有完整 LISP 文本），直到把 4GB 堆撑爆。
const QUEUE_MAX = Math.max(1, config.workerQueueMax || 200);

process.stdin.on('data', (data) => {
  stdinBuffer += data;
  const lines = stdinBuffer.split('\n');
  stdinBuffer = lines.pop() || '';
  
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      const requestId = msg.requestId;
      if (requestQueue.length >= QUEUE_MAX) {
        process.stdout.write(JSON.stringify({
          error: `Worker queue overflow (max ${QUEUE_MAX})`,
          requestId,
        }) + '\n');
        continue;
      }
      // 添加到队列而不是立即处理
      requestQueue.push({ msg, requestId, timestamp: Date.now() });
      
      // 如果没有在处理，开始处理队列
      if (!isProcessing) {
        processQueue();
      }
    } catch {
      process.stdout.write(JSON.stringify({ error: 'invalid message', requestId: undefined }) + '\n');
    }
  }
});

function rejectStaleQueued() {
  if (requestQueue.length === 0) return;
  const now = Date.now();
  for (let i = requestQueue.length - 1; i >= 0; i--) {
    if (now - requestQueue[i].timestamp <= QUEUE_TIMEOUT) continue;
    const stale = requestQueue.splice(i, 1)[0];
    process.stdout.write(JSON.stringify({
      error: 'Queue processing timeout',
      requestId: stale.requestId,
      remaining: requestQueue.length,
    }) + '\n');
  }
}

async function processQueue() {
  if (isProcessing || requestQueue.length === 0) return;
  
  isProcessing = true;
  
  while (requestQueue.length > 0) {
    // 清理排队超过默认超时的请求；当前正在执行的请求由自己的 timeoutMs 控制
    rejectStaleQueued();
    if (requestQueue.length === 0) break;

    const { msg, requestId } = requestQueue.shift();
    // 为每个请求添加超时（定时器必须在请求完成后清掉，否则每个请求都留一个活定时器）
    // @lisp 引导会传 timeoutMs=120000，用于 moniker 连接下等待内核下载/加载完成。
    const requestTimeout = Number(msg.timeoutMs) > 0 ? Number(msg.timeoutMs) : QUEUE_TIMEOUT;
    let timer = null;
    try {
      const result = await Promise.race([
        handleMessage(msg),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Request timeout')), requestTimeout);
        })
      ]);
      process.stdout.write(JSON.stringify({ ...result, requestId }) + '\n');
    } catch (err) {
      process.stdout.write(JSON.stringify({ error: err.message, requestId }) + '\n');
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  
  isProcessing = false;
}

const cadIsBusy = edge.func(function() {/*
  async (input) => {
      try {
          string platform = input.ToString();
          string progId = platform == "BricsCAD" ? "BricscadApp.AcadApplication" : platform + ".Application";
          dynamic cad = System.Runtime.InteropServices.Marshal.GetActiveObject(progId);
          if (cad != null) {
              bool isBusy = false;
              if (platform == "ZWCAD") {
                  isBusy = !(cad.GetZcadState().IsQuiescent);
              } else {
                  isBusy = !(cad.GetAcadState().IsQuiescent);
              }
              return new { isBusy = isBusy };
          }
      } catch (Exception ex) {
          System.Diagnostics.Debug.WriteLine("cadIsBusy error: " + ex.Message);
      }
      return new { isBusy = false };
  }
 */});

const cadHasDoc = edge.func(function() {/*
  async (input) => {
      try {
          string platform = input.ToString();
          string progId = platform == "BricsCAD" ? "BricscadApp.AcadApplication" : platform + ".Application";
          dynamic cad = System.Runtime.InteropServices.Marshal.GetActiveObject(progId);
          if (cad != null) {
              int docCount = cad.Documents.Count;
              return new { hasDoc = docCount > 0, docCount = docCount };
          }
      } catch (Exception ex) {
          System.Diagnostics.Debug.WriteLine("cadHasDoc error: " + ex.Message);
          System.Diagnostics.Debug.WriteLine("cadHasDoc stacktrace: " + ex.StackTrace);
      }
      return new { hasDoc = false, docCount = 0 };
  }
 */});

const cadNewDoc = edge.func(function() {/*
  async (input) => {
      try {
          string platform = input.ToString();
          string progId = platform == "BricsCAD" ? "BricscadApp.AcadApplication" : platform + ".Application";
          dynamic cad = System.Runtime.InteropServices.Marshal.GetActiveObject(progId);
          if (cad != null) {
              cad.Documents.Add();
              return new { success = true };
          }
      } catch (Exception ex) {
          System.Diagnostics.Debug.WriteLine("cadNewDoc error: " + ex.Message);
          return new { success = false, error = ex.Message };
      }
      return new { success = false, error = "CAD not found" };
  }
 */});

const cadOpenDoc = edge.func(function() {/*
  async (input) => {
      try {
          dynamic d = input;
          string platform = d.platform != null ? d.platform.ToString() : "AutoCAD";
          string filePath = d.filePath != null ? d.filePath.ToString() : "";
          if (filePath.Length == 0) return new { success = false, error = "filePath is required" };
          if (!System.IO.File.Exists(filePath)) return new { success = false, error = "File not found: " + filePath };
          string progId = platform == "BricsCAD" ? "BricscadApp.AcadApplication" : platform + ".Application";
          dynamic cad = System.Runtime.InteropServices.Marshal.GetActiveObject(progId);
          if (cad != null) {
              dynamic doc = cad.Documents.Open(filePath);
              string name = "";
              try { name = doc.FullName; } catch {}
              return new { success = true, name = name };
          }
      } catch (Exception ex) {
          System.Diagnostics.Debug.WriteLine("cadOpenDoc error: " + ex.Message);
          return new { success = false, error = ex.Message };
      }
      return new { success = false, error = "CAD not found" };
  }
 */});

const cadSaveDoc = edge.func(function() {/*
  async (input) => {
      try {
          dynamic d = input;
          string platform = d.platform != null ? d.platform.ToString() : "AutoCAD";
          string filePath = d.filePath != null ? d.filePath.ToString() : "";
          string progId = platform == "BricsCAD" ? "BricscadApp.AcadApplication" : platform + ".Application";
          dynamic cad = System.Runtime.InteropServices.Marshal.GetActiveObject(progId);
          if (cad == null) return new { success = false, error = "CAD not found" };
          dynamic doc = cad.ActiveDocument;
          if (doc == null) return new { success = false, error = "No active document" };
          if (filePath.Length == 0) doc.Save(); else doc.SaveAs(filePath);
          string name = "";
          try { name = doc.FullName; } catch {}
          return new { success = true, name = name };
      } catch (Exception ex) {
          System.Diagnostics.Debug.WriteLine("cadSaveDoc error: " + ex.Message);
          return new { success = false, error = ex.Message };
      }
  }
 */});

const cadBringToFront = edge.func(function() {/*
  async (input) => {
      try {
          string platform = input.ToString();
          string progId = platform == "BricsCAD" ? "BricscadApp.AcadApplication" : platform + ".Application";
          dynamic cad = System.Runtime.InteropServices.Marshal.GetActiveObject(progId);
          if (cad != null) {
              cad.Visible = true;
              return new { success = true };
          }
      } catch (Exception ex) {
          System.Diagnostics.Debug.WriteLine("cadBringToFront error: " + ex.Message);
          return new { success = false, error = ex.Message };
      }
      return new { success = false, error = "CAD not found" };
  }
 */});

const cadSendEsc = edge.func(function() {/*
  async (input) => {
      try {
          string platform = input.ToString();
          string progId = platform == "BricsCAD" ? "BricscadApp.AcadApplication" : platform + ".Application";
          dynamic cad = System.Runtime.InteropServices.Marshal.GetActiveObject(progId);
          if (cad == null) return new { success = false, error = "CAD not found" };
          try { cad.Visible = true; } catch { }
          dynamic shell = System.Activator.CreateInstance(System.Type.GetTypeFromProgID("WScript.Shell"));
          shell.SendKeys("{ESC}");
          return new { success = true };
      } catch (Exception ex) {
          System.Diagnostics.Debug.WriteLine("cadSendEsc error: " + ex.Message);
          return new { success = false, error = ex.Message };
      }
  }
 */});

const cadConnectByName = edge.func(function() {/*
  async (input) => {
      dynamic d = input;
      string platform = d.platform.ToString();
      bool forceLaunch = d.forceLaunch != null && d.forceLaunch.ToString() == "True";
      string progId = platform == "BricsCAD" ? "BricscadApp.AcadApplication" : platform + ".Application";
      if (!forceLaunch) {
          try {
              dynamic cad = System.Runtime.InteropServices.Marshal.GetActiveObject(progId);
              if (cad != null) {
                  string ver = cad.Version.ToString();
                  return new { success = true, platform = platform, version = ver, launched = false };
              }
          } catch (Exception ex) {
              System.Diagnostics.Debug.WriteLine("cadConnectByName existing error: " + ex.Message);
          }
      }
      try {
          var type = System.Type.GetTypeFromProgID(progId);
          if (type != null) {
              dynamic cad = System.Activator.CreateInstance(type);
              if (cad != null) {
                  for (int retry = 0; retry < 60; retry++) {
                      await System.Threading.Tasks.Task.Delay(500);
                      try {
                          string ver = cad.Version.ToString();
                          return new { success = true, platform = platform, version = ver, launched = true };
                      } catch {}
                  }
              }
          }
      } catch (Exception ex) {
          System.Diagnostics.Debug.WriteLine("cadConnectByName launch error: " + ex.Message);
      }
      return new { success = false, error = "Not found" };
  }
 */});

async function waitForIdle(platform) {
  let retries = BUSY_RETRIES;
  while (retries > 0) {
    const checkResult = await new Promise((resolve, reject) => {
      cadIsBusy(platform || 'AutoCAD', (e, r) => {
        if (e) reject(e);
        else resolve(r);
      });
    });
    if (!checkResult.isBusy) return true;
    retries--;
    if (retries > 0) await new Promise(resolve => setTimeout(resolve, BUSY_DELAY));
  }
  return false;
}

async function connectToPlatform(targetPlatform, forceLaunch = false) {
  return new Promise((resolve, reject) => {
    cadConnectByName({ platform: targetPlatform, forceLaunch }, (e, r) => {
      if (e) reject(e);
      else resolve(r);
    });
  });
}

function computeCodeHash(code, cacheEnabled) {
  if (cacheEnabled) {
    return crypto.createHash('sha256').update(code).digest('hex');
  }
  return '';
}

function dllCall(fn, args) {
  return new Promise((resolve, reject) => {
    if (!fn) return resolve({ success: false, error: 'DLL method not available' });
    fn(args, (e, r) => {
      if (e) reject(e);
      else resolve(r);
    });
  });
}

async function monikerOrEdge(rotFn, edgeFn, args, platform) {
  if (_monikerSession && rotFn) return await dllCall(rotFn, { key: _monikerSession, ...args });
  return new Promise((resolve, reject) => {
    edgeFn(platform || 'AutoCAD', (e, r) => {
      if (e) reject(e);
      else resolve(r);
    });
  });
}

function validateCode(code, trusted = false) {
  const parenCheck = checkParens(code);
  if (!parenCheck.valid) {
    return { valid: false, error: `括号错误: ${parenCheck.error} (位置 ${parenCheck.pos})` };
  }
  // trusted 仅由服务端 @lisp 引导模块设置，用于放行内部的安装/加载脚本
  if (trusted) return { valid: true };
  const securityLevel = process.env.SECURITY_LEVEL || 'relaxed';
  if (securityLevel !== 'relaxed') {
    const injectionCheck = validateLispCodeWorker(code);
    if (!injectionCheck.valid) {
      return { valid: false, error: `安全限制: ${injectionCheck.error}` };
    }
  }
  return { valid: true };
}

async function ensureDocument(platform) {
  if (_monikerSession) return true;
  try {
    const docCheck = await new Promise((resolve, reject) => {
      cadHasDoc(platform || 'AutoCAD', (e, r) => {
        if (e) reject(e);
        else resolve(r);
      });
    });
    return docCheck.hasDoc;
  } catch (error) {
    // COM 调用失败时，尝试创建新文档
    console.error('ensureDocument COM error:', error);
    try {
      const newDocResult = await new Promise((resolve, reject) => {
        cadNewDoc(platform || 'AutoCAD', (e, r) => {
          if (e) reject(e);
          else resolve(r);
        });
      });
      return newDocResult && newDocResult.success;
    } catch (newDocError) {
      console.error('Auto-create document failed:', newDocError);
      return false;
    }
  }
}

async function executeWithRetry(fn, label) {
  const maxRetries = 3;
  let lastError = null;
  for (let i = 0; i < maxRetries; i++) {
    const isBusy = await waitForIdle();
    if (isBusy) {
      try {
        return await fn();
    } catch (_e) {
        log(`${label} error: ${_e.message}`);
        lastError = _e;
      }
    }
    await new Promise(r => setTimeout(r, 500));
  }
  return { success: false, error: lastError?.message || '发送失败' };
}

async function executeLongCode(msg) {
  const cacheEnabled = process.env.LONG_CODE_CACHE === '1';
  const codeHash = computeCodeHash(msg.code, cacheEnabled);
  log(`sendResult (${msg.code.length} chars, cache=${cacheEnabled}): ${msg.code.substring(0, 80)}...`);
  return await executeWithRetry(async () => {
    const r = await new Promise((resolve, reject) => {
      cadSendWithResult({ code: msg.code, platform: msg.platform, encoding: msg.encoding || '', codeHash, cacheEnabled }, (e, r) => {
        if (e) reject(e);
        else resolve(r);
      });
    });
    log(`sendResult result: ${JSON.stringify(r)}`);
    return r;
  }, 'sendResult');
}

async function executeShortCode(msg) {
  log(`send: ${msg.code}`);
  return await executeWithRetry(async () => {
    const r = await new Promise((resolve, reject) => {
      cadSend({ code: msg.code, platform: msg.platform }, (e, r) => {
        if (e) reject(e);
        else resolve(r);
      });
    });
    log(`send result: ${JSON.stringify(r)}`);
    return r;
  }, 'send');
}

async function executeLisp(msg, withResult) {
  if (!msg.code.endsWith('\n')) {
    msg.code += '\n';
  }

  const validation = validateCode(msg.code, msg.trusted === true);
  if (!validation.valid) return validation;

  if (!await ensureDocument(msg.platform)) {
    return { success: false, error: 'No open document' };
  }

  if (_monikerSession) {
    if (withResult || msg.code.length > 240) {
      return await dllCall(_rotSendResult, { key: _monikerSession, code: msg.code, encoding: msg.encoding || '' });
    }
    return await dllCall(_rotSendCmd, { key: _monikerSession, code: msg.code });
  }

  if (withResult || msg.code.length > 255) {
    return await executeLongCode(msg);
  }

  return await executeShortCode(msg);
}

const MESSAGE_HANDLERS = {
  ping() {
    return { pong: true };
  },

  healthCheck() {
    const memUsage = process.memoryUsage();
    return {
      healthy: true,
      uptime: process.uptime(),
      memory: {
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        rss: memUsage.rss,
      },
      queueSize: requestQueue.length,
      isProcessing: isProcessing,
    };
  },

  async connect(msg) {
    if (msg.moniker && _rotConnect) {
      const result = await dllCall(_rotConnect, { key: msg.monikerKey, moniker: msg.moniker });
      if (result && result.success) {
        _monikerSession = msg.monikerKey;
        return result;
      }
      return result;
    }
    if (msg.platform) {
      return await connectToPlatform(msg.platform, !!msg.forceLaunch);
    }
    try {
      const result = await new Promise((resolve, reject) => {
        cadConnect({}, (e, r) => {
          if (e) reject(e);
          else resolve(r);
        });
      });
      if (result && result.success) return result;
    } catch (e) {
      log('cadConnect failed: ' + e.message);
    }
    return new Promise((resolve, reject) => {
      cadLaunch({}, (e, r) => {
        if (e) reject(e);
        else resolve(r);
      });
    });
  },

  async disconnect() {
    if (_monikerSession && _rotDisconnect) {
      await dllCall(_rotDisconnect, { key: _monikerSession });
    }
    _monikerSession = null;
    return { success: true };
  },

  async hasdoc(msg) {
    return await monikerOrEdge(_rotHasDoc, cadHasDoc, {}, msg.platform);
  },

  async newdoc(msg) {
    return await monikerOrEdge(_rotNewDoc, cadNewDoc, {}, msg.platform);
  },

  async opendoc(msg) {
    if (_monikerSession && _rotOpenDoc) {
      return await dllCall(_rotOpenDoc, { key: _monikerSession, filePath: msg.filePath });
    }
    return new Promise((resolve, reject) => {
      cadOpenDoc({ platform: msg.platform, filePath: msg.filePath }, (e, r) => {
        if (e) reject(e);
        else resolve(r);
      });
    });
  },

  async savedoc(msg) {
    if (_monikerSession && _rotSaveDoc) {
      return await dllCall(_rotSaveDoc, { key: _monikerSession, filePath: msg.filePath });
    }
    return new Promise((resolve, reject) => {
      cadSaveDoc({ platform: msg.platform, filePath: msg.filePath }, (e, r) => {
        if (e) reject(e);
        else resolve(r);
      });
    });
  },

  async bringToFront(msg) {
    return await monikerOrEdge(_rotBringToFront, cadBringToFront, {}, msg.platform);
  },

  async sendEsc(msg) {
    return await monikerOrEdge(_rotSendEsc, cadSendEsc, { front: msg.front }, msg.platform);
  },

  async send(msg) {
    return await executeLisp(msg, false);
  },

  async sendResult(msg) {
    return await executeLisp(msg, true);
  },

  async isBusy(msg) {
    return await monikerOrEdge(_rotIsBusy, cadIsBusy, {}, msg.platform);
  },

  async getActiveDocInfo(msg) {
    return await monikerOrEdge(_rotDocInfo, cadGetActiveDocInfo, {}, msg.platform);
  },

  async startMonitor(msg) {
    if (_monikerSession) {
      return { success: false, error: 'startMonitor not supported for moniker connections' };
    }
    return new Promise((resolve, reject) => {
      cadStartMonitor(msg.platform || 'AutoCAD', (e, r) => {
        if (e) reject(e);
        else resolve(r);
      });
    });
  },
};

export async function handleMessage(msg) {
  const handler = MESSAGE_HANDLERS[msg.type];
  if (!handler) return { error: 'unknown message type' };
  return await handler(msg);
}

// Exported for testing
export { validateCode, computeCodeHash, getCachedLisp, setCachedLisp, MESSAGE_HANDLERS, executeLisp, executeLongCode, executeShortCode };
