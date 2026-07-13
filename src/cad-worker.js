#!/usr/bin/env node
import edge from 'edge-js';
import process from 'process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { validateLispCodeWorker, checkParens } from './lisp-security.js';

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
  } catch (e) {
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
  } catch (e) {
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
const _rotNewDoc = _loadDll('RotNewDoc');
const _rotEnum = _loadEnum();

let _monikerSession = null;

const BUSY_RETRIES = parseInt(process.env.BUSY_RETRIES || '10', 10);
const BUSY_DELAY = parseInt(process.env.BUSY_DELAY || '500', 10);

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
  return entry.compiled;
}

function setCachedLisp(code, compiled) {
  const hash = crypto.createHash('sha256').update(code).digest('hex');
  if (LISP_CACHE.size >= LISP_CACHE_MAX) {
    let oldest = null;
    for (const [k, v] of LISP_CACHE) {
      if (!oldest || v.ts < oldest.ts) oldest = { k, ts: v.ts };
    }
    if (oldest) LISP_CACHE.delete(oldest.k);
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
                              string rawBase64 = System.Convert.ToBase64String(bytes);
                              System.Text.Encoding enc;

                              if (!string.IsNullOrEmpty(encoding)) {
                                  enc = System.Text.Encoding.GetEncoding(encoding);
                              } else {
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

async function connectToPlatform(targetPlatform) {
  return new Promise((resolve, reject) => {
    cadConnectByName(targetPlatform, (e, r) => {
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

function validateCode(code) {
  const parenCheck = checkParens(code);
  if (!parenCheck.valid) {
    return { valid: false, error: `括号错误: ${parenCheck.error} (位置 ${parenCheck.pos})` };
  }
  const securityLevel = process.env.SECURITY_LEVEL || 'strict';
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
  const docCheck = await new Promise((resolve, reject) => {
    cadHasDoc(platform || 'AutoCAD', (e, r) => {
      if (e) reject(e);
      else resolve(r);
    });
  });
  return docCheck.hasDoc;
}

async function executeWithRetry(fn, label) {
  const maxRetries = 3;
  let lastError = null;
  for (let i = 0; i < maxRetries; i++) {
    const isBusy = await waitForIdle();
    if (isBusy) {
      try {
        return await fn();
      } catch (e) {
        log(`${label} error: ${e.message}`);
        lastError = e;
      }
    }
    await new Promise(r => setTimeout(r, 500));
  }
  return { success: false, error: lastError?.message || '发送失败' };
}

async function executeLisp(msg, withResult) {
  if (!msg.code.endsWith('\n')) {
    msg.code += '\n';
  }

  const validation = validateCode(msg.code);
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

const MESSAGE_HANDLERS = {
  ping() {
    return { pong: true };
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

  async bringToFront(msg) {
    return await monikerOrEdge(_rotBringToFront, cadBringToFront, {}, msg.platform);
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
export { validateCode, computeCodeHash, getCachedLisp, setCachedLisp, MESSAGE_HANDLERS, executeLisp };
