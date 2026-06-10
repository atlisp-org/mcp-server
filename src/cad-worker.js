#!/usr/bin/env node
import edge from 'edge-js';
import process from 'process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { validateLispCodeWorker, checkParens } from './lisp-security.js';

const BUSY_RETRIES = parseInt(process.env.BUSY_RETRIES || '10', 10);
const BUSY_DELAY = parseInt(process.env.BUSY_DELAY || '500', 10);

// Lisp expression cache (hash -> compiled Lisp code)
const LISP_CACHE = new Map();
const LISP_CACHE_MAX = parseInt(process.env.LISP_CACHE_MAX || '500', 10);

function getCachedLisp(code) {
  const hash = crypto.createHash('sha256').update(code).digest('hex');
  if (LISP_CACHE.has(hash)) return LISP_CACHE.get(hash);
  return null;
}

function setCachedLisp(code, compiled) {
  const hash = crypto.createHash('sha256').update(code).digest('hex');
  if (LISP_CACHE.size >= LISP_CACHE_MAX) {
    const firstKey = LISP_CACHE.keys().next().value;
    LISP_CACHE.delete(firstKey);
  }
  LISP_CACHE.set(hash, compiled);
  return compiled;
}

const DEBUG_FILE = process.env.DEBUG_FILE || path.join(process.env.TEMP || '/tmp', 'cad-worker-debug.log');

function log(msg) {
    const entry = `${new Date().toISOString()} ${msg}\n`;
    if (process.env.DEBUG) {
        fs.appendFile(DEBUG_FILE, entry, () => {});
    }
}

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
           string progId = platform == "BricsCAD" ? "BricscadApp.AcadApplication" : platform + ".Application";
           string tempDir = System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "@lisp", "tmp");
          System.IO.Directory.CreateDirectory(tempDir);
          
          tempFile = System.IO.Path.Combine(tempDir, "atlisp_result_" + System.Guid.NewGuid().ToString("N") + ".txt");
          lispFile = System.IO.Path.Combine(tempDir, "atlisp_code_" + System.Guid.NewGuid().ToString("N") + ".lsp");
          userCodeFile = System.IO.Path.Combine(tempDir, "atlisp_user_" + System.Guid.NewGuid().ToString("N") + ".lsp");
          
          // 用户代码单独写入文件，避免拼接注入风险
          System.IO.File.WriteAllText(userCodeFile, code, System.Text.Encoding.GetEncoding(System.Globalization.CultureInfo.CurrentCulture.TextInfo.ANSICodePage));
          
          string lispCode = "(progn"
              + "(setq f(open \"" + tempFile.Replace("\\", "\\\\") + "\" \"w\"))"
              + "(setq r(vl-catch-all-apply '(lambda ()(load \"" + userCodeFile.Replace("\\", "\\\\") + "\"))))"
              + "(if (vl-catch-all-error-p r)"
              + "(princ(strcat \"ERROR:\"(vl-catch-all-error-message r)) f)"
              + "(princ r f))"
              + "(close f)"
              + "(princ))";
            
            // 使用系统 ANSI 编码以兼容 GstarCAD / ZWCAD
            System.IO.File.WriteAllText(lispFile, lispCode, System.Text.Encoding.GetEncoding(System.Globalization.CultureInfo.CurrentCulture.TextInfo.ANSICodePage));
          
          dynamic cad = System.Runtime.InteropServices.Marshal.GetActiveObject(progId);
          if (cad != null) {
              dynamic doc = cad.ActiveDocument;
               if (doc != null) {
                    doc.SendCommand("(load \"" + lispFile.Replace("\\", "\\\\") + "\")\n");
                  
                  int retries = 10;
                  string result = "";
                  while (retries > 0 && !System.IO.File.Exists(tempFile)) {
                      System.Threading.Thread.Sleep(200);
                      retries--;
                  }
                  if (System.IO.File.Exists(tempFile)) {
                      retries = 5;
                      while (retries > 0) {
                          try {
                              byte[] bytes = System.IO.File.ReadAllBytes(tempFile);
                              System.Text.Encoding enc;
                              
                              // 优先使用指定的编码
                              if (!string.IsNullOrEmpty(encoding)) {
                                  enc = System.Text.Encoding.GetEncoding(encoding);
                              } else {
                                  // 自动检测编码：先尝试 UTF-8，如果失败则使用 GBK
                                  try {
                                      string utf8Result = System.Text.Encoding.UTF8.GetString(bytes);
                                      if (!utf8Result.Contains("\ufffd")) {
                                          enc = System.Text.Encoding.UTF8;
                                      } else {
                                          enc = System.Text.Encoding.GetEncoding("gbk");
                                      }
                                  } catch {
                                      try {
                                          enc = System.Text.Encoding.GetEncoding("gbk");
                                      } catch {
                                          enc = System.Text.Encoding.Default;
                                      }
                                  }
                              }
                              
                              result = enc.GetString(bytes).Trim();
                              
                              // 检查是否有错误前缀
                              if (result.StartsWith("ERROR:")) {
                                  return new { success = false, error = result.Substring(6).Trim() };
                              }
                              
                              try { System.IO.File.Delete(tempFile); } catch {}
                              try { System.IO.File.Delete(lispFile); } catch {}
                              try { System.IO.File.Delete(userCodeFile); } catch {}
                              break;
                          } catch (System.IO.IOException) {
                              System.Threading.Thread.Sleep(200);
                              retries--;
                          }
                      }
                      if (!string.IsNullOrEmpty(result)) {
                          return new { success = true, result = result };
                      }
                      return new { success = true, result = "" };
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

let stdinBuffer = '';
process.stdin.on('data', (data) => {
  stdinBuffer += data;
  const lines = stdinBuffer.split('\n');
  stdinBuffer = lines.pop() || '';
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      const requestId = msg.requestId;
      handleMessage(msg).then(result => {
        process.stdout.write(JSON.stringify({ ...result, requestId }) + '\n');
      }).catch(err => {
        process.stdout.write(JSON.stringify({ error: err.message, requestId }) + '\n');
      });
    } catch (e) {
      process.stdout.write(JSON.stringify({ error: 'invalid message' }) + '\n');
    }
  }
});

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

const cadConnectByName = edge.func(function() {/*
  async (input) => {
      try {
          string platform = input.ToString();
          string progId = platform == "BricsCAD" ? "BricscadApp.AcadApplication" : platform + ".Application";
          dynamic cad = System.Runtime.InteropServices.Marshal.GetActiveObject(progId);
          if (cad != null) {
              string ver = cad.Version.ToString();
              return new { success = true, platform = platform, version = ver, launched = false };
          }
      } catch (Exception ex) {
          System.Diagnostics.Debug.WriteLine("cadConnectByName existing error: " + ex.Message);
      }
      try {
          string platform = input.ToString();
          string progId = platform == "BricsCAD" ? "BricscadApp.AcadApplication" : platform + ".Application";
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

export { checkParens } from './lisp-security.js';

async function connectToPlatform(targetPlatform) {
  return new Promise((resolve, reject) => {
    cadConnectByName(targetPlatform, (e, r) => {
      if (e) reject(e);
      else resolve(r);
    });
  });
}

async function handleMessage(msg) {
  if (msg.type === 'ping') {
    return { pong: true };
  }
  if (msg.type === 'connect') {
    if (msg.platform) {
      return await connectToPlatform(msg.platform);
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
  }
  if (msg.type === 'hasdoc') {
    return new Promise((resolve, reject) => {
      cadHasDoc(msg.platform || 'AutoCAD', (e, r) => {
        if (e) reject(e);
        else resolve(r);
      });
    });
  }
  if (msg.type === 'newdoc') {
    return new Promise((resolve, reject) => {
      cadNewDoc(msg.platform || 'AutoCAD', (e, r) => {
        if (e) reject(e);
        else resolve(r);
      });
    });
  }
  if (msg.type === 'bringToFront') {
    return new Promise((resolve, reject) => {
      cadBringToFront(msg.platform || 'AutoCAD', (e, r) => {
        if (e) reject(e);
        else resolve(r);
      });
    });
  }
  if (msg.type === 'send') {
    if (!msg.code.endsWith('\n')) {
      msg.code += '\n';
    }
    const docCheck = await new Promise((resolve, reject) => {
      cadHasDoc(msg.platform || 'AutoCAD', (e, r) => {
        if (e) reject(e);
        else resolve(r);
      });
    });
    if (!docCheck.hasDoc) {
      return { success: false, error: 'No open document' };
    }
    const parenCheck = checkParens(msg.code);
    if (!parenCheck.valid) {
      return { success: false, error: `括号错误: ${parenCheck.error} (位置 ${parenCheck.pos})` };
    }
    const injectionCheck = validateLispCodeWorker(msg.code);
    if (!injectionCheck.valid) {
      return { success: false, error: `安全限制: ${injectionCheck.error}` };
    }
    if (msg.code.length > 255) {
      log(`send (long code ${msg.code.length} chars, fallback to sendResult): ${msg.code.substring(0, 80)}...`);
      const r = await new Promise((resolve, reject) => {
        cadSendWithResult({ code: msg.code, platform: msg.platform || 'AutoCAD', encoding: '' }, (e, r) => {
          if (e) reject(e);
          else resolve(r);
        });
      });
      log(`send result (long code): ${JSON.stringify(r)}`);
      return r;
    }
    const maxRetries = 3;
    let lastError = null;
    for (let i = 0; i < maxRetries; i++) {
      const isBusy = await waitForIdle(msg.platform || 'AutoCAD');
      if (isBusy) {
        log(`send: ${msg.code}`);
        try {
          const r = await new Promise((resolve, reject) => {
            cadSend({ code: msg.code, platform: msg.platform }, (e, r) => {
              if (e) reject(e);
              else resolve(r);
            });
          });
          log(`send result: ${JSON.stringify(r)}`);
          return r;
        } catch (e) {
          log(`send error: ${e.message}`);
          lastError = e;
        }
      }
      await new Promise(r => setTimeout(r, 500));
    }
    return { success: false, error: lastError?.message || '发送失败' };
  }
  if (msg.type === 'sendResult') {
    const docCheck = await new Promise((resolve, reject) => {
      cadHasDoc(msg.platform || 'AutoCAD', (e, r) => {
        if (e) reject(e);
        else resolve(r);
      });
    });
    if (!docCheck.hasDoc) {
      return { success: false, error: 'No open document' };
    }
    const parenCheck = checkParens(msg.code);
    if (!parenCheck.valid) {
      return { success: false, error: `括号错误: ${parenCheck.error} (位置 ${parenCheck.pos})` };
    }
    const injectionCheck = validateLispCodeWorker(msg.code);
    if (!injectionCheck.valid) {
      return { success: false, error: `安全限制: ${injectionCheck.error}` };
    }
    const maxRetriesResult = 3;
    let lastErrorResult = null;
    for (let i = 0; i < maxRetriesResult; i++) {
      const isBusy = await waitForIdle(msg.platform);
      if (isBusy) {
        log(`sendResult: ${msg.code}`);
        try {
          const r = await new Promise((resolve, reject) => {
            cadSendWithResult({ code: msg.code, platform: msg.platform, encoding: msg.encoding || '' }, (e, r) => {
              if (e) reject(e);
              else resolve(r);
            });
          });
          log(`sendResult result: ${JSON.stringify(r)}`);
          return r;
        } catch (e) {
          log(`sendResult error: ${e.message}`);
          lastErrorResult = e;
        }
      }
      await new Promise(r => setTimeout(r, 500));
    }
    return { success: false, error: lastErrorResult?.message || '发送失败' };
  }
  if (msg.type === 'isBusy') {
    return new Promise((resolve, reject) => {
      cadIsBusy(msg.platform || 'AutoCAD', (e, r) => {
        if (e) reject(e);
        else resolve(r);
      });
    });
  }
  if (msg.type === 'getActiveDocInfo') {
    return new Promise((resolve, reject) => {
      cadGetActiveDocInfo(msg.platform || 'AutoCAD', (e, r) => {
        if (e) reject(e);
        else resolve(r);
      });
    });
  }
  if (msg.type === 'startMonitor') {
    return new Promise((resolve, reject) => {
      cadStartMonitor(msg.platform || 'AutoCAD', (e, r) => {
        if (e) reject(e);
        else resolve(r);
      });
    });
  }
  return { error: 'unknown message type' };
}
