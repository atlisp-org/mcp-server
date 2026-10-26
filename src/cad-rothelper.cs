using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Threading.Tasks;
using System.Collections.Generic;

namespace CadRotHelper
{
    // ─── ROT 枚举 ─────────────────────────────────────────
    public class RotEnumerator
    {
        [DllImport("ole32.dll")]
        static extern int GetRunningObjectTable(uint reserved, out IRunningObjectTable prot);

        [DllImport("ole32.dll")]
        static extern int CreateBindCtx(uint reserved, out IBindCtx ppbc);

        [DllImport("user32.dll")]
        static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

        static string DetectApp(dynamic app)
        {
            if (app == null) return null;
            try
            {
                string name = app.Name;
                if (name != null)
                {
                    if (name.IndexOf("AutoCAD", StringComparison.OrdinalIgnoreCase) >= 0) return "AutoCAD";
                    if (name.IndexOf("ZWCAD", StringComparison.OrdinalIgnoreCase) >= 0) return "ZWCAD";
                    if (name.IndexOf("GStarCAD", StringComparison.OrdinalIgnoreCase) >= 0) return "GStarCAD";
                    if (name.IndexOf("BricsCAD", StringComparison.OrdinalIgnoreCase) >= 0) return "BricsCAD";
                }
                try { string ver = app.Version; if (ver != null) return (name ?? "CADApp"); }
                catch { }
            }
            catch { }
            return null;
        }

        public Task<object> EnumerateAll(object input)
        {
            var results = new List<Dictionary<string, object>>();

            IRunningObjectTable rot;
            GetRunningObjectTable(0, out rot);

            IEnumMoniker enumMoniker;
            rot.EnumRunning(out enumMoniker);

            IMoniker[] monikers = new IMoniker[1];
            IntPtr fetched = Marshal.AllocHGlobal(4);

            while (enumMoniker.Next(1, monikers, fetched) == 0)
            {
                IBindCtx ctx;
                CreateBindCtx(0, out ctx);

                string name;
                monikers[0].GetDisplayName(ctx, null, out name);

                try
                {
                    object comObj;
                    rot.GetObject(monikers[0], out comObj);
                    string appName = null;
                    int hwnd = 0;
                    uint pid = 0;
                    string ver = "";

                    if (comObj != null)
                    {
                        dynamic app = comObj;
                        appName = DetectApp(app);
                        if (appName != null)
                        {
                            try { hwnd = (int)app.HWND; } catch { }
                            if (hwnd != 0) { GetWindowThreadProcessId((IntPtr)hwnd, out pid); }
                            try { ver = app.Version.ToString(); } catch { }
                        }
                    }

                    results.Add(new Dictionary<string, object>
                    {
                        { "name", name ?? "" },
                        { "appName", appName },
                        { "pid", (int)pid },
                        { "hwnd", hwnd },
                        { "version", ver }
                    });
                }
                catch { }
            }

            Marshal.FreeHGlobal(fetched);
            return Task.FromResult<object>(results);
        }
    }

    // ─── 连接管理器（按 moniker 连接特定实例）─────────────
    public class ConnectionManager
    {
        static readonly Dictionary<string, dynamic> _connections = new Dictionary<string, dynamic>();

        [DllImport("ole32.dll")]
        static extern int GetRunningObjectTable(uint reserved, out IRunningObjectTable prot);

        [DllImport("ole32.dll")]
        static extern int CreateBindCtx(uint reserved, out IBindCtx ppbc);

        [DllImport("user32.dll")]
        static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

        [DllImport("user32.dll")]
        static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

        static string DetectPlatform(dynamic cad)
        {
            try
            {
                string name = cad.Name;
                if (name != null)
                {
                    if (name.IndexOf("AutoCAD", StringComparison.OrdinalIgnoreCase) >= 0) return "AutoCAD";
                    if (name.IndexOf("ZWCAD", StringComparison.OrdinalIgnoreCase) >= 0) return "ZWCAD";
                    if (name.IndexOf("GStarCAD", StringComparison.OrdinalIgnoreCase) >= 0) return "GStarCAD";
                    if (name.IndexOf("BricsCAD", StringComparison.OrdinalIgnoreCase) >= 0) return "BricsCAD";
                }
            }
            catch { }
            return "AutoCAD";
        }

        // ── 通过 moniker 连接 ──
        public Task<object> RotConnect(object input)
        {
            dynamic d = input;
            string key = d.key;
            string monikerName = d.moniker;

            if (_connections.ContainsKey(key))
                _connections.Remove(key);

            IRunningObjectTable rot;
            GetRunningObjectTable(0, out rot);

            IEnumMoniker enumMoniker;
            rot.EnumRunning(out enumMoniker);

            IMoniker[] monikers = new IMoniker[1];
            IntPtr fetched = Marshal.AllocHGlobal(4);

            while (enumMoniker.Next(1, monikers, fetched) == 0)
            {
                IBindCtx ctx;
                CreateBindCtx(0, out ctx);

                string name;
                monikers[0].GetDisplayName(ctx, null, out name);

                if (name == monikerName)
                {
                    object comObj;
                    rot.GetObject(monikers[0], out comObj);
                    if (comObj != null)
                    {
                        dynamic cad = comObj;
                        _connections[key] = cad;

                        string platform = DetectPlatform(cad);
                        string ver = "";
                        try { ver = cad.Version.ToString(); } catch { }
                        int hwnd = 0;
                        try { hwnd = (int)cad.HWND; } catch { }
                        uint pid = 0;
                        if (hwnd != 0) { GetWindowThreadProcessId((IntPtr)hwnd, out pid); }

                        Marshal.FreeHGlobal(fetched);
                        return Task.FromResult<object>(new Dictionary<string, object>
                        {
                            { "success", true },
                            { "platform", platform },
                            { "version", ver },
                            { "pid", (int)pid }
                        });
                    }
                }
            }

            Marshal.FreeHGlobal(fetched);
            return Task.FromResult<object>(new Dictionary<string, object>
            {
                { "success", false },
                { "error", "ROT moniker not found: " + monikerName }
            });
        }

        // ── 断开连接 ──
        public Task<object> RotDisconnect(object input)
        {
            dynamic d = input;
            string key = d.key;
            _connections.Remove(key);
            return Task.FromResult<object>(new Dictionary<string, object> { { "success", true } });
        }

        // ── 执行命令（不返回结果） ──
        public Task<object> RotSendCommand(object input)
        {
            dynamic d = input;
            string key = d.key;
            string code = d.code + "\n";

            dynamic cad;
            if (!_connections.TryGetValue(key, out cad))
                return Task.FromResult<object>(new Dictionary<string, object> { { "success", false }, { "error", "Not connected" } });

            try
            {
                dynamic doc = cad.ActiveDocument;
                if (doc == null)
                    return Task.FromResult<object>(new Dictionary<string, object> { { "success", false }, { "error", "No active document" } });
                doc.SendCommand(code);
                return Task.FromResult<object>(new Dictionary<string, object> { { "success", true } });
            }
            catch (Exception ex)
            {
                return Task.FromResult<object>(new Dictionary<string, object> { { "success", false }, { "error", ex.Message } });
            }
        }

        // ── 执行命令并返回结果（文件方式） ──
        public Task<object> RotSendWithResult(object input)
        {
            dynamic d = input;
            string key = d.key;
            string code = d.code;
            string encoding = (d.encoding ?? "").ToString();
            string tempFile = null;
            string lispFile = null;
            string userCodeFile = null;

            try
            {
                dynamic cad;
                if (!_connections.TryGetValue(key, out cad))
                    return Task.FromResult<object>(new Dictionary<string, object> { { "success", false }, { "error", "Not connected" } });

                string tempDir = System.IO.Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                    "@lisp", "tmp");
                System.IO.Directory.CreateDirectory(tempDir);

                tempFile = System.IO.Path.Combine(tempDir, "atlisp_result_" + Guid.NewGuid().ToString("N") + ".txt");
                string fileKey = Guid.NewGuid().ToString("N");
                userCodeFile = System.IO.Path.Combine(tempDir, "atlisp_user_" + fileKey + ".lsp");
                lispFile = System.IO.Path.Combine(tempDir, "atlisp_code_" + fileKey + ".lsp");

                dynamic doc = cad.ActiveDocument;
                if (doc == null)
                    return Task.FromResult<object>(new Dictionary<string, object> { { "success", false }, { "error", "No active document" } });

                if (EnsureTrustedPaths(doc, tempDir))
                {
                    // ── 文件方式：临时 .lsp + (load ...)，要求 tempDir 已在受信任路径里 ──
                    System.IO.File.WriteAllText(userCodeFile, code,
                        System.Text.Encoding.GetEncoding(
                            System.Globalization.CultureInfo.CurrentCulture.TextInfo.ANSICodePage));

                    string lispCode = "(progn"
                        + "(setq f(open \"" + tempFile.Replace("\\", "\\\\") + "\" \"w\"))"
                        + "(setq r(vl-catch-all-apply '(lambda ()(load \"" + userCodeFile.Replace("\\", "\\\\") + "\"))))"
                        + "(if (vl-catch-all-error-p r)"
                        + "(princ(strcat \"ERROR:\"(vl-catch-all-error-message r)) f)"
                        + "(princ r f))"
                        + "(close f)"
                        + "(princ))";

                    System.IO.File.WriteAllText(lispFile, lispCode,
                        System.Text.Encoding.GetEncoding(
                            System.Globalization.CultureInfo.CurrentCulture.TextInfo.ANSICodePage));

                    doc.SendCommand("(load \"" + lispFile.Replace("\\", "\\\\") + "\")\n");
                }
                else
                {
                    // ── 分块方式：不 load 文件，所以不触发任何信任检查 ──
                    // 中望/浩辰可能没有 TRUSTEDPATHS，BricsCAD 的该变量只读，AutoCAD 也可能被管理员锁定。
                    foreach (string chunkCmd in BuildChunkCommands(code, tempFile))
                    {
                        doc.SendCommand(chunkCmd + "\n");
                        System.Threading.Thread.Sleep(10);
                    }
                }

                int retries = 10;
                while (retries > 0 && !System.IO.File.Exists(tempFile))
                {
                    System.Threading.Thread.Sleep(200);
                    retries--;
                }

                string result = "";
                if (System.IO.File.Exists(tempFile))
                {
                    retries = 5;
                    while (retries > 0)
                    {
                        try
                        {
                            byte[] bytes = System.IO.File.ReadAllBytes(tempFile);
                            System.Text.Encoding enc;
                            int offset = 0;

                            if (!string.IsNullOrEmpty(encoding))
                            {
                                enc = System.Text.Encoding.GetEncoding(encoding);
                            }
                            else if (bytes.Length >= 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF)
                            {
                                // 带 UTF-8 BOM 才按 UTF-8 解码（AutoLISP 不会写 BOM，此处仅作兜底）
                                enc = System.Text.Encoding.UTF8;
                                offset = 3;
                            }
                            else
                            {
                                // AutoLISP (open ... "w") 一律按系统 ANSI 代码页（中文系统 GBK/936）写结果文件，
                                // 不可能是 UTF-8；GBK 字节对常恰好构成合法 UTF-8 双字节序列，
                                // 旧「无替换字符 -> UTF-8」启发式会把大量中文误判成 UTF-8 解出乱码。
                                // 因此默认用系统 ANSI 代码页（与上方写 .lsp 文件用的编码一致）。
                                try { enc = System.Text.Encoding.GetEncoding(System.Globalization.CultureInfo.CurrentCulture.TextInfo.ANSICodePage); }
                                catch
                                {
                                    try { enc = System.Text.Encoding.GetEncoding("gbk"); }
                                    catch { enc = System.Text.Encoding.UTF8; }
                                }
                            }

                            result = enc.GetString(bytes, offset, bytes.Length - offset).Trim();
                            break;
                        }
                        catch (System.IO.IOException)
                        {
                            System.Threading.Thread.Sleep(200);
                            retries--;
                        }
                    }
                }

                if (result.StartsWith("ERROR:"))
                {
                    CleanupFiles(tempFile, lispFile, userCodeFile);
                    return Task.FromResult<object>(new Dictionary<string, object>
                    {
                        { "success", false },
                        { "error", result.Substring(6).Trim() }
                    });
                }

                CleanupFiles(tempFile, lispFile, userCodeFile);
                return Task.FromResult<object>(new Dictionary<string, object>
                {
                    { "success", true },
                    { "result", result }
                });
            }
            catch (Exception ex)
            {
                CleanupFiles(tempFile, lispFile, userCodeFile);
                return Task.FromResult<object>(new Dictionary<string, object>
                {
                    { "success", false },
                    { "error", ex.Message }
                });
            }
        }

        static void CleanupFiles(params string[] files)
        {
            foreach (var f in files)
            {
                if (f != null) { try { if (System.IO.File.Exists(f)) System.IO.File.Delete(f); } catch { } }
            }
        }

        // ── 信任目录：把 tempDir 追加进 TRUSTEDPATHS ──
        // 参照 kernel/src/setup.lsp 的 @::add-path-in-trustedpaths 语义。
        // 返回 true 表示 tempDir 已被信任（可以安全 load 临时文件）；
        // false 表示该系统变量不可用 —— 中望/浩辰可能没有这个变量，BricsCAD 的该变量只读，
        // AutoCAD 也可能被管理员锁定 —— 调用方必须改走分块通道（不 load 文件，不触发信任检查）。
        static bool EnsureTrustedPaths(dynamic doc, string tempDir)
        {
            string currentTrust;
            try
            {
                object trustValue = doc.GetVariable("TRUSTEDPATHS");
                currentTrust = trustValue as string ?? "";
            }
            catch (Exception ex)
            {
                // 读不到就绝不写：否则会用「空值 + tempDir」覆盖用户已有的整串受信任路径
                System.Diagnostics.Debug.WriteLine("TRUSTEDPATHS unavailable: " + ex.Message);
                return false;
            }

            foreach (string trustEntry in currentTrust.Split(';'))
            {
                if (string.Equals(trustEntry.Trim(), tempDir, StringComparison.OrdinalIgnoreCase))
                    return true;
            }

            try
            {
                string newTrust = string.IsNullOrEmpty(currentTrust)
                    ? tempDir
                    : currentTrust.TrimEnd(';') + ";" + tempDir;
                doc.SetVariable("TRUSTEDPATHS", newTrust);
                return true;
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine("TRUSTEDPATHS not writable: " + ex.Message);
                return false;
            }
        }

        // ── 分块命令：不 load 文件也能执行代码 ──
        // 把代码按「LISP 字符串常量分块累积」注入命令行，最后用
        // (eval (read (strcat "(progn " *atlisp_chunk* ")"))) 在内存里执行。
        // 每条命令控制在 250 字符内（命令行 255 上限）。
        // AutoLISP 字符串字面量只保证 \\ 和 \" 两种转义，换行必须用 (chr 10) 还原；
        // 按行拆、按 180 硬切都只切字符串常量内容，不改变语义。
        static List<string> BuildChunkCommands(string code, string tempFile)
        {
            var commands = new List<string>();
            var tokens = new List<string>();
            string[] codeLines = code.Replace("\r\n", "\n").Replace("\r", "\n").Split('\n');

            for (int li = 0; li < codeLines.Length; li++)
            {
                if (li > 0) tokens.Add("(chr 10)");
                string codeLine = codeLines[li];
                int pos = 0;
                while (pos < codeLine.Length)
                {
                    int take = Math.Min(180, codeLine.Length - pos);
                    string lit = "\"" + EscapeLispString(codeLine.Substring(pos, take)) + "\"";
                    while (take > 1 && lit.Length > 180)
                    {
                        take--;
                        lit = "\"" + EscapeLispString(codeLine.Substring(pos, take)) + "\"";
                    }
                    tokens.Add(lit);
                    pos += take;
                }
            }

            string expr = "";
            bool firstCmd = true;
            foreach (string token in tokens)
            {
                string candidate = expr.Length == 0 ? token : expr + " " + token;
                if (expr.Length > 0 && candidate.Length > 180)
                {
                    commands.Add(MakeChunkCommand(expr, firstCmd));
                    firstCmd = false;
                    expr = token;
                }
                else
                {
                    expr = candidate;
                }
            }
            if (expr.Length > 0)
                commands.Add(MakeChunkCommand(expr, firstCmd));
            if (commands.Count == 0)
                commands.Add("(progn (setq *atlisp_chunk* \"\") (princ))");

            commands.Add("(setq *atlisp_ar* (vl-catch-all-apply '(lambda () (eval (read (strcat \"(progn \" *atlisp_chunk* \")\"))))))");
            commands.Add("(setq *atlisp_ar* (if (vl-catch-all-error-p *atlisp_ar*) (strcat \"ERROR:\" (vl-catch-all-error-message *atlisp_ar*)) *atlisp_ar*))");
            // 结果文件必须等 eval 结束才创建：open/写/close 放同一条命令，
            // 否则轮询会在 eval 期间读到空文件（和文件方式的行为对齐）
            commands.Add("(progn (setq *atlisp_af* (open \"" + tempFile.Replace("\\", "\\\\")
                + "\" \"w\")) (princ *atlisp_ar* *atlisp_af*) (close *atlisp_af*) (princ))");
            commands.Add("(progn (setq *atlisp_chunk* nil) (princ))");
            return commands;
        }

        static string MakeChunkCommand(string expr, bool firstCmd)
        {
            return firstCmd
                ? "(progn (setq *atlisp_chunk* (strcat " + expr + ")) (princ))"
                : "(progn (setq *atlisp_chunk* (strcat *atlisp_chunk* " + expr + ")) (princ))";
        }

        static string EscapeLispString(string s)
        {
            // AutoLISP 字符串字面量只保证 \\ 和 \" 两种转义，换行由 BuildChunkCommands
            // 用 (chr 10) 还原；反斜杠必须先替换，否则新插入的反斜杠会被二次转义。
            return s.Replace("\\", "\\\\").Replace("\"", "\\\"");
        }

        // ── 检查是否忙 ──
        public Task<object> RotIsBusy(object input)
        {
            dynamic d = input;
            string key = d.key;

            dynamic cad;
            if (!_connections.TryGetValue(key, out cad))
                return Task.FromResult<object>(new Dictionary<string, object> { { "isBusy", false } });

            try
            {
                string platform = DetectPlatform(cad);
                if (platform == "ZWCAD")
                    return Task.FromResult<object>(new Dictionary<string, object> { { "isBusy", !(cad.GetZcadState().IsQuiescent) } });
                else
                    return Task.FromResult<object>(new Dictionary<string, object> { { "isBusy", !(cad.GetAcadState().IsQuiescent) } });
            }
            catch
            {
                return Task.FromResult<object>(new Dictionary<string, object> { { "isBusy", false } });
            }
        }

        // ── 检查是否有文档 ──
        public Task<object> RotHasDoc(object input)
        {
            dynamic d = input;
            string key = d.key;

            dynamic cad;
            if (!_connections.TryGetValue(key, out cad))
                return Task.FromResult<object>(new Dictionary<string, object> { { "hasDoc", false }, { "docCount", 0 } });

            try
            {
                int count = cad.Documents.Count;
                return Task.FromResult<object>(new Dictionary<string, object> { { "hasDoc", count > 0 }, { "docCount", count } });
            }
            catch
            {
                return Task.FromResult<object>(new Dictionary<string, object> { { "hasDoc", false }, { "docCount", 0 } });
            }
        }

        // ── 获取活动文档信息 ──
        public Task<object> RotGetActiveDocInfo(object input)
        {
            dynamic d = input;
            string key = d.key;

            dynamic cad;
            if (!_connections.TryGetValue(key, out cad))
                return Task.FromResult<object>(new Dictionary<string, object> { { "hasDoc", false }, { "docCount", 0 }, { "docName", "" }, { "docPath", "" } });

            try
            {
                int count = cad.Documents.Count;
                string docName = "";
                string docPath = "";
                try { docName = cad.ActiveDocument.Name; } catch { }
                try { docPath = cad.ActiveDocument.FullName; } catch { }
                return Task.FromResult<object>(new Dictionary<string, object>
                {
                    { "hasDoc", count > 0 },
                    { "docCount", count },
                    { "docName", docName },
                    { "docPath", docPath }
                });
            }
            catch
            {
                return Task.FromResult<object>(new Dictionary<string, object> { { "hasDoc", false }, { "docCount", 0 }, { "docName", "" }, { "docPath", "" } });
            }
        }

        // ── 置前 ──
        public Task<object> RotBringToFront(object input)
        {
            dynamic d = input;
            string key = d.key;

            dynamic cad;
            if (!_connections.TryGetValue(key, out cad))
                return Task.FromResult<object>(new Dictionary<string, object> { { "success", false }, { "error", "Not connected" } });

            try
            {
                cad.Visible = true;
                return Task.FromResult<object>(new Dictionary<string, object> { { "success", true } });
            }
            catch (Exception ex)
            {
                return Task.FromResult<object>(new Dictionary<string, object> { { "success", false }, { "error", ex.Message } });
            }
        }

        // ── 发送 ESC（不经过 LISP、不需要活动文档） ──
        public Task<object> RotSendEsc(object input)
        {
            dynamic d = input;
            string key = d.key;
            bool front = true;
            try { front = d.front == null || d.front.ToString() != "False"; } catch { }

            dynamic cad;
            if (!_connections.TryGetValue(key, out cad))
                return Task.FromResult<object>(new Dictionary<string, object> { { "success", false }, { "error", "Not connected" } });

            try
            {
                IntPtr hwnd = (IntPtr)cad.HWND;
                if (hwnd == IntPtr.Zero)
                    return Task.FromResult<object>(new Dictionary<string, object> { { "success", false }, { "error", "No window handle" } });
                if (front) { try { SetForegroundWindow(hwnd); } catch { } }
                const uint WM_KEYDOWN = 0x0100;
                const uint WM_KEYUP = 0x0101;
                IntPtr vkEsc = (IntPtr)0x1B;
                PostMessage(hwnd, WM_KEYDOWN, vkEsc, IntPtr.Zero);
                PostMessage(hwnd, WM_KEYUP, vkEsc, IntPtr.Zero);
                return Task.FromResult<object>(new Dictionary<string, object> { { "success", true } });
            }
            catch (Exception ex)
            {
                return Task.FromResult<object>(new Dictionary<string, object> { { "success", false }, { "error", ex.Message } });
            }
        }

        // ── 新建文档 ──
        public Task<object> RotNewDoc(object input)
        {
            dynamic d = input;
            string key = d.key;

            dynamic cad;
            if (!_connections.TryGetValue(key, out cad))
                return Task.FromResult<object>(new Dictionary<string, object> { { "success", false }, { "error", "Not connected" } });

            try
            {
                cad.Documents.Add();
                return Task.FromResult<object>(new Dictionary<string, object> { { "success", true } });
            }
            catch (Exception ex)
            {
                return Task.FromResult<object>(new Dictionary<string, object> { { "success", false }, { "error", ex.Message } });
            }
        }

        // ── 打开文档（ActiveX Documents.Open，不受 FILEDIA 影响）──
        public Task<object> RotOpenDoc(object input)
        {
            dynamic d = input;
            string key = d.key;
            string filePath = (d.filePath ?? "").ToString();

            dynamic cad;
            if (!_connections.TryGetValue(key, out cad))
                return Task.FromResult<object>(new Dictionary<string, object> { { "success", false }, { "error", "Not connected" } });

            if (string.IsNullOrEmpty(filePath))
                return Task.FromResult<object>(new Dictionary<string, object> { { "success", false }, { "error", "filePath is required" } });

            try
            {
                if (!System.IO.File.Exists(filePath))
                    return Task.FromResult<object>(new Dictionary<string, object> { { "success", false }, { "error", "File not found: " + filePath } });

                dynamic doc = cad.Documents.Open(filePath);
                string name = "";
                try { name = doc.FullName; } catch { }
                return Task.FromResult<object>(new Dictionary<string, object>
                {
                    { "success", true },
                    { "name", name }
                });
            }
            catch (Exception ex)
            {
                return Task.FromResult<object>(new Dictionary<string, object> { { "success", false }, { "error", ex.Message } });
            }
        }

        // ── 保存文档（ActiveX，不走 LISP） ──
        public Task<object> RotSaveDoc(object input)
        {
            dynamic d = input;
            string key = d.key;
            string filePath = (d.filePath ?? "").ToString();

            dynamic cad;
            if (!_connections.TryGetValue(key, out cad))
                return Task.FromResult<object>(new Dictionary<string, object> { { "success", false }, { "error", "Not connected" } });

            try
            {
                dynamic doc = cad.ActiveDocument;
                if (doc == null)
                    return Task.FromResult<object>(new Dictionary<string, object> { { "success", false }, { "error", "No active document" } });

                if (string.IsNullOrEmpty(filePath))
                    doc.Save();
                else
                    doc.SaveAs(filePath);

                string name = "";
                try { name = doc.FullName; } catch { }
                return Task.FromResult<object>(new Dictionary<string, object>
                {
                    { "success", true },
                    { "name", name }
                });
            }
            catch (Exception ex)
            {
                return Task.FromResult<object>(new Dictionary<string, object> { { "success", false }, { "error", ex.Message } });
            }
        }
    }
}
