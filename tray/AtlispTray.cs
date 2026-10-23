// @lisp MCP Server Windows 托盘管理工具
//
// 单文件 WinForms 程序，使用 .NET Framework 4.x 自带的 csc.exe 编译，
// 目标平台 Windows 7+（实际依赖 .NET Framework 4.5+）。
//
// 功能：启动/停止/重启本机 atlisp-mcp、检查更新、下载安装/升级、
//       查看日志与调试面板、托盘/服务开机自启、环境诊断。
//
// 注意：本文件必须保持 C# 5 语法（in-box csc.exe 的限制），
//       不要使用字符串插值、?.、nameof、自动属性初始化器等 C# 6+ 特性。

using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

namespace Atlisp.Tray
{
    internal static class Program
    {
#if TRAY_VERSION_STAMPED
        // 构建时由 build.ps1 / scripts/build-tray.mjs 注入（取自 package.json 版本）
        internal const string AppVersion = BuildInfo.TrayVersion;
#else
        internal const string AppVersion = "1.0.0";
#endif
        private const string MutexName = "Local\\atlisp-mcp-tray";

        /// <summary>本次启动是否为 --silent（托盘重启/自我更新时保留）。</summary>
        internal static bool SilentMode;

        /// <summary>本次启动是否带 --start-server（托盘自我更新重启后确保服务恢复）。</summary>
        internal static bool StartServerRequested;

        [STAThread]
        private static void Main(string[] args)
        {
            bool silent = false;
            for (int i = 0; i < args.Length; i++)
            {
                if (string.Equals(args[i], "--silent", StringComparison.OrdinalIgnoreCase))
                {
                    silent = true;
                }
                else if (string.Equals(args[i], "--start-server", StringComparison.OrdinalIgnoreCase))
                {
                    StartServerRequested = true;
                }
            }
            SilentMode = silent;

            AppLog.Init();

            // Windows 7/8 上的 .NET Framework 默认不启用 TLS 1.2，npmmirror 需要 TLS 1.2
            try
            {
                ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
            }
            catch
            {
                // 老版本 .NET 不支持 Tls12 时保持默认
            }

            bool createdNew = false;
            using (Mutex mutex = new Mutex(true, MutexName, out createdNew))
            {
                if (!createdNew)
                {
                    if (!silent)
                    {
                        MessageBox.Show(
                            "@lisp MCP 托盘已经在运行，请查看任务栏通知区域。",
                            "@lisp MCP 托盘",
                            MessageBoxButtons.OK,
                            MessageBoxIcon.Information);
                    }
                    return;
                }

                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);

                // 从 npm 包目录启动时先把自己迁到用户目录：运行中的 exe 会被 Windows
                // 锁住，会导致 `npm install -g @atlisp/mcp@latest` 在替换 dist\AtlispTray.exe
                // 时报 EBUSY/EPERM。迁移后包内文件不再被占用，也便于后续自我更新。
                string relocateMessage;
                if (TraySelfUpdate.TryRelocate(out relocateMessage))
                {
                    AppLog.Write("tray-selfupdate: " + relocateMessage);
                    return;
                }
                if (!string.IsNullOrEmpty(relocateMessage))
                {
                    AppLog.Write("tray-selfupdate: 跳过自迁移：" + relocateMessage);
                }

                Application.ThreadException += delegate(object sender, ThreadExceptionEventArgs e)
                {
                    AppLog.Write("ThreadException: " + e.Exception);
                    if (!silent)
                    {
                        MessageBox.Show(e.Exception.Message, "@lisp MCP 托盘 - 错误",
                            MessageBoxButtons.OK, MessageBoxIcon.Error);
                    }
                };
                AppDomain.CurrentDomain.UnhandledException += delegate(object sender, UnhandledExceptionEventArgs e)
                {
                    AppLog.Write("UnhandledException: " + e.ExceptionObject);
                };

                try
                {
                    using (TrayApplication app = new TrayApplication(silent, StartServerRequested))
                    {
                        Application.Run(app);
                    }
                }
                catch (Exception ex)
                {
                    AppLog.Write("fatal: " + ex);
                    if (!silent)
                    {
                        MessageBox.Show(ex.Message, "@lisp MCP 托盘 - 启动失败",
                            MessageBoxButtons.OK, MessageBoxIcon.Error);
                    }
                }

                GC.KeepAlive(mutex);
            }
        }
    }

    internal static class Paths
    {
        public static string DataDir
        {
            get
            {
                return Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                    "atlisp-mcp");
            }
        }

        public static string LogDir
        {
            get { return Path.Combine(DataDir, "logs"); }
        }

        public static string TrayConfigPath
        {
            get { return Path.Combine(DataDir, "tray.json"); }
        }

        public static string TrayLogPath
        {
            get { return Path.Combine(LogDir, "tray.log"); }
        }

        public static string PidPath
        {
            get { return Path.Combine(DataDir, "server.pid"); }
        }

        public static string DownloadDir
        {
            get
            {
                return Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "atlisp-mcp", "downloads");
            }
        }

        /// <summary>免管理员的 portable Node.js（解压 zip 到用户目录，无需 UAC）。</summary>
        public static string PortableNodeDir
        {
            get
            {
                return Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "atlisp-mcp", "node");
            }
        }

        /// <summary>首次自动开启开机自启的标记文件，用户关闭后不会被再次打开。</summary>
        public static string AutostartDefaultPath
        {
            get { return Path.Combine(DataDir, "autostart-default.txt"); }
        }

        /// <summary>自动安装的退避状态，避免反复失败时反复下载。</summary>
        public static string BootstrapStatePath
        {
            get { return Path.Combine(DataDir, "bootstrap.state"); }
        }
    }

    internal static class AppLog
    {
        private static readonly object Sync = new object();

        public static void Init()
        {
            try
            {
                Directory.CreateDirectory(Paths.LogDir);
                if (File.Exists(Paths.TrayLogPath) &&
                    new FileInfo(Paths.TrayLogPath).Length > 2 * 1024 * 1024)
                {
                    string backup = Paths.TrayLogPath + ".1";
                    if (File.Exists(backup)) File.Delete(backup);
                    File.Move(Paths.TrayLogPath, backup);
                }
                Write("---- tray start v" + Program.AppVersion + " ----");
            }
            catch
            {
                // 日志目录不可写时静默降级，不影响托盘启动
            }
        }

        public static void Write(string message)
        {
            lock (Sync)
            {
                try
                {
                    Directory.CreateDirectory(Paths.LogDir);
                    File.AppendAllText(
                        Paths.TrayLogPath,
                        DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " " + message + "\r\n",
                        new UTF8Encoding(false));
                }
                catch
                {
                    // 忽略日志写入失败
                }
            }
        }
    }

    /// <summary>
    /// 解压 portable Node.js 的 zip 包。官方 zip 顶层带一个
    /// node-vX.Y.Z-win-x64\ 目录，这里统一剥掉，避免多一层路径。
    /// 全程只写用户目录，不需要管理员权限。
    /// </summary>
    internal static class ZipInstaller
    {
        /// <summary>返回解压后 node.exe 的路径；失败时抛出异常。</summary>
        public static string ExtractNodeZip(string zipPath, string destDir)
        {
            if (!File.Exists(zipPath)) throw new IOException("安装包不存在：" + zipPath);
            Directory.CreateDirectory(destDir);

            string staging = destDir + ".tmp-" + Guid.NewGuid().ToString("N").Substring(0, 8);
            try
            {
                using (FileStream stream = File.OpenRead(zipPath))
                using (ZipArchive archive = new ZipArchive(stream, ZipArchiveMode.Read))
                {
                    if (archive.Entries.Count == 0) throw new IOException("压缩包为空。");
                    string root = CommonRoot(archive);
                    foreach (ZipArchiveEntry entry in archive.Entries)
                    {
                        string relative = StripRoot(entry.FullName, root);
                        if (relative.Length == 0) continue;

                        string target = Path.GetFullPath(Path.Combine(staging, relative));
                        if (!IsUnder(staging, target))
                        {
                            throw new IOException("压缩包含非法路径：" + entry.FullName);
                        }

                        if (entry.FullName.EndsWith("/", StringComparison.Ordinal) ||
                            entry.FullName.EndsWith("\\", StringComparison.Ordinal))
                        {
                            Directory.CreateDirectory(target);
                            continue;
                        }

                        string dir = Path.GetDirectoryName(target);
                        if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
                        // 手动复制，避免依赖 System.IO.Compression.FileSystem
                        using (Stream source = entry.Open())
                        using (FileStream sink = new FileStream(
                            target, FileMode.Create, FileAccess.Write, FileShare.None))
                        {
                            source.CopyTo(sink);
                        }
                    }
                }

                string nodeExe = Path.Combine(staging, "node.exe");
                if (!File.Exists(nodeExe)) throw new IOException("压缩包中没有 node.exe。");
                string npmCmd = Path.Combine(staging, "npm.cmd");
                if (!File.Exists(npmCmd)) throw new IOException("压缩包中没有 npm.cmd。");

                // 旧版本残留目录先清掉再替换，避免 node.exe 被占用导致失败
                if (Directory.Exists(destDir))
                {
                    try { Directory.Delete(destDir, true); }
                    catch (Exception ex)
                    {
                        throw new IOException("无法替换已有目录（可能有 node.exe 正在运行）：" +
                            ex.Message);
                    }
                }
                Directory.Move(staging, destDir);
                return Path.Combine(destDir, "node.exe");
            }
            finally
            {
                try { if (Directory.Exists(staging)) Directory.Delete(staging, true); }
                catch { }
            }
        }

        /// <summary>取所有条目共有的第一层目录名；没有则返回空。</summary>
        private static string CommonRoot(ZipArchive archive)
        {
            string root = null;
            foreach (ZipArchiveEntry entry in archive.Entries)
            {
                string name = entry.FullName.Replace('\\', '/');
                int slash = name.IndexOf('/');
                if (slash <= 0) return "";
                string first = name.Substring(0, slash);
                if (root == null) root = first;
                else if (!string.Equals(root, first, StringComparison.OrdinalIgnoreCase)) return "";
            }
            return root ?? "";
        }

        private static string StripRoot(string fullName, string root)
        {
            string name = fullName.Replace('\\', '/');
            if (root.Length > 0)
            {
                if (name.Length <= root.Length) return "";
                if (!name.StartsWith(root, StringComparison.OrdinalIgnoreCase)) return "";
                name = name.Substring(root.Length).TrimStart('/');
            }
            return name.Replace('/', Path.DirectorySeparatorChar);
        }

        private static bool IsUnder(string root, string target)
        {
            string left = Path.GetFullPath(root).TrimEnd('\\') + "\\";
            return target.StartsWith(left, StringComparison.OrdinalIgnoreCase);
        }
    }

    public sealed class TrayConfig
    {
        public int Port { get; set; }
        public string NodePath { get; set; }
        public string NpmPath { get; set; }
        public string ServerScript { get; set; }
        public string ConfigFile { get; set; }
        public string NpmRegistry { get; set; }
        public string NodeVersion { get; set; }
        public string NodeMirror { get; set; }
        public bool AutoStartServer { get; set; }
        public bool CheckUpdateOnStart { get; set; }
        public bool StopServerOnExit { get; set; }
        public bool AutoInstall { get; set; }
        public bool AutoUpgrade { get; set; }
        public int AutoUpgradeHours { get; set; }
        public int HealthyPollSeconds { get; set; }

        public TrayConfig()
        {
            Port = 8110;
            NodePath = "";
            NpmPath = "";
            ServerScript = "";
            ConfigFile = "";
            NpmRegistry = "";
            NodeVersion = "22.12.0";
            NodeMirror = "https://npmmirror.com/mirrors/node";
            AutoStartServer = true;
            CheckUpdateOnStart = true;
            StopServerOnExit = false;
            AutoInstall = true;
            AutoUpgrade = true;
            AutoUpgradeHours = 1;
            HealthyPollSeconds = 5;
        }

        public static TrayConfig Load()
        {
            TrayConfig config = new TrayConfig();
            bool exists = File.Exists(Paths.TrayConfigPath);
            try
            {
                if (exists)
                {
                    JavaScriptSerializer serializer = new JavaScriptSerializer();
                    TrayConfig loaded = serializer.Deserialize<TrayConfig>(
                        File.ReadAllText(Paths.TrayConfigPath, Encoding.UTF8));
                    if (loaded != null) config = loaded;
                }
            }
            catch (Exception ex)
            {
                AppLog.Write("读取托盘配置失败，使用默认值: " + ex.Message);
            }
            config.Normalize();
            if (!exists) config.Save();
            return config;
        }

        public void CopyFrom(TrayConfig other)
        {
            if (other == null) return;
            Port = other.Port;
            NodePath = other.NodePath;
            NpmPath = other.NpmPath;
            ServerScript = other.ServerScript;
            ConfigFile = other.ConfigFile;
            NpmRegistry = other.NpmRegistry;
            NodeVersion = other.NodeVersion;
            NodeMirror = other.NodeMirror;
            AutoStartServer = other.AutoStartServer;
            CheckUpdateOnStart = other.CheckUpdateOnStart;
            StopServerOnExit = other.StopServerOnExit;
            AutoInstall = other.AutoInstall;
            AutoUpgrade = other.AutoUpgrade;
            AutoUpgradeHours = other.AutoUpgradeHours;
            HealthyPollSeconds = other.HealthyPollSeconds;
            Normalize();
        }

        public void Save()
        {
            try
            {
                Directory.CreateDirectory(Paths.DataDir);
                JavaScriptSerializer serializer = new JavaScriptSerializer();
                File.WriteAllText(
                    Paths.TrayConfigPath,
                    serializer.Serialize(this),
                    new UTF8Encoding(false));
            }
            catch (Exception ex)
            {
                AppLog.Write("保存托盘配置失败: " + ex.Message);
            }
        }

        public void Normalize()
        {
            if (Port < 1 || Port > 65535) Port = 8110;
            if (HealthyPollSeconds < 2 || HealthyPollSeconds > 60) HealthyPollSeconds = 5;
            if (AutoUpgradeHours < 1 || AutoUpgradeHours > 168) AutoUpgradeHours = 1;
            NodePath = NodePath ?? "";
            NpmPath = NpmPath ?? "";
            ServerScript = ServerScript ?? "";
            ConfigFile = ConfigFile ?? "";
            NpmRegistry = NpmRegistry ?? "";
            NodeVersion = NormalizeNodeVersion(NodeVersion);
            NodeMirror = (NodeMirror ?? "").Trim().TrimEnd('/');
            if (NodeMirror.Length == 0)
            {
                NodeMirror = "https://npmmirror.com/mirrors/node";
            }
        }

        private static string NormalizeNodeVersion(string value)
        {
            if (string.IsNullOrEmpty(value)) return "22.12.0";
            string version = value.Trim();
            if (version.StartsWith("v", StringComparison.OrdinalIgnoreCase))
            {
                version = version.Substring(1);
            }
            if (Regex.IsMatch(version, @"^\d+\.\d+\.\d+$")) return version;
            return "22.12.0";
        }
    }

    internal sealed class TrayException : Exception
    {
        public TrayException(string message) : base(message)
        {
        }
    }

    internal enum ServerState
    {
        Stopped,
        Starting,
        Running,
        Stopping,
        Error
    }

    internal sealed class HealthSnapshot
    {
        public bool Ok;
        public bool CadConnected;
        public string CadStatus;
        public string CadPlatform;
        public string CadVersion;
        public double UptimeSeconds;
        public int ToolCount;
        public string Error;

        public string CadSummary()
        {
            if (!Ok) return "服务未响应";
            if (!CadConnected) return "CAD 未连接";
            string text = "CAD 已连接";
            if (!string.IsNullOrEmpty(CadPlatform)) text += " · " + CadPlatform;
            if (!string.IsNullOrEmpty(CadVersion)) text += " " + CadVersion;
            return text;
        }
    }

    internal static class HealthClient
    {
        public static HealthSnapshot Check(int port, int timeoutMs)
        {
            HealthSnapshot snapshot = new HealthSnapshot();
            HttpWebRequest request = null;
            try
            {
                request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + "/health");
                request.Method = "GET";
                request.Proxy = null;
                request.KeepAlive = false;
                request.Timeout = timeoutMs;
                request.ReadWriteTimeout = timeoutMs;
                request.UserAgent = "atlisp-tray/" + Program.AppVersion;

                using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
                using (Stream stream = response.GetResponseStream())
                using (StreamReader reader = new StreamReader(stream, Encoding.UTF8))
                {
                    string json = reader.ReadToEnd();
                    Parse(json, snapshot);
                }
                snapshot.Ok = true;
            }
            catch (Exception ex)
            {
                snapshot.Ok = false;
                snapshot.Error = ex.Message;
            }
            return snapshot;
        }

        private static void Parse(string json, HealthSnapshot snapshot)
        {
            try
            {
                JavaScriptSerializer serializer = new JavaScriptSerializer();
                Dictionary<string, object> root =
                    serializer.DeserializeObject(json) as Dictionary<string, object>;
                if (root == null) return;

                object cadValue;
                if (root.TryGetValue("cad", out cadValue))
                {
                    Dictionary<string, object> cad = cadValue as Dictionary<string, object>;
                    if (cad != null)
                    {
                        snapshot.CadConnected = GetBool(cad, "connected");
                        snapshot.CadStatus = GetString(cad, "status");
                        snapshot.CadPlatform = GetString(cad, "platform");
                        snapshot.CadVersion = GetString(cad, "version");
                    }
                }

                object systemValue;
                if (root.TryGetValue("system", out systemValue))
                {
                    Dictionary<string, object> system = systemValue as Dictionary<string, object>;
                    if (system != null)
                    {
                        snapshot.UptimeSeconds = GetDouble(system, "uptime");
                    }
                }

                object mcpValue;
                if (root.TryGetValue("mcp", out mcpValue))
                {
                    Dictionary<string, object> mcp = mcpValue as Dictionary<string, object>;
                    if (mcp != null) snapshot.ToolCount = (int)GetDouble(mcp, "tools");
                }
            }
            catch (Exception ex)
            {
                AppLog.Write("解析 /health 失败: " + ex.Message);
            }
        }

        private static bool GetBool(Dictionary<string, object> dict, string key)
        {
            object value;
            if (dict != null && dict.TryGetValue(key, out value) && value is bool) return (bool)value;
            return false;
        }

        private static string GetString(Dictionary<string, object> dict, string key)
        {
            object value;
            if (dict != null && dict.TryGetValue(key, out value) && value != null)
            {
                return Convert.ToString(value, CultureInfo.InvariantCulture);
            }
            return null;
        }

        private static double GetDouble(Dictionary<string, object> dict, string key)
        {
            object value;
            if (dict != null && dict.TryGetValue(key, out value) && value != null)
            {
                try
                {
                    return Convert.ToDouble(value, CultureInfo.InvariantCulture);
                }
                catch
                {
                    return 0;
                }
            }
            return 0;
        }
    }

    internal sealed class HealthMonitor : IDisposable
    {
        private readonly object _sync = new object();
        private Thread _thread;
        private volatile bool _stop;
        private volatile int _port;
        private volatile int _intervalMs;
        private volatile HealthSnapshot _snapshot;

        public HealthMonitor(int port, int intervalMs)
        {
            _port = port;
            _intervalMs = Math.Max(2000, intervalMs);
        }

        public HealthSnapshot Snapshot
        {
            get { return _snapshot; }
        }

        public void CheckNow()
        {
            _snapshot = HealthClient.Check(_port, 1500);
        }

        public void SetPort(int port)
        {
            _port = port;
        }

        public void Start()
        {
            lock (_sync)
            {
                if (_thread != null) return;
                _stop = false;
                _thread = new Thread(Run);
                _thread.IsBackground = true;
                _thread.Name = "atlisp-health";
                _thread.Start();
            }
        }

        private void Run()
        {
            while (!_stop)
            {
                try
                {
                    _snapshot = HealthClient.Check(_port, 2000);
                }
                catch (Exception ex)
                {
                    AppLog.Write("健康检查异常: " + ex.Message);
                }

                int waited = 0;
                int interval = _intervalMs;
                while (!_stop && waited < interval)
                {
                    Thread.Sleep(200);
                    waited += 200;
                }
            }
        }

        public void Dispose()
        {
            _stop = true;
        }
    }

    internal static class ProcessRunner
    {
        private static readonly object PathSync = new object();

        /// <summary>
        /// 确保 node 所在目录在当前进程 PATH 中。
        /// 托盘可能从 Explorer（或安装 Node.js 之前的登录会话）启动，其 PATH 不含
        /// “C:\Program Files\nodejs”，此时 npm 的安装脚本（如 edge-js 的
        /// node tools/install.js）会因为找不到 node 而失败：
        ///     'C:\Windows\system32\cmd.exe' /d /s /c node tools/install.js
        ///     'node' 不是内部或外部命令，也不是可运行的程序或批处理文件。
        /// 这里补进当前进程环境变量，所有 UseShellExecute=false 的子进程都会继承修正值。
        /// 返回 true 表示发生了修改。
        /// </summary>
        public static bool EnsureNodeOnPath(string nodePath)
        {
            if (string.IsNullOrEmpty(nodePath)) return false;
            string nodeDir;
            try
            {
                nodeDir = Path.GetDirectoryName(Path.GetFullPath(nodePath));
            }
            catch
            {
                return false;
            }
            if (string.IsNullOrEmpty(nodeDir)) return false;

            lock (PathSync)
            {
                string current;
                try { current = Environment.GetEnvironmentVariable("PATH") ?? ""; }
                catch { return false; }

                string[] parts = current.Split(new char[] { ';' },
                    StringSplitOptions.RemoveEmptyEntries);
                for (int i = 0; i < parts.Length; i++)
                {
                    if (SameDir(parts[i], nodeDir)) return false;
                }

                try
                {
                    Environment.SetEnvironmentVariable("PATH", nodeDir + ";" + current);
                }
                catch
                {
                    return false;
                }
                AppLog.Write("已将 " + nodeDir + " 补充到当前进程 PATH");
                return true;
            }
        }

        private static bool SameDir(string a, string b)
        {
            if (string.IsNullOrEmpty(a)) return false;
            try
            {
                string left = Path.GetFullPath(a.Trim().Trim('"')).TrimEnd('\\');
                string right = Path.GetFullPath(b).TrimEnd('\\');
                return string.Equals(left, right, StringComparison.OrdinalIgnoreCase);
            }
            catch
            {
                return false;
            }
        }

        public static string Where(string executable)
        {
            int exitCode;
            string output = Run("where.exe", executable, 5000, out exitCode, Encoding.Default);
            if (exitCode != 0 || string.IsNullOrEmpty(output)) return null;
            string[] lines = output.Split(new char[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
            for (int i = 0; i < lines.Length; i++)
            {
                string line = lines[i].Trim();
                if (line.Length > 0 && File.Exists(line)) return line;
            }
            return null;
        }

        public static string Run(string fileName, string arguments, int timeoutMs, out int exitCode)
        {
            return Run(fileName, arguments, timeoutMs, out exitCode, Encoding.Default);
        }

        public static string Run(string fileName, string arguments, int timeoutMs,
            out int exitCode, Encoding encoding)
        {
            Process process = null;
            StringBuilder output = new StringBuilder();
            try
            {
                ProcessStartInfo info = new ProcessStartInfo();
                info.FileName = fileName;
                info.Arguments = arguments;
                info.UseShellExecute = false;
                info.CreateNoWindow = true;
                info.RedirectStandardOutput = true;
                info.RedirectStandardError = true;
                if (encoding != null)
                {
                    info.StandardOutputEncoding = encoding;
                    info.StandardErrorEncoding = encoding;
                }

                process = new Process();
                process.StartInfo = info;
                process.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e)
                {
                    if (e.Data != null)
                    {
                        lock (output) output.AppendLine(e.Data);
                    }
                };
                process.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e)
                {
                    if (e.Data != null)
                    {
                        lock (output) output.AppendLine(e.Data);
                    }
                };

                process.Start();
                process.BeginOutputReadLine();
                process.BeginErrorReadLine();

                if (!process.WaitForExit(timeoutMs))
                {
                    try { process.Kill(); } catch { }
                    exitCode = -1;
                    lock (output) output.AppendLine("[timeout] 命令执行超时");
                }
                else
                {
                    try { process.WaitForExit(2000); } catch { }
                    exitCode = process.ExitCode;
                }
            }
            catch (Exception ex)
            {
                exitCode = -1;
                lock (output) output.AppendLine("[error] " + ex.Message);
            }
            finally
            {
                if (process != null)
                {
                    try { process.Dispose(); } catch { }
                }
            }

            lock (output) return output.ToString();
        }

        public static string RunCmd(string commandLine, int timeoutMs, out int exitCode)
        {
            string comspec = Environment.GetEnvironmentVariable("ComSpec");
            if (string.IsNullOrEmpty(comspec)) comspec = "cmd.exe";
            return Run(comspec, "/d /s /c \"" + commandLine + "\"", timeoutMs,
                out exitCode, Encoding.Default);
        }

        public static Process Create(string fileName, string arguments, Encoding encoding,
            string workingDirectory, DataReceivedEventHandler outputHandler,
            DataReceivedEventHandler errorHandler)
        {
            ProcessStartInfo info = new ProcessStartInfo();
            info.FileName = fileName;
            info.Arguments = arguments;
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            info.RedirectStandardOutput = true;
            info.RedirectStandardError = true;
            if (encoding != null)
            {
                info.StandardOutputEncoding = encoding;
                info.StandardErrorEncoding = encoding;
            }
            if (!string.IsNullOrEmpty(workingDirectory) && Directory.Exists(workingDirectory))
            {
                info.WorkingDirectory = workingDirectory;
            }

            Process process = new Process();
            process.StartInfo = info;
            process.OutputDataReceived += outputHandler;
            process.ErrorDataReceived += errorHandler;
            return process;
        }

        public static string Quote(string value)
        {
            if (value == null) return "\"\"";
            return "\"" + value.Replace("\"", "\\\"") + "\"";
        }

        public static Process StartElevated(string commandLine, string logFile,
            string nodePath, out string error)
        {
            error = null;
            try
            {
                string batchFile = Path.Combine(
                    Path.GetTempPath(),
                    "atlisp-mcp-" + Guid.NewGuid().ToString("N") + ".cmd");
                StringBuilder content = new StringBuilder();
                content.AppendLine("@echo off");
                content.AppendLine("chcp 65001 >nul");
                // UAC 提升的进程不一定继承托盘的 PATH，npm 安装脚本需要能找到 node
                if (!string.IsNullOrEmpty(nodePath))
                {
                    string nodeDir = Path.GetDirectoryName(Path.GetFullPath(nodePath));
                    if (!string.IsNullOrEmpty(nodeDir))
                    {
                        content.AppendLine("set \"PATH=" + nodeDir + ";%PATH%\"");
                    }
                }
                content.AppendLine("call " + commandLine + " > " + Quote(logFile) + " 2>&1");
                content.AppendLine("exit /b %ERRORLEVEL%");
                File.WriteAllText(batchFile, content.ToString(), Encoding.Default);

                string comspec = Environment.GetEnvironmentVariable("ComSpec");
                if (string.IsNullOrEmpty(comspec)) comspec = "cmd.exe";

                ProcessStartInfo info = new ProcessStartInfo();
                info.FileName = comspec;
                info.Arguments = "/d /s /c " + Quote(batchFile);
                info.Verb = "runas";
                info.UseShellExecute = true;
                info.WindowStyle = ProcessWindowStyle.Hidden;
                return Process.Start(info);
            }
            catch (Win32Exception ex)
            {
                // 1223 = 用户取消了 UAC
                error = ex.NativeErrorCode == 1223 ? "已取消管理员授权" : ex.Message;
                return null;
            }
            catch (Exception ex)
            {
                error = ex.Message;
                return null;
            }
        }

        public static Process StartElevatedExecutable(string fileName, string arguments,
            out string error)
        {
            error = null;
            try
            {
                ProcessStartInfo info = new ProcessStartInfo();
                info.FileName = fileName;
                info.Arguments = arguments;
                info.Verb = "runas";
                info.UseShellExecute = true;
                info.WindowStyle = ProcessWindowStyle.Hidden;
                return Process.Start(info);
            }
            catch (Win32Exception ex)
            {
                // 1223 = 用户取消了 UAC
                error = ex.NativeErrorCode == 1223 ? "已取消管理员授权" : ex.Message;
                return null;
            }
            catch (Exception ex)
            {
                error = ex.Message;
                return null;
            }
        }
    }

    internal sealed class ServerInfo
    {
        public string NodePath;
        public string NpmPath;
        public string NpmCliPath;
        public string ScriptPath;
        public string PackageDir;
        public string Version;
        public string VersionText;

        public bool IsInstalled
        {
            get { return !string.IsNullOrEmpty(ScriptPath); }
        }
    }

    internal static class ServerLocator
    {
        private static readonly object Sync = new object();
        private static ServerInfo _cached;
        private static DateTime _cachedAt = DateTime.MinValue;

        public static ServerInfo Resolve(TrayConfig config, bool force)
        {
            lock (Sync)
            {
                if (!force && _cached != null &&
                    (DateTime.UtcNow - _cachedAt).TotalSeconds < 30)
                {
                    return _cached;
                }

                ServerInfo info = new ServerInfo();
                info.NodePath = FindNode(config);
                // 必须先于 npm 检测：托盘自身 PATH 可能没有 node 目录
                ProcessRunner.EnsureNodeOnPath(info.NodePath);
                info.NpmPath = FindNpm(config, info.NodePath);
                info.NpmCliPath = FindNpmCli(info.NpmPath, info.NodePath);
                info.ScriptPath = FindScript(config, info);
                info.PackageDir = FindPackageDir(info.ScriptPath);
                info.Version = ReadPackageVersion(info.PackageDir);
                info.VersionText = string.IsNullOrEmpty(info.Version) ? "未知版本" : "v" + info.Version;

                _cached = info;
                _cachedAt = DateTime.UtcNow;
                return info;
            }
        }

        public static void Invalidate()
        {
            lock (Sync)
            {
                _cached = null;
                _cachedAt = DateTime.MinValue;
            }
        }

        private static string FindNode(TrayConfig config)
        {
            if (ExistsFile(config.NodePath)) return config.NodePath;

            string programFiles = Environment.GetEnvironmentVariable("ProgramFiles");
            string programFilesX86 = Environment.GetEnvironmentVariable("ProgramFiles(x86)");
            string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            string roamingAppData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            string userProfile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);

            List<string> candidates = new List<string>();
            if (!string.IsNullOrEmpty(programFiles))
                candidates.Add(Path.Combine(programFiles, "nodejs", "node.exe"));
            if (!string.IsNullOrEmpty(programFilesX86))
                candidates.Add(Path.Combine(programFilesX86, "nodejs", "node.exe"));
            candidates.Add(Path.Combine(localAppData, "Programs", "nodejs", "node.exe"));
            candidates.Add(Path.Combine(localAppData, "fnm", "nodejs", "current", "node.exe"));
            candidates.Add(Path.Combine(userProfile, ".volta", "bin", "node.exe"));
            candidates.Add(Path.Combine(userProfile, "scoop", "apps", "nodejs", "current", "node.exe"));
            candidates.Add(Path.Combine(roamingAppData, "nvm", "current", "node.exe"));

            for (int i = 0; i < candidates.Count; i++)
            {
                if (ExistsFile(candidates[i])) return candidates[i];
            }

            string nvmNode = FindNewestNvmNode(Path.Combine(roamingAppData, "nvm"));
            if (nvmNode != null) return nvmNode;

            // 托盘自动安装的免管理员 Node.js（解压在用户目录下，无需 UAC）
            string portableNode = Path.Combine(Paths.PortableNodeDir, "node.exe");
            if (ExistsFile(portableNode)) return portableNode;

            string fromPath = ProcessRunner.Where("node.exe");
            if (fromPath != null) return fromPath;

            return null;
        }

        private static string FindNewestNvmNode(string nvmRoot)
        {
            try
            {
                if (!Directory.Exists(nvmRoot)) return null;
                string[] dirs = Directory.GetDirectories(nvmRoot, "v*");
                int bestMajor = -1;
                int bestMinor = -1;
                int bestPatch = -1;
                string best = null;
                for (int i = 0; i < dirs.Length; i++)
                {
                    string name = Path.GetFileName(dirs[i]).TrimStart('v', 'V');
                    Match match = Regex.Match(name, @"^(\d+)\.(\d+)\.(\d+)");
                    if (!match.Success) continue;
                    int major = int.Parse(match.Groups[1].Value, CultureInfo.InvariantCulture);
                    int minor = int.Parse(match.Groups[2].Value, CultureInfo.InvariantCulture);
                    int patch = int.Parse(match.Groups[3].Value, CultureInfo.InvariantCulture);
                    string exe = Path.Combine(dirs[i], "node.exe");
                    if (!File.Exists(exe)) continue;
                    if (major > bestMajor ||
                        (major == bestMajor && minor > bestMinor) ||
                        (major == bestMajor && minor == bestMinor && patch > bestPatch))
                    {
                        bestMajor = major;
                        bestMinor = minor;
                        bestPatch = patch;
                        best = exe;
                    }
                }
                return best;
            }
            catch
            {
                return null;
            }
        }

        private static string FindNpm(TrayConfig config, string nodePath)
        {
            if (ExistsFile(config.NpmPath)) return config.NpmPath;

            if (!string.IsNullOrEmpty(nodePath))
            {
                string sibling = Path.Combine(Path.GetDirectoryName(nodePath), "npm.cmd");
                if (File.Exists(sibling)) return sibling;
            }

            string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            string perUser = Path.Combine(appData, "npm", "npm.cmd");
            if (File.Exists(perUser)) return perUser;

            string fromPath = ProcessRunner.Where("npm.cmd");
            if (fromPath != null) return fromPath;

            return ProcessRunner.Where("npm");
        }

        private static string FindNpmCli(string npmPath, string nodePath)
        {
            List<string> roots = new List<string>();
            if (!string.IsNullOrEmpty(npmPath)) roots.Add(Path.GetDirectoryName(npmPath));
            if (!string.IsNullOrEmpty(nodePath)) roots.Add(Path.GetDirectoryName(nodePath));
            string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            roots.Add(Path.Combine(appData, "npm"));
            roots.Add(Path.Combine(appData, "npm", "node_modules"));

            for (int i = 0; i < roots.Count; i++)
            {
                string candidate = Path.Combine(roots[i], "node_modules", "npm", "bin", "npm-cli.js");
                if (File.Exists(candidate)) return candidate;
            }
            return null;
        }

        private static string FindScript(TrayConfig config, ServerInfo info)
        {
            if (ExistsFile(config.ServerScript)) return config.ServerScript;

            string fromEnv = Environment.GetEnvironmentVariable("ATLISP_MCP_SCRIPT");
            if (ExistsFile(fromEnv)) return fromEnv;

            string baseDir = Application.StartupPath;
            string[] relative = new string[]
            {
                Path.Combine(baseDir, "dist", "atlisp-mcp.js"),
                Path.Combine(baseDir, "atlisp-mcp.js"),
                Path.Combine(baseDir, "..", "dist", "atlisp-mcp.js"),
                Path.Combine(baseDir, "..", "src", "atlisp-mcp.js"),
                Path.Combine(baseDir, "..", "..", "dist", "atlisp-mcp.js"),
                Path.Combine(baseDir, "..", "..", "src", "atlisp-mcp.js")
            };
            for (int i = 0; i < relative.Length; i++)
            {
                if (ExistsFile(relative[i])) return Path.GetFullPath(relative[i]);
            }

            List<string> globalRoots = new List<string>();
            string npmRoot = GetNpmGlobalRoot(info);
            if (!string.IsNullOrEmpty(npmRoot)) globalRoots.Add(npmRoot);

            string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            globalRoots.Add(Path.Combine(appData, "npm", "node_modules"));
            globalRoots.Add(Path.Combine(localAppData, "npm", "node_modules"));

            for (int i = 0; i < globalRoots.Count; i++)
            {
                string candidate = Path.Combine(globalRoots[i], "@atlisp", "mcp", "dist", "atlisp-mcp.js");
                if (File.Exists(candidate)) return candidate;
            }

            return null;
        }

        private static string GetNpmGlobalRoot(ServerInfo info)
        {
            try
            {
                int exitCode;
                string output;
                if (!string.IsNullOrEmpty(info.NodePath) && !string.IsNullOrEmpty(info.NpmCliPath))
                {
                    output = ProcessRunner.Run(
                        info.NodePath,
                        ProcessRunner.Quote(info.NpmCliPath) + " root -g",
                        10000,
                        out exitCode,
                        Encoding.UTF8);
                }
                else if (!string.IsNullOrEmpty(info.NpmPath))
                {
                    output = ProcessRunner.RunCmd(
                        ProcessRunner.Quote(info.NpmPath) + " root -g",
                        15000,
                        out exitCode);
                }
                else
                {
                    return null;
                }

                if (exitCode != 0 || string.IsNullOrEmpty(output)) return null;
                string[] lines = output.Split(new char[] { '\r', '\n' },
                    StringSplitOptions.RemoveEmptyEntries);
                for (int i = lines.Length - 1; i >= 0; i--)
                {
                    string line = lines[i].Trim();
                    if (line.Length > 0 && Directory.Exists(line)) return line;
                }
            }
            catch (Exception ex)
            {
                AppLog.Write("获取 npm 全局目录失败: " + ex.Message);
            }
            return null;
        }

        private static string FindPackageDir(string scriptPath)
        {
            if (string.IsNullOrEmpty(scriptPath)) return null;
            try
            {
                DirectoryInfo dir = new DirectoryInfo(Path.GetDirectoryName(scriptPath));
                for (int i = 0; i < 4 && dir != null; i++)
                {
                    if (File.Exists(Path.Combine(dir.FullName, "package.json"))) return dir.FullName;
                    dir = dir.Parent;
                }
            }
            catch
            {
                // 路径异常时按未知处理
            }
            return null;
        }

        private static string ReadPackageVersion(string packageDir)
        {
            if (string.IsNullOrEmpty(packageDir)) return null;
            try
            {
                string text = File.ReadAllText(
                    Path.Combine(packageDir, "package.json"), Encoding.UTF8);
                Match match = Regex.Match(text, "\"version\"\\s*:\\s*\"([^\"]+)\"");
                if (match.Success) return match.Groups[1].Value;
            }
            catch (Exception ex)
            {
                AppLog.Write("读取 package.json 失败: " + ex.Message);
            }
            return null;
        }

        private static bool ExistsFile(string path)
        {
            return !string.IsNullOrEmpty(path) && File.Exists(path);
        }
    }

    /// <summary>
    /// edge-js 的 npm 安装脚本（node tools/install.js）在 Windows 上会无条件
    /// spawn `dotnet build` 构建 CoreCLR bootstrap。机器没有 .NET SDK 时 spawn 抛
    /// 未处理的 ENOENT，整个 `npm install -g @atlisp/mcp` 以退出码 1 失败：
    ///     Error: spawn dotnet ENOENT / code: 'ENOENT', syscall: 'spawn dotnet'
    ///
    /// 本服务在 Windows 上走 .NET Framework 的 native CLR + COM，用不到 bootstrap，
    /// 所以没有 dotnet 时可以：
    ///   1) npm install 加 --ignore-scripts（只跳过安装脚本，包文件照常安装）；
    ///   2) 用 Repair() 补上安装脚本里唯一有用的那步——把 VC 运行时 DLL 复制到
    ///      各 node ABI 目录（edge_nativeclr.node 就从这个目录解析依赖）。
    /// </summary>
    internal static class EdgeNativeSupport
    {
        private static readonly string[] RedistDlls = new string[]
        {
            "concrt140.dll", "msvcp140.dll", "vccorlib140.dll", "vcruntime140.dll"
        };

        private static readonly string[] ArchDirs = new string[] { "x64", "ia32", "arm64" };

        /// <summary>本机是否有 .NET SDK（只有它才需要跑 edge-js 的安装脚本）。</summary>
        public static bool DotnetAvailable()
        {
            return ProcessRunner.Where("dotnet.exe") != null;
        }

        /// <summary>npm install 需要追加的参数：没有 dotnet 时跳过安装脚本，避免 ENOENT。</summary>
        public static string InstallArgs()
        {
            return DotnetAvailable() ? "" : " --ignore-scripts";
        }

        /// <summary>安装/升级完成后补齐 edge-js 原生文件，返回一行写日志的说明。</summary>
        public static string Repair(ServerInfo info)
        {
            if (info == null || string.IsNullOrEmpty(info.PackageDir))
            {
                return "未定位到 @lisp/mcp 包目录，跳过 edge-js 原生文件检查";
            }

            string edgeDir = FindEdgeJs(info.PackageDir);
            if (string.IsNullOrEmpty(edgeDir))
            {
                return "未找到 edge-js 目录，跳过原生文件检查";
            }

            string winRoot = Path.Combine(edgeDir, "lib", "native", "win32");
            if (!Directory.Exists(winRoot))
            {
                return "edge-js 不含 win32 原生目录，跳过";
            }

            int copied = 0;
            int failed = 0;
            for (int i = 0; i < ArchDirs.Length; i++)
            {
                string archDir = Path.Combine(winRoot, ArchDirs[i]);
                if (!Directory.Exists(archDir)) continue;

                string[] nodeDirs;
                try { nodeDirs = Directory.GetDirectories(archDir); }
                catch { continue; }

                for (int j = 0; j < nodeDirs.Length; j++)
                {
                    for (int k = 0; k < RedistDlls.Length; k++)
                    {
                        string source = Path.Combine(archDir, RedistDlls[k]);
                        if (!File.Exists(source)) continue;
                        string target = Path.Combine(nodeDirs[j], RedistDlls[k]);
                        try
                        {
                            if (File.Exists(target))
                            {
                                // 安装脚本写过的文件带只读属性，覆盖前先清掉
                                File.SetAttributes(target, FileAttributes.Normal);
                            }
                            File.Copy(source, target, true);
                            copied++;
                        }
                        catch
                        {
                            failed++;
                        }
                    }
                }
            }

            if (failed > 0)
            {
                return "edge-js 原生文件补齐不完整（复制 " + copied + " 个，失败 " +
                    failed + " 个）；如报缺 DLL，可用管理员身份重试或安装 VC++ 运行库";
            }
            if (copied == 0)
            {
                return "edge-js 原生文件已就绪（无需复制）";
            }
            return "edge-js 原生文件已补齐（复制 " + copied + " 个 DLL）";
        }

        private static string FindEdgeJs(string packageDir)
        {
            // 全局安装时依赖通常嵌套在 @atlisp/mcp/node_modules，
            // 但也可能被提升到 <prefix>/node_modules/edge-js
            string[] candidates = new string[]
            {
                Path.Combine(packageDir, "node_modules", "edge-js"),
                Path.Combine(packageDir, "..", "..", "edge-js"),
                Path.Combine(packageDir, "..", "..", "..", "edge-js")
            };
            for (int i = 0; i < candidates.Length; i++)
            {
                try
                {
                    string full = Path.GetFullPath(candidates[i]);
                    if (Directory.Exists(full)) return full;
                }
                catch
                {
                }
            }
            return null;
        }
    }

    internal static class NpmRunner
    {
        /// <summary>
        /// 全局安装/升级命令。没有 .NET SDK 时追加 --ignore-scripts：edge-js 的安装
        /// 脚本会因 `spawn dotnet ENOENT` 让 npm 退出码 1（见 EdgeNativeSupport）。
        /// </summary>
        public static string InstallServerArgs(TrayConfig config)
        {
            return WithRegistry(config,
                "install -g @atlisp/mcp@latest --loglevel=error" + EdgeNativeSupport.InstallArgs());
        }

        public static string WithRegistry(TrayConfig config, string arguments)
        {
            if (!string.IsNullOrEmpty(config.NpmRegistry))
            {
                return arguments + " --registry=" + config.NpmRegistry;
            }
            return arguments;
        }

        public static string Run(TrayConfig config, ServerInfo info, string arguments,
            int timeoutMs, out int exitCode)
        {
            if (!string.IsNullOrEmpty(info.NodePath) && !string.IsNullOrEmpty(info.NpmCliPath))
            {
                return ProcessRunner.Run(
                    info.NodePath,
                    ProcessRunner.Quote(info.NpmCliPath) + " " + arguments,
                    timeoutMs,
                    out exitCode,
                    Encoding.UTF8);
            }

            if (!string.IsNullOrEmpty(info.NpmPath))
            {
                return ProcessRunner.RunCmd(
                    ProcessRunner.Quote(info.NpmPath) + " " + arguments,
                    timeoutMs,
                    out exitCode);
            }

            exitCode = -1;
            return "未找到 npm，请先安装 Node.js。";
        }

        public static string BuildCommandLine(ServerInfo info, string arguments)
        {
            if (!string.IsNullOrEmpty(info.NodePath) && !string.IsNullOrEmpty(info.NpmCliPath))
            {
                return ProcessRunner.Quote(info.NodePath) + " " +
                       ProcessRunner.Quote(info.NpmCliPath) + " " + arguments;
            }
            if (!string.IsNullOrEmpty(info.NpmPath))
            {
                return ProcessRunner.Quote(info.NpmPath) + " " + arguments;
            }
            return null;
        }

        public static Process Create(TrayConfig config, ServerInfo info, string arguments,
            DataReceivedEventHandler outputHandler, DataReceivedEventHandler errorHandler)
        {
            // 不要把 npm 的工作目录设在正在被替换的包目录里（Windows 会锁定该目录）
            string workingDirectory = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            if (!string.IsNullOrEmpty(info.NodePath) && !string.IsNullOrEmpty(info.NpmCliPath))
            {
                return ProcessRunner.Create(
                    info.NodePath,
                    ProcessRunner.Quote(info.NpmCliPath) + " " + arguments,
                    Encoding.UTF8,
                    workingDirectory,
                    outputHandler,
                    errorHandler);
            }
            if (!string.IsNullOrEmpty(info.NpmPath))
            {
                string comspec = Environment.GetEnvironmentVariable("ComSpec");
                if (string.IsNullOrEmpty(comspec)) comspec = "cmd.exe";
                return ProcessRunner.Create(
                    comspec,
                    "/d /s /c \"" + ProcessRunner.Quote(info.NpmPath) + " " + arguments + "\"",
                    Encoding.Default,
                    workingDirectory,
                    outputHandler,
                    errorHandler);
            }
            return null;
        }
    }

    internal static class VersionUtil
    {
        public static Version Parse(string text)
        {
            if (string.IsNullOrEmpty(text)) return null;
            Match match = Regex.Match(text.Trim(), @"(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?");
            if (!match.Success) return null;
            try
            {
                int major = int.Parse(match.Groups[1].Value, CultureInfo.InvariantCulture);
                int minor = int.Parse(match.Groups[2].Value, CultureInfo.InvariantCulture);
                int patch = int.Parse(match.Groups[3].Value, CultureInfo.InvariantCulture);
                int build = match.Groups[4].Success
                    ? int.Parse(match.Groups[4].Value, CultureInfo.InvariantCulture)
                    : 0;
                return new Version(major, minor, patch, build);
            }
            catch
            {
                return null;
            }
        }

        public static bool IsNewer(string latest, string current)
        {
            Version latestVersion = Parse(latest);
            Version currentVersion = Parse(current);
            if (latestVersion == null) return false;
            if (currentVersion == null) return true;
            return latestVersion > currentVersion;
        }

        public static string Extract(string text)
        {
            if (string.IsNullOrEmpty(text)) return null;
            string[] lines = text.Split(new char[] { '\r', '\n' },
                StringSplitOptions.RemoveEmptyEntries);
            for (int i = lines.Length - 1; i >= 0; i--)
            {
                string line = lines[i].Trim();
                if (line.Length > 0 && line[0] >= '0' && line[0] <= '9' &&
                    line.IndexOf('.') > 0)
                {
                    return line;
                }
            }
            return null;
        }
    }

    internal static class ServiceHelper
    {
        public const string ServiceName = "atlisp-mcp";
        private static readonly object Sync = new object();
        private static DateTime _cachedAt = DateTime.MinValue;
        private static bool _cachedExists;
        private static bool _cachedRunning;

        public static void Query(out bool exists, out bool running)
        {
            Query(out exists, out running, false);
        }

        public static void Query(out bool exists, out bool running, bool force)
        {
            lock (Sync)
            {
                if (!force && (DateTime.UtcNow - _cachedAt).TotalSeconds < 10)
                {
                    exists = _cachedExists;
                    running = _cachedRunning;
                    return;
                }

                exists = false;
                running = false;
                try
                {
                    int exitCode;
                    string output = ProcessRunner.Run(
                        "sc.exe", "query " + ServiceName, 5000, out exitCode);
                    if (exitCode == 0)
                    {
                        exists = true;
                        running = output.IndexOf("RUNNING", StringComparison.OrdinalIgnoreCase) >= 0;
                    }
                }
                catch (Exception ex)
                {
                    AppLog.Write("查询 Windows 服务失败: " + ex.Message);
                }

                _cachedExists = exists;
                _cachedRunning = running;
                _cachedAt = DateTime.UtcNow;
            }
        }

        public static void Invalidate()
        {
            lock (Sync)
            {
                _cachedAt = DateTime.MinValue;
            }
        }

        public static bool Exists()
        {
            bool exists;
            bool running;
            Query(out exists, out running, true);
            return exists;
        }

        public static bool IsRunning()
        {
            bool exists;
            bool running;
            Query(out exists, out running, true);
            return exists && running;
        }

        public static string Start()
        {
            int exitCode;
            string output = ProcessRunner.Run(
                "sc.exe", "start " + ServiceName, 20000, out exitCode);
            Invalidate();
            if (exitCode != 0) return output.Trim();
            return null;
        }

        public static string Stop()
        {
            int exitCode;
            string output = ProcessRunner.Run(
                "sc.exe", "stop " + ServiceName, 20000, out exitCode);
            Invalidate();
            if (exitCode != 0) return output.Trim();
            return null;
        }
    }

    internal sealed class ServerManager : IDisposable
    {
        private readonly TrayConfig _config;
        private readonly object _sync = new object();
        private Process _process;
        private StreamWriter _logWriter;
        private volatile ServerState _state = ServerState.Stopped;
        private volatile bool _stopRequested;
        private DateTime _lastCrashReport = DateTime.MinValue;
        private string _lastError;
        private readonly List<string> _tail = new List<string>();

        public ServerManager(TrayConfig config)
        {
            _config = config;
        }

        public ServerState State
        {
            get { return _state; }
        }

        public string LastError
        {
            get { return _lastError; }
        }

        public string Tail
        {
            get
            {
                lock (_sync)
                {
                    if (_tail.Count == 0) return "";
                    return string.Join("\r\n", _tail.ToArray());
                }
            }
        }

        public bool IsTrayProcessAlive()
        {
            Process process = _process;
            if (process == null) return false;
            try { return !process.HasExited; }
            catch { return false; }
        }

        public ServerState Refresh(HealthSnapshot health)
        {
            if (_state == ServerState.Stopping) return _state;

            if (health != null && health.Ok)
            {
                _state = ServerState.Running;
                _lastError = null;
                return _state;
            }

            if (IsTrayProcessAlive())
            {
                _state = ServerState.Starting;
                return _state;
            }

            bool serviceExists;
            bool serviceRunning;
            ServiceHelper.Query(out serviceExists, out serviceRunning);
            if (serviceRunning)
            {
                _state = ServerState.Starting;
                return _state;
            }

            Process finished = _process;
            if (finished != null)
            {
                try
                {
                    if (finished.HasExited && finished.ExitCode != 0 && !_stopRequested)
                    {
                        int code = finished.ExitCode;
                        _lastError = "服务进程已退出（退出码 " + code + "）。请查看日志。";
                        if ((DateTime.UtcNow - _lastCrashReport).TotalSeconds > 60)
                        {
                            _lastCrashReport = DateTime.UtcNow;
                        }
                        _state = ServerState.Error;
                        return _state;
                    }
                }
                catch
                {
                    // 进程对象已释放时按停止处理
                }
            }

            _state = ServerState.Stopped;
            return _state;
        }

        public void Start()
        {
            if (IsTrayProcessAlive()) return;

            bool serviceExists;
            bool serviceRunning;
            ServiceHelper.Query(out serviceExists, out serviceRunning, true);
            if (serviceExists)
            {
                if (serviceRunning) return;
                string error = ServiceHelper.Start();
                if (error != null) throw new TrayException("启动 Windows 服务失败：" + error);
                _state = ServerState.Starting;
                return;
            }

            ServerInfo info = ServerLocator.Resolve(_config, true);
            if (string.IsNullOrEmpty(info.NodePath))
            {
                throw new TrayException("未检测到 Node.js。请先安装 Node.js（>= 18）。");
            }
            if (!info.IsInstalled)
            {
                throw new TrayException("未检测到 @lisp MCP Server。请先安装：npm install -g @atlisp/mcp");
            }

            lock (_sync)
            {
                CloseLogWriter();
                Directory.CreateDirectory(Paths.LogDir);
                string logFile = Path.Combine(
                    Paths.LogDir,
                    "server-" + DateTime.Now.ToString("yyyyMMdd") + ".log");
                try
                {
                    FileStream stream = new FileStream(
                        logFile, FileMode.Append, FileAccess.Write, FileShare.ReadWrite);
                    _logWriter = new StreamWriter(stream, new UTF8Encoding(false));
                    _logWriter.AutoFlush = true;
                }
                catch (Exception ex)
                {
                    AppLog.Write("打开服务器日志失败: " + ex.Message);
                }

                _tail.Clear();

                ProcessStartInfo startInfo = new ProcessStartInfo();
                startInfo.FileName = info.NodePath;
                startInfo.Arguments = BuildArguments(info);
                startInfo.UseShellExecute = false;
                startInfo.CreateNoWindow = true;
                startInfo.RedirectStandardOutput = true;
                startInfo.RedirectStandardError = true;
                startInfo.StandardOutputEncoding = Encoding.UTF8;
                startInfo.StandardErrorEncoding = Encoding.UTF8;
                if (!string.IsNullOrEmpty(info.PackageDir))
                {
                    startInfo.WorkingDirectory = info.PackageDir;
                }

                Process process = new Process();
                process.StartInfo = startInfo;
                process.EnableRaisingEvents = true;
                process.OutputDataReceived += OnServerOutput;
                process.ErrorDataReceived += OnServerOutput;

                try
                {
                    process.Start();
                    process.BeginOutputReadLine();
                    process.BeginErrorReadLine();
                }
                catch (Exception ex)
                {
                    try { process.Dispose(); } catch { }
                    CloseLogWriter();
                    throw new TrayException("启动服务失败：" + ex.Message);
                }

                // 上一次进程对象可能已退出但仍占用句柄，先释放
                if (_process != null)
                {
                    try { _process.Dispose(); } catch { }
                }
                _process = process;
                _stopRequested = false;
                _lastError = null;
                _state = ServerState.Starting;
                WritePidFile(process.Id);
                AppLog.Write("server started pid=" + process.Id + " port=" + _config.Port);
            }
        }

        public void StopAsync()
        {
            if (_state == ServerState.Stopping) return;
            _stopRequested = true;
            _state = ServerState.Stopping;
            Thread thread = new Thread(StopWorker);
            thread.IsBackground = true;
            thread.Name = "atlisp-stop";
            thread.Start();
        }

        public void StopSync()
        {
            if (_state == ServerState.Stopping) return;
            _stopRequested = true;
            _state = ServerState.Stopping;
            StopWorker();
        }

        public void RestartAsync()
        {
            if (_state == ServerState.Stopping) return;
            _stopRequested = true;
            _state = ServerState.Stopping;
            Thread thread = new Thread(RestartWorker);
            thread.IsBackground = true;
            thread.Name = "atlisp-restart";
            thread.Start();
        }

        private void RestartWorker()
        {
            StopWorker();
            try
            {
                Thread.Sleep(800);
                Start();
            }
            catch (Exception ex)
            {
                AppLog.Write("重启服务失败: " + ex.Message);
                _lastError = ex.Message;
                _state = ServerState.Error;
            }
        }

        private void StopWorker()
        {
            try
            {
                bool serviceExists;
                bool serviceRunning;
                ServiceHelper.Query(out serviceExists, out serviceRunning, true);
                if (serviceExists && serviceRunning)
                {
                    string error = ServiceHelper.Stop();
                    if (error != null) throw new TrayException("停止 Windows 服务失败：" + error);
                    WaitForServiceStopped(15000);
                    return;
                }

                int pid = FindServerPid();
                if (pid > 0)
                {
                    KillProcess(pid);
                    DeletePidFile();
                    AppLog.Write("server stopped pid=" + pid);
                }
            }
            catch (Exception ex)
            {
                AppLog.Write("停止服务失败: " + ex.Message);
                _lastError = ex.Message;
                _state = ServerState.Error;
            }
            finally
            {
                lock (_sync)
                {
                    if (_process != null)
                    {
                        try { _process.Dispose(); } catch { }
                        _process = null;
                    }
                    CloseLogWriter();
                }
                _stopRequested = false;
                if (_state == ServerState.Stopping) _state = ServerState.Stopped;
            }
        }

        private void WaitForServiceStopped(int timeoutMs)
        {
            int waited = 0;
            while (waited < timeoutMs)
            {
                bool exists;
                bool running;
                ServiceHelper.Query(out exists, out running, true);
                if (!running) return;
                Thread.Sleep(300);
                waited += 300;
            }
        }

        private int FindServerPid()
        {
            Process process = _process;
            if (process != null)
            {
                try
                {
                    if (!process.HasExited) return process.Id;
                }
                catch
                {
                    // 继续尝试其他来源
                }
            }

            int pid = ReadPidFile();
            if (pid > 0 && IsNodeProcess(pid)) return pid;

            pid = ReadLockFile();
            if (pid > 0 && IsNodeProcess(pid)) return pid;

            return FindListeningPid(_config.Port);
        }

        private int ReadPidFile()
        {
            try
            {
                if (!File.Exists(Paths.PidPath)) return 0;
                string text = File.ReadAllText(Paths.PidPath).Trim();
                int pid;
                if (int.TryParse(text, NumberStyles.Integer, CultureInfo.InvariantCulture, out pid))
                {
                    return pid;
                }
            }
            catch
            {
                // 忽略损坏的 pid 文件
            }
            return 0;
        }

        private int ReadLockFile()
        {
            try
            {
                string path = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                    ".atlisp", "locks", "atlisp-mcp-" + _config.Port + ".lock");
                if (!File.Exists(path)) return 0;
                string text = File.ReadAllText(path, Encoding.UTF8);
                Match match = Regex.Match(text, "\"pid\"\\s*:\\s*(\\d+)");
                if (match.Success)
                {
                    return int.Parse(match.Groups[1].Value, CultureInfo.InvariantCulture);
                }
            }
            catch
            {
                // 锁文件不可读时忽略
            }
            return 0;
        }

        private static bool IsNodeProcess(int pid)
        {
            try
            {
                Process process = Process.GetProcessById(pid);
                return process.ProcessName.IndexOf("node", StringComparison.OrdinalIgnoreCase) >= 0;
            }
            catch
            {
                return false;
            }
        }

        private static int FindListeningPid(int port)
        {
            try
            {
                int exitCode;
                string output = ProcessRunner.Run("netstat.exe", "-ano -p tcp", 8000, out exitCode);
                if (exitCode != 0) return 0;
                string[] lines = output.Split(new char[] { '\r', '\n' },
                    StringSplitOptions.RemoveEmptyEntries);
                string suffix = ":" + port;
                for (int i = 0; i < lines.Length; i++)
                {
                    string line = lines[i].Trim();
                    if (line.IndexOf("LISTENING", StringComparison.OrdinalIgnoreCase) < 0) continue;
                    string[] parts = Regex.Split(line, "\\s+");
                    if (parts.Length < 4) continue;
                    string local = parts[1];
                    if (!local.EndsWith(suffix, StringComparison.Ordinal)) continue;
                    int pid;
                    if (int.TryParse(parts[parts.Length - 1], NumberStyles.Integer,
                        CultureInfo.InvariantCulture, out pid))
                    {
                        if (IsNodeProcess(pid)) return pid;
                    }
                }
            }
            catch (Exception ex)
            {
                AppLog.Write("查找监听端口进程失败: " + ex.Message);
            }
            return 0;
        }

        private static void KillProcess(int pid)
        {
            int exitCode;
            ProcessRunner.Run("taskkill.exe", "/PID " + pid + " /T", 5000, out exitCode);
            if (WaitForExit(pid, 2000)) return;

            ProcessRunner.Run("taskkill.exe", "/PID " + pid + " /T /F", 8000, out exitCode);
            WaitForExit(pid, 3000);
        }

        private static bool WaitForExit(int pid, int timeoutMs)
        {
            int waited = 0;
            while (waited < timeoutMs)
            {
                try
                {
                    Process.GetProcessById(pid);
                }
                catch
                {
                    return true;
                }
                Thread.Sleep(200);
                waited += 200;
            }
            return false;
        }

        private string BuildArguments(ServerInfo info)
        {
            StringBuilder builder = new StringBuilder();
            builder.Append(ProcessRunner.Quote(info.ScriptPath));
            builder.Append(" --transport http");
            builder.Append(" --port ");
            builder.Append(_config.Port.ToString(CultureInfo.InvariantCulture));
            if (!string.IsNullOrEmpty(_config.ConfigFile))
            {
                builder.Append(" --config ");
                builder.Append(ProcessRunner.Quote(_config.ConfigFile));
            }
            return builder.ToString();
        }

        private void OnServerOutput(object sender, DataReceivedEventArgs e)
        {
            if (e.Data == null) return;
            lock (_sync)
            {
                _tail.Add(e.Data);
                if (_tail.Count > 300) _tail.RemoveAt(0);
                if (_logWriter != null)
                {
                    try { _logWriter.WriteLine(e.Data); } catch { }
                }
            }
        }

        private void WritePidFile(int pid)
        {
            try
            {
                Directory.CreateDirectory(Paths.DataDir);
                File.WriteAllText(Paths.PidPath,
                    pid.ToString(CultureInfo.InvariantCulture), new UTF8Encoding(false));
            }
            catch (Exception ex)
            {
                AppLog.Write("写入 pid 文件失败: " + ex.Message);
            }
        }

        private void DeletePidFile()
        {
            try
            {
                if (File.Exists(Paths.PidPath)) File.Delete(Paths.PidPath);
            }
            catch
            {
                // 忽略删除失败
            }
        }

        private void CloseLogWriter()
        {
            if (_logWriter != null)
            {
                try { _logWriter.Dispose(); } catch { }
                _logWriter = null;
            }
        }

        public void Dispose()
        {
            lock (_sync)
            {
                CloseLogWriter();
                // 托盘退出不结束已启动的服务：允许服务继续在后台运行
                if (_process != null)
                {
                    try { _process.Dispose(); } catch { }
                    _process = null;
                }
            }
        }
    }

    internal static class AutostartHelper
    {
        private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
        private const string ValueName = "atlisp-mcp-tray";

        public static bool IsEnabled()
        {
            try
            {
                using (RegistryKey key = Registry.CurrentUser.OpenSubKey(RunKey, false))
                {
                    if (key == null) return false;
                    return key.GetValue(ValueName) != null;
                }
            }
            catch (Exception ex)
            {
                AppLog.Write("读取自启动项失败: " + ex.Message);
                return false;
            }
        }

        public static void SetEnabled(bool enabled)
        {
            SetEnabled(enabled, Application.ExecutablePath);
        }

        public static void SetEnabled(bool enabled, string executablePath)
        {
            using (RegistryKey key = Registry.CurrentUser.CreateSubKey(RunKey))
            {
                if (key == null) throw new TrayException("无法写入注册表自启动项。");
                if (enabled)
                {
                    string command = ProcessRunner.Quote(executablePath) + " --silent";
                    key.SetValue(ValueName, command, RegistryValueKind.String);
                }
                else
                {
                    key.DeleteValue(ValueName, false);
                }
            }
        }
    }

    /// <summary>
    /// 托盘自身的搬迁与自我更新。
    ///
    /// 背景：托盘 exe 随 @atlisp/mcp 一起发布，`atlisp-tray` 默认直接运行包内的
    /// `dist\AtlispTray.exe`。Windows 会锁住运行中的 exe，导致 npm 升级替换该文件时
    /// 失败（EBUSY/EPERM），运行中的旧进程也不会自动变成新版本。
    ///
    /// 处理方式：
    ///   1. 启动时若发现自己运行在 node_modules 里，复制到用户目录并重启（自迁移）；
    ///   2. 每次升级 @lisp/mcp 成功后，比对新包内 exe 与当前 exe，不同则用临时 cmd
    ///      脚本（等本进程退出 → 覆盖 → 重新启动）完成自我替换。
    /// </summary>
    internal static class TraySelfUpdate
    {
        private const string StagedName = ".AtlispTray.update.exe";

        public static string StablePath
        {
            get
            {
                return Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "Programs", "atlisp-mcp", "AtlispTray.exe");
            }
        }

        public static string PackageTrayPath(ServerInfo info)
        {
            if (info == null || string.IsNullOrEmpty(info.PackageDir)) return null;
            string candidate = Path.Combine(info.PackageDir, "dist", "AtlispTray.exe");
            return File.Exists(candidate) ? candidate : null;
        }

        /// <summary>
        /// 从 npm 包目录启动时把自身复制到用户目录，并在本进程退出后启动新副本。
        /// 返回 true 表示已安排重启，调用方应直接退出。
        /// </summary>
        public static bool TryRelocate(out string message)
        {
            message = "";
            string current = Application.ExecutablePath;
            if (SamePath(current, StablePath)) return false;
            if (!IsUnderNpmPackage(current)) return false;

            try
            {
                string dir = Path.GetDirectoryName(StablePath);
                if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
                File.Copy(current, StablePath, true);
            }
            catch (Exception ex)
            {
                message = "复制到 " + StablePath + " 失败: " + ex.Message;
                return false;
            }

            // 开机自启原先可能指向包内路径，改指用户目录下的副本
            try
            {
                if (AutostartHelper.IsEnabled()) AutostartHelper.SetEnabled(true, StablePath);
            }
            catch (Exception ex)
            {
                AppLog.Write("tray-selfupdate: 更新自启路径失败: " + ex.Message);
            }

            string error;
            if (!ScheduleRestartScript(Process.GetCurrentProcess().Id, null, StablePath,
                Program.StartServerRequested, out error))
            {
                message = "无法启动迁移后的托盘: " + error;
                return false;
            }

            message = "已迁移到 " + StablePath + "，正在重启托盘";
            return true;
        }

        /// <summary>
        /// 升级 @lisp/mcp 成功后调用：包内托盘与当前 exe 不同则安排自我替换 + 重启。
        /// </summary>
        public static bool TryApplyUpdate(ServerInfo info, bool startServer, out string message)
        {
            message = "";
            string current = Application.ExecutablePath;
            string candidate = PackageTrayPath(info);
            if (candidate == null)
            {
                AppLog.Write("tray-selfupdate: 包内未找到 dist\\AtlispTray.exe，跳过托盘更新");
                return false;
            }
            if (SamePath(current, candidate)) return false;
            // 只更新受管副本（%LOCALAPPDATA%\Programs\atlisp-mcp）：开发目录/Program Files
            // 等位置不自动替换，避免把开发中构建的 exe 覆盖成 npm 包里的版本。
            if (!SamePath(current, StablePath))
            {
                if (IsUnderNpmPackage(current))
                {
                    message = "托盘仍运行在 npm 包目录内（自迁移未生效），跳过自我替换";
                }
                else
                {
                    AppLog.Write("tray-selfupdate: 托盘不在受管目录，跳过自我替换（" +
                        current + "）");
                }
                return false;
            }

            try
            {
                if (string.Equals(FileHash(current), FileHash(candidate),
                    StringComparison.OrdinalIgnoreCase))
                {
                    return false;
                }
            }
            catch (Exception ex)
            {
                message = "比较托盘版本失败: " + ex.Message;
                return false;
            }

            string staged = Path.Combine(Path.GetDirectoryName(current), StagedName);
            try
            {
                File.Copy(candidate, staged, true);
            }
            catch (Exception ex)
            {
                message = "无法写入托盘目录（" + Path.GetDirectoryName(current) + "）: " + ex.Message;
                return false;
            }

            string error;
            if (!ScheduleRestartScript(Process.GetCurrentProcess().Id, staged, current,
                startServer, out error))
            {
                try { File.Delete(staged); } catch { }
                message = "无法启动托盘更新脚本: " + error;
                return false;
            }

            message = "托盘程序已就绪，退出后自动替换并重启";
            return true;
        }

        /// <summary>
        /// 写一个临时 cmd：等本进程退出 → （可选）覆盖 exe → 重新启动。
        /// Windows 不允许覆盖正在运行的 exe，所以这一步只能交给独立进程。
        /// </summary>
        private static bool ScheduleRestartScript(int pid, string stagedExe, string targetExe,
            bool startServer, out string error)
        {
            error = "";
            try
            {
                Directory.CreateDirectory(Paths.DataDir);
                string logFile = Path.Combine(Paths.LogDir, "tray-update.log");
                string script = Path.Combine(Paths.DataDir, "update-tray.cmd");

                StringBuilder sb = new StringBuilder();
                sb.AppendLine("@echo off");
                sb.AppendLine("setlocal enabledelayedexpansion");
                sb.AppendLine("set /a tries=0");
                sb.AppendLine(":wait");
                sb.AppendLine("tasklist /FI \"PID eq " + pid.ToString(CultureInfo.InvariantCulture) +
                    "\" /NH 2>nul | findstr /C:\"" + pid.ToString(CultureInfo.InvariantCulture) + "\" >nul");
                sb.AppendLine("if errorlevel 1 goto apply");
                sb.AppendLine("set /a tries+=1");
                sb.AppendLine("if !tries! GEQ 120 goto fail");
                sb.AppendLine("ping -n 1 127.0.0.1 >nul");
                sb.AppendLine("goto wait");
                sb.AppendLine(":apply");
                if (!string.IsNullOrEmpty(stagedExe))
                {
                    sb.AppendLine("set /a tries=0");
                    sb.AppendLine(":copy");
                    sb.AppendLine("copy /y \"" + stagedExe + "\" \"" + targetExe + "\" >nul 2>&1");
                    sb.AppendLine("if not errorlevel 1 goto start");
                    sb.AppendLine("set /a tries+=1");
                    sb.AppendLine("if !tries! GEQ 30 goto copyfail");
                    sb.AppendLine("ping -n 1 127.0.0.1 >nul");
                    sb.AppendLine("goto copy");
                }
                sb.AppendLine(":start");
                if (!string.IsNullOrEmpty(stagedExe))
                {
                    sb.AppendLine("del /q \"" + stagedExe + "\" >nul 2>&1");
                }
                string args = "";
                if (Program.SilentMode) args += " --silent";
                if (startServer) args += " --start-server";
                string targetDir = Path.GetDirectoryName(targetExe);
                if (!string.IsNullOrEmpty(targetDir))
                {
                    sb.AppendLine("cd /d \"" + targetDir + "\"");
                }
                sb.AppendLine("start \"\" \"" + targetExe + "\"" + args);
                sb.AppendLine("del /q \"%~f0\" >nul 2>&1");
                sb.AppendLine("exit /b 0");
                sb.AppendLine(":copyfail");
                // 覆盖失败说明目标还是旧版：先把旧版拉起来，避免托盘消失
                sb.AppendLine("echo [%date% %time%] tray update copy failed >>\"" + logFile + "\"");
                sb.AppendLine("del /q \"" + stagedExe + "\" >nul 2>&1");
                if (!string.IsNullOrEmpty(targetDir))
                {
                    sb.AppendLine("cd /d \"" + targetDir + "\"");
                }
                sb.AppendLine("start \"\" \"" + targetExe + "\"" + args);
                sb.AppendLine("del /q \"%~f0\" >nul 2>&1");
                sb.AppendLine("exit /b 1");
                sb.AppendLine(":fail");
                sb.AppendLine("echo [%date% %time%] tray update failed (target=" + targetExe +
                    ") >>\"" + logFile + "\"");
                sb.AppendLine("del /q \"" + stagedExe + "\" >nul 2>&1");
                sb.AppendLine("exit /b 1");

                File.WriteAllText(script, sb.ToString(), Encoding.Default);

                ProcessStartInfo psi = new ProcessStartInfo();
                string comspec = Environment.GetEnvironmentVariable("ComSpec");
                psi.FileName = string.IsNullOrEmpty(comspec) ? "cmd.exe" : comspec;
                psi.Arguments = "/c call " + ProcessRunner.Quote(script);
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.WindowStyle = ProcessWindowStyle.Hidden;
                Process.Start(psi);
                return true;
            }
            catch (Exception ex)
            {
                error = ex.Message;
                return false;
            }
        }

        public static bool IsUnderNpmPackage(string path)
        {
            return !string.IsNullOrEmpty(path) &&
                path.IndexOf("\\node_modules\\", StringComparison.OrdinalIgnoreCase) >= 0;
        }

        private static bool SamePath(string left, string right)
        {
            if (string.IsNullOrEmpty(left) || string.IsNullOrEmpty(right)) return false;
            return string.Equals(Path.GetFullPath(left), Path.GetFullPath(right),
                StringComparison.OrdinalIgnoreCase);
        }

        private static string FileHash(string path)
        {
            using (FileStream stream = File.OpenRead(path))
            using (SHA256 sha = SHA256.Create())
            {
                byte[] hash = sha.ComputeHash(stream);
                StringBuilder sb = new StringBuilder(hash.Length * 2);
                for (int i = 0; i < hash.Length; i++)
                {
                    sb.Append(hash[i].ToString("x2", CultureInfo.InvariantCulture));
                }
                return sb.ToString();
            }
        }
    }

    internal static class IconFactory
    {
        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        private static extern bool DestroyIcon(IntPtr handle);

        public static Icon Create(ServerState state)
        {
            Color color = StateColor(state);

            // 优先使用嵌入在 exe 里的品牌图标（tray/atlisp.ico），
            // 在右下角叠加状态圆点；加载失败时回退到内置绘制图标。
            try
            {
                using (Icon executableIcon = Icon.ExtractAssociatedIcon(Application.ExecutablePath))
                {
                    if (executableIcon != null)
                    {
                        using (Bitmap source = executableIcon.ToBitmap())
                        using (Bitmap canvas = new Bitmap(32, 32))
                        {
                            using (Graphics graphics = Graphics.FromImage(canvas))
                            {
                                graphics.Clear(Color.Transparent);
                                graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
                                graphics.SmoothingMode = SmoothingMode.AntiAlias;
                                graphics.DrawImage(source, new Rectangle(0, 0, 32, 32));
                                DrawStatusDot(graphics, color);
                            }
                            return ToIcon(canvas);
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                AppLog.Write("加载品牌图标失败，使用内置图标: " + ex.Message);
            }

            return CreateFallback(color);
        }

        private static Color StateColor(ServerState state)
        {
            switch (state)
            {
                case ServerState.Running:
                    return Color.FromArgb(34, 197, 94);
                case ServerState.Starting:
                case ServerState.Stopping:
                    return Color.FromArgb(234, 179, 8);
                case ServerState.Error:
                    return Color.FromArgb(220, 38, 38);
                default:
                    return Color.FromArgb(115, 115, 115);
            }
        }

        private static void DrawStatusDot(Graphics graphics, Color color)
        {
            using (SolidBrush border = new SolidBrush(Color.White))
            {
                graphics.FillEllipse(border, 18, 18, 14, 14);
            }
            using (SolidBrush brush = new SolidBrush(color))
            {
                graphics.FillEllipse(brush, 20, 20, 10, 10);
            }
        }

        private static Icon ToIcon(Bitmap bitmap)
        {
            IntPtr handle = bitmap.GetHicon();
            try
            {
                using (Icon temporary = Icon.FromHandle(handle))
                {
                    return (Icon)temporary.Clone();
                }
            }
            finally
            {
                DestroyIcon(handle);
            }
        }

        private static Icon CreateFallback(Color color)
        {
            using (Bitmap bitmap = new Bitmap(32, 32))
            {
                using (Graphics graphics = Graphics.FromImage(bitmap))
                {
                    graphics.SmoothingMode = SmoothingMode.AntiAlias;
                    graphics.TextRenderingHint =
                        System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
                    graphics.Clear(Color.Transparent);
                    using (SolidBrush brush = new SolidBrush(color))
                    {
                        graphics.FillEllipse(brush, 1, 1, 30, 30);
                    }
                    using (Font font = new Font("Segoe UI", 17f, FontStyle.Bold, GraphicsUnit.Pixel))
                    using (SolidBrush textBrush = new SolidBrush(Color.White))
                    using (StringFormat format = new StringFormat())
                    {
                        format.Alignment = StringAlignment.Center;
                        format.LineAlignment = StringAlignment.Center;
                        graphics.DrawString("M", font, textBrush,
                            new RectangleF(0, 0, 32, 32), format);
                    }
                }
                return ToIcon(bitmap);
            }
        }
    }

    internal sealed class OutputForm : Form
    {
        private readonly TextBox _box;
        private readonly Label _status;
        private readonly Button _closeButton;
        private readonly bool _taskMode;
        private bool _finished;

        public OutputForm(string title, string text, bool taskMode)
        {
            _taskMode = taskMode;
            _finished = !taskMode;

            Text = title;
            Width = 760;
            Height = 430;
            MinimumSize = new Size(480, 260);
            StartPosition = FormStartPosition.CenterScreen;
            ShowInTaskbar = true;
            MinimizeBox = false;
            Icon = IconFactory.Create(ServerState.Starting);

            _status = new Label();
            _status.AutoSize = false;
            _status.Height = 30;
            _status.Dock = DockStyle.Fill;
            _status.Padding = new Padding(10, 7, 10, 0);
            _status.Text = taskMode ? "正在执行，请稍候…" : "就绪";
            _status.ForeColor = Color.DimGray;

            _box = new TextBox();
            _box.Multiline = true;
            _box.ReadOnly = true;
            _box.ScrollBars = ScrollBars.Both;
            _box.WordWrap = false;
            _box.Dock = DockStyle.Fill;
            _box.Font = new Font("Consolas", 9f);
            _box.BackColor = Color.FromArgb(25, 25, 28);
            _box.ForeColor = Color.Gainsboro;
            _box.BorderStyle = BorderStyle.None;
            _box.Text = text ?? "";

            Panel buttonPanel = new Panel();
            buttonPanel.Dock = DockStyle.Fill;

            Button copyButton = new Button();
            copyButton.Text = "复制";
            copyButton.Width = 84;
            copyButton.Height = 28;
            copyButton.Anchor = AnchorStyles.Right | AnchorStyles.Top;
            copyButton.Location = new Point(Width - 210, 8);
            copyButton.Click += delegate
            {
                try { Clipboard.SetText(_box.Text); } catch { }
            };

            _closeButton = new Button();
            _closeButton.Text = taskMode ? "隐藏" : "关闭";
            _closeButton.Width = 84;
            _closeButton.Height = 28;
            _closeButton.Anchor = AnchorStyles.Right | AnchorStyles.Top;
            _closeButton.Location = new Point(Width - 118, 8);
            _closeButton.Click += delegate
            {
                if (_taskMode && !_finished) Hide();
                else Close();
            };

            buttonPanel.Controls.Add(copyButton);
            buttonPanel.Controls.Add(_closeButton);

            TableLayoutPanel layout = new TableLayoutPanel();
            layout.Dock = DockStyle.Fill;
            layout.ColumnCount = 1;
            layout.RowCount = 3;
            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 32));
            layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 44));
            layout.Controls.Add(_status, 0, 0);
            layout.Controls.Add(_box, 0, 1);
            layout.Controls.Add(buttonPanel, 0, 2);
            Controls.Add(layout);

            FormClosing += OnFormClosing;
            Shown += delegate { _box.SelectionStart = _box.TextLength; _box.ScrollToCaret(); };
        }

        private void OnFormClosing(object sender, FormClosingEventArgs e)
        {
            if (_taskMode && !_finished)
            {
                e.Cancel = true;
                Hide();
            }
        }

        public bool IsFinished
        {
            get { return _finished; }
        }

        public void Append(string text)
        {
            if (string.IsNullOrEmpty(text)) return;
            if (_box.TextLength < 2000000) _box.AppendText(text);
        }

        public void SetStatus(string text)
        {
            if (_status != null && !string.IsNullOrEmpty(text)) _status.Text = text;
        }

        public void SetFinished(bool ok, int exitCode)
        {
            _finished = true;
            _closeButton.Text = "关闭";
            if (ok)
            {
                _status.Text = "完成。";
                _status.ForeColor = Color.ForestGreen;
            }
            else
            {
                _status.Text = "失败（退出码 " + exitCode + "）。可复制日志反馈问题。";
                _status.ForeColor = Color.Firebrick;
            }
        }
    }

    internal sealed class LongTask : IDisposable
    {
        private readonly object _sync = new object();
        private readonly StringBuilder _all = new StringBuilder();
        private readonly string _logFile;
        private string _elevatedLog;
        private StreamWriter _writer;
        private Process _process;
        private int _drainPosition;
        private bool _finished;
        private int _exitCode = -1;

        public LongTask(string title, string logFile)
        {
            Title = title;
            _logFile = logFile;
            try
            {
                string directory = Path.GetDirectoryName(logFile);
                if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);
                FileStream stream = new FileStream(
                    logFile, FileMode.Append, FileAccess.Write, FileShare.ReadWrite);
                _writer = new StreamWriter(stream, new UTF8Encoding(false));
                _writer.AutoFlush = true;
            }
            catch (Exception ex)
            {
                AppLog.Write("打开任务日志失败: " + ex.Message);
            }
        }

        public string Title { get; private set; }

        public string LogFile
        {
            get { return _logFile; }
        }

        public bool Finished
        {
            get { lock (_sync) return _finished; }
        }

        public int ExitCode
        {
            get { lock (_sync) return _exitCode; }
        }

        public string Output
        {
            get { lock (_sync) return _all.ToString(); }
        }

        public void Attach(Process process)
        {
            _process = process;
            try
            {
                process.Start();
                process.BeginOutputReadLine();
                process.BeginErrorReadLine();
            }
            catch (Exception ex)
            {
                AppendLine("[error] " + ex.Message);
                lock (_sync)
                {
                    _finished = true;
                    _exitCode = -1;
                    CloseWriter();
                }
            }
        }

        public void AttachElevated(Process process, string elevatedLog)
        {
            _process = process;
            _elevatedLog = elevatedLog;
            if (process == null)
            {
                lock (_sync)
                {
                    _finished = true;
                    _exitCode = -1;
                }
            }
        }

        public void AppendLine(string line)
        {
            lock (_sync)
            {
                if (_all.Length < 4000000)
                {
                    _all.AppendLine(line);
                }
                if (_writer != null)
                {
                    try { _writer.WriteLine(line); } catch { }
                }
            }
        }

        public string Drain()
        {
            lock (_sync)
            {
                if (_drainPosition >= _all.Length) return "";
                string text = _all.ToString(_drainPosition, _all.Length - _drainPosition);
                _drainPosition = _all.Length;
                return text;
            }
        }

        public bool Poll()
        {
            lock (_sync)
            {
                if (_finished) return true;
            }

            Process process = _process;
            if (process == null) return false;

            bool exited;
            try { exited = process.HasExited; }
            catch { exited = true; }
            if (!exited) return false;

            // 有界等待：确保 DataReceived 异步回调把剩余输出刷完，同时避免 UI 线程卡死
            try { process.WaitForExit(2000); } catch { }

            int code = -1;
            try { code = process.ExitCode; } catch { }

            if (!string.IsNullOrEmpty(_elevatedLog))
            {
                try
                {
                    if (File.Exists(_elevatedLog))
                    {
                        AppendLine(File.ReadAllText(_elevatedLog, Encoding.UTF8));
                    }
                }
                catch (Exception ex)
                {
                    AppendLine("[error] 读取安装日志失败: " + ex.Message);
                }
            }

            lock (_sync)
            {
                _exitCode = code;
                _finished = true;
                CloseWriter();
            }
            return true;
        }

        private void CloseWriter()
        {
            if (_writer != null)
            {
                try { _writer.Dispose(); } catch { }
                _writer = null;
            }
        }

        public void Dispose()
        {
            lock (_sync) CloseWriter();
            if (_process != null)
            {
                try { _process.Dispose(); } catch { }
                _process = null;
            }
        }
    }

    /// <summary>
    /// 后台线程解压 portable Node.js，避免 30MB 的解压阻塞 UI 消息循环。
    /// </summary>
    internal sealed class PortableInstallJob
    {
        private readonly string _zipPath;
        private readonly string _destDir;

        public volatile bool Finished;
        public volatile bool Success;
        public volatile string Error;
        public volatile string NodePath;

        public string ZipPath
        {
            get { return _zipPath; }
        }

        public PortableInstallJob(string zipPath, string destDir)
        {
            _zipPath = zipPath;
            _destDir = destDir;
        }

        public void Start()
        {
            ThreadPool.QueueUserWorkItem(delegate
            {
                try
                {
                    NodePath = ZipInstaller.ExtractNodeZip(_zipPath, _destDir);
                    Success = true;
                }
                catch (Exception ex)
                {
                    Error = ex.Message;
                    Success = false;
                }
                Finished = true;
            });
        }
    }

    internal sealed class DownloadJob : IDisposable
    {
        private readonly object _sync = new object();
        private readonly string _url;
        private readonly string _filePath;
        private WebClient _client;
        private long _received;
        private long _total;
        private bool _finished;
        private bool _success;
        private string _error;

        public DownloadJob(string url, string filePath)
        {
            _url = url;
            _filePath = filePath;
        }

        public string Url
        {
            get { return _url; }
        }

        public string FilePath
        {
            get { return _filePath; }
        }

        public long Received
        {
            get { lock (_sync) return _received; }
        }

        public long Total
        {
            get { lock (_sync) return _total; }
        }

        public bool Finished
        {
            get { lock (_sync) return _finished; }
        }

        public bool Success
        {
            get { lock (_sync) return _success; }
        }

        public string Error
        {
            get { lock (_sync) return _error; }
        }

        public void Start()
        {
            try
            {
                string directory = Path.GetDirectoryName(_filePath);
                if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);

                if (File.Exists(_filePath))
                {
                    File.Delete(_filePath);
                }

                _client = new WebClient();
                _client.Headers.Add("User-Agent", "atlisp-tray/" + Program.AppVersion);
                _client.DownloadProgressChanged += OnProgress;
                _client.DownloadFileCompleted += OnCompleted;
                _client.DownloadFileAsync(new Uri(_url), _filePath);
            }
            catch (Exception ex)
            {
                lock (_sync)
                {
                    _finished = true;
                    _success = false;
                    _error = ex.Message;
                }
            }
        }

        private void OnProgress(object sender, DownloadProgressChangedEventArgs e)
        {
            lock (_sync)
            {
                _received = e.BytesReceived;
                _total = e.TotalBytesToReceive;
            }
        }

        private void OnCompleted(object sender, AsyncCompletedEventArgs e)
        {
            lock (_sync)
            {
                _finished = true;

                if (e.Cancelled)
                {
                    _success = false;
                    _error = "下载已取消";
                    return;
                }
                if (e.Error != null)
                {
                    _success = false;
                    _error = e.Error.Message;
                    return;
                }

                try
                {
                    FileInfo file = new FileInfo(_filePath);
                    if (!file.Exists || file.Length <= 0)
                    {
                        _success = false;
                        _error = "下载文件为空。";
                        return;
                    }
                    if (_total > 0 && file.Length != _total)
                    {
                        _success = false;
                        _error = "下载不完整（" + file.Length + " / " + _total + " 字节）。";
                        return;
                    }
                    _success = true;
                }
                catch (Exception ex)
                {
                    _success = false;
                    _error = ex.Message;
                }
            }
        }

        public void Dispose()
        {
            if (_client != null)
            {
                try { _client.Dispose(); } catch { }
                _client = null;
            }
        }
    }

    internal sealed class TrayApplication : ApplicationContext
    {
        private const string AgentChatUrl = "https://atlisp.cn/agent/chat";

        private readonly bool _silent;
        private readonly TrayConfig _config;
        private readonly NotifyIcon _tray;
        private readonly ContextMenuStrip _menu;
        private readonly System.Windows.Forms.Timer _uiTimer;
        private readonly HealthMonitor _health;
        private readonly ServerManager _server;

        private readonly ToolStripMenuItem _headerItem;
        private readonly ToolStripMenuItem _stateItem;
        private readonly ToolStripMenuItem _startItem;
        private readonly ToolStripMenuItem _stopItem;
        private readonly ToolStripMenuItem _restartItem;
        private readonly ToolStripMenuItem _webMenu;
        private readonly ToolStripMenuItem _logsMenu;
        private readonly ToolStripMenuItem _updateMenu;
        private readonly ToolStripMenuItem _settingsMenu;
        private readonly ToolStripMenuItem _panelItem;
        private readonly ToolStripMenuItem _docsItem;
        private readonly ToolStripMenuItem _playgroundItem;
        private readonly ToolStripMenuItem _logItem;
        private readonly ToolStripMenuItem _logDirItem;
        private readonly ToolStripMenuItem _checkItem;
        private readonly ToolStripMenuItem _upgradeItem;
        private readonly ToolStripMenuItem _installItem;
        private readonly ToolStripMenuItem _nodeItem;
        private readonly ToolStripMenuItem _trayAutoItem;
        private readonly ToolStripMenuItem _serverAutoItem;
        private readonly ToolStripMenuItem _mirrorItem;
        private readonly ToolStripMenuItem _diagItem;
        private readonly ToolStripMenuItem _autoInstallItem;
        private readonly ToolStripMenuItem _autoUpgradeItem;

        private Icon _currentIcon;
        private ServerState _lastState = ServerState.Stopped;
        private bool _firstTick = true;
        private bool _suppressNotifications;
        private bool _startupUpdateChecked;
        private DateTime _createdAt = DateTime.UtcNow;
        private DateTime _nextUpdateCheckAt = DateTime.MinValue;
        private readonly bool _startServerOnLaunch;
        private bool _restartForSelfUpdate;
        private string _latestVersion;
        private string _lastNotifiedError;
        private LongTask _task;
        private OutputForm _taskWindow;
        private string _taskAction;
        private bool _restartAfterTask;
        private bool _taskElevated;
        private bool _showTaskWindow;
        private int _activePort;

        private DownloadJob _downloadJob;
        private string _downloadVersion;
        private string _downloadArch;
        private string _downloadUrl;
        private string _nodeMsiPath;
        private string _nodeMsiLog;
        private bool _nodeNeedsReboot;
        private bool _restartAfterNodeInstall;

        // ---- 自动补齐运行环境（零人工干预）----
        private const int AutoInstallMaxFailures = 3;
        private bool _autoInstallDone;
        private bool _autoStartAttempted;
        private bool _portableNodeAttempted;
        private bool _msiFallbackTried;
        private int _autoInstallFailures;
        private DateTime _autoInstallRetryAt = DateTime.MinValue;
        private string _downloadKind;
        private bool _bootstrapMode;
        private PortableInstallJob _portableJob;

        public TrayApplication(bool silent, bool startServerOnLaunch)
        {
            _silent = silent;
            _startServerOnLaunch = startServerOnLaunch;
            _config = TrayConfig.Load();
            _activePort = _config.Port;
            LoadBootstrapState();
            ServerLocator.Resolve(_config, true);
            _health = new HealthMonitor(_config.Port, _config.HealthyPollSeconds * 1000);
            _health.CheckNow();
            _health.Start();
            _server = new ServerManager(_config);

            _menu = new ContextMenuStrip();
            _menu.ShowImageMargin = false;
            _menu.ShowCheckMargin = false;
            _menu.Opening += OnMenuOpening;

            _headerItem = new ToolStripMenuItem("@lisp MCP Server");
            _headerItem.Enabled = false;
            _headerItem.Font = new Font(_menu.Font, FontStyle.Bold);

            _stateItem = new ToolStripMenuItem("状态：正在检测…");
            _stateItem.Enabled = false;

            _startItem = new ToolStripMenuItem("启动服务");
            _startItem.Click += delegate { StartServer(); };

            _stopItem = new ToolStripMenuItem("停止服务");
            _stopItem.Click += delegate { StopServer(); };

            _restartItem = new ToolStripMenuItem("重启服务");
            _restartItem.Click += delegate { RestartServer(); };

            _panelItem = new ToolStripMenuItem("打开调试面板");
            _panelItem.Click += delegate { OpenUrl("http://127.0.0.1:" + _config.Port + "/debug"); };

            _docsItem = new ToolStripMenuItem("打开 API 文档");
            _docsItem.Click += delegate { OpenUrl("http://127.0.0.1:" + _config.Port + "/api/docs"); };

            _playgroundItem = new ToolStripMenuItem("打开 Playground");
            _playgroundItem.Click += delegate { OpenUrl("http://127.0.0.1:" + _config.Port + "/playground"); };

            _logItem = new ToolStripMenuItem("查看服务器日志");
            _logItem.Click += delegate { OpenServerLog(); };

            _logDirItem = new ToolStripMenuItem("打开日志目录");
            _logDirItem.Click += delegate { OpenPath(Paths.LogDir); };

            _checkItem = new ToolStripMenuItem("检查更新");
            _checkItem.Click += delegate { CheckUpdate(false); };

            _upgradeItem = new ToolStripMenuItem("升级到最新版");
            _upgradeItem.Click += delegate { UpgradeServer(); };

            _installItem = new ToolStripMenuItem("下载并安装 @lisp MCP Server");
            _installItem.Click += delegate { InstallServer(); };

            _nodeItem = new ToolStripMenuItem("下载并安装 Node.js…");
            _nodeItem.Click += delegate { InstallNodeFromMirror(); };

            _trayAutoItem = new ToolStripMenuItem("随 Windows 启动托盘");
            _trayAutoItem.Click += delegate { ToggleTrayAutostart(); };

            _serverAutoItem = new ToolStripMenuItem("托盘启动时自动启动服务");
            _serverAutoItem.Click += delegate { ToggleServerAutostart(); };

            _mirrorItem = new ToolStripMenuItem("使用 npmmirror 镜像下载");
            _mirrorItem.Click += delegate { ToggleMirror(); };

            _autoInstallItem = new ToolStripMenuItem("启动时自动补齐运行环境");
            _autoInstallItem.Click += delegate { ToggleAutoInstall(); };

            _autoUpgradeItem = new ToolStripMenuItem("定时自动检查并升级 @lisp/mcp");
            _autoUpgradeItem.Click += delegate { ToggleAutoUpgrade(); };

            _diagItem = new ToolStripMenuItem("环境诊断…");
            _diagItem.Click += delegate { ShowDiagnostics(); };

            ToolStripMenuItem reloadItem = new ToolStripMenuItem("重新加载配置");
            reloadItem.Click += delegate { ReloadConfig(); };

            ToolStripMenuItem configItem = new ToolStripMenuItem("打开配置文件");
            configItem.Click += delegate { OpenPath(Paths.TrayConfigPath); };

            ToolStripMenuItem aboutItem = new ToolStripMenuItem("关于");
            aboutItem.Click += delegate { ShowAbout(); };

            ToolStripMenuItem exitItem = new ToolStripMenuItem("退出托盘");
            exitItem.Click += delegate { ExitApplication(); };

            ToolStripMenuItem agentChatItem = new ToolStripMenuItem("Agent Chat（atlisp.cn）");
            agentChatItem.Click += delegate { OpenUrl(AgentChatUrl); };

            _webMenu = CreateSubmenu("打开网页");
            _webMenu.DropDownItems.Add(agentChatItem);
            _webMenu.DropDownItems.Add(_panelItem);
            _webMenu.DropDownItems.Add(_docsItem);
            _webMenu.DropDownItems.Add(_playgroundItem);

            _logsMenu = CreateSubmenu("日志与诊断");
            _logsMenu.DropDownItems.Add(_logItem);
            _logsMenu.DropDownItems.Add(_logDirItem);
            _logsMenu.DropDownItems.Add(new ToolStripSeparator());
            _logsMenu.DropDownItems.Add(_diagItem);

            _updateMenu = CreateSubmenu("更新与安装");
            _updateMenu.DropDownItems.Add(_checkItem);
            _updateMenu.DropDownItems.Add(_upgradeItem);
            _updateMenu.DropDownItems.Add(new ToolStripSeparator());
            _updateMenu.DropDownItems.Add(_installItem);
            _updateMenu.DropDownItems.Add(_nodeItem);

            _settingsMenu = CreateSubmenu("设置");
            _settingsMenu.DropDownItems.Add(_trayAutoItem);
            _settingsMenu.DropDownItems.Add(_serverAutoItem);
            _settingsMenu.DropDownItems.Add(_mirrorItem);
            _settingsMenu.DropDownItems.Add(_autoInstallItem);
            _settingsMenu.DropDownItems.Add(_autoUpgradeItem);
            _settingsMenu.DropDownItems.Add(new ToolStripSeparator());
            _settingsMenu.DropDownItems.Add(reloadItem);
            _settingsMenu.DropDownItems.Add(configItem);
            _settingsMenu.DropDownItems.Add(new ToolStripSeparator());
            _settingsMenu.DropDownItems.Add(aboutItem);

            _menu.Items.Add(_headerItem);
            _menu.Items.Add(_stateItem);
            _menu.Items.Add(new ToolStripSeparator());
            _menu.Items.Add(_startItem);
            _menu.Items.Add(_stopItem);
            _menu.Items.Add(_restartItem);
            _menu.Items.Add(new ToolStripSeparator());
            _menu.Items.Add(_webMenu);
            _menu.Items.Add(_logsMenu);
            _menu.Items.Add(_updateMenu);
            _menu.Items.Add(_settingsMenu);
            _menu.Items.Add(new ToolStripSeparator());
            _menu.Items.Add(exitItem);

            _currentIcon = IconFactory.Create(ServerState.Stopped);
            _tray = new NotifyIcon();
            _tray.Icon = _currentIcon;
            _tray.Text = "@lisp MCP Server";
            _tray.ContextMenuStrip = _menu;
            _tray.Visible = true;
            _tray.DoubleClick += delegate { OpenUrl(AgentChatUrl); };

            _uiTimer = new System.Windows.Forms.Timer();
            _uiTimer.Interval = 1000;
            _uiTimer.Tick += OnUiTimer;
            _uiTimer.Start();

            _server.Refresh(_health.Snapshot);
            _lastState = _server.State;
            UpdateUi();
            ApplyIcon(_server.State);
            // 初始状态已经反映到 UI，后续第一次真实状态变化应当正常提醒
            _firstTick = false;

            // 默认随 Windows 启动（只发生一次，用户关闭后不再自动打开）
            EnsureDefaultAutostart();

            if (_config.AutoStartServer || _startServerOnLaunch)
            {
                // 开启自动补齐时由 AutoBootstrap 统一编排（缺依赖会先装再启动）；
                // 关闭时保持原行为：缺依赖就报启动失败。
                ServerInfo bootInfo = ServerLocator.Resolve(_config, false);
                if (!_config.AutoInstall ||
                    (!string.IsNullOrEmpty(bootInfo.NodePath) && bootInfo.IsInstalled))
                {
                    EnsureServerStartedOnLaunch();
                }
            }

            if (!_silent)
            {
                Balloon("@lisp MCP 托盘已启动",
                    "双击图标打开 https://atlisp.cn/agent/chat，右键查看更多操作。",
                    ToolTipIcon.Info);
            }
        }

        private static ToolStripMenuItem CreateSubmenu(string text)
        {
            ToolStripMenuItem item = new ToolStripMenuItem(text);
            ToolStripDropDownMenu dropDown = item.DropDown as ToolStripDropDownMenu;
            if (dropDown != null)
            {
                dropDown.ShowImageMargin = false;
                dropDown.ShowCheckMargin = true;
            }
            return item;
        }

        private void EnsureServerStartedOnLaunch()
        {
            if (_autoStartAttempted) return;
            _autoStartAttempted = true;

            HealthSnapshot snapshot = _health.Snapshot;
            if (snapshot != null && snapshot.Ok) return;
            if (ServiceHelper.IsRunning()) return;

            try
            {
                _suppressNotifications = true;
                _server.Start();
                _suppressNotifications = false;
                AppLog.Write("auto-start server on tray launch");
            }
            catch (Exception ex)
            {
                _suppressNotifications = false;
                AppLog.Write("自动启动服务失败: " + ex.Message);
                // 首次启动缺依赖时给出可操作提示，而不是反复弹窗
                if (!_silent)
                {
                    Balloon("服务未启动", ex.Message, ToolTipIcon.Warning);
                }
            }
        }

        /// <summary>
        /// 首次启动自动把托盘加入 Windows 开机自启（HKCU\...\Run）。
        /// 用标记文件保证只发生一次：用户之后手动关闭，再启动不会被重新打开。
        /// </summary>
        private void EnsureDefaultAutostart()
        {
            try
            {
                if (File.Exists(Paths.AutostartDefaultPath)) return;

                bool added = false;
                if (!AutostartHelper.IsEnabled())
                {
                    AutostartHelper.SetEnabled(true);
                    added = true;
                }

                Directory.CreateDirectory(Paths.DataDir);
                File.WriteAllText(Paths.AutostartDefaultPath,
                    DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"), new UTF8Encoding(false));

                AppLog.Write(added
                    ? "首次启动：已自动加入 Windows 开机自启"
                    : "首次启动：开机自启已存在，保持不变");
                if (added && !_silent)
                {
                    Balloon("已加入开机自启",
                        "托盘将随 Windows 自动启动。\r\n如不需要，可在右键菜单「随 Windows 启动托盘」中关闭。",
                        ToolTipIcon.Info);
                }
            }
            catch (Exception ex)
            {
                AppLog.Write("设置默认开机自启失败: " + ex.Message);
            }
        }

        /// <summary>
        /// 启动后按环境自动补齐依赖，全程不需要人工确认：
        ///   1) 没有 Node.js → 从 npmmirror 下载 zip 解压到用户目录（免 UAC）
        ///   2) 没有 @lisp/mcp → npm install -g（用户级前缀，同样免 UAC）
        ///   3) 都齐了 → 按 AutoStartServer 启动服务
        /// 安装动作按指数退避重试并限次，但环境就绪的检测一直继续，
        /// 这样用户手动装好依赖后托盘仍能自动启动服务。
        /// </summary>
        private void AutoBootstrap()
        {
            if (!_config.AutoInstall || _autoInstallDone) return;
            if (DateTime.UtcNow < _autoInstallRetryAt) return;
            if (TaskBusy()) return;

            try
            {
                // 用缓存版：force=true 每次都会拉起 npm root -g，1s 一次的定时器扛不住
                ServerInfo info = ServerLocator.Resolve(_config, false);

                if (!string.IsNullOrEmpty(info.NodePath) && info.IsInstalled)
                {
                    _autoInstallDone = true;
                    _bootstrapMode = false;
                    if (_autoInstallFailures > 0)
                    {
                        _autoInstallFailures = 0;
                        SaveBootstrapState();
                    }
                    AppLog.Write("auto-install: 运行环境就绪 node=" + info.NodePath +
                        " version=" + info.VersionText);

                    if (_config.AutoStartServer || _startServerOnLaunch) EnsureServerStartedOnLaunch();
                    return;
                }

                if (_autoInstallFailures >= AutoInstallMaxFailures) return;

                if (string.IsNullOrEmpty(info.NodePath))
                {
                    StartPortableNode();
                    return;
                }

                _bootstrapMode = true;
                AppLog.Write("auto-install: 正在安装 @lisp/mcp");
                InstallServer();
            }
            catch (Exception ex)
            {
                AppLog.Write("auto-install 异常: " + ex);
                ScheduleAutoInstallRetry();
            }
        }

        private void ScheduleAutoInstallRetry()
        {
            _autoInstallFailures++;
            int minutes = _autoInstallFailures <= 1 ? 1 :
                (_autoInstallFailures <= 2 ? 5 : 30);
            _autoInstallRetryAt = DateTime.UtcNow.AddMinutes(minutes);
            AppLog.Write("auto-install 第 " + _autoInstallFailures +
                " 次失败，" + minutes + " 分钟后重试");
            SaveBootstrapState();
        }

        /// <summary>
        /// 退避时间写入磁盘：托盘每次开机自启都会重新开始，
        /// 不落盘会导致网络故障时反复重下 35MB。
        /// </summary>
        private void SaveBootstrapState()
        {
            try
            {
                Directory.CreateDirectory(Paths.DataDir);
                File.WriteAllText(Paths.BootstrapStatePath,
                    _autoInstallRetryAt.ToString("o") + Environment.NewLine +
                    _autoInstallFailures.ToString(CultureInfo.InvariantCulture),
                    new UTF8Encoding(false));
            }
            catch
            {
                // 状态文件写不了不影响主流程
            }
        }

        private void LoadBootstrapState()
        {
            try
            {
                if (!File.Exists(Paths.BootstrapStatePath)) return;
                string[] lines = File.ReadAllLines(Paths.BootstrapStatePath);
                if (lines.Length > 0)
                {
                    DateTime retryAt;
                    if (DateTime.TryParse(lines[0], CultureInfo.InvariantCulture,
                        DateTimeStyles.RoundtripKind, out retryAt))
                    {
                        _autoInstallRetryAt = retryAt;
                    }
                }
                if (lines.Length > 1)
                {
                    int failures;
                    if (int.TryParse(lines[1], NumberStyles.Integer,
                        CultureInfo.InvariantCulture, out failures))
                    {
                        _autoInstallFailures = failures;
                    }
                }
            }
            catch
            {
                _autoInstallRetryAt = DateTime.MinValue;
            }
        }

        /// <summary>下载并解压免管理员的 portable Node.js。</summary>
        private void StartPortableNode()
        {
            if (_portableNodeAttempted) return;
            _portableNodeAttempted = true;
            _bootstrapMode = true;

            string version = _config.NodeVersion;
            string arch = DetectNodeArch();
            string url = BuildNodeZipUrl(version, arch);
            string filePath = Path.Combine(Paths.DownloadDir,
                "node-v" + version + "-win-" + arch + ".zip");

            _downloadKind = "portable";
            _downloadVersion = version;
            _downloadArch = arch;
            _downloadUrl = url;
            _portableJob = null;
            _downloadJob = new DownloadJob(url, filePath);

            if (_taskWindow != null && !_taskWindow.IsDisposed)
            {
                try { _taskWindow.Close(); } catch { }
            }
            OutputForm form = new OutputForm("自动安装 Node.js v" + version, "", true);
            form.FormClosed += delegate { if (_taskWindow == form) _taskWindow = null; };
            _taskWindow = form;
            form.Show();
            form.Append("未检测到 Node.js，正在自动下载（无需管理员权限）\r\n");
            form.Append("下载地址：" + url + "\r\n");
            form.Append("安装目录：" + Paths.PortableNodeDir + "\r\n\r\n");

            Balloon("自动安装中", "未检测到 Node.js，正在下载 v" + version + "…",
                ToolTipIcon.Info);

            AppLog.Write("auto-install: 下载 portable Node.js " + url);
            _downloadJob.Start();
            if (_downloadJob.Finished) PollDownload();
        }

        private string BuildNodeZipUrl(string version, string arch)
        {
            string mirror = _config.NodeMirror;
            if (string.IsNullOrEmpty(mirror))
            {
                mirror = "https://npmmirror.com/mirrors/node";
            }
            return mirror.TrimEnd('/') + "/v" + version +
                "/node-v" + version + "-win-" + arch + ".zip";
        }

        private void PollPortableInstall()
        {
            PortableInstallJob job = _portableJob;
            if (job == null || !job.Finished) return;
            _portableJob = null;

            if (_taskWindow != null && !_taskWindow.IsDisposed)
            {
                if (job.Success)
                {
                    _taskWindow.Append("\r\nNode.js 解压完成：" + job.NodePath + "\r\n");
                    _taskWindow.SetStatus("Node.js 就绪，正在继续安装 @lisp/mcp…");
                }
                else
                {
                    _taskWindow.Append("\r\nNode.js 解压失败：" + job.Error + "\r\n");
                    _taskWindow.SetFinished(false, -1);
                }
            }

            if (!job.Success)
            {
                AppLog.Write("auto-install: portable Node.js 解压失败 " + job.Error);
                ScheduleAutoInstallRetry();
                Balloon("自动安装 Node.js 失败", job.Error, ToolTipIcon.Warning);
                return;
            }

            AppLog.Write("auto-install: portable Node.js 就绪 " + job.NodePath);
            // 解压完就删掉 35MB 的 zip
            try { File.Delete(job.ZipPath); } catch { }
            ServerLocator.Invalidate();
        }

        private void OnUiTimer(object sender, EventArgs e)
        {
            try
            {
                UpdateUi();
                PollDownload();
                PollPortableInstall();
                PollTask();

                // 启动后稍等片刻再补齐环境，避免和首轮 UI/健康检测抢线程
                if (_config.AutoInstall && !_autoInstallDone &&
                    (DateTime.UtcNow - _createdAt).TotalSeconds > 3)
                {
                    AutoBootstrap();
                }

                if (_config.CheckUpdateOnStart && !_config.AutoUpgrade && !_startupUpdateChecked &&
                    (DateTime.UtcNow - _createdAt).TotalSeconds > 20)
                {
                    _startupUpdateChecked = true;
                    CheckUpdate(true);
                }

                MaybeAutoUpgrade();
            }
            catch (Exception ex)
            {
                AppLog.Write("UI 定时器异常: " + ex);
            }
        }

        private void OnMenuOpening(object sender, CancelEventArgs e)
        {
            UpdateUi();
        }

        private void UpdateUi()
        {
            HealthSnapshot snapshot = _health.Snapshot;
            ServerState state = _server.Refresh(snapshot);

            if (state != _lastState)
            {
                ApplyIcon(state);
                OnStateChanged(_lastState, state);
                _lastState = state;
            }

            ServerInfo info = ServerLocator.Resolve(_config, false);

            _headerItem.Text = "@lisp MCP Server  " +
                (string.IsNullOrEmpty(info.Version) ? "(未安装)" : "v" + info.Version);

            string stateText = "状态：";
            switch (state)
            {
                case ServerState.Running:
                    stateText += "运行中";
                    break;
                case ServerState.Starting:
                    stateText += "启动中 / 等待响应";
                    break;
                case ServerState.Stopping:
                    stateText += "正在停止…";
                    break;
                case ServerState.Error:
                    stateText += "异常";
                    break;
                default:
                    stateText += "已停止";
                    break;
            }
            stateText += " · 端口 " + _config.Port;
            if (snapshot != null && snapshot.Ok)
            {
                stateText += " · " + snapshot.CadSummary();
            }
            _stateItem.Text = stateText;

            bool running = state == ServerState.Running || state == ServerState.Starting;
            bool busy = _task != null && !_task.Finished;
            bool updating = busy || _downloadJob != null;

            _startItem.Enabled = !running && !busy;
            _stopItem.Enabled = running && !busy;
            _restartItem.Enabled = running && !busy;
            _panelItem.Enabled = state == ServerState.Running;
            _docsItem.Enabled = state == ServerState.Running;
            _playgroundItem.Enabled = state == ServerState.Running;

            _checkItem.Enabled = !updating;
            _upgradeItem.Enabled = !updating;
            _installItem.Enabled = !updating;
            _installItem.Text = info.IsInstalled
                ? "重新安装 / 修复安装"
                : "下载并安装 @lisp MCP Server";
            _nodeItem.Enabled = !updating;
            _nodeItem.Text = "下载并安装 Node.js v" + _config.NodeVersion + "（npmmirror）";

            bool updateAvailable = !string.IsNullOrEmpty(_latestVersion) &&
                VersionUtil.IsNewer(_latestVersion, info.Version);
            if (updateAvailable)
            {
                _upgradeItem.Text = "升级到 v" + _latestVersion +
                    "（当前 " + info.VersionText + "）";
                _updateMenu.Text = "更新与安装（有新版 v" + _latestVersion + "）";
            }
            else
            {
                _upgradeItem.Text = "升级到最新版";
                _updateMenu.Text = "更新与安装";
            }

            _trayAutoItem.Checked = AutostartHelper.IsEnabled();
            _serverAutoItem.Checked = _config.AutoStartServer;
            _mirrorItem.Checked = !string.IsNullOrEmpty(_config.NpmRegistry);
            _autoInstallItem.Checked = _config.AutoInstall;
            _autoUpgradeItem.Checked = _config.AutoUpgrade;
            _autoUpgradeItem.Text = "定时自动检查并升级 @lisp/mcp（每 " +
                (_config.AutoUpgradeHours > 0 ? _config.AutoUpgradeHours : 1) + " 小时）";

            _tray.Text = Truncate("@lisp MCP · " + StateText(state) + " · 端口 " + _config.Port, 63);
        }

        private static string StateText(ServerState state)
        {
            switch (state)
            {
                case ServerState.Running: return "运行中";
                case ServerState.Starting: return "启动中";
                case ServerState.Stopping: return "停止中";
                case ServerState.Error: return "异常";
                default: return "已停止";
            }
        }

        private static string Truncate(string value, int maxLength)
        {
            if (value == null) return "";
            if (value.Length <= maxLength) return value;
            return value.Substring(0, maxLength);
        }

        private void ApplyIcon(ServerState state)
        {
            Icon icon = IconFactory.Create(state);
            Icon old = _currentIcon;
            _currentIcon = icon;
            _tray.Icon = icon;
            if (old != null)
            {
                try { old.Dispose(); } catch { }
            }
        }

        private void OnStateChanged(ServerState oldState, ServerState newState)
        {
            if (_firstTick)
            {
                _firstTick = false;
                return;
            }
            if (_suppressNotifications)
            {
                // 用户主动停止时不打扰；状态落定后恢复通知
                if (newState == ServerState.Stopped) _suppressNotifications = false;
                return;
            }

            if (newState == ServerState.Error && !string.IsNullOrEmpty(_server.LastError))
            {
                if (_lastNotifiedError != _server.LastError)
                {
                    _lastNotifiedError = _server.LastError;
                    Balloon("服务异常退出", _server.LastError, ToolTipIcon.Error);
                }
                return;
            }

            if (newState == ServerState.Running)
            {
                _lastNotifiedError = null;
            }

            if (newState == ServerState.Running &&
                (oldState == ServerState.Starting || oldState == ServerState.Stopped))
            {
                HealthSnapshot snapshot = _health.Snapshot;
                Balloon("服务已启动",
                    "端口 " + _config.Port + "，" +
                    (snapshot != null ? snapshot.CadSummary() : "正在获取 CAD 状态"),
                    ToolTipIcon.Info);
                return;
            }

            if (newState == ServerState.Stopped && oldState == ServerState.Running)
            {
                Balloon("服务已停止", "端口 " + _config.Port + " 已释放。", ToolTipIcon.Warning);
            }
        }

        private void StartServer()
        {
            try
            {
                // Windows 服务模式优先：服务已安装时由 SCM 启动，避免启动第二个实例
                bool serviceExists;
                bool serviceRunning;
                ServiceHelper.Query(out serviceExists, out serviceRunning, true);
                if (serviceExists)
                {
                    _suppressNotifications = false;
                    _server.Start();
                    UpdateUi();
                    return;
                }

                ServerInfo info = ServerLocator.Resolve(_config, true);
                if (string.IsNullOrEmpty(info.NodePath))
                {
                    PromptInstallNode();
                    return;
                }
                if (!info.IsInstalled)
                {
                    PromptInstallServer();
                    return;
                }

                _suppressNotifications = false;
                _server.Start();
                UpdateUi();
            }
            catch (Exception ex)
            {
                ShowError("启动服务失败", ex.Message);
            }
        }

        private void StopServer()
        {
            _suppressNotifications = true;
            _server.StopAsync();
        }

        private void RestartServer()
        {
            _suppressNotifications = false;
            _server.RestartAsync();
        }

        private void PromptInstallNode()
        {
            if (TaskBusy())
            {
                Balloon("请稍候", "Node.js 下载/安装或其他更新任务正在进行。", ToolTipIcon.Info);
                return;
            }

            string arch = DetectNodeArch();
            DialogResult result = MessageBox.Show(
                "未检测到 Node.js。\r\n\r\n" +
                "是否从 npmmirror 下载并安装 Node.js v" + _config.NodeVersion +
                "（" + arch + "）？\r\n" +
                "安装包约 30 MB，安装时需要管理员授权。",
                "@lisp MCP 托盘",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Question);
            if (result != DialogResult.Yes) return;

            InstallNodeFromMirror();
        }

        private static string DetectNodeArch()
        {
            string arch = (Environment.GetEnvironmentVariable("PROCESSOR_ARCHITECTURE") ?? "")
                .ToUpperInvariant();
            string arch64 = (Environment.GetEnvironmentVariable("PROCESSOR_ARCHITEW6432") ?? "")
                .ToUpperInvariant();
            if (arch.IndexOf("ARM64", StringComparison.Ordinal) >= 0 ||
                arch64.IndexOf("ARM64", StringComparison.Ordinal) >= 0)
            {
                return "arm64";
            }
            if (Environment.Is64BitOperatingSystem) return "x64";
            return "x86";
        }

        private string BuildNodeMsiUrl(string version, string arch)
        {
            string mirror = _config.NodeMirror;
            if (string.IsNullOrEmpty(mirror))
            {
                mirror = "https://npmmirror.com/mirrors/node";
            }
            // 注意：MSI 的命名没有 "win-"（node-vX.Y.Z-x64.msi），zip 才有（node-vX.Y.Z-win-x64.zip）
            return mirror.TrimEnd('/') + "/v" + version + "/node-v" + version + "-" + arch + ".msi";
        }

        private void InstallNodeFromMirror()
        {
            if (TaskBusy())
            {
                Balloon("请稍候", "已有下载/安装任务正在进行。", ToolTipIcon.Info);
                return;
            }

            string arch = DetectNodeArch();
            ServerInfo existing = ServerLocator.Resolve(_config, true);
            if (!string.IsNullOrEmpty(existing.NodePath))
            {
                DialogResult confirm = MessageBox.Show(
                    "检测到已有 Node.js：\r\n" + existing.NodePath + "\r\n\r\n" +
                    "仍要下载并安装 v" + _config.NodeVersion + "（" + arch + "）吗？\r\n" +
                    "安装会覆盖现有的 Node.js。",
                    "@lisp MCP 托盘",
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Warning);
                if (confirm != DialogResult.Yes) return;
            }

            string version = _config.NodeVersion;
            string url = BuildNodeMsiUrl(version, arch);
            string directory = Paths.DownloadDir;
            _restartAfterNodeInstall = false;
            _nodeNeedsReboot = false;
            string fileName = "node-v" + version + "-" + arch + ".msi";
            string filePath = Path.Combine(directory, fileName);

            _downloadVersion = version;
            _downloadArch = arch;
            _downloadUrl = url;
            _nodeMsiPath = filePath;
            _nodeMsiLog = null;
            _downloadJob = new DownloadJob(url, filePath);

            if (_taskWindow != null && !_taskWindow.IsDisposed)
            {
                try { _taskWindow.Close(); } catch { }
            }
            OutputForm form = new OutputForm("下载 Node.js v" + version, "", true);
            form.FormClosed += delegate { if (_taskWindow == form) _taskWindow = null; };
            _taskWindow = form;
            form.Show();
            form.Append("下载地址：" + url + "\r\n");
            form.Append("保存到：" + filePath + "\r\n\r\n");

            AppLog.Write("download Node.js " + version + " " + arch + " from " + url);
            _downloadJob.Start();
            if (_downloadJob.Finished) PollDownload();
        }

        private void PollDownload()
        {
            DownloadJob job = _downloadJob;
            if (job == null) return;

            long received = job.Received;
            long total = job.Total;
            if (_taskWindow != null && !_taskWindow.IsDisposed)
            {
                string status = "正在下载 Node.js v" + _downloadVersion +
                    "（" + _downloadArch + "）：" + FormatBytes(received);
                if (total > 0)
                {
                    status += " / " + FormatBytes(total) + "  " +
                        (received * 100 / total).ToString(CultureInfo.InvariantCulture) + "%";
                }
                _taskWindow.SetStatus(status);
            }

            if (!job.Finished) return;

            _downloadJob = null;
            bool success = job.Success;
            string error = job.Error;
            string path = job.FilePath;
            long expected = job.Total;
            job.Dispose();

            if (!success)
            {
                if (_taskWindow != null && !_taskWindow.IsDisposed)
                {
                    _taskWindow.Append("\r\n下载失败：" + error + "\r\n");
                    _taskWindow.SetFinished(false, -1);
                }
                AppLog.Write("Node.js download failed: " + error + " url=" + _downloadUrl);
                OnNodeDownloadFailed(error);
                return;
            }

            long actual = 0;
            try { actual = new FileInfo(path).Length; } catch { }
            if (expected > 0 && actual != expected)
            {
                string sizeError = "下载文件大小不一致（" + actual + " / " + expected + " 字节）。";
                if (_taskWindow != null && !_taskWindow.IsDisposed)
                {
                    _taskWindow.Append("\r\n" + sizeError + "\r\n");
                    _taskWindow.SetFinished(false, -1);
                }
                OnNodeDownloadFailed(sizeError);
                return;
            }

            if (_downloadKind == "portable")
            {
                AppLog.Write("portable Node.js downloaded: " + path);
                _downloadKind = null;
                _portableJob = new PortableInstallJob(path, Paths.PortableNodeDir);
                _portableJob.Start();
                return;
            }

            if (_taskWindow != null && !_taskWindow.IsDisposed)
            {
                _taskWindow.Append("\r\n下载完成：" + path +
                    "（" + FormatBytes(actual) + "）\r\n");
                _taskWindow.SetStatus("正在安装 Node.js，请在 UAC 窗口中选择“是”…");
            }
            AppLog.Write("Node.js downloaded: " + path);
            StartNodeMsiInstall(path);
        }

        private void OnNodeDownloadFailed(string error)
        {
            // 自动补齐流程：portable zip 失败后降级到需要 UAC 的安装方式（MSI → winget），
            // UAC 本身需要用户点一次，这里不再额外询问。只降级一次，避免循环。
            if (_bootstrapMode)
            {
                _downloadKind = null;
                if (!_msiFallbackTried)
                {
                    _msiFallbackTried = true;
                    AppLog.Write("auto-install: portable 路线失败，改用 MSI 安装 " + error);
                    InstallNodeFromMirror();
                    return;
                }
                ScheduleAutoInstallRetry();
                Balloon("自动安装 Node.js 失败",
                    error + "\r\n\r\n将在稍后自动重试，也可在托盘菜单手动操作。",
                    ToolTipIcon.Warning);
                return;
            }
            OfferWingetFallback(error);
        }

        private void OfferWingetFallback(string error)
        {
            DialogResult result = MessageBox.Show(
                "从 npmmirror 下载 Node.js 失败：\r\n" + error +
                "\r\n\r\n是否改用 winget 安装 Node.js LTS？",
                "@lisp MCP 托盘",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Warning);
            if (result == DialogResult.Yes) InstallNodeWithWinget();
        }

        private void InstallNodeWithWinget()
        {
            string winget = ProcessRunner.Where("winget.exe");
            if (string.IsNullOrEmpty(winget))
            {
                OpenUrl("https://nodejs.org/zh-cn/download");
                return;
            }

            _nodeMsiLog = null;
            _nodeMsiPath = null;
            _nodeNeedsReboot = false;
            _restartAfterNodeInstall = IsServerBusy();
            StopServerForUpdate();

            RunWingetTask(winget,
                "install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements");
        }

        private void StartNodeMsiInstall(string msiPath)
        {
            if (!File.Exists(msiPath))
            {
                ShowError("安装 Node.js 失败", "安装包不存在：" + msiPath);
                return;
            }

            // 覆盖安装 node.exe 前必须先停止服务，否则 Windows 会锁定正在运行的可执行文件
            _restartAfterNodeInstall = IsServerBusy();
            StopServerForUpdate();

            string taskLog = NewTaskLogFile("node-msi-task");
            string msiLog = NewMsiLogFile();
            _nodeMsiPath = msiPath;
            _nodeMsiLog = msiLog;

            LongTask task = new LongTask("安装 Node.js", taskLog);
            task.AppendLine("安装包：" + msiPath);
            task.AppendLine("安装日志：" + msiLog);

            string arguments = "/i " + ProcessRunner.Quote(msiPath) +
                " /qn /norestart /l*v " + ProcessRunner.Quote(msiLog);
            string error;
            Process process = ProcessRunner.StartElevatedExecutable(
                "msiexec.exe", arguments, out error);
            if (process == null)
            {
                task.Dispose();
                string message = string.IsNullOrEmpty(error) ? "无法启动安装程序。" : error;
                AppLog.Write("Node.js msiexec start failed: " + message);
                if (_taskWindow != null && !_taskWindow.IsDisposed)
                {
                    _taskWindow.Append("\r\n安装未执行：" + message + "\r\n");
                    _taskWindow.SetFinished(false, -1);
                }
                if (message != "已取消管理员授权")
                {
                    ShowError("安装 Node.js 失败", message);
                }
                if (_restartAfterNodeInstall)
                {
                    _restartAfterNodeInstall = false;
                    _server.RestartAsync();
                }
                return;
            }

            _task = task;
            _taskAction = "node-msi";
            _restartAfterTask = false;
            _taskElevated = true;
            _showTaskWindow = true;
            task.AttachElevated(process, null);
            if (_taskWindow != null && !_taskWindow.IsDisposed)
            {
                _taskWindow.SetStatus("正在安装 Node.js，请稍候…");
            }
        }

        private static string FormatBytes(long bytes)
        {
            if (bytes < 1024)
            {
                return bytes.ToString(CultureInfo.InvariantCulture) + " B";
            }
            if (bytes < 1024 * 1024)
            {
                return (bytes / 1024.0).ToString("0.0", CultureInfo.InvariantCulture) + " KB";
            }
            return (bytes / (1024.0 * 1024.0)).ToString("0.0", CultureInfo.InvariantCulture) + " MB";
        }

        private void PromptInstallServer()
        {
            DialogResult result = MessageBox.Show(
                "尚未安装 @lisp MCP Server。\r\n\r\n是否现在通过 npm 下载并安装最新版？",
                "@lisp MCP 托盘",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Question);
            if (result != DialogResult.Yes) return;
            InstallServer();
        }

        private bool TaskBusy()
        {
            return (_task != null && !_task.Finished) || _downloadJob != null;
        }

        private void InstallServer()
        {
            if (TaskBusy())
            {
                Balloon("请稍候", "已有下载/更新任务正在进行。", ToolTipIcon.Info);
                return;
            }
            ServerInfo info = ServerLocator.Resolve(_config, true);
            bool shouldRunAfter = !info.IsInstalled || IsServerBusy();
            StopServerForUpdate();
            RunNpmTask("安装 @lisp MCP Server",
                NpmRunner.InstallServerArgs(_config),
                "install", true, shouldRunAfter);
        }

        private void UpgradeServer()
        {
            if (TaskBusy())
            {
                Balloon("请稍候", "已有下载/更新任务正在进行。", ToolTipIcon.Info);
                return;
            }
            ServerInfo info = ServerLocator.Resolve(_config, true);
            if (!info.IsInstalled)
            {
                InstallServer();
                return;
            }
            bool shouldRunAfter = IsServerBusy();
            StopServerForUpdate();
            RunNpmTask("升级 @lisp MCP Server",
                NpmRunner.InstallServerArgs(_config),
                "upgrade", true, shouldRunAfter);
        }

        private bool IsServerBusy()
        {
            // Error 状态下进程可能仍存活（健康检查失败），升级前也尝试停止一次
            return _server.State == ServerState.Running ||
                   _server.State == ServerState.Starting ||
                   _server.State == ServerState.Error;
        }

        private void StopServerForUpdate()
        {
            // Windows 会锁定已加载的 edge-js 原生模块，升级前必须先停止服务
            if (!IsServerBusy()) return;
            _suppressNotifications = true;
            Cursor.Current = Cursors.WaitCursor;
            try
            {
                _server.StopSync();
            }
            finally
            {
                Cursor.Current = Cursors.Default;
            }
        }

        private void CheckUpdate(bool silentCheck)
        {
            CheckUpdate(silentCheck, false);
        }

        private void CheckUpdate(bool silentCheck, bool autoUpgrade)
        {
            RunNpmTask("检查更新",
                NpmRunner.WithRegistry(_config, "view @atlisp/mcp version"),
                autoUpgrade ? "check-auto" : (silentCheck ? "check-silent" : "check"),
                false, false);
        }

        /// <summary>
        /// 定时检查更新（AutoUpgrade，默认每小时一次）：发现新版本直接静默升级。
        /// 启动 20 秒后才开始首轮，避免和自动补齐环境/首轮健康检查抢线程。
        /// </summary>
        private void MaybeAutoUpgrade()
        {
            if (!_config.AutoUpgrade) return;
            if (TaskBusy()) return;

            DateTime now = DateTime.UtcNow;
            if (_nextUpdateCheckAt == DateTime.MinValue &&
                (now - _createdAt).TotalSeconds < 20)
            {
                return;
            }
            if (now < _nextUpdateCheckAt) return;

            int hours = _config.AutoUpgradeHours > 0 ? _config.AutoUpgradeHours : 1;
            _nextUpdateCheckAt = now.AddHours(hours);
            AppLog.Write("auto-upgrade: 开始检查 @lisp/mcp 新版本");
            CheckUpdate(true, true);
        }

        /// <summary>
        /// 自动升级：和手动升级一样走 npm 全局安装，但不弹任务窗口、不询问 UAC。
        /// 服务运行中会先停止，升级完成后再重启（见 HandleTaskSuccess）。
        /// </summary>
        private void AutoUpgradeServer()
        {
            if (TaskBusy()) return;
            ServerInfo info = ServerLocator.Resolve(_config, true);
            if (!info.IsInstalled) return;
            bool shouldRunAfter = IsServerBusy();
            StopServerForUpdate();
            RunNpmTask("自动升级 @lisp MCP Server",
                NpmRunner.InstallServerArgs(_config),
                "upgrade-auto", false, shouldRunAfter);
        }

        /// <summary>
        /// 升级 @lisp/mcp 成功后，如果新包里的 AtlispTray.exe 与当前运行的托盘不同，
        /// 安排“退出 → 覆盖 → 重启”，让托盘也升到同一版本。
        /// 服务由重启后的托盘（--start-server）负责启动/恢复。
        /// </summary>
        private bool TryApplyTraySelfUpdate(ServerInfo info, bool startServerAfter)
        {
            string message;
            if (!TraySelfUpdate.TryApplyUpdate(info, startServerAfter, out message))
            {
                if (!string.IsNullOrEmpty(message))
                {
                    AppLog.Write("tray-selfupdate: " + message);
                    if (!_silent)
                    {
                        Balloon("托盘未能自动更新",
                            message + "\r\n可稍后手动重启托盘以应用新版本。",
                            ToolTipIcon.Warning);
                    }
                }
                return false;
            }

            AppLog.Write("tray-selfupdate: " + message);
            if (!_silent)
            {
                Balloon("托盘更新", "托盘程序已更新，正在重启以应用新版本…", ToolTipIcon.Info);
            }
            _restartForSelfUpdate = true;
            _uiTimer.Stop();
            ExitApplication();
            return true;
        }

        private void RunWingetTask(string wingetPath, string arguments)
        {
            if (_task != null && !_task.Finished) return;
            string logFile = NewTaskLogFile("winget");
            LongTask task = new LongTask("安装 Node.js", logFile);
            Process process = ProcessRunner.Create(
                wingetPath, arguments, Encoding.UTF8, null,
                delegate(object sender, DataReceivedEventArgs e)
                {
                    if (e.Data != null) task.AppendLine(e.Data);
                },
                delegate(object sender, DataReceivedEventArgs e)
                {
                    if (e.Data != null) task.AppendLine(e.Data);
                });
            if (process == null)
            {
                ShowError("安装 Node.js", "无法启动 winget。");
                return;
            }

            _task = task;
            _taskAction = "node";
            _restartAfterTask = false;
            _taskElevated = false;
            _showTaskWindow = true;
            task.Attach(process);
            ShowTaskWindow("安装 Node.js", task);
        }

        private void RunNpmTask(string title, string arguments, string action,
            bool showWindow, bool restartAfter)
        {
            if (TaskBusy())
            {
                Balloon("请稍候", "已有下载/更新任务正在进行。", ToolTipIcon.Info);
                return;
            }

            ServerInfo info = ServerLocator.Resolve(_config, true);
            if (string.IsNullOrEmpty(info.NodePath) && string.IsNullOrEmpty(info.NpmPath))
            {
                if (action == "check-silent" || action == "check-auto")
                {
                    AppLog.Write("定时检查更新失败：未检测到 Node.js/npm");
                    return;
                }
                PromptInstallNode();
                return;
            }

            string logFile = NewTaskLogFile("npm");
            LongTask task = new LongTask(title, logFile);
            if (arguments != null &&
                arguments.IndexOf("--ignore-scripts", StringComparison.Ordinal) >= 0)
            {
                task.AppendLine("提示：未检测到 .NET SDK（dotnet），已跳过 npm 安装脚本。" +
                    "edge-js 原生文件会在安装完成后自动补齐，不影响使用。");
            }
            Process process = NpmRunner.Create(_config, info, arguments,
                delegate(object sender, DataReceivedEventArgs e)
                {
                    if (e.Data != null) task.AppendLine(e.Data);
                },
                delegate(object sender, DataReceivedEventArgs e)
                {
                    if (e.Data != null) task.AppendLine(e.Data);
                });
            if (process == null)
            {
                task.Dispose();
                ShowError(title, "找不到可用的 npm，请检查 Node.js 安装。");
                return;
            }

            _task = task;
            _taskAction = action;
            _restartAfterTask = restartAfter;
            _taskElevated = false;
            _showTaskWindow = showWindow;
            // 静默任务不要把输出追加到上一次遗留的窗口里
            if (!showWindow) _taskWindow = null;
            task.Attach(process);
            if (showWindow) ShowTaskWindow(title, task);
            else if (action != "check-silent" && action != "check-auto")
            {
                Balloon(title, "正在执行，请稍候…", ToolTipIcon.Info);
            }
        }

        private void RetryElevated(string title, string action, bool restartAfter)
        {
            // 自动补齐流程里不再多问一次，直接弹 UAC（UAC 本身需要用户点“是”）
            if (!_bootstrapMode)
            {
                DialogResult result = MessageBox.Show(
                    "当前用户没有写入全局 npm 目录的权限。\r\n\r\n是否以管理员身份重试？" +
                    "\r\n（会弹出 Windows UAC 授权窗口）",
                    "@lisp MCP 托盘",
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Question);
                if (result != DialogResult.Yes) return;
            }

            ServerInfo info = ServerLocator.Resolve(_config, true);
            string arguments = action == "upgrade" || action == "install"
                ? NpmRunner.InstallServerArgs(_config)
                : NpmRunner.WithRegistry(_config, "view @atlisp/mcp version");
            string commandLine = NpmRunner.BuildCommandLine(info, arguments);
            if (string.IsNullOrEmpty(commandLine))
            {
                ShowError(title, "找不到可用的 npm，请检查 Node.js 安装。");
                return;
            }

            string logFile = NewTaskLogFile("npm-elevated");
            LongTask task = new LongTask(title + "（管理员）", logFile);
            string error;
            Process process = ProcessRunner.StartElevated(commandLine, logFile, info.NodePath, out error);
            if (process == null)
            {
                task.Dispose();
                if (!string.IsNullOrEmpty(error) && error != "已取消管理员授权")
                {
                    ShowError(title, error);
                }
                else if (_bootstrapMode)
                {
                    // 用户主动取消了 UAC，停止自动重试以免反复弹窗
                    AppLog.Write("auto-install: 用户取消了 UAC 授权，停止自动安装");
                    _autoInstallDone = true;
                    Balloon("自动安装已取消",
                        "管理员授权被取消，未能完成 @lisp/mcp 安装。\r\n可在托盘菜单手动重试。",
                        ToolTipIcon.Warning);
                }
                return;
            }

            _task = task;
            _taskAction = action;
            _restartAfterTask = restartAfter;
            _taskElevated = true;
            _showTaskWindow = true;
            task.AttachElevated(process, logFile);
            ShowTaskWindow(title + "（管理员）", task);
        }

        private void PollTask()
        {
            LongTask task = _task;
            if (task == null) return;

            string chunk = task.Drain();
            if (!string.IsNullOrEmpty(chunk) && _taskWindow != null && !_taskWindow.IsDisposed)
            {
                _taskWindow.Append(chunk);
            }

            if (!task.Poll()) return;

            chunk = task.Drain();
            if (!string.IsNullOrEmpty(chunk) && _taskWindow != null && !_taskWindow.IsDisposed)
            {
                _taskWindow.Append(chunk);
            }

            int exitCode = task.ExitCode;
            string output = task.Output;
            string action = _taskAction;
            bool restartAfter = _restartAfterTask;
            bool elevated = _taskElevated;
            bool showWindow = _showTaskWindow;

            // MSI 的 3010/1641 表示安装成功但需要重启
            bool success = exitCode == 0 || exitCode == 3010 || exitCode == 1641;
            _nodeNeedsReboot = action == "node-msi" && (exitCode == 3010 || exitCode == 1641);
            if (_taskWindow != null && !_taskWindow.IsDisposed)
            {
                _taskWindow.SetFinished(success, exitCode);
            }

            _task = null;
            _taskAction = null;
            _taskWindow = null;
            task.Dispose();

            if (success)
            {
                HandleTaskSuccess(action, output, restartAfter, showWindow);
            }
            else
            {
                HandleTaskFailure(action, output, elevated, showWindow, restartAfter, exitCode);
            }
        }

        private void HandleTaskSuccess(string action, string output, bool restartAfter, bool showWindow)
        {
            ServerLocator.Invalidate();
            ServerInfo info = ServerLocator.Resolve(_config, true);

            // 没有 .NET SDK 时安装用 --ignore-scripts 跳过了 edge-js 的安装脚本，
            // 这里补上它本该做的事（复制 VC 运行时 DLL）；正常安装时是幂等空操作。
            if (action == "install" || action == "upgrade" || action == "upgrade-auto")
            {
                AppLog.Write("edge-js: " + EdgeNativeSupport.Repair(info));
            }

            if (action == "check" || action == "check-silent" || action == "check-auto")
            {
                bool autoCheck = action == "check-auto";
                string latest = VersionUtil.Extract(output);
                _latestVersion = latest;
                if (latest == null)
                {
                    if (showWindow) return;
                    if (!autoCheck)
                    {
                        Balloon("检查更新", "无法解析 npm 返回的版本号。", ToolTipIcon.Warning);
                    }
                    else
                    {
                        AppLog.Write("auto-upgrade: 无法解析 npm 返回的版本号");
                    }
                    return;
                }
                AppLog.Write("latest version: " + latest);
                if (!info.IsInstalled)
                {
                    if (!_silent && !autoCheck)
                    {
                        Balloon("尚未安装",
                            "@lisp MCP Server v" + latest +
                            " 可用。右键托盘图标 → “下载并安装 @lisp MCP Server”。",
                            ToolTipIcon.Info);
                    }
                    UpdateUi();
                    return;
                }
                if (VersionUtil.IsNewer(latest, info.Version))
                {
                    if (autoCheck)
                    {
                        AppLog.Write("auto-upgrade: 发现新版本 " + latest +
                            "（当前 " + info.VersionText + "），开始自动升级");
                        if (!_silent)
                        {
                            Balloon("正在自动升级",
                                "@lisp MCP Server v" + latest + " 已发布（当前 " +
                                info.VersionText + "），正在后台升级。",
                                ToolTipIcon.Info);
                        }
                        AutoUpgradeServer();
                    }
                    else
                    {
                        Balloon("发现新版本",
                            "@lisp MCP Server v" + latest + " 可用（当前 " + info.VersionText + "）。" +
                            "右键托盘图标 → 升级到最新版。",
                            ToolTipIcon.Info);
                    }
                }
                else if (!string.IsNullOrEmpty(info.Version) && action == "check")
                {
                    Balloon("已是最新版本", "当前版本 " + info.VersionText + "。", ToolTipIcon.Info);
                }
                UpdateUi();
                return;
            }

            if (action == "upgrade-auto")
            {
                if (!string.IsNullOrEmpty(info.Version))
                {
                    _latestVersion = info.Version;
                }
                AppLog.Write("auto-upgrade: 已升级到 " + info.VersionText);
                if (!_silent)
                {
                    Balloon("自动升级完成", "已升级到 " + info.VersionText + "。", ToolTipIcon.Info);
                }
                ServerLocator.Invalidate();
                if (TryApplyTraySelfUpdate(info, restartAfter))
                {
                    return;
                }
                if (restartAfter)
                {
                    _server.RestartAsync();
                }
                UpdateUi();
                return;
            }

            if (action == "install" || action == "upgrade")
            {
                if (!string.IsNullOrEmpty(info.Version))
                {
                    _latestVersion = info.Version;
                }
                Balloon("安装完成",
                    (action == "install" ? "已安装 " : "已升级到 ") + info.VersionText + "。",
                    ToolTipIcon.Info);

                if (TryApplyTraySelfUpdate(info, restartAfter || _config.AutoStartServer))
                {
                    return;
                }
                if (restartAfter)
                {
                    _server.RestartAsync();
                }
                else if (_config.AutoStartServer)
                {
                    try { _server.Start(); } catch (Exception ex) { AppLog.Write("安装后启动失败: " + ex.Message); }
                }
                ServerLocator.Invalidate();
                _autoInstallDone = true;
                _autoInstallFailures = 0;
                _bootstrapMode = false;
                UpdateUi();
                return;
            }

            if (action == "node" || action == "node-msi")
            {
                ServerLocator.Invalidate();
                ServerInfo after = ServerLocator.Resolve(_config, true);
                bool restart = _restartAfterNodeInstall;
                _restartAfterNodeInstall = false;

                string message;
                if (_nodeNeedsReboot)
                {
                    message = "安装完成，需要重启电脑后生效。";
                }
                else if (string.IsNullOrEmpty(after.NodePath))
                {
                    message = "安装完成，但暂未检测到 Node.js。请重启托盘或检查 NodePath 配置。";
                }
                else
                {
                    message = "已检测到 Node.js：" + after.NodePath;
                }
                Balloon("Node.js 安装完成", message, ToolTipIcon.Info);

                if (restart && !string.IsNullOrEmpty(after.NodePath))
                {
                    _server.RestartAsync();
                }
                else if (!string.IsNullOrEmpty(after.NodePath) && after.IsInstalled &&
                    _config.AutoStartServer)
                {
                    try { _server.Start(); } catch (Exception ex) { AppLog.Write(ex.Message); }
                }
                else if (!string.IsNullOrEmpty(after.NodePath) && !after.IsInstalled)
                {
                    if (_bootstrapMode) InstallServer();
                    else PromptInstallServer();
                }
                UpdateUi();
            }
        }

        private void HandleTaskFailure(string action, string output, bool elevated,
            bool showWindow, bool restartAfter, int exitCode)
        {
            string text = output ?? "";
            AppLog.Write("task failed action=" + action + " exitCode=" + exitCode +
                " output=" + Tail(text, 2000));

            if (action == "node-msi")
            {
                StringBuilder message = new StringBuilder();
                message.AppendLine("msiexec 退出码：" + exitCode);
                if (!string.IsNullOrEmpty(_nodeMsiLog))
                {
                    message.AppendLine("安装日志：" + _nodeMsiLog);
                }
                if (!string.IsNullOrEmpty(_nodeMsiPath))
                {
                    message.AppendLine("安装包：" + _nodeMsiPath);
                }
                message.AppendLine();
                message.AppendLine("可尝试手动以管理员身份运行安装包，或改用 winget 安装。");
                if (_bootstrapMode)
                {
                    ScheduleAutoInstallRetry();
                    Balloon("自动安装 Node.js 失败",
                        "msiexec 退出码：" + exitCode + "\r\n\r\n将在稍后自动重试。",
                        ToolTipIcon.Warning);
                }
                else
                {
                    ShowError("安装 Node.js 失败", message.ToString().Trim());
                }
                if (_restartAfterNodeInstall)
                {
                    _restartAfterNodeInstall = false;
                    _server.RestartAsync();
                }
                return;
            }

            bool permissionError =
                text.IndexOf("EPERM", StringComparison.OrdinalIgnoreCase) >= 0 ||
                text.IndexOf("EACCES", StringComparison.OrdinalIgnoreCase) >= 0 ||
                text.IndexOf("permission denied", StringComparison.OrdinalIgnoreCase) >= 0 ||
                text.IndexOf("Access is denied", StringComparison.OrdinalIgnoreCase) >= 0;

            if (permissionError && !elevated &&
                (action == "install" || action == "upgrade" || action == "check"))
            {
                RetryElevated(
                    action == "upgrade" ? "升级 @lisp MCP Server" : "安装 @lisp MCP Server",
                    action,
                    restartAfter);
                return;
            }

            if (action == "check-silent")
            {
                AppLog.Write("启动时检查更新失败（已静默）");
                return;
            }

            if (action == "check-auto")
            {
                AppLog.Write("auto-upgrade: 检查更新失败，将在下一次定时检查时重试");
                return;
            }

            if (action == "upgrade-auto")
            {
                AppLog.Write("auto-upgrade: 升级失败 exitCode=" + exitCode +
                    " output=" + Tail(text, 2000));
                if (!_silent)
                {
                    Balloon("自动升级失败",
                        LastLines(text, 3) + "\r\n\r\n将在下一次定时检查时重试。",
                        ToolTipIcon.Warning);
                }
                if (restartAfter)
                {
                    _server.RestartAsync();
                }
                return;
            }

            // edge-js 安装脚本在没有 .NET SDK 的机器上会 spawn dotnet 失败。正常路径
            // 已用 --ignore-scripts 规避（见 EdgeNativeSupport），走到这里说明兜底没生效，
            // 直接给出可复制的命令，避免用户对着 "退出码 1" 发呆。
            bool dotnetScriptFailure =
                text.IndexOf("spawn dotnet", StringComparison.OrdinalIgnoreCase) >= 0 ||
                (text.IndexOf("tools/install.js", StringComparison.OrdinalIgnoreCase) >= 0 &&
                 text.IndexOf("ENOENT", StringComparison.OrdinalIgnoreCase) >= 0);
            if (dotnetScriptFailure && !_bootstrapMode && !elevated &&
                (action == "install" || action == "upgrade"))
            {
                AppLog.Write("安装失败：edge-js 安装脚本找不到 dotnet（--ignore-scripts 兜底未生效）");
                ShowError("安装失败：缺少 .NET SDK",
                    "edge-js 的 npm 安装脚本会调用 dotnet 构建 CoreCLR bootstrap，" +
                    "本机没有 .NET SDK 时报 spawn dotnet ENOENT。\r\n\r\n" +
                    "请关闭托盘后在命令行执行：\r\n" +
                    "  npm install -g @atlisp/mcp --ignore-scripts\r\n\r\n" +
                    LastLines(text, 6));
                if (restartAfter)
                {
                    _server.RestartAsync();
                }
                return;
            }

            string detail = LastLines(text, 12);

            // 自动补齐流程：按退避重试，不打扰用户
            if (_bootstrapMode)
            {
                ScheduleAutoInstallRetry();
                Balloon("自动安装未成功",
                    LastLines(text, 3) + "\r\n\r\n将在稍后自动重试，也可在托盘菜单手动操作。",
                    ToolTipIcon.Warning);
                if (_restartAfterNodeInstall)
                {
                    _restartAfterNodeInstall = false;
                    _server.RestartAsync();
                }
                return;
            }

            ShowError("操作失败", string.IsNullOrEmpty(detail) ? "命令执行失败，请查看日志。" : detail);

            if (action == "node" && _restartAfterNodeInstall)
            {
                _restartAfterNodeInstall = false;
                _server.RestartAsync();
            }
        }

        private static string Tail(string text, int maxLength)
        {
            if (string.IsNullOrEmpty(text)) return "";
            if (text.Length <= maxLength) return text;
            return text.Substring(text.Length - maxLength);
        }

        private static string LastLines(string text, int count)
        {
            if (string.IsNullOrEmpty(text)) return "";
            string[] lines = text.Split(new char[] { '\r', '\n' },
                StringSplitOptions.RemoveEmptyEntries);
            int start = Math.Max(0, lines.Length - count);
            StringBuilder builder = new StringBuilder();
            for (int i = start; i < lines.Length; i++)
            {
                builder.AppendLine(lines[i]);
            }
            return builder.ToString().Trim();
        }

        private string NewTaskLogFile(string prefix)
        {
            Directory.CreateDirectory(Paths.LogDir);
            return Path.Combine(Paths.LogDir,
                prefix + "-" + DateTime.Now.ToString("yyyyMMdd-HHmmss") + ".log");
        }

        private string NewMsiLogFile()
        {
            Directory.CreateDirectory(Paths.LogDir);
            return Path.Combine(Paths.LogDir,
                "node-msi-" + DateTime.Now.ToString("yyyyMMdd-HHmmss") + ".log");
        }

        private void ShowTaskWindow(string title, LongTask task)
        {
            if (_taskWindow != null && !_taskWindow.IsDisposed)
            {
                try { _taskWindow.Close(); } catch { }
            }
            OutputForm form = new OutputForm(title, "", true);
            form.FormClosed += delegate { if (_taskWindow == form) _taskWindow = null; };
            _taskWindow = form;
            form.Show();
            string initial = task.Drain();
            if (!string.IsNullOrEmpty(initial)) form.Append(initial);
        }

        private void ToggleTrayAutostart()
        {
            try
            {
                bool enabled = !AutostartHelper.IsEnabled();
                AutostartHelper.SetEnabled(enabled);
                Balloon("开机自启",
                    enabled ? "托盘已加入 Windows 启动项。" : "托盘已从 Windows 启动项移除。",
                    ToolTipIcon.Info);
                UpdateUi();
            }
            catch (Exception ex)
            {
                ShowError("设置开机自启失败", ex.Message);
            }
        }

        private void ToggleServerAutostart()
        {
            _config.AutoStartServer = !_config.AutoStartServer;
            _config.Save();
            UpdateUi();
        }

        private void ToggleAutoInstall()
        {
            _config.AutoInstall = !_config.AutoInstall;
            _config.Save();
            if (_config.AutoInstall)
            {
                // 重新开启时重置所有开关，否则本进程内的自动补齐不会恢复
                _autoInstallDone = false;
                _autoStartAttempted = false;
                _portableNodeAttempted = false;
                _msiFallbackTried = false;
                _autoInstallFailures = 0;
                _autoInstallRetryAt = DateTime.MinValue;
                SaveBootstrapState();
            }
            else
            {
                // 关闭后停止当前进程里的自动重试；已装好的依赖和服务不受影响
                _autoInstallDone = true;
                _portableNodeAttempted = true;
            }
            UpdateUi();
            Balloon("自动补齐运行环境",
                _config.AutoInstall
                    ? "开启：缺少 Node.js 或 @lisp/mcp 时会自动下载安装。"
                    : "关闭：缺少依赖时只提示，需要手动从菜单安装。",
                ToolTipIcon.Info);
        }

        private void ToggleAutoUpgrade()
        {
            _config.AutoUpgrade = !_config.AutoUpgrade;
            _config.Save();
            // 重新开启时立即按新周期重新计时（20 秒启动宽限仍生效）
            _nextUpdateCheckAt = DateTime.MinValue;
            _startupUpdateChecked = _config.AutoUpgrade;
            UpdateUi();

            int hours = _config.AutoUpgradeHours > 0 ? _config.AutoUpgradeHours : 1;
            Balloon("定时自动检查并升级",
                _config.AutoUpgrade
                    ? "开启：每 " + hours + " 小时检查一次 @lisp/mcp 新版本，发现后自动升级。"
                    : "关闭：不再自动检查/升级，可在“更新与安装”里手动操作。",
                ToolTipIcon.Info);
        }

        private void ToggleMirror()
        {
            if (string.IsNullOrEmpty(_config.NpmRegistry))
            {
                _config.NpmRegistry = "https://registry.npmmirror.com";
            }
            else
            {
                _config.NpmRegistry = "";
            }
            _config.Save();
            UpdateUi();
            Balloon("npm 源",
                string.IsNullOrEmpty(_config.NpmRegistry)
                    ? "已恢复使用 npm 默认源。"
                    : "已切换到 npmmirror 镜像：" + _config.NpmRegistry,
                ToolTipIcon.Info);
        }

        private void ReloadConfig()
        {
            TrayConfig loaded = TrayConfig.Load();
            bool portChanged = loaded.Port != _config.Port;
            bool restart = portChanged && IsServerBusy();

            if (restart)
            {
                // 必须用旧端口停止旧进程，否则找不到 lock/pid 对应的实例
                _suppressNotifications = true;
                Cursor.Current = Cursors.WaitCursor;
                try
                {
                    _server.StopSync();
                }
                finally
                {
                    Cursor.Current = Cursors.Default;
                }
            }

            _config.CopyFrom(loaded);
            _activePort = _config.Port;
            ServerLocator.Invalidate();
            _health.SetPort(_config.Port);
            // 定时自动升级按新配置重新计时
            _nextUpdateCheckAt = DateTime.MinValue;
            _startupUpdateChecked = _config.AutoUpgrade;

            if (restart)
            {
                try
                {
                    _server.Start();
                }
                catch (Exception ex)
                {
                    AppLog.Write("端口变更后重启服务失败: " + ex.Message);
                    Balloon("重启服务失败", ex.Message, ToolTipIcon.Error);
                }
            }

            UpdateUi();
            Balloon("配置已重新加载",
                "端口：" + _config.Port + (restart ? "（服务已重启）" : ""),
                ToolTipIcon.Info);
        }

        private void ShowDiagnostics()
        {
            ServerInfo info = ServerLocator.Resolve(_config, true);
            HealthSnapshot health = _health.Snapshot;

            bool serviceExists;
            bool serviceRunning;
            ServiceHelper.Query(out serviceExists, out serviceRunning, true);

            StringBuilder builder = new StringBuilder();
            builder.AppendLine("@lisp MCP 托盘 诊断信息");
            builder.AppendLine("托盘版本     : v" + Program.AppVersion);
            builder.AppendLine("托盘路径     : " + Application.ExecutablePath);
            builder.AppendLine("生成时间     : " + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"));
            builder.AppendLine("操作系统     : " + Environment.OSVersion.VersionString);
            builder.AppendLine("64 位进程    : " + (Environment.Is64BitProcess ? "是" : "否"));
            builder.AppendLine();
            builder.AppendLine("配置文件     : " + Paths.TrayConfigPath);
            builder.AppendLine("端口         : " + _config.Port);
            builder.AppendLine("托盘自启     : " + (AutostartHelper.IsEnabled() ? "已启用" : "未启用"));
            builder.AppendLine("启动时启服务 : " + (_config.AutoStartServer ? "是" : "否"));
            builder.AppendLine("自动补齐环境 : " + (_config.AutoInstall ? "开" : "关") + BootstrapStateText());
            builder.AppendLine("自动升级     : " +
                (_config.AutoUpgrade
                    ? "每 " + (_config.AutoUpgradeHours > 0 ? _config.AutoUpgradeHours : 1) + " 小时检查并升级"
                    : "关"));
            builder.AppendLine("npm 源       : " +
                (string.IsNullOrEmpty(_config.NpmRegistry) ? "默认" : _config.NpmRegistry));
            builder.AppendLine();
            builder.AppendLine("Node.js      : " + (string.IsNullOrEmpty(info.NodePath) ? "未检测到" : info.NodePath));
            if (Directory.Exists(Paths.PortableNodeDir))
            {
                builder.AppendLine("portable 目录: " + Paths.PortableNodeDir);
            }
            builder.AppendLine("npm          : " + (string.IsNullOrEmpty(info.NpmPath) ? "未检测到" : info.NpmPath));
            builder.AppendLine("npm-cli.js   : " + (string.IsNullOrEmpty(info.NpmCliPath) ? "未检测到" : info.NpmCliPath));
            builder.AppendLine("@lisp/mcp    : " + (info.IsInstalled ? info.ScriptPath : "未安装"));
            builder.AppendLine("服务版本     : " + info.VersionText);
            builder.AppendLine("最新版本     : " +
                (string.IsNullOrEmpty(_latestVersion) ? "未检查" : "v" + _latestVersion));
            builder.AppendLine();
            builder.AppendLine("托盘服务状态 : " + StateText(_server.State));
            builder.AppendLine("Windows 服务 : " +
                (serviceExists ? (serviceRunning ? "已安装 / 运行中" : "已安装 / 已停止") : "未安装"));
            if (health != null)
            {
                builder.AppendLine("健康检查     : " + (health.Ok ? "正常" : "失败（" + health.Error + "）"));
                builder.AppendLine("CAD 状态     : " + (health.Ok ? health.CadSummary() : "未知"));
                if (health.Ok)
                {
                    builder.AppendLine("已运行       : " + FormatUptime(health.UptimeSeconds));
                    builder.AppendLine("工具数量     : " + health.ToolCount);
                }
            }
            builder.AppendLine();
            builder.AppendLine("日志目录     : " + Paths.LogDir);
            builder.AppendLine("托盘日志     : " + Paths.TrayLogPath);
            if (!string.IsNullOrEmpty(_server.LastError))
            {
                builder.AppendLine();
                builder.AppendLine("最近错误     : " + _server.LastError);
            }

            OutputForm form = new OutputForm("环境诊断", builder.ToString(), false);
            form.Show();
        }

        private string BootstrapStateText()
        {
            if (_autoInstallDone) return "（环境已就绪）";
            if (_autoInstallFailures >= AutoInstallMaxFailures) return "（已重试 " +
                _autoInstallFailures + " 次，停止自动重试）";
            if (_bootstrapMode) return "（进行中…）";
            if (DateTime.UtcNow < _autoInstallRetryAt)
            {
                return "（退避至 " + _autoInstallRetryAt.ToLocalTime()
                    .ToString("HH:mm:ss") + "）";
            }
            return "";
        }

        private static string FormatUptime(double seconds)
        {
            if (seconds <= 0) return "未知";
            TimeSpan span = TimeSpan.FromSeconds(seconds);
            if (span.TotalHours >= 1)
            {
                return string.Format(CultureInfo.InvariantCulture, "{0:0} 小时 {1:0} 分",
                    Math.Floor(span.TotalHours), span.Minutes);
            }
            return string.Format(CultureInfo.InvariantCulture, "{0:0} 分 {1:0} 秒",
                span.Minutes, span.Seconds);
        }

        private void ShowAbout()
        {
            ServerInfo info = ServerLocator.Resolve(_config, false);
            MessageBox.Show(
                "@lisp MCP Server 托盘管理工具\r\n" +
                "版本 v" + Program.AppVersion + "\r\n\r\n" +
                "服务版本：" + info.VersionText + "\r\n" +
                "端口：" + _config.Port + "\r\n\r\n" +
                "双击托盘图标打开 https://atlisp.cn/agent/chat；\r\n" +
                "右键菜单可启动/停止服务、\r\n" +
                "检查更新、升级、安装以及设置开机自启。\r\n" +
                "托盘随 @lisp/mcp 自动升级（默认每小时检查一次）。\r\n\r\n" +
                "项目主页：https://gitee.com/atlisp",
                "关于 @lisp MCP 托盘",
                MessageBoxButtons.OK,
                MessageBoxIcon.Information);
        }

        private void OpenServerLog()
        {
            try
            {
                string file = FindLatestServerLog();
                if (!string.IsNullOrEmpty(file)) OpenPath(file);
                else OpenPath(Paths.LogDir);
            }
            catch (Exception ex)
            {
                ShowError("打开日志失败", ex.Message);
            }
        }

        private static string FindLatestServerLog()
        {
            try
            {
                if (!Directory.Exists(Paths.LogDir)) return null;
                string[] files = Directory.GetFiles(Paths.LogDir, "server-*.log");
                if (files.Length == 0) return null;
                Array.Sort(files, StringComparer.OrdinalIgnoreCase);
                return files[files.Length - 1];
            }
            catch
            {
                return null;
            }
        }

        private static void OpenUrl(string url)
        {
            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = url,
                    UseShellExecute = true
                });
            }
            catch (Exception ex)
            {
                MessageBox.Show("无法打开链接：" + ex.Message, "@lisp MCP 托盘",
                    MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }

        private static void OpenPath(string path)
        {
            try
            {
                if (string.IsNullOrEmpty(path)) return;
                if (Directory.Exists(path))
                {
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = "explorer.exe",
                        Arguments = ProcessRunner.Quote(path),
                        UseShellExecute = true
                    });
                }
                else if (File.Exists(path))
                {
                    Process.Start(new ProcessStartInfo { FileName = path, UseShellExecute = true });
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show("无法打开：" + ex.Message, "@lisp MCP 托盘",
                    MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }

        private void Balloon(string title, string text, ToolTipIcon icon)
        {
            try
            {
                _tray.ShowBalloonTip(4000, title, text, icon);
            }
            catch
            {
                // 通知中心不可用时忽略
            }
        }

        private void ShowError(string title, string message)
        {
            AppLog.Write(title + ": " + message);
            MessageBox.Show(message, "@lisp MCP 托盘 - " + title,
                MessageBoxButtons.OK, MessageBoxIcon.Error);
        }

        private void ExitApplication()
        {
            if (TaskBusy())
            {
                DialogResult result = MessageBox.Show(
                    "正在下载/更新，退出托盘不会中断该操作。\r\n\r\n确定要退出吗？",
                    "@lisp MCP 托盘",
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Question);
                if (result != DialogResult.Yes) return;
            }

            if (_config.StopServerOnExit && !_restartForSelfUpdate)
            {
                // 退出时必须同步等待停止完成，否则后台线程会随进程一起结束
                _server.StopSync();
            }
            _uiTimer.Stop();
            _tray.Visible = false;
            _tray.Dispose();
            _health.Dispose();
            _server.Dispose();
            if (_currentIcon != null)
            {
                try { _currentIcon.Dispose(); } catch { }
                _currentIcon = null;
            }
            if (_task != null)
            {
                try { _task.Dispose(); } catch { }
                _task = null;
            }
            if (_downloadJob != null)
            {
                try { _downloadJob.Dispose(); } catch { }
                _downloadJob = null;
            }
            ExitThread();
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                try { _tray.Visible = false; } catch { }
                try { _tray.Dispose(); } catch { }
                try { _health.Dispose(); } catch { }
                try { _server.Dispose(); } catch { }
                try { _uiTimer.Dispose(); } catch { }
                try { _menu.Dispose(); } catch { }
                if (_downloadJob != null)
                {
                    try { _downloadJob.Dispose(); } catch { }
                    _downloadJob = null;
                }
                if (_currentIcon != null)
                {
                    try { _currentIcon.Dispose(); } catch { }
                }
            }
            base.Dispose(disposing);
        }
    }
}
