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

                dynamic doc = cad.ActiveDocument;
                if (doc == null)
                    return Task.FromResult<object>(new Dictionary<string, object> { { "success", false }, { "error", "No active document" } });

                doc.SendCommand("(load \"" + lispFile.Replace("\\", "\\\\") + "\")\n");

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

                            if (!string.IsNullOrEmpty(encoding))
                            {
                                enc = System.Text.Encoding.GetEncoding(encoding);
                            }
                            else
                            {
                                string utf8Result = System.Text.Encoding.UTF8.GetString(bytes);
                                if (!utf8Result.Contains("\ufffd"))
                                    enc = System.Text.Encoding.UTF8;
                                else
                                {
                                    try { enc = System.Text.Encoding.GetEncoding("gbk"); }
                                    catch { enc = System.Text.Encoding.Default; }
                                }
                            }

                            result = enc.GetString(bytes).Trim();
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
