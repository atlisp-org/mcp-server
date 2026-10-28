// @lisp MCP Server Windows 托盘管理工具
//
// 单文件 WinForms 程序，使用 .NET Framework 4.x 自带的 csc.exe 编译，
// 目标平台 Windows 7+（实际依赖 .NET Framework 4.5+）。
//
// 功能：启动/停止/重启本机 atlisp-mcp、健康检查、只读检查更新、
//       查看日志与调试面板、托盘/服务开机自启、环境诊断。
//
// 刻意不具备「下载 / 安装 / 解压 / 枚举进程」能力：缺依赖时只显示安装命令，
// 由用户自行安装（见 tray/README.md「杀软误报」）。
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
using System.Net;
using System.Runtime.InteropServices;
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
        /// <summary>
        /// 托盘真实版本号。exe 的版本资源固定为 1.0.0.0（为了让 hash 跨版本稳定，
        /// 见 build.ps1 / scripts/build-tray.mjs 里的说明），真实版本按下面顺序解析：
        ///   1. 同目录的 AtlispTray.version（安装器 / 更新器写入）；
        ///   2. 向上找 package.json（从 npm 包目录直接运行时）；
        ///   3. "dev"。
        /// </summary>
        internal static readonly string AppVersion = ResolveAppVersion();

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

            // 不再有自我替换模式：更新由 atlisp-tray 在托盘退出后完成，
            // 新托盘由它直接拉起，因此这里不需要 --wait-pid 之类的等待逻辑。

            AppLog.Init();
            // 旧版本的自我更新靠 %APPDATA%\atlisp-mcp\update-tray.cmd，新版不再生成，
            // 顺手清掉残留（避免留下一个「可疑脚本」样本）。
            TraySelfUpdate.CleanupLegacyScript();

            // Windows 7/8 上的 .NET Framework 默认不启用 TLS 1.2，npm registry 需要 TLS 1.2
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

                // 不再做「从 npm 包目录把自己复制到用户目录再启动」的自迁移：
                // 新版的 exe 由 `atlisp-tray` 直接下载到 %LOCALAPPDATA%\Programs\atlisp-mcp，
                // 不会运行在包目录里。留着这条路径只会给杀软提供一个「自我复制并执行」的样本。
                // 旧版用户由旧版自己完成迁移（旧代码在他们机器上仍然生效）。

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

        internal const string VersionFileName = "AtlispTray.version";

        /// <summary>
        /// 解析托盘真实版本号，见 <see cref="AppVersion"/> 的注释。
        /// </summary>
        private static string ResolveAppVersion()
        {
            try
            {
                string exe = Application.ExecutablePath;
                string dir = string.IsNullOrEmpty(exe) ? null : Path.GetDirectoryName(exe);
                if (!string.IsNullOrEmpty(dir))
                {
                    string sidecar = Path.Combine(dir, VersionFileName);
                    if (File.Exists(sidecar))
                    {
                        string text = File.ReadAllText(sidecar).Trim();
                        if (text.Length > 0) return text;
                    }
                }
                // 从 npm 包目录直接运行时用包里的 package.json
                for (int i = 0; i < 5 && !string.IsNullOrEmpty(dir); i++)
                {
                    string pkg = Path.Combine(dir, "package.json");
                    if (File.Exists(pkg))
                    {
                        string content = File.ReadAllText(pkg);
                        Match name = Regex.Match(content, "\"name\"\\s*:\\s*\"@atlisp/mcp\"");
                        Match version = Regex.Match(content, "\"version\"\\s*:\\s*\"([^\"]+)\"");
                        if (name.Success && version.Success)
                        {
                            return version.Groups[1].Value;
                        }
                    }
                    dir = Path.GetDirectoryName(dir);
                }

                // 兜底：全局 npm 前缀里的包（托盘已迁到 %LOCALAPPDATA% 时靠这个）
                string npmPkg = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                    "npm", "node_modules", "@atlisp", "mcp", "package.json");
                if (File.Exists(npmPkg))
                {
                    string content = File.ReadAllText(npmPkg);
                    Match version = Regex.Match(content, "\"version\"\\s*:\\s*\"([^\"]+)\"");
                    if (version.Success) return version.Groups[1].Value;
                }
            }
            catch (Exception)
            {
                // 版本号读不出来不影响运行
            }
            return "dev";
        }

        /// <summary>把版本号写到 exe 同目录（由 atlisp-tray 首次安装时调用）。</summary>
        internal static void WriteVersionFile(string directory)
        {
            if (string.IsNullOrEmpty(directory)) return;
            try
            {
                Directory.CreateDirectory(directory);
                File.WriteAllText(Path.Combine(directory, VersionFileName), AppVersion,
                    new UTF8Encoding(false));
            }
            catch (Exception ex)
            {
                AppLog.Write("写版本文件失败: " + ex.Message);
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

        /// <summary>旧版托盘解压到用户目录的 portable Node.js（仅用于探测，不再安装）。</summary>
        public static string PortableNodeDir
        {
            get
            {
                return Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "atlisp-mcp", "node");
            }
        }

        /// <summary>旧版托盘安装到用户目录的 Python（仅用于探测，不再安装）。</summary>
        public static string PythonDir
        {
            get
            {
                return Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "atlisp-mcp", "python");
            }
        }

        /// <summary>首次自动开启开机自启的标记文件，用户关闭后不会被再次打开。</summary>
        public static string AutostartDefaultPath
        {
            get { return Path.Combine(DataDir, "autostart-default.txt"); }
        }

        /// <summary>托盘启动的知识库服务 PID（用于停止；仅记托盘自己起的进程）。</summary>
        public static string DwgKbPidPath
        {
            get { return Path.Combine(DataDir, "dwgkb.pid"); }
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

    public sealed class TrayConfig
    {
        public int Port { get; set; }
        public string NodePath { get; set; }
        public string NpmPath { get; set; }
        public string ServerScript { get; set; }
        public string ConfigFile { get; set; }
        public bool AutoStartServer { get; set; }
        public bool CheckUpdateOnStart { get; set; }
        public bool StopServerOnExit { get; set; }
        public int HealthyPollSeconds { get; set; }
        /// <summary>图纸知识库（atlisp-dwg-kb）服务地址，默认本机 :8322。</summary>
        public string DwgKbUrl { get; set; }
        /// <summary>知识库 API key；知识库侧设置了 DWG_KB_API_KEY 时必须一致。</summary>
        public string DwgKbApiKey { get; set; }
        /// <summary>检测到的 Python 解释器路径（缓存，加速后续检测）。</summary>
        public string PythonPath { get; set; }
        /// <summary>托盘启动时自动启动本地知识库服务（仅当地址是本机且已安装包）。</summary>
        public bool DwgKbAutoStart { get; set; }

        public TrayConfig()
        {
            Port = 8110;
            NodePath = "";
            NpmPath = "";
            ServerScript = "";
            ConfigFile = "";
            AutoStartServer = true;
            CheckUpdateOnStart = true;
            StopServerOnExit = false;
            HealthyPollSeconds = 5;
            DwgKbUrl = "http://127.0.0.1:8322";
            DwgKbApiKey = "";
            PythonPath = "";
            DwgKbAutoStart = true;
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
            AutoStartServer = other.AutoStartServer;
            CheckUpdateOnStart = other.CheckUpdateOnStart;
            StopServerOnExit = other.StopServerOnExit;
            HealthyPollSeconds = other.HealthyPollSeconds;
            DwgKbUrl = other.DwgKbUrl;
            DwgKbApiKey = other.DwgKbApiKey;
            PythonPath = other.PythonPath;
            DwgKbAutoStart = other.DwgKbAutoStart;
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
            NodePath = NodePath ?? "";
            NpmPath = NpmPath ?? "";
            ServerScript = ServerScript ?? "";
            ConfigFile = ConfigFile ?? "";
            // 知识库地址：空 → 默认本机；只接受 http/https（写错成裸主机名时
            // HttpWebRequest 会在菜单打开时抛异常，表现为「知识库不可达」）。
            DwgKbUrl = (DwgKbUrl ?? "").Trim().TrimEnd('/');
            if (DwgKbUrl.Length == 0) DwgKbUrl = "http://127.0.0.1:8322";
            if (!DwgKbUrl.StartsWith("http://", StringComparison.OrdinalIgnoreCase) &&
                !DwgKbUrl.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            {
                DwgKbUrl = "http://" + DwgKbUrl;
            }
            DwgKbApiKey = DwgKbApiKey ?? "";
            PythonPath = PythonPath ?? "";
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
        public bool Timeout;
        public bool CadConnected;
        public string CadStatus;
        public string CadPlatform;
        public string CadVersion;
        public double UptimeSeconds;
        public int ToolCount;
        public int CommandQueueSize;
        public string Error;

        public string CadSummary()
        {
            if (!Ok)
            {
                return Timeout ? "响应超时（CAD 可能正忙）" : "服务未响应";
            }
            if (!CadConnected) return "CAD 未连接";
            if (string.Equals(CadStatus, "busy", StringComparison.OrdinalIgnoreCase))
            {
                return CommandQueueSize > 0
                    ? "CAD 忙（队列 " + CommandQueueSize + "）"
                    : "CAD 忙";
            }
            string text = "CAD 已连接";
            if (!string.IsNullOrEmpty(CadPlatform)) text += " · " + CadPlatform;
            if (!string.IsNullOrEmpty(CadVersion)) text += " " + CadVersion;
            return text;
        }
    }

    internal static class HealthClient
    {
        /// <summary>
        /// 健康检查的 HTTP 超时。必须大于服务端 /health 的最长响应时间：
        /// 服务端在 CAD 忙时最多会等 HEALTH_FAST_PROBE_MS(1.2s) 再返回，
        /// 这里给到 10s，避免把「慢」误判成「服务没起来」（状态行来回跳的根因）。
        /// </summary>
        public const int TimeoutMs = 10000;

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
            catch (WebException ex)
            {
                snapshot.Ok = false;
                // 超时单独标记：这只是「这一轮探测慢了」（CAD 忙 / worker 轮换），
                // 不等于服务挂了，调用方据此保留上一次状态。
                snapshot.Timeout = ex.Status == WebExceptionStatus.Timeout;
                snapshot.Error = ex.Message;
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
                        snapshot.CommandQueueSize = (int)GetDouble(cad, "commandQueueSize");
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
            _snapshot = HealthClient.Check(_port, HealthClient.TimeoutMs);
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
                    _snapshot = HealthClient.Check(_port, HealthClient.TimeoutMs);
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
            if (string.IsNullOrEmpty(executable)) return null;
            string target = executable.Trim().Trim('"');
            if (target.Length == 0) return null;

            // 显式带路径：只判断文件是否存在
            if (target.IndexOf('\\') >= 0 || target.IndexOf('/') >= 0)
            {
                try
                {
                    return File.Exists(target) ? Path.GetFullPath(target) : null;
                }
                catch
                {
                    return null;
                }
            }

            List<string> names = new List<string>();
            names.Add(target);
            if (Path.GetExtension(target).Length == 0)
            {
                string pathExt = Environment.GetEnvironmentVariable("PATHEXT");
                if (string.IsNullOrEmpty(pathExt)) pathExt = ".COM;.EXE;.BAT;.CMD";
                string[] extensions = pathExt.Split(new char[] { ';' },
                    StringSplitOptions.RemoveEmptyEntries);
                for (int i = 0; i < extensions.Length; i++)
                {
                    string ext = extensions[i].Trim();
                    if (ext.Length == 0) continue;
                    names.Add(target + (ext[0] == '.' ? ext : "." + ext));
                }
            }

            List<string> dirs = new List<string>();
            try { dirs.Add(Directory.GetCurrentDirectory()); } catch { }
            string pathValue = Environment.GetEnvironmentVariable("PATH") ?? "";
            string[] entries = pathValue.Split(new char[] { ';' },
                StringSplitOptions.RemoveEmptyEntries);
            for (int i = 0; i < entries.Length; i++)
            {
                string dir = entries[i].Trim().Trim('"');
                if (dir.Length > 0) dirs.Add(dir);
            }

            // 进程内扫描 PATH，不启动 where.exe（少一次 CreateProcess）
            for (int d = 0; d < dirs.Count; d++)
            {
                for (int n = 0; n < names.Count; n++)
                {
                    try
                    {
                        string candidate = Path.Combine(dirs[d], names[n]);
                        if (File.Exists(candidate)) return candidate;
                    }
                    catch
                    {
                        // 非法路径（驱动器不存在等）直接跳过
                    }
                }
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

        public static string Quote(string value)
        {
            if (value == null) return "\"\"";
            return "\"" + value.Replace("\"", "\\\"") + "\"";
        }

    }

    /// <summary>
    /// 进程树终止：kernel32 的 Toolhelp 快照 + Process.Kill。
    /// 刻意不调用 taskkill.exe —— 托盘里每多一次 CreateProcess 都是一条行为特征，
    /// 而「枚举子进程再逐个结束」完全可以在进程内完成。
    /// </summary>
    internal static class ProcessKiller
    {
        private const uint Th32csSnapProcess = 0x00000002;

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
        private struct PROCESSENTRY32
        {
            public uint dwSize;
            public uint cntUsage;
            public uint th32ProcessID;
            public IntPtr th32DefaultHeapID;
            public uint th32ModuleID;
            public uint cntThreads;
            public uint th32ParentProcessID;
            public int pcPriClassBase;
            public uint dwFlags;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
            public string szExeFile;
        }

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint processId);

        [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern bool Process32First(IntPtr snapshot, ref PROCESSENTRY32 entry);

        [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern bool Process32Next(IntPtr snapshot, ref PROCESSENTRY32 entry);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool CloseHandle(IntPtr handle);

        /// <summary>
        /// 结束 pid 及其所有后代（先杀子进程，避免 node 拉起 cad-worker 后留下孤儿）。
        /// 返回成功结束的进程数。
        /// </summary>
        public static int KillTree(int pid)
        {
            if (pid <= 0) return 0;
            Dictionary<int, List<int>> children = Snapshot();
            List<int> order = new List<int>();
            Walk(pid, children, order);
            int killed = 0;
            for (int i = order.Count - 1; i >= 0; i--)
            {
                if (Kill(order[i])) killed++;
            }
            return killed;
        }

        private static void Walk(int pid, Dictionary<int, List<int>> children, List<int> order)
        {
            order.Add(pid);
            List<int> kids;
            if (!children.TryGetValue(pid, out kids)) return;
            for (int i = 0; i < kids.Count; i++)
            {
                Walk(kids[i], children, order);
            }
        }

        private static Dictionary<int, List<int>> Snapshot()
        {
            Dictionary<int, List<int>> map = new Dictionary<int, List<int>>();
            IntPtr snapshot = CreateToolhelp32Snapshot(Th32csSnapProcess, 0);
            if (snapshot == new IntPtr(-1)) return map;
            try
            {
                PROCESSENTRY32 entry = new PROCESSENTRY32();
                entry.dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32));
                if (!Process32First(snapshot, ref entry)) return map;
                do
                {
                    int parent = (int)entry.th32ParentProcessID;
                    int child = (int)entry.th32ProcessID;
                    List<int> list;
                    if (!map.TryGetValue(parent, out list))
                    {
                        list = new List<int>();
                        map[parent] = list;
                    }
                    list.Add(child);
                }
                while (Process32Next(snapshot, ref entry));
            }
            finally
            {
                CloseHandle(snapshot);
            }
            return map;
        }

        private static bool Kill(int pid)
        {
            try
            {
                using (Process process = Process.GetProcessById(pid))
                {
                    process.Kill();
                    process.WaitForExit(5000);
                    return true;
                }
            }
            catch
            {
                return false;
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

            // 旧版托盘留下的免管理员 Node.js（只探测，不再安装）
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

    /// <summary>
    /// 本机 TCP 监听表（iphlpapi 的 GetExtendedTcpTable）。只用系统 API 读 PID，
    /// 不再启动 netstat.exe ——「枚举进程 + 连接」在杀软 ML 里权重不低，而且
    /// 每多一次 CreateProcess 就多一条行为证据。
    /// </summary>
    internal static class PortInspector
    {
        private const int AfInet = 2;
        private const int TcpTableOwnerPidListener = 3;
        private const int ErrorInsufficientBuffer = 122;

        [StructLayout(LayoutKind.Sequential)]
        private struct MIB_TCPROW_OWNER_PID
        {
            public uint State;
            public uint LocalAddr;
            public uint LocalPort;
            public uint RemoteAddr;
            public uint RemotePort;
            public uint OwningPid;
        }

        [DllImport("iphlpapi.dll", SetLastError = true)]
        private static extern uint GetExtendedTcpTable(IntPtr table, ref int size,
            bool order, int addressFamily, int tableClass, uint reserved);

        /// <summary>返回监听指定端口的 PID；查不到或 API 不可用时返回 0。</summary>
        public static int FindListenerPid(int port)
        {
            try
            {
                int size = 0;
                uint result = GetExtendedTcpTable(IntPtr.Zero, ref size, false,
                    AfInet, TcpTableOwnerPidListener, 0);
                if (result != ErrorInsufficientBuffer || size <= 0) return 0;

                IntPtr buffer = Marshal.AllocHGlobal(size);
                try
                {
                    result = GetExtendedTcpTable(buffer, ref size, false,
                        AfInet, TcpTableOwnerPidListener, 0);
                    if (result != 0) return 0;

                    int count = Marshal.ReadInt32(buffer);
                    int rowSize = Marshal.SizeOf(typeof(MIB_TCPROW_OWNER_PID));
                    IntPtr row = new IntPtr(buffer.ToInt64() + 4);
                    for (int i = 0; i < count; i++)
                    {
                        MIB_TCPROW_OWNER_PID entry =
                            (MIB_TCPROW_OWNER_PID)Marshal.PtrToStructure(row,
                                typeof(MIB_TCPROW_OWNER_PID));
                        int localPort = (int)(((entry.LocalPort & 0xFF) << 8) |
                            ((entry.LocalPort >> 8) & 0xFF));
                        if (localPort == port && entry.OwningPid > 0)
                        {
                            return (int)entry.OwningPid;
                        }
                        row = new IntPtr(row.ToInt64() + rowSize);
                    }
                }
                finally
                {
                    Marshal.FreeHGlobal(buffer);
                }
            }
            catch (Exception ex)
            {
                AppLog.Write("端口探测失败: " + ex.Message);
            }
            return 0;
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

            /* 探测超时 ≠ 服务没起来：CAD 忙（长命令 / worker 轮换）时 ping 会慢，
               托盘侧 HTTP 超时也会到。只要之前已经是 Running 就保持 Running，
               否则状态行会在「运行中 / 启动中」之间来回跳（真机踩过）。 */
            if (health != null && health.Timeout && _state == ServerState.Running)
            {
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
                // CWD 不要设在 npm 包目录里：Windows 把「进程的当前目录」也算作占用，
                // 服务一跑起来 `node_modules\@atlisp\mcp` 就改不了名，升级时 npm 报
                // EBUSY（npm 替换全局包的做法是把包目录改名成 .mcp-XXXXXX）。
                // 脚本路径是绝对的（info.ScriptPath），服务端也不按 CWD 找资源，
                // 用数据目录当工作目录不影响任何查找，还方便用户在这里找到临时文件。
                try
                {
                    Directory.CreateDirectory(Paths.DataDir);
                    startInfo.WorkingDirectory = Paths.DataDir;
                }
                catch (Exception ex)
                {
                    AppLog.Write("设置服务工作目录失败: " + ex.Message);
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
            int pid = PortInspector.FindListenerPid(port);
            if (pid > 0 && IsNodeProcess(pid)) return pid;
            return 0;
        }

        private static void KillProcess(int pid)
        {
            ProcessKiller.KillTree(pid);
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
    /// 托盘更新交接：托盘**不下载、不替换自己**。
    ///
    /// 升级 @lisp/mcp 后发现新版本的托盘与当前不同，就启动 `atlisp-tray`
    /// （Node 脚本，无自建 PE）并退出；由启动器等本进程退出后下载/校验新 exe，
    /// 再重新拉起托盘。
    ///
    /// 这样交付物里不再有 `AtlispUpdater.exe`，也没有「运行中的程序覆盖自身」
    /// 这种最像 dropper 的行为——它是 Defender 云端 ML 判
    /// `Trojan:Win32/Wacatac.!ml` 的高权重特征。整个过程不生成 .cmd/.bat。
    /// </summary>
    internal static class TraySelfUpdate
    {
        /// <summary>清掉旧版本留下的更新脚本与暂存副本（不再使用的可疑样本）。</summary>
        public static void CleanupLegacyScript()
        {
            try
            {
                string legacy = Path.Combine(Paths.DataDir, "update-tray.cmd");
                if (File.Exists(legacy)) File.Delete(legacy);
            }
            catch (Exception ex)
            {
                AppLog.Write("清理旧更新脚本失败: " + ex.Message);
            }
            try
            {
                string staged = Path.Combine(
                    Path.GetDirectoryName(Application.ExecutablePath) ?? "",
                    ".AtlispTray.update.exe");
                if (File.Exists(staged)) File.Delete(staged);
            }
            catch (Exception ex)
            {
                AppLog.Write("清理旧暂存文件失败: " + ex.Message);
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

    /// <summary>
    /// Python 环境快照（知识库是 Python 包，没 Python 就装不了）。
    /// 与 ServerInfo 分开：Node/CAD 与 Python 是两条独立的依赖链。
    /// </summary>
    internal sealed class PythonInfo
    {
        public string PythonPath;
        public string Version;
        public string PipVersion;
        public string PackageVersion;
        public string Error;

        public bool HasPython
        {
            get { return !string.IsNullOrEmpty(PythonPath); }
        }

        public bool HasPackage
        {
            get { return !string.IsNullOrEmpty(PackageVersion); }
        }

        public bool HasPip
        {
            get { return !string.IsNullOrEmpty(PipVersion); }
        }

        public string RuntimeText
        {
            get
            {
                if (!HasPython) return "运行环境：未检测到 Python 3.10+（请自行安装）";
                string text = "运行环境：Python " + (Version ?? "?");
                text += " · 本机包 " + (HasPackage ? "v" + PackageVersion : "未安装");
                if (!HasPip) text += " · pip 不可用";
                return text;
            }
        }
    }

    internal static class PythonLocator
    {
        private static readonly object Sync = new object();
        private static PythonInfo _cached;
        private static DateTime _cachedAt = DateTime.MinValue;

        public static void Invalidate()
        {
            lock (Sync)
            {
                _cached = null;
                _cachedAt = DateTime.MinValue;
            }
        }

        public static PythonInfo Resolve(TrayConfig config, bool force)
        {
            lock (Sync)
            {
                if (!force && _cached != null &&
                    (DateTime.UtcNow - _cachedAt).TotalSeconds < 60)
                {
                    return _cached;
                }
            }
            PythonInfo info = Detect(config);
            lock (Sync)
            {
                _cached = info;
                _cachedAt = DateTime.UtcNow;
            }
            return info;
        }

        private static PythonInfo Detect(TrayConfig config)
        {
            PythonInfo info = new PythonInfo();
            List<string> candidates = new List<string>();
            if (!string.IsNullOrEmpty(config.PythonPath)) candidates.Add(config.PythonPath);
            candidates.Add(Path.Combine(Paths.PythonDir, "python.exe"));

            string fromPath = ProcessRunner.Where("python.exe");
            if (!string.IsNullOrEmpty(fromPath)) candidates.Add(fromPath);
            string fromPath3 = ProcessRunner.Where("python3.exe");
            if (!string.IsNullOrEmpty(fromPath3)) candidates.Add(fromPath3);

            // py 启动器：绕过 Windows Store 的 python.exe 占位符（那个只会弹商店）
            string launcher = ProcessRunner.Where("py.exe");
            if (!string.IsNullOrEmpty(launcher))
            {
                int code;
                string output = ProcessRunner.Run(launcher,
                    "-3 -c \"import sys;print(sys.executable)\"", 8000, out code, Encoding.UTF8);
                if (code == 0)
                {
                    string[] lines = output.Split(
                        new char[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
                    for (int i = 0; i < lines.Length; i++)
                    {
                        string line = lines[i].Trim();
                        if (line.Length > 0 && File.Exists(line)) candidates.Add(line);
                    }
                }
            }

            for (int i = 0; i < candidates.Count; i++)
            {
                string candidate = candidates[i];
                if (string.IsNullOrEmpty(candidate) || !File.Exists(candidate)) continue;
                string version = ProbeVersion(candidate);
                if (version == null) continue;
                info.PythonPath = candidate;
                info.Version = version;
                break;
            }

            if (!info.HasPython)
            {
                info.Error = "未检测到 Python 3.10+";
                return info;
            }

            int pipCode;
            string pipOutput = ProcessRunner.Run(info.PythonPath,
                "-m pip --version", 20000, out pipCode, Encoding.UTF8);
            if (pipCode == 0)
            {
                string first = FirstLine(pipOutput);
                if (!string.IsNullOrEmpty(first)) info.PipVersion = first;
            }

            int pkgCode;
            string pkgOutput = ProcessRunner.Run(info.PythonPath,
                "-c \"import importlib.metadata as m;print(m.version('atlisp-dwg-kb'))\"",
                20000, out pkgCode, Encoding.UTF8);
            if (pkgCode == 0)
            {
                string version = FirstLine(pkgOutput);
                if (!string.IsNullOrEmpty(version) &&
                    version.IndexOf("Traceback", StringComparison.Ordinal) < 0)
                {
                    info.PackageVersion = version.Trim();
                }
            }
            return info;
        }

        /// <summary>返回 "3.12.8"；版本 &lt; 3.10、非 Python、或超时返回 null。</summary>
        private static string ProbeVersion(string pythonPath)
        {
            int code;
            string output = ProcessRunner.Run(pythonPath,
                "-c \"import sys;print('%d.%d.%d' % sys.version_info[:3])\"",
                10000, out code, Encoding.UTF8);
            if (code != 0) return null;
            string version = FirstLine(output);
            if (string.IsNullOrEmpty(version)) return null;
            string[] parts = version.Split('.');
            int major, minor;
            if (parts.Length < 2) return null;
            if (!int.TryParse(parts[0], out major)) return null;
            if (!int.TryParse(parts[1], out minor)) return null;
            if (major < 3 || (major == 3 && minor < 10)) return null;
            return version.Trim();
        }

        private static string FirstLine(string text)
        {
            if (string.IsNullOrEmpty(text)) return null;
            string[] lines = text.Split(new char[] { '\r', '\n' },
                StringSplitOptions.RemoveEmptyEntries);
            for (int i = 0; i < lines.Length; i++)
            {
                string line = lines[i].Trim();
                if (line.Length > 0) return line;
            }
            return null;
        }
    }

    /// <summary>
    /// 本地知识库服务（atlisp-dwg-kb serve）的启动/停止。
    /// 只管理「托盘自己启动的」进程：PID 记在 dwgkb.pid，别人手动起的服务不会被误杀。
    /// </summary>
    internal static class DwgKbServer
    {
        private static Process _process;

        public static bool IsLocalUrl(string url)
        {
            try
            {
                Uri uri;
                if (!Uri.TryCreate(url, UriKind.Absolute, out uri)) return false;
                string host = uri.Host ?? "";
                return host.Equals("localhost", StringComparison.OrdinalIgnoreCase) ||
                    host == "127.0.0.1" || host == "::1" || host == "[::1]";
            }
            catch
            {
                return false;
            }
        }

        public static int PortOf(string url, int fallback)
        {
            try
            {
                Uri uri;
                if (Uri.TryCreate(url, UriKind.Absolute, out uri) && uri.Port > 0) return uri.Port;
            }
            catch { }
            return fallback;
        }

        /// <summary>loopback 只绑本机；配了局域网地址说明希望被外部访问，绑 0.0.0.0。</summary>
        public static string BindHost(string url)
        {
            return IsLocalUrl(url) ? "127.0.0.1" : "0.0.0.0";
        }

        public static bool IsPortListening(int port)
        {
            try
            {
                using (System.Net.Sockets.TcpClient client = new System.Net.Sockets.TcpClient())
                {
                    IAsyncResult ar = client.BeginConnect("127.0.0.1", port, null, null);
                    if (!ar.AsyncWaitHandle.WaitOne(800)) return false;
                    client.EndConnect(ar);
                    return true;
                }
            }
            catch
            {
                return false;
            }
        }

        public static int ReadPid()
        {
            try
            {
                if (!File.Exists(Paths.DwgKbPidPath)) return 0;
                int pid;
                string text = File.ReadAllText(Paths.DwgKbPidPath).Trim();
                return int.TryParse(text, out pid) ? pid : 0;
            }
            catch
            {
                return 0;
            }
        }

        /// <summary>托盘启动的进程是否还活着（用来决定「停止」是否可用）。</summary>
        public static bool IsRunning()
        {
            int pid = ReadPid();
            if (pid <= 0) return false;
            try
            {
                Process process = Process.GetProcessById(pid);
                return !process.HasExited;
            }
            catch
            {
                return false;
            }
        }

        /// <summary>
        /// 找监听指定端口的本机进程（TCP LISTENING）。不依赖 pid 文件，
        /// 用于管理「手动/计划任务启动、托盘没有记录」的知识库服务。
        /// </summary>
        public static int FindListener(int port, out string imageName)
        {
            imageName = null;
            int pid = PortInspector.FindListenerPid(port);
            if (pid <= 0) return 0;
            try
            {
                Process process = Process.GetProcessById(pid);
                imageName = process.ProcessName;
            }
            catch
            {
                imageName = null;
            }
            return pid;
        }

        /// <summary>只允许停止看起来像知识库的进程，避免误杀占用同一端口的其他程序。</summary>
        public static bool IsKnowledgeBaseProcess(string imageName)
        {
            if (string.IsNullOrEmpty(imageName)) return false;
            string name = imageName.ToLowerInvariant();
            return name == "python" || name == "pythonw" || name == "python3" ||
                name.IndexOf("atlisp-dwg-kb", StringComparison.Ordinal) >= 0 ||
                name.IndexOf("atlisp_dwg_kb", StringComparison.Ordinal) >= 0;
        }

        /// <summary>
        /// 按端口停止本机知识库进程（用于不是托盘启动、没有 pid 记录的实例）。
        /// 只杀 python 系进程；端口被其他程序占用时拒绝操作。
        /// </summary>
        public static bool StopListener(int port, out string error)
        {
            error = null;
            string image;
            int pid = FindListener(port, out image);
            if (pid <= 0)
            {
                error = "端口 " + port + " 上没有找到监听进程。";
                return false;
            }
            if (!IsKnowledgeBaseProcess(image))
            {
                error = "端口 " + port + " 被 " + (image ?? "未知进程") +
                    "（PID " + pid + "）占用，不像是知识库服务，已取消。";
                return false;
            }
            try
            {
                Process process = Process.GetProcessById(pid);
                if (!process.HasExited) process.Kill();
            }
            catch (Exception ex)
            {
                error = "停止 PID " + pid + " 失败：" + ex.Message +
                    "\r\n如果它由 Windows 服务/系统服务启动，请用服务管理器停止。";
                return false;
            }

            for (int i = 0; i < 30 && IsPortListening(port); i++)
            {
                Thread.Sleep(100);
            }
            try { File.Delete(Paths.DwgKbPidPath); } catch { }
            AppLog.Write("dwg-kb: stopped external listener pid=" + pid + " port=" + port);
            return true;
        }

        public static Process Start(PythonInfo info, string url, out string error)
        {
            error = null;
            try
            {
                int port = PortOf(url, 8322);
                string arguments = "-m atlisp_dwg_kb.cli serve --host " + BindHost(url) +
                    " --port " + port + " --no-browser";

                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = info.PythonPath;
                psi.Arguments = arguments;
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.RedirectStandardOutput = true;
                psi.RedirectStandardError = true;
                psi.StandardOutputEncoding = Encoding.UTF8;
                psi.StandardErrorEncoding = Encoding.UTF8;
                // 不设置的话中文日志按系统代码页输出，写进 UTF-8 日志会乱码
                psi.EnvironmentVariables["PYTHONIOENCODING"] = "utf-8";
                psi.EnvironmentVariables["PYTHONUNBUFFERED"] = "1";

                Process process = new Process();
                process.StartInfo = psi;

                // 子进程输出必须持续读走：管道写满后 Python 会卡在 print 上
                string logFile = Path.Combine(Paths.LogDir,
                    "dwgkb-" + DateTime.Now.ToString("yyyyMMdd-HHmmss") + ".log");
                StreamWriter writer = null;
                try
                {
                    Directory.CreateDirectory(Paths.LogDir);
                    writer = new StreamWriter(new FileStream(logFile, FileMode.Append,
                        FileAccess.Write, FileShare.ReadWrite), new UTF8Encoding(false));
                    writer.AutoFlush = true;
                }
                catch { }
                StreamWriter log = writer;
                DataReceivedEventHandler onData = delegate(object sender, DataReceivedEventArgs e)
                {
                    if (e.Data == null || log == null) return;
                    try { lock (log) log.WriteLine(e.Data); } catch { }
                };
                process.OutputDataReceived += onData;
                process.ErrorDataReceived += onData;

                process.Start();
                process.BeginOutputReadLine();
                process.BeginErrorReadLine();

                Directory.CreateDirectory(Paths.DataDir);
                File.WriteAllText(Paths.DwgKbPidPath, process.Id.ToString(),
                    new UTF8Encoding(false));
                _process = process;
                AppLog.Write("dwg-kb: started pid=" + process.Id + " " + arguments +
                    " log=" + logFile);
                return process;
            }
            catch (Exception ex)
            {
                error = ex.Message;
                return null;
            }
        }

        public static bool Stop(out string error)
        {
            error = null;
            int pid = ReadPid();
            if (pid <= 0)
            {
                error = "没有找到托盘启动的知识库进程。\r\n" +
                    "如果服务是手动或系统服务方式启动的，请用对应方式停止。";
                return false;
            }
            try
            {
                Process process = Process.GetProcessById(pid);
                if (!process.HasExited) process.Kill();
            }
            catch (ArgumentException)
            {
                // 进程已退出：清掉 pid 文件即可
            }
            catch (Exception ex)
            {
                error = ex.Message;
                return false;
            }
            try { File.Delete(Paths.DwgKbPidPath); } catch { }
            _process = null;
            AppLog.Write("dwg-kb: stopped pid=" + pid);
            return true;
        }
    }

    /// <summary>
    /// 图纸知识库（atlisp-dwg-kb）状态快照。与 HealthSnapshot 分开放：知识库是
    /// 独立的 Python 服务（默认 :8322），它的存活与 MCP/CAD 无关——MCP 正常而
    /// 知识库没起是常见状态，不能混进 CAD 的健康判定里。
    /// </summary>
    internal sealed class DwgKbStatus
    {
        public bool Reachable;
        public string Version;
        public long Triples;
        public bool RdfLoaded;
        public string Error;
    }

    internal static class DwgKbClient
    {
        /// <summary>GET /health。不可达时 Reachable=false，不抛异常。</summary>
        public static DwgKbStatus Check(string baseUrl, int timeoutMs)
        {
            DwgKbStatus status = new DwgKbStatus();
            try
            {
                HttpWebRequest request = (HttpWebRequest)WebRequest.Create(Trim(baseUrl) + "/health");
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
                    Parse(reader.ReadToEnd(), status);
                }
                status.Reachable = true;
            }
            catch (Exception ex)
            {
                status.Reachable = false;
                status.Error = ex.Message;
            }
            return status;
        }

        /// <summary>
        /// POST /build：服务端后台重建索引（返回 run_id 之类的 JSON 文本）。
        /// 只是「提交任务」，不等待重建完成——全量 5.5M 三元组要几分钟，
        /// 在托盘里同步等会把菜单卡死。
        /// </summary>
        public static string Build(string baseUrl, string apiKey, int timeoutMs)
        {
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create(Trim(baseUrl) + "/build");
            request.Method = "POST";
            request.Proxy = null;
            request.KeepAlive = false;
            request.Timeout = timeoutMs;
            request.ReadWriteTimeout = timeoutMs;
            request.ContentType = "application/json";
            request.UserAgent = "atlisp-tray/" + Program.AppVersion;
            if (!string.IsNullOrEmpty(apiKey))
            {
                request.Headers["X-API-Key"] = apiKey;
            }
            byte[] payload = Encoding.UTF8.GetBytes("{}");
            request.ContentLength = payload.Length;
            using (Stream body = request.GetRequestStream())
            {
                body.Write(payload, 0, payload.Length);
            }
            using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
            using (Stream stream = response.GetResponseStream())
            using (StreamReader reader = new StreamReader(stream, Encoding.UTF8))
            {
                return reader.ReadToEnd();
            }
        }

        private static string Trim(string url)
        {
            return (url ?? "").Trim().TrimEnd('/');
        }

        private static void Parse(string json, DwgKbStatus status)
        {
            try
            {
                JavaScriptSerializer serializer = new JavaScriptSerializer();
                Dictionary<string, object> root =
                    serializer.DeserializeObject(json) as Dictionary<string, object>;
                if (root == null) return;
                object value;
                if (root.TryGetValue("version", out value) && value != null)
                {
                    status.Version = Convert.ToString(value);
                }
                if (root.TryGetValue("triples", out value) && value != null)
                {
                    long parsed;
                    if (long.TryParse(Convert.ToString(value), out parsed)) status.Triples = parsed;
                }
                if (root.TryGetValue("rdf_loaded", out value) && value is bool)
                {
                    status.RdfLoaded = (bool)value;
                }
            }
            catch
            {
                // 解析失败只影响状态文案，不影响可用性判断
            }
        }
    }

    /// <summary>
    /// 知识库地址 / API Key 设置对话框（托盘不依赖 InputBox，自绘一个最小窗体）。
    /// </summary>
    internal sealed class DwgKbSettingsForm : Form
    {
        private readonly TextBox _url;
        private readonly TextBox _key;
        private readonly Label _testResult;

        public string UrlValue
        {
            get { return _url.Text.Trim(); }
        }

        public string ApiKeyValue
        {
            get { return _key.Text.Trim(); }
        }

        public DwgKbSettingsForm(string url, string apiKey)
        {
            Text = "@lisp MCP 托盘 - 知识库设置";
            Width = 520;
            Height = 220;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            StartPosition = FormStartPosition.CenterParent;
            ShowInTaskbar = false;
            Icon = IconFactory.Create(ServerState.Starting);

            Label urlLabel = new Label();
            urlLabel.Text = "知识库地址";
            urlLabel.Location = new Point(16, 18);
            urlLabel.Width = 460;

            _url = new TextBox();
            _url.Location = new Point(18, 40);
            _url.Width = 460;
            _url.Text = url ?? "";

            Label keyLabel = new Label();
            keyLabel.Text = "API Key（知识库设置了 DWG_KB_API_KEY 时必填，可留空）";
            keyLabel.Location = new Point(16, 72);
            keyLabel.Width = 460;

            _key = new TextBox();
            _key.Location = new Point(18, 94);
            _key.Width = 460;
            _key.UseSystemPasswordChar = true;
            _key.Text = apiKey ?? "";

            _testResult = new Label();
            _testResult.Text = "";
            _testResult.Location = new Point(16, 124);
            _testResult.Width = 470;
            _testResult.Height = 24;
            _testResult.ForeColor = Color.DimGray;

            Button testButton = new Button();
            testButton.Text = "测试连接";
            testButton.Location = new Point(18, 152);
            testButton.Width = 96;
            testButton.Height = 28;
            testButton.Click += delegate { TestConnection(); };

            Button okButton = new Button();
            okButton.Text = "保存";
            okButton.Location = new Point(296, 152);
            okButton.Width = 84;
            okButton.Height = 28;
            okButton.DialogResult = DialogResult.OK;

            Button cancelButton = new Button();
            cancelButton.Text = "取消";
            cancelButton.Location = new Point(394, 152);
            cancelButton.Width = 84;
            cancelButton.Height = 28;
            cancelButton.DialogResult = DialogResult.Cancel;

            Controls.Add(urlLabel);
            Controls.Add(_url);
            Controls.Add(keyLabel);
            Controls.Add(_key);
            Controls.Add(_testResult);
            Controls.Add(testButton);
            Controls.Add(okButton);
            Controls.Add(cancelButton);
            AcceptButton = okButton;
            CancelButton = cancelButton;
        }

        private void TestConnection()
        {
            string url = _url.Text.Trim();
            if (url.Length == 0)
            {
                _testResult.Text = "请填写地址。";
                return;
            }
            if (!url.StartsWith("http://", StringComparison.OrdinalIgnoreCase) &&
                !url.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            {
                url = "http://" + url;
            }
            DwgKbStatus status = DwgKbClient.Check(url, 2500);
            if (status.Reachable)
            {
                _testResult.Text = "连接成功：v" + (status.Version ?? "?") +
                    " · " + (status.Triples > 0 ? status.Triples.ToString("N0") + " 三元组" : "已加载");
                _testResult.ForeColor = Color.ForestGreen;
            }
            else
            {
                _testResult.Text = "不可达：" + status.Error;
                _testResult.ForeColor = Color.Firebrick;
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
        private readonly ToolStripMenuItem _diagItem;

        // 图纸知识库（atlisp-dwg-kb）子菜单。状态在后台线程检测、UI 线程渲染，
        // 与 HealthMonitor 的分工一致：菜单永远不因为知识库慢而卡住。
        private readonly ToolStripMenuItem _dwgKbMenu;
        private readonly ToolStripMenuItem _dwgKbStatusItem;
        private readonly ToolStripMenuItem _dwgKbRuntimeItem;
        private readonly ToolStripMenuItem _dwgKbVersionHintItem;
        private readonly ToolStripMenuItem _dwgKbOpenItem;
        private readonly ToolStripMenuItem _dwgKbRefreshItem;
        private readonly ToolStripMenuItem _dwgKbInstallItem;
        private readonly ToolStripMenuItem _dwgKbStartItem;
        private readonly ToolStripMenuItem _dwgKbStopItem;
        private readonly ToolStripMenuItem _dwgKbRestartItem;
        private readonly ToolStripMenuItem _dwgKbAutoStartItem;
        private readonly ToolStripMenuItem _dwgKbRebuildItem;
        private readonly ToolStripMenuItem _dwgKbConfigItem;
        private readonly object _dwgKbLock = new object();
        private DwgKbStatus _dwgKbStatus;
        private PythonInfo _dwgKbPython;
        private DateTime _dwgKbCheckedAt = DateTime.MinValue;
        private bool _dwgKbBusy;
        private bool _dwgKbBuilding;
        private bool _dwgKbAutoStartAttempted;
        // 后台线程不能直接碰 NotifyIcon：把气泡请求挂在字段上，由 UI 定时器展示。
        private bool _dwgKbBalloonPending;
        private string _dwgKbBalloonTitle;
        private string _dwgKbBalloonText;
        private ToolTipIcon _dwgKbBalloonIcon;

        private Icon _currentIcon;
        private ServerState _lastState = ServerState.Stopped;
        private bool _firstTick = true;
        private bool _suppressNotifications;
        private bool _startupUpdateChecked;
        // 首次启动只尝试拉起一次服务（失败留给用户手动点）
        private bool _autoStartAttempted;
        private DateTime _createdAt = DateTime.UtcNow;
        // 服务异常退出后自动拉起（退避 1/2/5/10/30 分钟，连续 5 次失败后停手）
        private const int ServerRestartMaxFailures = 5;
        private DateTime _serverRestartRetryAt = DateTime.MinValue;
        private int _serverRestartFailures;
        // 用户点过「停止知识库服务」后不再自动拉起，直到手动启动或下次开托盘
        private bool _dwgKbUserStopped;
        private DateTime _dwgKbRestartRetryAt = DateTime.MinValue;
        private int _dwgKbRestartFailures;
        // 本机包升级后旧服务仍在跑：自动重启一次让新版本生效（带退避，最多 3 次）
        private DateTime _dwgKbSyncRetryAt = DateTime.MinValue;
        private int _dwgKbSyncFailures;
        private readonly bool _startServerOnLaunch;
        private string _latestVersion;
        private string _lastNotifiedError;
        private bool _updateChecking;
        private bool _updateBalloonPending;
        private string _updateBalloonTitle;
        private string _updateBalloonText;
        private ToolTipIcon _updateBalloonIcon;
        private int _activePort;

        public TrayApplication(bool silent, bool startServerOnLaunch)
        {
            _silent = silent;
            _startServerOnLaunch = startServerOnLaunch;
            _config = TrayConfig.Load();
            _activePort = _config.Port;
            ServerLocator.Resolve(_config, true);
            _health = new HealthMonitor(_config.Port, _config.HealthyPollSeconds * 1000);
            _health.CheckNow();
            _health.Start();
            _server = new ServerManager(_config);

            _menu = new ContextMenuStrip();
            _menu.ShowImageMargin = false;
            _menu.ShowCheckMargin = false;
            _menu.ShowItemToolTips = true;
            _menu.Opening += OnMenuOpening;

            _headerItem = new ToolStripMenuItem("@lisp MCP Server");
            _headerItem.Enabled = false;
            _headerItem.Font = new Font(_menu.Font, FontStyle.Bold);

            _stateItem = new ToolStripMenuItem("状态：正在检测…");
            _stateItem.Enabled = false;

            _startItem = new ToolStripMenuItem("启动 MCP 服务");
            _startItem.Click += delegate { StartServer(); };

            _stopItem = new ToolStripMenuItem("停止 MCP 服务");
            _stopItem.Click += delegate { StopServer(); };

            _restartItem = new ToolStripMenuItem("重启 MCP 服务");
            _restartItem.Click += delegate { RestartServer(); };

            _panelItem = new ToolStripMenuItem("打开调试面板");
            _panelItem.Click += delegate { OpenUrl("http://127.0.0.1:" + _config.Port + "/debug"); };

            _docsItem = new ToolStripMenuItem("API 文档");
            _docsItem.Click += delegate { OpenUrl("http://127.0.0.1:" + _config.Port + "/api/docs"); };

            _playgroundItem = new ToolStripMenuItem("Playground（在线试用）");
            _playgroundItem.Click += delegate { OpenUrl("http://127.0.0.1:" + _config.Port + "/playground"); };

            _logItem = new ToolStripMenuItem("查看服务器日志");
            _logItem.Click += delegate { OpenServerLog(); };

            _logDirItem = new ToolStripMenuItem("打开日志目录");
            _logDirItem.Click += delegate { OpenPath(Paths.LogDir); };

            _checkItem = new ToolStripMenuItem("检查更新");
            _checkItem.ToolTipText = "对比 npm 上的最新版本，不修改任何文件";
            _checkItem.Click += delegate { CheckUpdate(false); };

            _upgradeItem = new ToolStripMenuItem("如何升级…");
            _upgradeItem.Click += delegate { ShowUpgradeHelp(); };

            _installItem = new ToolStripMenuItem("如何安装 @lisp MCP Server…");
            _installItem.Click += delegate { ShowInstallServerHelp(); };

            _nodeItem = new ToolStripMenuItem("如何安装 Node.js…");
            _nodeItem.ToolTipText = "托盘不代下载、不代执行安装包，只给命令提示";
            _nodeItem.Click += delegate { ShowInstallNodeHelp(); };

            _trayAutoItem = new ToolStripMenuItem("随 Windows 启动托盘");
            _trayAutoItem.ToolTipText = "开机后自动启动托盘，由托盘拉起各服务";
            _trayAutoItem.Click += delegate { ToggleTrayAutostart(); };

            _serverAutoItem = new ToolStripMenuItem("启动托盘时自动启动 MCP");
            _serverAutoItem.ToolTipText = "关闭后托盘只做管理，不主动启动 MCP 服务";
            _serverAutoItem.Click += delegate { ToggleServerAutostart(); };

            _dwgKbStatusItem = new ToolStripMenuItem("图纸知识库：检测中…");
            _dwgKbStatusItem.Enabled = false;

            _dwgKbRuntimeItem = new ToolStripMenuItem("运行环境：检测中…");
            _dwgKbRuntimeItem.Enabled = false;

            _dwgKbVersionHintItem = new ToolStripMenuItem("本机与服务版本不一致");
            _dwgKbVersionHintItem.Enabled = false;
            _dwgKbVersionHintItem.Visible = false;

            _dwgKbOpenItem = new ToolStripMenuItem("打开图纸知识库");
            _dwgKbOpenItem.ToolTipText = "在浏览器里打开知识库的查询界面";
            _dwgKbOpenItem.Click += delegate { OpenDwgKbUi(); };

            _dwgKbRefreshItem = new ToolStripMenuItem("重新检测连接");
            _dwgKbRefreshItem.Click += delegate { RefreshDwgKbStatus(true); };

            _dwgKbStartItem = new ToolStripMenuItem("启动本地知识库服务");
            _dwgKbStartItem.Click += delegate { StartDwgKbService(); };

            _dwgKbStopItem = new ToolStripMenuItem("停止本地知识库服务");
            _dwgKbStopItem.ToolTipText = "托盘启动的直接停止；外部启动的会先确认再按端口停止";
            _dwgKbStopItem.Click += delegate { StopDwgKbService(); };

            _dwgKbRestartItem = new ToolStripMenuItem("重启本地知识库服务");
            _dwgKbRestartItem.ToolTipText = "停止后用本机 Python 重新启动，升级包后可用它让新版本生效";
            _dwgKbRestartItem.Click += delegate { RestartDwgKbService(); };

            _dwgKbAutoStartItem = new ToolStripMenuItem("随托盘自动启动");
            _dwgKbAutoStartItem.ToolTipText = "已装好 atlisp-dwg-kb 时，托盘启动后拉起本地服务";
            _dwgKbAutoStartItem.Click += delegate { ToggleDwgKbAutoStart(); };

            _dwgKbInstallItem = new ToolStripMenuItem("如何安装 / 升级知识库…");
            _dwgKbInstallItem.ToolTipText = "显示 pip 命令（托盘不代下载、不代执行）";
            _dwgKbInstallItem.Click += delegate { ShowInstallDwgKbHelp(); };

            _dwgKbRebuildItem = new ToolStripMenuItem("重建索引…");
            _dwgKbRebuildItem.ToolTipText = "在知识库服务器上重建索引（管理员操作）";
            _dwgKbRebuildItem.Click += delegate { RebuildDwgKb(); };

            _dwgKbConfigItem = new ToolStripMenuItem("设置地址与 API Key…");
            _dwgKbConfigItem.Click += delegate { ConfigureDwgKb(); };

            _diagItem = new ToolStripMenuItem("环境诊断…");
            _diagItem.Click += delegate { ShowDiagnostics(); };

            ToolStripMenuItem reloadItem = new ToolStripMenuItem("重新加载配置");
            reloadItem.Click += delegate { ReloadConfig(); };

            ToolStripMenuItem configItem = new ToolStripMenuItem("打开配置文件");
            configItem.Click += delegate { OpenPath(Paths.TrayConfigPath); };

            ToolStripMenuItem aboutItem = new ToolStripMenuItem("关于 @lisp MCP…");
            aboutItem.Click += delegate { ShowAbout(); };

            ToolStripMenuItem exitItem = new ToolStripMenuItem("退出托盘");
            exitItem.Click += delegate { ExitApplication(); };

            ToolStripMenuItem agentChatItem = new ToolStripMenuItem("打开 Agent Chat");
            agentChatItem.ToolTipText = "在浏览器打开 https://atlisp.cn/agent/chat";
            agentChatItem.Click += delegate { OpenUrl(AgentChatUrl); };

            _logsMenu = CreateSubmenu("日志与诊断");
            _logsMenu.DropDownItems.Add(_logItem);
            _logsMenu.DropDownItems.Add(_logDirItem);
            _logsMenu.DropDownItems.Add(new ToolStripSeparator());
            _logsMenu.DropDownItems.Add(_panelItem);
            _logsMenu.DropDownItems.Add(_docsItem);
            _logsMenu.DropDownItems.Add(_playgroundItem);
            _logsMenu.DropDownItems.Add(new ToolStripSeparator());
            _logsMenu.DropDownItems.Add(_diagItem);

            _dwgKbMenu = CreateSubmenu("图纸知识库");
            _dwgKbMenu.DropDownItems.Add(_dwgKbRuntimeItem);
            _dwgKbMenu.DropDownItems.Add(_dwgKbVersionHintItem);
            _dwgKbMenu.DropDownItems.Add(new ToolStripSeparator());
            _dwgKbMenu.DropDownItems.Add(_dwgKbOpenItem);
            _dwgKbMenu.DropDownItems.Add(_dwgKbStartItem);
            _dwgKbMenu.DropDownItems.Add(_dwgKbStopItem);
            _dwgKbMenu.DropDownItems.Add(_dwgKbRestartItem);
            _dwgKbMenu.DropDownItems.Add(_dwgKbRefreshItem);
            _dwgKbMenu.DropDownItems.Add(new ToolStripSeparator());
            _dwgKbMenu.DropDownItems.Add(_dwgKbInstallItem);
            _dwgKbMenu.DropDownItems.Add(_dwgKbRebuildItem);
            _dwgKbMenu.DropDownItems.Add(new ToolStripSeparator());
            _dwgKbMenu.DropDownItems.Add(_dwgKbAutoStartItem);
            _dwgKbMenu.DropDownItems.Add(new ToolStripSeparator());
            _dwgKbMenu.DropDownItems.Add(_dwgKbConfigItem);

            _updateMenu = CreateSubmenu("更新与安装");
            _updateMenu.DropDownItems.Add(_checkItem);
            _updateMenu.DropDownItems.Add(_upgradeItem);
            _updateMenu.DropDownItems.Add(new ToolStripSeparator());
            _updateMenu.DropDownItems.Add(_installItem);
            _updateMenu.DropDownItems.Add(_nodeItem);

            _settingsMenu = CreateSubmenu("设置");
            _settingsMenu.DropDownItems.Add(_trayAutoItem);
            _settingsMenu.DropDownItems.Add(_serverAutoItem);
            _settingsMenu.DropDownItems.Add(new ToolStripSeparator());
            _settingsMenu.DropDownItems.Add(reloadItem);
            _settingsMenu.DropDownItems.Add(configItem);

            // 顶层只放「一眼要看的状态」和「最常用的动作」，其余按用途收进子菜单：
            //   状态 3 行 → 打开对话 / 启停 / 重启 → 知识库 / 日志 / 设置 / 更新 → 关于 / 退出
            _menu.Items.Add(_headerItem);
            _menu.Items.Add(_stateItem);
            _menu.Items.Add(_dwgKbStatusItem);
            _menu.Items.Add(new ToolStripSeparator());
            _menu.Items.Add(agentChatItem);
            _menu.Items.Add(_startItem);
            _menu.Items.Add(_stopItem);
            _menu.Items.Add(_restartItem);
            _menu.Items.Add(new ToolStripSeparator());
            _menu.Items.Add(_dwgKbMenu);
            _menu.Items.Add(_logsMenu);
            _menu.Items.Add(_settingsMenu);
            _menu.Items.Add(_updateMenu);
            _menu.Items.Add(new ToolStripSeparator());
            _menu.Items.Add(aboutItem);
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

            // 启动即探一次知识库：托盘起来时服务通常已经在跑，不必等用户点菜单
            RefreshDwgKbStatus(true);

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
                EnsureServerStartedOnLaunch();
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
                dropDown.ShowItemToolTips = true;
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
        /// 首次启动**先询问**是否加入 Windows 开机自启（HKCU\...\Run）。
        ///
        /// 以前是静默写入注册表——「未告知就设置开机自启」是杀软 ML 里权重很高的行为，
        /// 对一个图形化管理器来说也越权了。现在改为显式询问，默认按钮在「否」；
        /// 静默启动（--silent / 自更新重启）不询问也不写标记，留给下次交互启动。
        /// </summary>
        private void EnsureDefaultAutostart()
        {
            try
            {
                if (File.Exists(Paths.AutostartDefaultPath)) return;
                if (_silent) return;

                bool want = MessageBox.Show(
                    "是否让 @lisp MCP 托盘随 Windows 自动启动？\r\n\r\n" +
                    "选择「否」不影响使用，之后可以在右键菜单「随 Windows 启动托盘」里开启。",
                    "@lisp MCP 托盘",
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Question,
                    MessageBoxDefaultButton.Button2) == DialogResult.Yes;

                if (want && !AutostartHelper.IsEnabled())
                {
                    AutostartHelper.SetEnabled(true);
                }

                Directory.CreateDirectory(Paths.DataDir);
                File.WriteAllText(Paths.AutostartDefaultPath,
                    DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"), new UTF8Encoding(false));

                AppLog.Write(want
                    ? "首次启动：用户选择加入开机自启"
                    : "首次启动：用户未选择开机自启");
            }
            catch (Exception ex)
            {
                AppLog.Write("设置默认开机自启失败: " + ex.Message);
            }
        }

        private void OnUiTimer(object sender, EventArgs e)
        {
            try
            {
                UpdateUi();

                // 知识库重建结果由后台线程产生，气泡只能在这里（UI 线程）弹
                if (_dwgKbBalloonPending)
                {
                    _dwgKbBalloonPending = false;
                    Balloon(_dwgKbBalloonTitle, _dwgKbBalloonText, _dwgKbBalloonIcon);
                }

                // 后台线程查到的更新结果：在 UI 线程弹气泡
                if (_updateBalloonPending)
                {
                    _updateBalloonPending = false;
                    Balloon(_updateBalloonTitle, _updateBalloonText, _updateBalloonIcon);
                }

                // 知识库自动启动：等首轮环境检测稳定后再拉
                if (_config.DwgKbAutoStart && !_dwgKbAutoStartAttempted &&
                    (DateTime.UtcNow - _createdAt).TotalSeconds > 5 && !TaskBusy())
                {
                    EnsureDwgKbStartedOnLaunch();
                }

                if (_config.CheckUpdateOnStart && !_startupUpdateChecked &&
                    (DateTime.UtcNow - _createdAt).TotalSeconds > 20)
                {
                    _startupUpdateChecked = true;
                    CheckUpdate(true);
                }

                MaybeSyncDwgKbVersion();
                MaybeRestartServer();
                MaybeRestartDwgKbService();
            }
            catch (Exception ex)
            {
                AppLog.Write("UI 定时器异常: " + ex);
            }
        }

        private void OnMenuOpening(object sender, CancelEventArgs e)
        {
            RefreshDwgKbStatus(false);
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

            _headerItem.Text = "@lisp MCP 服务  " +
                (string.IsNullOrEmpty(info.Version) ? "(未安装)" : "v" + info.Version);

            string stateText = "MCP 服务：";
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
            bool busy = _dwgKbBuilding;
            bool updating = _updateChecking || busy;

            // 只显示当前能做的事：运行中给「停止/重启」，停止时给「启动」，
            // 避免菜单里同时出现一组互斥项还要用户自己判断哪个可用。
            _startItem.Visible = !running;
            _startItem.Enabled = !running && state != ServerState.Stopping && !busy;
            _stopItem.Visible = running;
            _stopItem.Enabled = running && !busy;
            _restartItem.Visible = running;
            _restartItem.Enabled = running && !busy;
            _panelItem.Enabled = state == ServerState.Running;
            _docsItem.Enabled = state == ServerState.Running;
            _playgroundItem.Enabled = state == ServerState.Running;

            _checkItem.Enabled = !updating;
            _upgradeItem.Enabled = !updating;
            _installItem.Enabled = !updating;
            _installItem.Text = info.IsInstalled
                ? "如何升级 @lisp MCP Server…"
                : "如何安装 @lisp MCP Server…";
            _nodeItem.Enabled = !updating;

            bool updateAvailable = !string.IsNullOrEmpty(_latestVersion) &&
                VersionUtil.IsNewer(_latestVersion, info.Version);
            if (updateAvailable)
            {
                _upgradeItem.Text = "有新版 v" + _latestVersion + "（如何升级…）";
                _updateMenu.Text = "更新与安装（有新版 v" + _latestVersion + "）";
            }
            else
            {
                _upgradeItem.Text = "如何升级…";
                _updateMenu.Text = "更新与安装";
            }

            _trayAutoItem.Checked = AutostartHelper.IsEnabled();
            _serverAutoItem.Checked = _config.AutoStartServer;

            _tray.Text = Truncate("@lisp MCP · " + StateText(state) + " · 端口 " + _config.Port, 63);

            UpdateDwgKbUi();
        }

        /// <summary>
        /// 知识库状态刷新（后台线程）。默认 10 秒内不重复探测：菜单一秒能被打开
        /// 好几次，每次都发 HTTP 会让右键菜单明显变慢。
        /// </summary>
        private void RefreshDwgKbStatus(bool force)
        {
            lock (_dwgKbLock)
            {
                if (_dwgKbBusy) return;
                if (!force && _dwgKbStatus != null &&
                    (DateTime.UtcNow - _dwgKbCheckedAt).TotalSeconds < 10) return;
                _dwgKbBusy = true;
            }

            string url = _config.DwgKbUrl;
            ThreadPool.QueueUserWorkItem(delegate
            {
                DwgKbStatus status = DwgKbClient.Check(url, 2500);
                // 同一轮顺带探测 Python/pip/知识库包：detect 要跑 2~3 个 python 子进程，
                // 放主线程会让右键菜单明显卡顿。
                PythonInfo python = null;
                try { python = PythonLocator.Resolve(_config, false); }
                catch { }

                // 服务版本与本机包版本不一致时强制重探一次 Python 环境：
                // PythonLocator 有 60 秒缓存，刚升级完可能还返回旧版本号，
                // 会让状态行（服务）与运行环境行（本机包）看起来自相矛盾。
                if (python != null && python.HasPackage && status.Reachable &&
                    DwgKbServer.IsLocalUrl(url) &&
                    !string.IsNullOrEmpty(status.Version) &&
                    !string.IsNullOrEmpty(python.PackageVersion) &&
                    !VersionsEqual(status.Version, python.PackageVersion))
                {
                    try
                    {
                        PythonLocator.Invalidate();
                        PythonInfo fresh = PythonLocator.Resolve(_config, true);
                        if (fresh != null && fresh.HasPackage) python = fresh;
                    }
                    catch
                    {
                        // 重探失败就沿用缓存值，只影响显示
                    }
                }
                lock (_dwgKbLock)
                {
                    _dwgKbStatus = status;
                    if (python != null) _dwgKbPython = python;
                    _dwgKbCheckedAt = DateTime.UtcNow;
                    _dwgKbBusy = false;
                }
            });
        }

        private void UpdateDwgKbUi()
        {
            DwgKbStatus status;
            PythonInfo python;
            lock (_dwgKbLock)
            {
                status = _dwgKbStatus;
                python = _dwgKbPython;
            }

            bool online = status != null && status.Reachable;
            bool local = DwgKbServer.IsLocalUrl(_config.DwgKbUrl);
            bool installed = python != null && python.HasPackage;
            bool ownedRunning = DwgKbServer.IsRunning();

            // 两个版本号来源不同，必须分开叫：
            //   服务版本 = /health 返回的、正在运行的进程版本
            //   本机版本 = 本机 Python 环境里 pip 装的版本
            // 二者不同通常意味着「升级了包但旧服务进程还在跑」或「连的是远程服务」。
            string serviceVersion = online ? (status.Version ?? "").Trim() : "";
            string localVersion = installed ? (python.PackageVersion ?? "").Trim() : "";
            bool mismatch = false;
            if (local && !string.IsNullOrEmpty(serviceVersion) && !string.IsNullOrEmpty(localVersion))
            {
                mismatch = !VersionsEqual(serviceVersion, localVersion);
            }

            if (status == null)
            {
                _dwgKbStatusItem.Text = "图纸知识库：检测中…";
            }
            else if (!status.Reachable)
            {
                _dwgKbStatusItem.Text = "图纸知识库：未连接";
            }
            else
            {
                string text = "图纸知识库：在线";
                if (serviceVersion.Length > 0) text += " · 服务 v" + serviceVersion;
                if (status.Triples > 0) text += " · " + FormatCount(status.Triples) + "条三元组";
                if (!status.RdfLoaded) text += " · 索引加载中";
                _dwgKbStatusItem.Text = text;
            }

            string tip = _config.DwgKbUrl;
            if (serviceVersion.Length > 0) tip += "\n服务版本：v" + serviceVersion;
            if (localVersion.Length > 0) tip += "\n本机版本：v" + localVersion;
            _dwgKbStatusItem.ToolTipText = tip;

            _dwgKbRuntimeItem.Text = python == null ? "运行环境：检测中…" : python.RuntimeText;
            if (mismatch)
            {
                bool localNewer = VersionUtil.IsNewer(localVersion, serviceVersion);
                if (ownedRunning && localNewer)
                {
                    _dwgKbVersionHintItem.Text = "服务 v" + serviceVersion +
                        " 落后于本机 v" + localVersion + "，自动重启服务中…";
                }
                else if (ownedRunning)
                {
                    _dwgKbVersionHintItem.Text = "服务 v" + serviceVersion +
                        " 比本机 v" + localVersion + " 新，可按菜单提示升级本机包";
                }
                else if (localNewer)
                {
                    _dwgKbVersionHintItem.Text = "服务 v" + serviceVersion +
                        " 落后于本机 v" + localVersion + "（外部服务，需手动重启）";
                }
                else
                {
                    _dwgKbVersionHintItem.Text = "本机 v" + localVersion +
                        " 落后于服务 v" + serviceVersion + "，可按菜单提示升级本机包";
                }
                _dwgKbVersionHintItem.Visible = true;
            }
            else if (!local)
            {
                _dwgKbVersionHintItem.Text = "远程服务，启动/停止请在服务器上操作";
                _dwgKbVersionHintItem.Visible = true;
            }
            else
            {
                _dwgKbVersionHintItem.Visible = false;
            }

            _dwgKbInstallItem.Enabled = !_dwgKbBuilding && !TaskBusy();
            _dwgKbInstallItem.Text = installed
                ? "如何升级知识库（当前 v" + localVersion + "）…"
                : "如何安装知识库…";

            _dwgKbOpenItem.Enabled = online;
            _dwgKbRebuildItem.Enabled = online && !_dwgKbBuilding;
            if (!local)
            {
                _dwgKbMenu.Text = online ? "图纸知识库（远程）" : "图纸知识库（远程，未连接）";
            }
            else
            {
                _dwgKbMenu.Text = online ? "图纸知识库" : "图纸知识库（未连接）";
            }

            // 启停只对「本机」有意义；停止对托盘自己启动和外部启动的本机实例都可用
            // （外部实例按端口找 PID，先确认再停）。远程服务不在这里管理。
            bool canManage = local && !_dwgKbBuilding && !TaskBusy();
            _dwgKbStartItem.Visible = local;
            _dwgKbStartItem.Enabled = canManage && installed && !online && !ownedRunning;
            _dwgKbStopItem.Visible = local;
            _dwgKbStopItem.Enabled = canManage && (ownedRunning || online);
            _dwgKbRestartItem.Visible = local;
            _dwgKbRestartItem.Enabled = canManage && installed && (ownedRunning || online);
            _dwgKbAutoStartItem.Checked = _config.DwgKbAutoStart;
            _dwgKbAutoStartItem.Enabled = local;
        }

        private void OpenDwgKbUi()
        {
            OpenUrl(_config.DwgKbUrl.TrimEnd('/') + "/ui");
        }

        /// <summary>
        /// 启动本地知识库服务：`python -m atlisp_dwg_kb.cli serve --host … --port …`
        /// 进程 PID 记进 dwgkb.pid，输出写到 logs/dwgkb-*.log。
        /// </summary>
        private void StartDwgKbService(bool quiet = false)
        {
            PythonInfo info = PythonLocator.Resolve(_config, false);
            lock (_dwgKbLock) { _dwgKbPython = info; }
            if (!info.HasPackage)
            {
                if (!quiet)
                {
                    Balloon("尚未安装知识库",
                        "先用菜单「图纸知识库 → 如何安装 / 升级知识库…」按提示安装 atlisp-dwg-kb。",
                        ToolTipIcon.Info);
                }
                return;
            }

            int port = DwgKbServer.PortOf(_config.DwgKbUrl, 8322);
            if (DwgKbServer.IsPortListening(port))
            {
                if (!quiet)
                {
                    Balloon("知识库已在运行", "端口 " + port + " 已有服务在监听。", ToolTipIcon.Info);
                }
                RefreshDwgKbStatus(true);
                return;
            }

            string error;
            Process process = DwgKbServer.Start(info, _config.DwgKbUrl, out error);
            if (process == null)
            {
                if (quiet)
                {
                    AppLog.Write("dwg-kb: 自动启动失败 " + error);
                }
                else
                {
                    ShowError("启动知识库失败", error);
                }
                return;
            }
            Balloon("知识库服务已启动",
                "PID " + process.Id + " · " + _config.DwgKbUrl +
                "\r\n首次加载索引可能需要几十秒。", ToolTipIcon.Info);
            _dwgKbUserStopped = false;
            _dwgKbRestartFailures = 0;
            RefreshDwgKbStatus(true);
            UpdateDwgKbUi();
        }

        private void StopDwgKbService()
        {
            if (!DwgKbServer.IsLocalUrl(_config.DwgKbUrl))
            {
                Balloon("仅支持本机服务",
                    "当前连接的是远程知识库，请在服务器上停止它。", ToolTipIcon.Info);
                return;
            }

            string error;
            if (!DwgKbServer.IsRunning())
            {
                int port = DwgKbServer.PortOf(_config.DwgKbUrl, 8322);
                if (!ConfirmStopExternalDwgKb(port)) return;
                if (!DwgKbServer.StopListener(port, out error))
                {
                    ShowError("停止知识库失败", error);
                    return;
                }
            }
            else if (!DwgKbServer.Stop(out error))
            {
                ShowError("停止知识库失败", error);
                return;
            }

            // 用户主动停止：本轮托盘生命周期内不再自动拉起
            _dwgKbUserStopped = true;
            Balloon("知识库服务已停止", "", ToolTipIcon.Info);
            RefreshDwgKbStatus(true);
            UpdateDwgKbUi();
        }

        /// <summary>
        /// 重启本机知识库：托盘启动的直接停；外部启动的按端口找到进程、确认后停，
        /// 然后统一用托盘探测到的 Python 重新启动（升级包后用它让新版本生效）。
        /// </summary>
        private void RestartDwgKbService()
        {
            if (!DwgKbServer.IsLocalUrl(_config.DwgKbUrl))
            {
                Balloon("仅支持本机服务",
                    "当前连接的是远程知识库，请在服务器上重启它。", ToolTipIcon.Info);
                return;
            }

            PythonInfo info = PythonLocator.Resolve(_config, false);
            lock (_dwgKbLock) { _dwgKbPython = info; }
            if (!info.HasPackage)
            {
                Balloon("尚未安装知识库",
                    "先用「安装 / 升级知识库…」安装 atlisp-dwg-kb。", ToolTipIcon.Info);
                return;
            }

            int port = DwgKbServer.PortOf(_config.DwgKbUrl, 8322);
            string error;
            if (DwgKbServer.IsRunning())
            {
                if (!DwgKbServer.Stop(out error))
                {
                    ShowError("重启知识库失败", error);
                    return;
                }
            }
            else if (DwgKbServer.IsPortListening(port))
            {
                if (!ConfirmStopExternalDwgKb(port)) return;
                if (!DwgKbServer.StopListener(port, out error))
                {
                    ShowError("重启知识库失败", error);
                    return;
                }
            }

            _dwgKbUserStopped = false;
            AppLog.Write("dwg-kb: manual restart");
            StartDwgKbService();
        }

        /// <summary>停止外部启动的本机知识库前确认：显示 PID/映像名，避免误杀。</summary>
        private bool ConfirmStopExternalDwgKb(int port)
        {
            if (!DwgKbServer.IsPortListening(port))
            {
                ShowError("停止知识库失败",
                    "端口 " + port + " 上没有运行中的知识库服务。");
                return false;
            }
            string image;
            int pid = DwgKbServer.FindListener(port, out image);
            if (pid <= 0)
            {
                ShowError("停止知识库失败", "无法确定端口 " + port + " 上的进程。");
                return false;
            }
            if (!DwgKbServer.IsKnowledgeBaseProcess(image))
            {
                ShowError("停止知识库失败", "端口 " + port + " 被 " + (image ?? "未知进程") +
                    "（PID " + pid + "）占用，不像是知识库服务，已取消。");
                return false;
            }

            string name = string.IsNullOrEmpty(image) ? "python" : image;
            DialogResult result = MessageBox.Show(
                "端口 " + port + " 上的知识库不是托盘启动的：\r\n\r\n" +
                name + "（PID " + pid + "）\r\n\r\n" +
                "停止它吗？如果它由 Windows 服务/系统服务启动，建议改用服务管理器。",
                "@lisp MCP 托盘 - 知识库",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Question);
            return result == DialogResult.Yes;
        }

        private void ToggleDwgKbAutoStart()
        {
            _config.DwgKbAutoStart = !_config.DwgKbAutoStart;
            _config.Save();
            UpdateDwgKbUi();
            if (_config.DwgKbAutoStart && !DwgKbServer.IsRunning())
            {
                // 勾选那一刻就把服务拉起来，语义比「下次启动才生效」直观
                StartDwgKbService();
            }
        }

        /// <summary>
        /// 知识库自动启动：地址必须是本机，且本机已装好 atlisp-dwg-kb。
        /// 托盘不再代装 Python / pip 包，装好后重启托盘即可自动拉起。
        /// </summary>
        private void EnsureDwgKbStartedOnLaunch()
        {
            if (!_config.DwgKbAutoStart)
            {
                _dwgKbAutoStartAttempted = true;
                return;
            }
            if (!DwgKbServer.IsLocalUrl(_config.DwgKbUrl))
            {
                _dwgKbAutoStartAttempted = true;
                return;
            }
            int port = DwgKbServer.PortOf(_config.DwgKbUrl, 8322);
            if (DwgKbServer.IsPortListening(port))
            {
                _dwgKbAutoStartAttempted = true;
                return;
            }
            if (TaskBusy()) return;

            PythonInfo info = PythonLocator.Resolve(_config, false);
            lock (_dwgKbLock) { _dwgKbPython = info; }

            if (!info.HasPackage)
            {
                // 托盘不再代装 Python / pip 包：装好后下次启动（或手动点启动）即可
                AppLog.Write("dwg-kb: 未安装 atlisp-dwg-kb，跳过自动启动");
                _dwgKbAutoStartAttempted = true;
                return;
            }

            _dwgKbAutoStartAttempted = true;
            AppLog.Write("dwg-kb: auto-start on launch");
            StartDwgKbService();
        }

        /// <summary>
        /// MCP 服务异常退出（退出码非 0）后自动拉起，退避 1/2/5/10/30 分钟。
        /// 用户手动停止走的是 Stopped 状态，不会触发这里。
        /// </summary>
        private void MaybeRestartServer()
        {
            if (!_config.AutoStartServer) return;
            if ((DateTime.UtcNow - _createdAt).TotalSeconds < 30) return;
            if (TaskBusy()) return;

            if (_server.State == ServerState.Running)
            {
                _serverRestartFailures = 0;
                return;
            }
            if (_server.State != ServerState.Error) return;
            if (_serverRestartFailures >= ServerRestartMaxFailures) return;
            if (DateTime.UtcNow < _serverRestartRetryAt) return;

            _serverRestartFailures++;
            int minutes = _serverRestartFailures <= 1 ? 1 :
                (_serverRestartFailures <= 2 ? 2 :
                (_serverRestartFailures <= 3 ? 5 :
                (_serverRestartFailures <= 4 ? 10 : 30)));
            _serverRestartRetryAt = DateTime.UtcNow.AddMinutes(minutes);
            AppLog.Write("auto-restart: MCP 服务异常退出，第 " + _serverRestartFailures +
                " 次自动拉起（开始 " + minutes + " 分钟退避）");
            try
            {
                _suppressNotifications = true;
                _server.Start();
                _suppressNotifications = false;
            }
            catch (Exception ex)
            {
                _suppressNotifications = false;
                AppLog.Write("auto-restart: 拉起失败 " + ex.Message);
                if (_serverRestartFailures >= ServerRestartMaxFailures)
                {
                    Balloon("MCP 服务反复异常退出",
                        "已尝试自动重启 " + ServerRestartMaxFailures +
                        " 次，请查看服务器日志。", ToolTipIcon.Error);
                }
            }
        }

        /// <summary>
        /// 知识库服务意外退出后自动拉起（仅本机 + 已装包 + 用户没主动停止）。
        /// 用户点「停止知识库服务」会置 _dwgKbUserStopped，避免刚停就被拉起来。
        /// </summary>
        private void MaybeRestartDwgKbService()
        {
            if (!_config.DwgKbAutoStart) return;
            if (_dwgKbUserStopped) return;
            if (!DwgKbServer.IsLocalUrl(_config.DwgKbUrl)) return;
            if ((DateTime.UtcNow - _createdAt).TotalSeconds < 90) return;
            if (TaskBusy() || _dwgKbBuilding) return;
            if (DateTime.UtcNow < _dwgKbRestartRetryAt) return;

            // 托盘自己起的进程还活着，或端口上已有别的实例 → 不需要干预
            if (DwgKbServer.IsRunning())
            {
                _dwgKbRestartFailures = 0;
                return;
            }
            int port = DwgKbServer.PortOf(_config.DwgKbUrl, 8322);
            if (DwgKbServer.IsPortListening(port))
            {
                _dwgKbRestartFailures = 0;
                return;
            }

            PythonInfo info = PythonLocator.Resolve(_config, false);
            lock (_dwgKbLock) { _dwgKbPython = info; }
            if (!info.HasPackage) return;
            if (_dwgKbRestartFailures >= 5) return;

            _dwgKbRestartFailures++;
            int minutes = _dwgKbRestartFailures <= 1 ? 1 :
                (_dwgKbRestartFailures <= 2 ? 2 :
                (_dwgKbRestartFailures <= 3 ? 5 : 15));
            _dwgKbRestartRetryAt = DateTime.UtcNow.AddMinutes(minutes);
            AppLog.Write("dwg-kb: 服务未运行，自动拉起（第 " + _dwgKbRestartFailures +
                " 次，开始 " + minutes + " 分钟退避）");
            StartDwgKbService(true);
        }

        /// <summary>
        /// 本机包升级后，托盘启动的旧服务进程仍报旧版本：自动重启一次让新版本生效。
        /// 只处理「托盘自己启动 + 本机地址」的服务；外部/远程服务只提示，不接管。
        /// </summary>
        private void MaybeSyncDwgKbVersion()
        {
            if (!DwgKbServer.IsLocalUrl(_config.DwgKbUrl)) return;
            if (TaskBusy() || _dwgKbBuilding) return;
            if (DateTime.UtcNow < _dwgKbSyncRetryAt) return;
            if (!DwgKbServer.IsRunning())
            {
                _dwgKbSyncFailures = 0;
                return;
            }

            DwgKbStatus status;
            PythonInfo python;
            lock (_dwgKbLock)
            {
                status = _dwgKbStatus;
                python = _dwgKbPython;
            }
            if (status == null || !status.Reachable) return;
            if (python == null || !python.HasPackage) return;

            string service = (status.Version ?? "").Trim();
            string local = (python.PackageVersion ?? "").Trim();
            if (service.Length == 0 || local.Length == 0) return;
            if (!VersionUtil.IsNewer(local, service))
            {
                _dwgKbSyncFailures = 0;
                return;
            }
            if (_dwgKbSyncFailures >= 3) return;

            _dwgKbSyncFailures++;
            _dwgKbSyncRetryAt = DateTime.UtcNow.AddMinutes(_dwgKbSyncFailures * 5);
            AppLog.Write("dwg-kb: 服务 v" + service + " 落后于本机 v" + local +
                "，第 " + _dwgKbSyncFailures + " 次自动重启以应用新版本");
            string error;
            if (!DwgKbServer.Stop(out error))
            {
                AppLog.Write("dwg-kb: 版本同步重启失败 " + error);
                return;
            }
            StartDwgKbService(true);
        }

        /// <summary>
        /// 提交重建任务（服务端后台执行，不在这里等它跑完）。
        /// 注意 /build 是 admin 操作：知识库侧设置了 DWG_KB_API_KEY 时，
        /// 托盘配置里的 key 必须一致，否则返回 401。
        /// </summary>
        private void RebuildDwgKb()
        {
            if (_dwgKbBuilding) return;

            DialogResult confirm = MessageBox.Show(
                "将请求知识库重建索引：\r\n" + _config.DwgKbUrl + "\r\n\r\n" +
                "重建在服务端后台运行（数分钟），期间旧索引仍可查询。\r\n继续吗？",
                "@lisp MCP 托盘 - 知识库",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Question);
            if (confirm != DialogResult.Yes) return;

            _dwgKbBuilding = true;
            string url = _config.DwgKbUrl;
            string key = _config.DwgKbApiKey;
            UpdateDwgKbUi();

            ThreadPool.QueueUserWorkItem(delegate
            {
                string error = null;
                try
                {
                    DwgKbClient.Build(url, key, 30000);
                }
                catch (Exception ex)
                {
                    error = ex.Message;
                }

                if (error == null)
                {
                    _dwgKbBalloonTitle = "知识库重建已提交";
                    _dwgKbBalloonText = "服务端正在后台重建索引，完成后自动生效。";
                    _dwgKbBalloonIcon = ToolTipIcon.Info;
                }
                else
                {
                    _dwgKbBalloonTitle = "知识库重建失败";
                    _dwgKbBalloonText = error;
                    _dwgKbBalloonIcon = ToolTipIcon.Error;
                }
                _dwgKbBalloonPending = true;

                lock (_dwgKbLock)
                {
                    _dwgKbBuilding = false;
                    _dwgKbCheckedAt = DateTime.MinValue;
                }
            });
        }

        private void ConfigureDwgKb()
        {
            using (DwgKbSettingsForm form =
                new DwgKbSettingsForm(_config.DwgKbUrl, _config.DwgKbApiKey))
            {
                if (form.ShowDialog() != DialogResult.OK) return;
                _config.DwgKbUrl = form.UrlValue;
                _config.DwgKbApiKey = form.ApiKeyValue;
                _config.Normalize();
                _config.Save();
                RefreshDwgKbStatus(true);
                UpdateDwgKbUi();
            }
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
                    ShowInstallNodeHelp();
                    return;
                }
                if (!info.IsInstalled)
                {
                    ShowInstallServerHelp();
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

        /// <summary>大数字用「万 / 亿」显示，状态行不至于被 5,499,880 这种数字撑爆。</summary>
        private static string FormatCount(long value)
        {
            if (value >= 100000000L)
            {
                return (value / 100000000.0).ToString("0.#", CultureInfo.InvariantCulture) + "亿";
            }
            if (value >= 10000L)
            {
                return (value / 10000.0).ToString("0.#", CultureInfo.InvariantCulture) + "万";
            }
            return value.ToString(CultureInfo.InvariantCulture);
        }

        /// <summary>比较两个版本字符串（忽略 v 前缀与不足的段，如 0.2.2 == 0.2.2.0）。</summary>
        private static bool VersionsEqual(string left, string right)
        {
            if (string.IsNullOrEmpty(left) || string.IsNullOrEmpty(right)) return false;
            Version a = VersionUtil.Parse(left);
            Version b = VersionUtil.Parse(right);
            if (a == null || b == null)
            {
                return string.Equals(left.Trim(), right.Trim(), StringComparison.OrdinalIgnoreCase);
            }
            return a == b;
        }

        private bool TaskBusy()
        {
            return _dwgKbBuilding;
        }

        private bool IsServerBusy()
        {
            // Error 状态下进程可能仍存活（健康检查失败），升级前也尝试停止一次
            return _server.State == ServerState.Running ||
                   _server.State == ServerState.Starting ||
                   _server.State == ServerState.Error;
        }

        private void CheckUpdate(bool silentCheck)
        {
            if (_updateChecking) return;
            _updateChecking = true;
            bool silent = silentCheck;
            ThreadPool.QueueUserWorkItem(delegate
            {
                // 只读一次 registry 元数据：不再 spawn npm，也不下载/执行任何东西。
                string latest = null;
                string error = null;
                try
                {
                    HttpWebRequest request = (HttpWebRequest)WebRequest.Create(
                        "https://registry.npmjs.org/@atlisp%2Fmcp/latest");
                    request.UserAgent = "atlisp-tray/" + Program.AppVersion;
                    request.Timeout = 15000;
                    request.ReadWriteTimeout = 15000;
                    request.AutomaticDecompression =
                        DecompressionMethods.GZip | DecompressionMethods.Deflate;
                    using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
                    using (Stream stream = response.GetResponseStream())
                    using (StreamReader reader = new StreamReader(stream, Encoding.UTF8))
                    {
                        Match match = Regex.Match(reader.ReadToEnd(),
                            "\"version\"\\s*:\\s*\"([^\"]+)\"");
                        if (match.Success) latest = match.Groups[1].Value.Trim();
                    }
                    if (string.IsNullOrEmpty(latest)) error = "npm registry 返回内容里没有版本号";
                }
                catch (Exception ex)
                {
                    error = ex.Message;
                }

                _updateChecking = false;
                if (error != null)
                {
                    AppLog.Write("检查更新失败" + (silent ? "（启动时静默）" : "") + ": " + error);
                    if (!silent)
                    {
                        _updateBalloonTitle = "检查更新失败";
                        _updateBalloonText = error;
                        _updateBalloonIcon = ToolTipIcon.Warning;
                        _updateBalloonPending = true;
                    }
                    return;
                }

                _latestVersion = latest;
                ServerInfo info = ServerLocator.Resolve(_config, false);
                bool newer = VersionUtil.IsNewer(latest, info.Version);
                AppLog.Write("检查更新: 最新 v" + latest + "，本机 " +
                    (info.IsInstalled ? info.VersionText : "未安装"));
                if (!silent || newer)
                {
                    _updateBalloonTitle = newer
                        ? "发现新版本 v" + latest
                        : "已是最新版本";
                    _updateBalloonText = newer
                        ? "本机 " + (info.IsInstalled ? info.VersionText : "未安装") +
                          "。升级方式见菜单「更新与安装 → 如何升级…」。"
                        : "当前已是最新版本。";
                    _updateBalloonIcon = newer ? ToolTipIcon.Info : ToolTipIcon.None;
                    _updateBalloonPending = true;
                }
            });
        }

        private void ShowInstallNodeHelp()
        {
            MessageBox.Show(
                "托盘不再自动下载、安装或执行外部安装包。\r\n\r\n" +
                "请自行安装 Node.js（建议 LTS），任选一种：\r\n\r\n" +
                "  winget install OpenJS.NodeJS.LTS\r\n\r\n" +
                "或从 https://nodejs.org/zh-cn/download 下载安装包。\r\n\r\n" +
                "装好后右键托盘 →「重新加载配置」，或重启托盘。",
                "@lisp MCP 托盘 - 安装 Node.js",
                MessageBoxButtons.OK,
                MessageBoxIcon.Information);
        }

        private void ShowInstallServerHelp()
        {
            string command = "npm install -g @atlisp/mcp@latest";
            MessageBox.Show(
                "托盘不再自动下载、安装或执行外部安装包。\r\n\r\n" +
                "请在命令行执行：\r\n\r\n  " + command + "\r\n\r\n" +
                "若机器上没有 .NET SDK，追加 --ignore-scripts 可跳过 edge-js 的编译脚本：\r\n\r\n" +
                "  " + command + " --ignore-scripts\r\n\r\n" +
                "装好后右键托盘 →「重新加载配置」，或重启托盘。",
                "@lisp MCP 托盘 - 安装 @lisp MCP Server",
                MessageBoxButtons.OK,
                MessageBoxIcon.Information);
        }

        private void ShowUpgradeHelp()
        {
            ServerInfo info = ServerLocator.Resolve(_config, false);
            string command = "npm install -g @atlisp/mcp@latest";
            MessageBox.Show(
                (string.IsNullOrEmpty(_latestVersion)
                    ? "先点「检查更新」看看有没有新版本。\r\n\r\n"
                    : "最新版本：v" + _latestVersion + "（本机 " +
                      (info.IsInstalled ? info.VersionText : "未安装") + "）\r\n\r\n") +
                "托盘不再代替你下载和执行安装包。请自行在命令行执行：\r\n\r\n  " +
                command + "\r\n\r\n" +
                "若机器上没有 .NET SDK，追加 --ignore-scripts。\r\n" +
                "装好后右键托盘 →「重新加载配置」，或重启托盘。",
                "@lisp MCP 托盘 - 升级",
                MessageBoxButtons.OK,
                MessageBoxIcon.Information);
        }

        private void ShowInstallDwgKbHelp()
        {
            PythonInfo info = PythonLocator.Resolve(_config, false);
            string python = info.HasPython ? info.PythonPath : "python";
            string text =
                "托盘不再自动下载、安装或执行外部安装包。\r\n\r\n";
            if (!info.HasPython)
            {
                text += "未检测到 Python 3.10+。请先自行安装，例如：\r\n\r\n" +
                    "  winget install Python.Python.3.12\r\n\r\n" +
                    "或从 https://www.python.org/downloads/ 下载。\r\n\r\n";
            }
            text += "然后执行（建议加国内镜像参数）：\r\n\r\n  " + python +
                " -m pip install --upgrade atlisp-dwg-kb\r\n\r\n" +
                "装好后在本菜单点「刷新状态」，再点「启动知识库服务」。";
            MessageBox.Show(text, "@lisp MCP 托盘 - 安装知识库",
                MessageBoxButtons.OK, MessageBoxIcon.Information);
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
            _startupUpdateChecked = false;
            _dwgKbAutoStartAttempted = false;

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
            builder.AppendLine("知识库地址   : " + _config.DwgKbUrl);
            builder.AppendLine("知识库自动   : " + (_config.DwgKbAutoStart ? "随托盘启动" : "手动启动"));
            PythonInfo python = PythonLocator.Resolve(_config, false);
            builder.AppendLine("知识库环境   : " + (python == null ? "检测中" : python.RuntimeText));
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
                "右键菜单可启动/停止服务、检查更新、设置开机自启。\r\n" +
                "托盘不代下载、不代安装：缺 Node.js / Python / 包时只显示命令。\r\n" +
                "升级托盘请退出后重新运行 atlisp-tray。\r\n\r\n" +
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
            if (_config.StopServerOnExit)
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
                if (_currentIcon != null)
                {
                    try { _currentIcon.Dispose(); } catch { }
                }
            }
            base.Dispose(disposing);
        }
    }
}
