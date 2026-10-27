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
using System.Management;
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
            // 自替换模式：本进程是新版本的暂存副本，只负责等旧进程退出、覆盖目标 exe
            // 再启动它。必须放在创建互斥体之前（此时旧进程还持有托盘互斥体）。
            if (TraySelfUpdate.TryApplyStagedUpdate(args)) return;

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

            // 自迁移会把副本立刻拉起，此时本进程还没退出、仍持有托盘互斥体。
            // 副本用 --wait-pid 等本进程退出后再创建托盘，避免撞上「已经在运行」。
            int waitPid = 0;
            for (int i = 0; i < args.Length - 1; i++)
            {
                if (string.Equals(args[i], "--wait-pid", StringComparison.OrdinalIgnoreCase))
                {
                    int.TryParse(args[i + 1], NumberStyles.Integer,
                        CultureInfo.InvariantCulture, out waitPid);
                }
            }
            if (waitPid > 0)
            {
                TraySelfUpdate.WaitForExit(waitPid, TimeSpan.FromSeconds(20));
            }

            AppLog.Init();
            // 旧版本的自我更新靠 %APPDATA%\atlisp-mcp\update-tray.cmd，新版不再生成，
            // 顺手清掉残留（避免留下一个「可疑脚本」样本）。
            TraySelfUpdate.CleanupLegacyScript();

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
                // 副本直接启动（不再借道 cmd 脚本，避免「写脚本等父进程退出」这种
                // 杀软重点关注的形态）。
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

        /// <summary>把版本号写到 exe 同目录（自迁移后新位置的托盘要能显示版本）。</summary>
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

        /// <summary>
        /// 托盘自动安装的 Python（官方安装包 InstallAllUsers=0 + TargetDir 到用户目录，
        /// 不需要管理员权限）。知识库（atlisp-dwg-kb）是 Python 包，没它装不了。
        /// </summary>
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

        /// <summary>自动安装的退避状态，避免反复失败时反复下载。</summary>
        public static string BootstrapStatePath
        {
            get { return Path.Combine(DataDir, "bootstrap.state"); }
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

    /// <summary>
    /// 下载物校验。托盘**不执行来源无法验证的二进制**——「下载后静默执行」正是杀软
    /// 判定 dropper 的核心特征，所以这里宁可失败也不放过：
    ///   · Node.js zip：比对官方 SHASUMS256.txt（镜像优先，退回 nodejs.org）；
    ///   · 安装包（Node MSI / Python exe）：校验 Authenticode 签名是否有效。
    /// </summary>
    internal static class DownloadVerifier
    {
        public static string Sha256(string path)
        {
            using (FileStream stream = File.OpenRead(path))
            using (SHA256 sha = SHA256.Create())
            {
                byte[] hash = sha.ComputeHash(stream);
                StringBuilder sb = new StringBuilder(hash.Length * 2);
                for (int i = 0; i < hash.Length; i++) sb.Append(hash[i].ToString("x2"));
                return sb.ToString();
            }
        }

        /// <summary>按官方 SHASUMS256.txt 校验 Node.js zip。拿不到清单时返回 false（fail-closed）。</summary>
        public static bool VerifyNodeZip(string zipPath, string version, string mirror,
            out string error)
        {
            error = null;
            string fileName = Path.GetFileName(zipPath);
            string expected = FetchShasum(version, mirror, fileName, out error);
            if (string.IsNullOrEmpty(expected)) return false;

            string actual;
            try
            {
                actual = Sha256(zipPath);
            }
            catch (Exception ex)
            {
                error = "计算 SHA256 失败: " + ex.Message;
                return false;
            }
            if (!string.Equals(expected, actual, StringComparison.OrdinalIgnoreCase))
            {
                error = "SHA256 与官方清单不一致（期望 " + Short(expected) +
                    "，实际 " + Short(actual) + "）";
                return false;
            }
            return true;
        }

        private static string Short(string hash)
        {
            if (string.IsNullOrEmpty(hash)) return "?";
            return hash.Length > 12 ? hash.Substring(0, 12) + "…" : hash;
        }

        private static string FetchShasum(string version, string mirror, string fileName,
            out string error)
        {
            error = null;
            List<string> bases = new List<string>();
            if (!string.IsNullOrEmpty(mirror)) bases.Add(mirror.TrimEnd('/'));
            bases.Add("https://nodejs.org/dist");

            foreach (string baseUrl in bases)
            {
                string url = baseUrl + "/v" + version + "/SHASUMS256.txt";
                try
                {
                    using (WebClient client = new WebClient())
                    {
                        client.Headers.Add("User-Agent", "atlisp-tray/" + Program.AppVersion);
                        string text = client.DownloadString(url);
                        foreach (string line in text.Split('\n'))
                        {
                            string trimmed = line.Trim();
                            if (!trimmed.EndsWith(fileName, StringComparison.OrdinalIgnoreCase))
                            {
                                continue;
                            }
                            string[] parts = trimmed.Split(new char[] { ' ', '\t' },
                                StringSplitOptions.RemoveEmptyEntries);
                            if (parts.Length >= 1 && parts[0].Length == 64) return parts[0];
                        }
                        error = url + " 里没有 " + fileName;
                    }
                }
                catch (Exception ex)
                {
                    error = url + ": " + ex.Message;
                }
            }
            return null;
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
        /// <summary>配置结构版本；小于当前值表示需要一次性迁移默认值。</summary>
        public const int ConfigVersionCurrent = 2;

        /// <summary>写入 tray.json 的配置版本，见 <see cref="ConfigVersionCurrent"/>。</summary>
        public int ConfigVersion { get; set; }
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
        /// <summary>图纸知识库（atlisp-dwg-kb）服务地址，默认本机 :8322。</summary>
        public string DwgKbUrl { get; set; }
        /// <summary>知识库 API key；知识库侧设置了 DWG_KB_API_KEY 时必须一致。</summary>
        public string DwgKbApiKey { get; set; }
        /// <summary>自动安装 Python 时使用的版本（官方安装包）。</summary>
        public string PythonVersion { get; set; }
        /// <summary>Python 安装包镜像（默认 npmmirror；留空则用 python.org）。</summary>
        public string PythonMirror { get; set; }
        /// <summary>检测到的 Python 解释器路径（缓存，加速后续检测）。</summary>
        public string PythonPath { get; set; }
        /// <summary>托盘启动时自动启动本地知识库服务（仅当地址是本机且已安装包）。</summary>
        public bool DwgKbAutoStart { get; set; }
        /// <summary>
        /// 定时检查 PyPI 上的 atlisp-dwg-kb 新版本并自动升级（间隔复用 AutoUpgradeHours）。
        /// 仅当地址是本机且已安装包时生效；升级前会停掉托盘启动的知识库进程，完成后自动拉起。
        /// </summary>
        public bool DwgKbAutoUpgrade { get; set; }

        public TrayConfig()
        {
            ConfigVersion = ConfigVersionCurrent;
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
            // 默认「只检查、只提示，不自动安装」：开机后静默联网并在后台执行
            // npm 全局安装，是杀软启发式里典型的「下载并执行」形态，改成用户确认后再升级。
            AutoUpgrade = false;
            AutoUpgradeHours = 24;
            HealthyPollSeconds = 5;
            DwgKbUrl = "http://127.0.0.1:8322";
            DwgKbApiKey = "";
            PythonVersion = "3.12.8";
            PythonMirror = "https://registry.npmmirror.com/-/binary/python";
            PythonPath = "";
            DwgKbAutoStart = true;
            // 与 AutoUpgrade 同理：后台静默 `pip install` 再重启服务是「下载并执行」
            // 形态，默认关掉，只在菜单里手动升级。
            DwgKbAutoUpgrade = false;
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
            // 旧版默认是「每 1 小时自动静默升级」，新默认改为「只检查并提示」。
            // 已装了旧版托盘的机器不需要手动清 tray.json：这里一次性迁移到新默认，
            // 避免继续每小时联网查版本并在后台静默执行 npm 安装。
            // v2 同理：知识库的自动 `pip install` 也改成默认关闭（旧版一律是 true，
            // 分不清用户是否亲手打开过，宁可让他们手动再勾一次）。
            if (config.ConfigVersion < ConfigVersionCurrent)
            {
                if (config.ConfigVersion < 1)
                {
                    config.AutoUpgrade = false;
                    if (config.AutoUpgradeHours <= 1) config.AutoUpgradeHours = 24;
                }
                config.DwgKbAutoUpgrade = false;
                config.ConfigVersion = ConfigVersionCurrent;
                config.Save();
            }
            else if (!exists)
            {
                config.Save();
            }
            return config;
        }

        public void CopyFrom(TrayConfig other)
        {
            if (other == null) return;
            ConfigVersion = other.ConfigVersion;
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
            DwgKbUrl = other.DwgKbUrl;
            DwgKbApiKey = other.DwgKbApiKey;
            PythonVersion = other.PythonVersion;
            PythonMirror = other.PythonMirror;
            PythonPath = other.PythonPath;
            DwgKbAutoStart = other.DwgKbAutoStart;
            DwgKbAutoUpgrade = other.DwgKbAutoUpgrade;
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
            if (AutoUpgradeHours < 1 || AutoUpgradeHours > 168) AutoUpgradeHours = 24;
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
            PythonVersion = (PythonVersion ?? "").Trim();
            if (PythonVersion.Length == 0) PythonVersion = "3.12.8";
            PythonMirror = (PythonMirror ?? "").Trim().TrimEnd('/');
            if (PythonMirror.Length == 0)
            {
                PythonMirror = "https://registry.npmmirror.com/-/binary/python";
            }
            PythonPath = PythonPath ?? "";
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

        /// <summary>
        /// 以管理员身份执行 cmd 命令行（npm 全局安装等），输出重定向到 logFile。
        ///
        /// 刻意**不再**往 %TEMP% 写 `.cmd` 再提权运行——「落一个批处理文件、再把它隐藏着
        /// 提权执行」是杀软眼里的投放器形态。现在直接把命令行交给提权后的 cmd，
        /// 也不隐藏窗口（提权进程弹个控制台是正常的，隐藏反而像在躲）。
        /// 命令行里的 node / npm 都用绝对路径，因此不依赖提升进程的 PATH。
        /// </summary>
        public static Process StartElevated(string commandLine, string logFile, out string error)
        {
            error = null;
            try
            {
                string comspec = Environment.GetEnvironmentVariable("ComSpec");
                if (string.IsNullOrEmpty(comspec)) comspec = "cmd.exe";

                // /s + 首尾引号：cmd 会去掉最外层一对引号，剩下的就是原始命令行 + 重定向。
                // chcp 65001 保留旧 `.cmd` 里的 UTF-8 输出，日志按 UTF-8 读回。
                ProcessStartInfo info = new ProcessStartInfo();
                info.FileName = comspec;
                info.Arguments = "/d /s /c \"chcp 65001 >nul & " + commandLine +
                    " > " + Quote(logFile) + " 2>&1\"";
                info.Verb = "runas";
                info.UseShellExecute = true;
                info.WorkingDirectory = Environment.GetFolderPath(
                    Environment.SpecialFolder.UserProfile);
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

    /// <summary>占用 npm 包目录的一个进程。</summary>
    internal sealed class LockHolder
    {
        public int Pid;
        public string Name;
        public string Path;

        public string Describe()
        {
            string name = string.IsNullOrEmpty(Name) ? "进程" : Name;
            return name + "（PID " + Pid.ToString(CultureInfo.InvariantCulture) + "）";
        }
    }

    /// <summary>
    /// npm 包目录占用探测（Windows 特有）。
    ///
    /// npm 升级全局包不是原地覆盖：它先把 `node_modules\@atlisp\mcp` 改名成
    /// `.mcp-XXXXXX`，解压新版本后再删掉旧的。Windows 不允许给「还有进程在里面」的
    /// 目录改名，于是报：
    ///     EBUSY: resource busy or locked, rename '...\@atlisp\mcp' -> '...\.mcp-XXXXXX'
    /// 常见占用者：
    ///   · 任何把该目录当工作目录的进程（托盘的旧版本直接把服务 CWD 设成包目录）；
    ///   · 任何映射了目录内原生模块的进程（edge-js 的 .node/.dll，连过 CAD 就常驻）；
    ///   · 正在运行的包内 AtlispTray.exe / AtlispUpdater.exe。
    /// npm 自己不会重试，所以托盘必须先把占用清干净再让它跑。
    ///
    /// 这个类只做两件事：探测目录能不能改名（和 npm 那一步等价），以及找出/结束占用者。
    /// </summary>
    internal static class PackageDirLock
    {
        private const string ProbeSuffix = ".atlisp-lockprobe";

        /// <summary>
        /// 目录是否仍被占用。做法就是把目录改名再改回来——和 npm 失败的那一步完全一致，
        /// 所以结论可靠；改不回来时（理论上不会）只记日志，不再继续操作。
        /// </summary>
        public static bool IsBusy(string dir)
        {
            if (string.IsNullOrEmpty(dir)) return false;
            string probe = dir.TrimEnd('\\') + ProbeSuffix;
            // 上次探测改名后进程恰好被杀：先把目录复原，再判断
            RecoverLeftover(dir, probe);
            if (!Directory.Exists(dir)) return false;
            try
            {
                Directory.Move(dir, probe);
            }
            catch
            {
                return true;
            }

            try
            {
                Directory.Move(probe, dir);
            }
            catch (Exception ex)
            {
                // 极端情况：改回去失败。把路径写进日志，便于用户手工改回。
                AppLog.Write("locked: 目录改回失败，请手工把 " + probe + " 改名回 " + dir +
                    "（" + ex.Message + "）");
            }
            return false;
        }

        /// <summary>
        /// 复原上一次探测留下的 `mcp.atlisp-lockprobe`：只有「探测中被强制结束」
        /// 这种极端情况才会出现，发现了就把目录改回来，避免下次启动找不到包。
        /// </summary>
        private static void RecoverLeftover(string dir, string probe)
        {
            try
            {
                if (!Directory.Exists(probe) || Directory.Exists(dir)) return;
                Directory.Move(probe, dir);
                AppLog.Write("locked: 发现上次探测残留的 " + probe + "，已改回 " + dir);
            }
            catch (Exception ex)
            {
                AppLog.Write("locked: 复原探测目录失败（" + probe + "）: " + ex.Message);
            }
        }

        /// <summary>轮询等待目录释放（句柄/文件锁通常几百毫秒内消失）。</summary>
        public static bool WaitFree(string dir, int timeoutMs)
        {
            int waited = 0;
            while (true)
            {
                if (!IsBusy(dir)) return true;
                if (waited >= timeoutMs)
                {
                    AppLog.Write("locked: 等待 " + timeoutMs + "ms 后目录仍不可改名 " + dir);
                    return false;
                }
                Thread.Sleep(200);
                waited += 200;
            }
        }

        /// <summary>
        /// 找出所有「可执行文件在包目录内，或命令行里带包目录」的进程（排除托盘自身）。
        /// 返回 null 表示枚举手段不可用（不能据此认定目录是空闲的）。
        /// </summary>
        public static List<LockHolder> Find(string packageDir)
        {
            if (string.IsNullOrEmpty(packageDir)) return new List<LockHolder>();
            List<LockHolder> holders = FindByWmi(packageDir);
            if (holders == null) return null;

            int self = Process.GetCurrentProcess().Id;
            List<LockHolder> result = new List<LockHolder>();
            for (int i = 0; i < holders.Count; i++)
            {
                if (holders[i].Pid != self) result.Add(holders[i]);
            }
            return result;
        }

        /// <summary>结束占用进程（整棵进程树：node 会带 cad-worker 子进程）。返回成功数。</summary>
        public static int Kill(List<LockHolder> holders)
        {
            if (holders == null) return 0;
            int killed = 0;
            for (int i = 0; i < holders.Count; i++)
            {
                int exitCode;
                ProcessRunner.Run("taskkill.exe",
                    "/PID " + holders[i].Pid.ToString(CultureInfo.InvariantCulture) + " /T /F",
                    8000, out exitCode);
                if (exitCode == 0) killed++;
                AppLog.Write("locked: 结束占用进程 " + holders[i].Describe() +
                    " path=" + holders[i].Path + " exitCode=" + exitCode);
            }
            return killed;
        }

        /// <summary>多行描述，用于日志与对话框。</summary>
        public static string Describe(List<LockHolder> holders)
        {
            if (holders == null || holders.Count == 0) return "";
            StringBuilder builder = new StringBuilder();
            for (int i = 0; i < holders.Count; i++)
            {
                builder.Append("  · ");
                builder.Append(holders[i].Describe());
                if (!string.IsNullOrEmpty(holders[i].Path))
                {
                    builder.Append("  ");
                    builder.Append(holders[i].Path);
                }
                builder.AppendLine();
            }
            return builder.ToString();
        }

        /// <summary>一行描述，写日志用。</summary>
        public static string DescribeOneLine(List<LockHolder> holders)
        {
            if (holders == null || holders.Count == 0) return "（未发现可疑进程）";
            StringBuilder builder = new StringBuilder();
            for (int i = 0; i < holders.Count; i++)
            {
                if (i > 0) builder.Append(", ");
                builder.Append(holders[i].Describe());
            }
            return builder.ToString();
        }

        /// <summary>
        /// 用 WMI 的 Win32_Process 枚举。需要命令行才能认出「把包目录当参数或工作目录的
        /// node 进程」，而 .NET Framework 的 Process 类读不到别的进程的命令行。
        ///
        /// 直接在进程内查 WMI（System.Management），不再启动 powershell 并把脚本经 stdin
        /// 灌进去：`powershell -ExecutionPolicy Bypass` 是杀软静态特征的常见命中项，
        /// 少一次隐藏子进程也少一条行为证据。
        /// </summary>
        private static List<LockHolder> FindByWmi(string packageDir)
        {
            string dir = packageDir.TrimEnd('\\');
            List<LockHolder> holders = new List<LockHolder>();
            try
            {
                using (ManagementObjectSearcher searcher = new ManagementObjectSearcher(
                    "SELECT ProcessId, Name, ExecutablePath, CommandLine FROM Win32_Process"))
                {
                    foreach (ManagementBaseObject row in searcher.Get())
                    {
                        using (row)
                        {
                            try
                            {
                                object value = row["ProcessId"];
                                int pid = value == null ? 0 :
                                    Convert.ToInt32(value, CultureInfo.InvariantCulture);
                                if (pid <= 0) continue;

                                string name = row["Name"] as string;
                                string exePath = row["ExecutablePath"] as string;
                                string commandLine = row["CommandLine"] as string;

                                bool hit = (!string.IsNullOrEmpty(exePath) &&
                                        exePath.StartsWith(dir, StringComparison.OrdinalIgnoreCase)) ||
                                    (!string.IsNullOrEmpty(commandLine) &&
                                        commandLine.IndexOf(dir, StringComparison.OrdinalIgnoreCase) >= 0);
                                if (!hit) continue;

                                LockHolder holder = new LockHolder();
                                holder.Pid = pid;
                                holder.Name = name;
                                holder.Path = string.IsNullOrEmpty(exePath) ? "" : exePath;
                                holders.Add(holder);
                            }
                            catch (Exception)
                            {
                                // 别的用户的进程读不到 ExecutablePath/CommandLine，跳过
                            }
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                AppLog.Write("locked: WMI 枚举进程失败: " + ex.Message);
                return null;
            }
            return holders;
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
    ///   1. 启动时若发现自己运行在 node_modules 里，复制到用户目录并直接启动副本（自迁移）；
    ///   2. 每次升级 @lisp/mcp 成功后，比对新包内 exe 与当前 exe，不同则把新 exe 暂存为
    ///      副本，由副本自己（`--apply-update` 模式）等旧进程退出后覆盖目标 exe 再启动。
    ///
    /// 注意：这里刻意**不生成任何 .cmd/.bat 脚本**。「写脚本 → tasklist 轮询父进程 →
    /// copy /y 覆盖 exe → start」是杀软启发式里最典型的自我更新形态（未签名时几乎必报
    /// Wacatac 一类的 !ml 检出）。由 exe 自身完成替换既能达到同样效果，也不会踩这条规则。
    /// </summary>
    internal static class TraySelfUpdate
    {
        private const string StagedName = ".AtlispTray.update.exe";

        /// <summary>自替换模式开关：由上一版托盘启动本副本时传入。</summary>
        public const string ApplyUpdateSwitch = "--apply-update";

        /// <summary>独立更新器文件名（随包发布，刻意极少修改）。</summary>
        public const string UpdaterName = "AtlispUpdater.exe";

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
        /// 从 npm 包目录启动时把自身复制到用户目录，然后直接启动副本。
        /// 返回 true 表示已启动副本，调用方应直接退出。
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

            // 副本的版本资源是固定的（1.0.0.0），真实版本靠这个 sidecar 显示
            Program.WriteVersionFile(Path.GetDirectoryName(StablePath));

            string error;
            if (!StartDetached(StablePath, BuildLaunchArgs(Program.StartServerRequested), out error))
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

            // 优先用独立更新器：它的 hash 跨版本稳定（详见 tray/AtlispUpdater.cs 顶部说明），
            // 由它来覆盖 exe 比「新版本副本自己覆盖自己」干净得多。
            string updater = FindUpdater(info);
            // 版本号取**新包**的版本（info.Version 是升级后重新探测到的），
            // 更新器把它写进 AtlispTray.version，重启后的托盘据此显示版本
            string newVersion = info != null && !string.IsNullOrEmpty(info.Version)
                ? info.Version
                : Program.AppVersion;
            string stagedHash;
            try
            {
                stagedHash = FileHash(staged);
            }
            catch (Exception ex)
            {
                try { File.Delete(staged); } catch { }
                message = "计算暂存文件哈希失败: " + ex.Message;
                return false;
            }

            string error;
            if (!string.IsNullOrEmpty(updater))
            {
                if (!StartDetached(updater,
                    BuildUpdaterArgs(staged, current, startServer, newVersion, stagedHash),
                    out error))
                {
                    try { File.Delete(staged); } catch { }
                    message = "无法启动托盘更新器: " + error;
                    return false;
                }
                message = "托盘更新器已启动，退出后自动替换并重启";
                return true;
            }

            // 兼容旧包（还没有 dist\AtlispUpdater.exe）：退回副本自替换（--apply-update）
            AppLog.Write("tray-selfupdate: 包内没有 AtlispUpdater.exe，退回自替换模式");
            if (!StartDetached(staged, BuildApplyUpdateArgs(staged, current, startServer),
                out error))
            {
                try { File.Delete(staged); } catch { }
                message = "无法启动托盘更新进程: " + error;
                return false;
            }

            message = "托盘程序已就绪，退出后自动替换并重启";
            return true;
        }

        /// <summary>找更新器：优先包内（随 npm 一起发布），其次托盘同目录（安装版）。</summary>
        private static string FindUpdater(ServerInfo info)
        {
            if (info != null && !string.IsNullOrEmpty(info.PackageDir))
            {
                string packaged = Path.Combine(info.PackageDir, "dist", UpdaterName);
                if (File.Exists(packaged)) return packaged;
            }
            string local = Path.Combine(
                Path.GetDirectoryName(Application.ExecutablePath) ?? "", UpdaterName);
            return File.Exists(local) ? local : null;
        }

        private static string BuildUpdaterArgs(string staged, string target,
            bool startServer, string version, string stagedHash)
        {
            StringBuilder sb = new StringBuilder();
            sb.Append("--target ");
            sb.Append(ProcessRunner.Quote(target));
            sb.Append(" --staged ");
            sb.Append(ProcessRunner.Quote(staged));
            sb.Append(" --sha256 ");
            sb.Append(stagedHash);
            sb.Append(" --pid ");
            sb.Append(Process.GetCurrentProcess().Id.ToString(CultureInfo.InvariantCulture));
            sb.Append(" --restart ");
            sb.Append(ProcessRunner.Quote(target));
            sb.Append(" --restart-args ");
            sb.Append(ProcessRunner.Quote(BuildApplyFlags(startServer)));
            sb.Append(" --version ");
            sb.Append(ProcessRunner.Quote(version ?? Program.AppVersion));
            sb.Append(" --log ");
            sb.Append(ProcessRunner.Quote(Paths.LogDir));
            return sb.ToString();
        }

        private static string BuildApplyFlags(bool startServer)
        {
            string flags = "";
            if (Program.SilentMode) flags += " --silent";
            if (startServer) flags += " --start-server";
            return flags.Trim();
        }

        /// <summary>
        /// 启动一个独立进程（不等待、不继承控制台）。托盘的重启/迁移/自替换都走这里。
        /// </summary>
        private static bool StartDetached(string exePath, string arguments, out string error)
        {
            error = "";
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = exePath;
                psi.Arguments = arguments ?? "";
                string dir = Path.GetDirectoryName(exePath);
                if (!string.IsNullOrEmpty(dir)) psi.WorkingDirectory = dir;
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                Process.Start(psi);
                return true;
            }
            catch (Exception ex)
            {
                error = ex.Message;
                return false;
            }
        }

        private static string BuildLaunchArgs(bool startServer)
        {
            string args = "";
            if (Program.SilentMode) args += " --silent";
            if (startServer) args += " --start-server";
            // 自迁移时本进程尚未退出，副本要等它让出托盘互斥体
            args += " --wait-pid " +
                Process.GetCurrentProcess().Id.ToString(CultureInfo.InvariantCulture);
            return args.Trim();
        }

        /// <summary>
        /// 自替换参数：--apply-update &lt;staged&gt; &lt;target&gt; &lt;pid&gt; [--silent] [--start-server]
        /// </summary>
        private static string BuildApplyUpdateArgs(string staged, string target, bool startServer)
        {
            StringBuilder sb = new StringBuilder();
            sb.Append(ApplyUpdateSwitch);
            sb.Append(' ');
            sb.Append(ProcessRunner.Quote(staged));
            sb.Append(' ');
            sb.Append(ProcessRunner.Quote(target));
            sb.Append(' ');
            sb.Append(Process.GetCurrentProcess().Id.ToString(CultureInfo.InvariantCulture));
            if (Program.SilentMode) sb.Append(" --silent");
            if (startServer) sb.Append(" --start-server");
            return sb.ToString();
        }

        /// <summary>
        /// 自替换模式入口（由上一版托盘启动）：等旧进程退出 → 覆盖目标 exe → 启动新版。
        /// 返回 true 表示本进程只负责替换，调用方应立即退出、不要创建托盘窗口。
        /// </summary>
        public static bool TryApplyStagedUpdate(string[] args)
        {
            if (args == null) return false;
            int index = -1;
            for (int i = 0; i < args.Length; i++)
            {
                if (string.Equals(args[i], ApplyUpdateSwitch, StringComparison.OrdinalIgnoreCase))
                {
                    index = i;
                    break;
                }
            }
            if (index < 0 || args.Length < index + 4) return false;
            string staged = args[index + 1];
            string target = args[index + 2];
            int pid;
            if (!int.TryParse(args[index + 3], NumberStyles.Integer,
                CultureInfo.InvariantCulture, out pid))
            {
                return false;
            }

            bool silent = false;
            bool startServer = false;
            for (int i = 0; i < args.Length; i++)
            {
                if (string.Equals(args[i], "--silent", StringComparison.OrdinalIgnoreCase))
                {
                    silent = true;
                }
                else if (string.Equals(args[i], "--start-server", StringComparison.OrdinalIgnoreCase))
                {
                    startServer = true;
                }
            }

            AppLog.Init();
            try
            {
                AppLog.Write("tray-selfupdate: 等待旧进程 " + pid + " 退出后替换 " + target);
                WaitForExit(pid, TimeSpan.FromSeconds(120));
                if (!ReplaceWithRetry(staged, target))
                {
                    // 旧进程可能还活着（镜像仍被锁），这时再启动一份只会撞互斥体，
                    // 直接放弃本次替换，旧托盘继续用，下次升级再试。
                    return true;
                }

                string error;
                if (!StartDetached(target, BuildLaunchArgsFor(silent, startServer), out error))
                {
                    AppLog.Write("tray-selfupdate: 启动新托盘失败: " + error);
                }
            }
            catch (Exception ex)
            {
                // 自替换失败不能把异常抛出去（此时还没注册全局异常处理器），
                // 记日志后静默退出，旧托盘文件保持可用。
                AppLog.Write("tray-selfupdate: 自替换失败: " + ex);
            }
            return true;
        }

        private static string BuildLaunchArgsFor(bool silent, bool startServer)
        {
            string args = "";
            if (silent) args += " --silent";
            if (startServer) args += " --start-server";
            return args.Trim();
        }

        /// <summary>
        /// 等指定进程退出（最多 timeout，超时只记日志）。托盘自迁移/自替换用它避免
        /// 「两个实例抢同一个互斥体」或「覆盖还被锁住的 exe」。
        /// </summary>
        public static void WaitForExit(int pid, TimeSpan timeout)
        {
            try
            {
                Process process = Process.GetProcessById(pid);
                if (!process.WaitForExit((int)timeout.TotalMilliseconds))
                {
                    AppLog.Write("tray-selfupdate: 等待旧进程超时，继续尝试替换");
                }
                process.Close();
            }
            catch (ArgumentException)
            {
                // 进程已经不在了，正常路径
            }
            catch (Exception ex)
            {
                AppLog.Write("tray-selfupdate: 等待旧进程失败: " + ex.Message);
            }
            // 句柄释放后镜像文件可能还被短暂锁住，先等一拍再覆盖
            Thread.Sleep(500);
        }

        /// <summary>
        /// 覆盖目标 exe：旧进程刚退出时镜像可能还被短暂锁住，重试 30 次（每次 500ms）。
        /// 覆盖失败时保留旧版本继续可用，下次升级再试。
        /// </summary>
        private static bool ReplaceWithRetry(string staged, string target)
        {
            for (int attempt = 0; attempt < 30; attempt++)
            {
                try
                {
                    File.Copy(staged, target, true);
                    try { File.Delete(staged); } catch (Exception) { }
                    AppLog.Write("tray-selfupdate: 已替换 " + target);
                    return true;
                }
                catch (Exception ex)
                {
                    if (attempt == 29)
                    {
                        AppLog.Write("tray-selfupdate: 覆盖 " + target + " 失败: " + ex.Message +
                            "（沿用当前版本）");
                        return false;
                    }
                    Thread.Sleep(500);
                }
            }
            return false;
        }

        /// <summary>
        /// 清理旧版留下的自我更新脚本（旧版本会写 %APPDATA%\atlisp-mcp\update-tray.cmd）。
        /// 新版本不再生成这种脚本，残留文件既没用又容易被杀软当成可疑样本。
        /// </summary>
        public static void CleanupLegacyScript()
        {
            try
            {
                string legacy = Path.Combine(Paths.DataDir, "update-tray.cmd");
                if (File.Exists(legacy)) File.Delete(legacy);
            }
            catch (Exception ex)
            {
                AppLog.Write("tray-selfupdate: 清理旧更新脚本失败: " + ex.Message);
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

    /// <summary>
    /// 后台下载（Node.js zip/MSI、Python 安装包）。
    ///
    /// 用 HttpWebRequest + 工作线程，而不是 WebClient.DownloadFileAsync：
    /// 「WebClient + DownloadFile + 随后 Process.Start」是杀软 ML 里权重很高的
    /// 下载器组合，而这个类做的本来就是普通的 HTTP GET + 自己写文件。
    /// 先写 `.part` 再改名，下载中断不会留下半截文件被后续步骤当成成品。
    /// </summary>
    internal sealed class DownloadJob : IDisposable
    {
        private readonly object _sync = new object();
        private readonly string _url;
        private readonly string _filePath;
        private HttpWebRequest _request;
        private Stream _stream;
        private volatile bool _cancelled;
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
            Thread worker = new Thread(Download);
            worker.IsBackground = true;
            worker.Name = "atlisp-download";
            worker.Start();
        }

        private void Download()
        {
            string temp = _filePath + ".part";
            bool ok = false;
            string error = null;
            try
            {
                string directory = Path.GetDirectoryName(_filePath);
                if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);
                if (File.Exists(temp))
                {
                    try { File.Delete(temp); } catch { }
                }

                HttpWebRequest request = (HttpWebRequest)WebRequest.Create(new Uri(_url));
                request.UserAgent = "atlisp-tray/" + Program.AppVersion;
                request.Timeout = 60000;
                request.ReadWriteTimeout = 60000;
                request.AllowAutoRedirect = true;
                _request = request;

                using (WebResponse response = request.GetResponse())
                {
                    long total = response.ContentLength;
                    lock (_sync) _total = total;

                    using (Stream remote = response.GetResponseStream())
                    {
                        _stream = remote;
                        using (FileStream local = new FileStream(temp, FileMode.Create,
                            FileAccess.Write, FileShare.None, 81920))
                        {
                            byte[] buffer = new byte[81920];
                            while (true)
                            {
                                if (_cancelled) throw new OperationCanceledException();
                                int read = remote.Read(buffer, 0, buffer.Length);
                                if (read <= 0) break;
                                local.Write(buffer, 0, read);
                                lock (_sync) _received += read;
                            }
                        }
                    }
                }

                FileInfo info = new FileInfo(temp);
                if (!info.Exists || info.Length <= 0)
                {
                    throw new IOException("下载文件为空。");
                }
                if (_total > 0 && info.Length != _total)
                {
                    throw new IOException("下载不完整（" + info.Length + " / " + _total + " 字节）。");
                }
                if (File.Exists(_filePath)) File.Delete(_filePath);
                File.Move(temp, _filePath);
                ok = true;
            }
            catch (Exception ex)
            {
                error = _cancelled ? "下载已取消" : ex.Message;
            }
            finally
            {
                _stream = null;
                _request = null;
                if (!ok) TryDelete(temp);
                lock (_sync)
                {
                    _success = ok;
                    if (!ok) _error = error ?? "下载失败。";
                    _finished = true;
                }
            }
        }

        private static void TryDelete(string path)
        {
            try
            {
                if (File.Exists(path)) File.Delete(path);
            }
            catch (Exception)
            {
                // 文件被占用时留给下次下载覆盖，不打扰用户
            }
        }

        public void Dispose()
        {
            _cancelled = true;
            try
            {
                if (_request != null) _request.Abort();
            }
            catch (Exception)
            {
            }
            try
            {
                if (_stream != null) _stream.Close();
            }
            catch (Exception)
            {
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
                if (!HasPython) return "运行环境：未检测到 Python 3.10+（可自动安装）";
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

    internal static class PythonRunner
    {
        public static string DetectArch()
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
            if (Environment.Is64BitOperatingSystem) return "amd64";
            return "win32";
        }

        /// <summary>
        /// 官方安装包地址。32 位包名没有架构后缀（python-3.12.8.exe），
        /// 这是 installers 的命名规则，别统一加后缀。
        /// </summary>
        public static string BuildInstallerUrl(TrayConfig config, string version, string arch)
        {
            string mirror = string.IsNullOrEmpty(config.PythonMirror)
                ? "https://registry.npmmirror.com/-/binary/python"
                : config.PythonMirror;
            string suffix = arch == "win32" ? "" : "-" + arch;
            return mirror.TrimEnd('/') + "/" + version + "/python-" + version +
                suffix + ".exe";
        }

        public static Process CreatePipInstall(string pythonPath, string package,
            DataReceivedEventHandler outputHandler, DataReceivedEventHandler errorHandler)
        {
            string arguments = "-m pip install --upgrade --disable-pip-version-check " + package;
            return ProcessRunner.Create(pythonPath, arguments, Encoding.UTF8, null,
                outputHandler, errorHandler);
        }

        /// <summary>
        /// 清理 pip 卸载中断留下的「~包名」残留目录。
        /// pip 卸载时先把包目录改名成 "~&lt;包名&gt;" 再删；删除失败（.pyd/.dll 被正在运行的
        /// 进程占用）就把改名后的目录留在 site-packages 里，之后**每条 pip 命令**都会刷
        /// "WARNING: Ignoring invalid distribution ~tlisp-dwg-kb"。
        /// 返回值：删除的目录数。
        /// </summary>
        public static int CleanBrokenDistributions(string pythonPath, string package)
        {
            int removed = 0;
            try
            {
                if (string.IsNullOrEmpty(pythonPath) || string.IsNullOrEmpty(package) ||
                    package.Length < 2)
                {
                    return 0;
                }
                string root = Path.GetDirectoryName(pythonPath);
                if (string.IsNullOrEmpty(root)) return 0;
                string sitePackages = Path.Combine(root, "Lib", "site-packages");
                if (!Directory.Exists(sitePackages)) return 0;

                // pip 的改名规则是把首字符换成 '~'；.dist-info 目录还会把 '-' 换成 '_'
                string dashed = "~" + package.Substring(1).ToLowerInvariant();
                string underscored = "~" + package.Replace('-', '_')
                    .Substring(1).ToLowerInvariant();
                foreach (string dir in Directory.GetDirectories(sitePackages, "~*"))
                {
                    string name = Path.GetFileName(dir).ToLowerInvariant();
                    if (!name.StartsWith(dashed) && !name.StartsWith(underscored)) continue;
                    try
                    {
                        Directory.Delete(dir, true);
                        removed++;
                    }
                    catch (Exception ex)
                    {
                        // 又被占用就留着，下次 pip 任务前再试
                        AppLog.Write("pip cleanup: 删除 " + dir + " 失败: " + ex.Message);
                    }
                }
            }
            catch (Exception ex)
            {
                AppLog.Write("pip cleanup: " + ex.Message);
            }
            return removed;
        }

        /// <summary>
        /// 查询 PyPI 上某个包的最新版本，不安装任何东西。
        /// 先走 PyPI JSON（一次 HTTP，快）；失败再回退 `pip index versions`
        /// （会走用户配置的镜像/代理，也能兼容公司内网源）。
        /// </summary>
        public static string CheckLatestVersion(PythonInfo info, string package, out string error)
        {
            error = null;
            string latest = PyPiClient.LatestVersion(package, 8000, out error);
            if (!string.IsNullOrEmpty(latest)) return latest.Trim();
            string pypiError = error;

            if (info == null || !info.HasPython) return null;

            int code;
            string output = ProcessRunner.Run(info.PythonPath,
                "-m pip index versions " + package + " --disable-pip-version-check",
                40000, out code, Encoding.UTF8);
            if (code == 0)
            {
                Match match = Regex.Match(output,
                    Regex.Escape(package) + @"\s*\(([^)]+)\)",
                    RegexOptions.IgnoreCase);
                if (match.Success)
                {
                    error = null;
                    return match.Groups[1].Value.Trim();
                }
            }
            if (string.IsNullOrEmpty(pypiError))
            {
                pypiError = "pip index 退出码 " + code;
            }
            error = pypiError;
            return null;
        }

        /// <summary>
        /// 静默安装官方安装包到用户目录：InstallAllUsers=0 是**免 UAC** 的关键，
        /// PrependPath=0 不改用户 PATH（路径由托盘自己记），Shortcuts=0 不建快捷方式。
        /// </summary>
        public static int InstallSilently(string installerPath, string targetDir, out string error)
        {
            error = null;
            try
            {
                string arguments = "/quiet InstallAllUsers=0 TargetDir=\"" + targetDir + "\" " +
                    "PrependPath=0 Shortcuts=0 Include_pip=1 Include_test=0 Include_doc=0 " +
                    "Include_tcltk=0 Include_launcher=0";
                int exitCode;
                string output = ProcessRunner.Run(installerPath, arguments, 300000,
                    out exitCode, Encoding.UTF8);
                if (exitCode != 0)
                {
                    error = "安装程序退出码 " + exitCode +
                        (string.IsNullOrEmpty(output) ? "" : "：" + TailText(output, 300));
                }
                return exitCode;
            }
            catch (Exception ex)
            {
                error = ex.Message;
                return -1;
            }
        }

        private static string TailText(string text, int max)
        {
            if (string.IsNullOrEmpty(text)) return "";
            text = text.Trim();
            if (text.Length <= max) return text;
            return text.Substring(text.Length - max);
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
            int code;
            string output = ProcessRunner.Run("netstat.exe", "-ano", 6000, out code, Encoding.Default);
            if (code != 0 || string.IsNullOrEmpty(output)) return 0;

            string[] lines = output.Split(new char[] { '\r', '\n' },
                StringSplitOptions.RemoveEmptyEntries);
            for (int i = 0; i < lines.Length; i++)
            {
                string[] parts = lines[i].Trim().Split(
                    new char[] { ' ', '\t' }, StringSplitOptions.RemoveEmptyEntries);
                if (parts.Length < 5) continue;
                if (!parts[0].Equals("TCP", StringComparison.OrdinalIgnoreCase)) continue;
                if (parts[3].IndexOf("LISTEN", StringComparison.OrdinalIgnoreCase) < 0) continue;

                string local = parts[1];
                int colon = local.LastIndexOf(':');
                if (colon <= 0) continue;
                int listenerPort;
                if (!int.TryParse(local.Substring(colon + 1), out listenerPort)) continue;
                if (listenerPort != port) continue;

                int pid;
                if (!int.TryParse(parts[4], out pid)) continue;
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
            return 0;
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
    /// PyPI 版本查询。只用公开 JSON API（`https://pypi.org/pypi/&lt;pkg&gt;/json`），
    /// 不下载任何文件；网络不通时返回 null 并由调用方回退到 `pip index versions`
    /// （pip 会走用户自己配置的镜像/代理，国内网络更可靠）。
    /// </summary>
    internal static class PyPiClient
    {
        public static string LatestVersion(string package, int timeoutMs, out string error)
        {
            error = null;
            try
            {
                string url = "https://pypi.org/pypi/" + package + "/json";
                HttpWebRequest request = (HttpWebRequest)WebRequest.Create(url);
                request.Method = "GET";
                request.Proxy = null;
                request.KeepAlive = false;
                request.Timeout = timeoutMs;
                request.ReadWriteTimeout = timeoutMs;
                request.UserAgent = "atlisp-tray/" + Program.AppVersion;

                string body;
                using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
                using (Stream stream = response.GetResponseStream())
                using (StreamReader reader = new StreamReader(stream, Encoding.UTF8))
                {
                    body = reader.ReadToEnd();
                }

                JavaScriptSerializer serializer = new JavaScriptSerializer();
                Dictionary<string, object> root =
                    serializer.DeserializeObject(body) as Dictionary<string, object>;
                if (root == null)
                {
                    error = "PyPI 响应不是 JSON 对象";
                    return null;
                }
                object infoValue;
                if (!root.TryGetValue("info", out infoValue))
                {
                    error = "PyPI 响应缺少 info 字段";
                    return null;
                }
                Dictionary<string, object> info = infoValue as Dictionary<string, object>;
                if (info == null)
                {
                    error = "PyPI 响应 info 字段格式异常";
                    return null;
                }
                object versionValue;
                if (!info.TryGetValue("version", out versionValue) || versionValue == null)
                {
                    error = "PyPI 响应缺少 version 字段";
                    return null;
                }
                string version = Convert.ToString(versionValue).Trim();
                if (version.Length == 0)
                {
                    error = "PyPI 返回空版本号";
                    return null;
                }
                return version;
            }
            catch (Exception ex)
            {
                error = ex.Message;
                return null;
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
        private readonly ToolStripMenuItem _mirrorItem;
        private readonly ToolStripMenuItem _diagItem;
        private readonly ToolStripMenuItem _autoInstallItem;
        private readonly ToolStripMenuItem _autoUpgradeItem;

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
        private readonly ToolStripMenuItem _dwgKbAutoUpgradeItem;
        private readonly ToolStripMenuItem _dwgKbRebuildItem;
        private readonly ToolStripMenuItem _dwgKbConfigItem;
        private readonly object _dwgKbLock = new object();
        private DwgKbStatus _dwgKbStatus;
        private PythonInfo _dwgKbPython;
        private DateTime _dwgKbCheckedAt = DateTime.MinValue;
        private bool _dwgKbBusy;
        private bool _dwgKbBuilding;
        private bool _pythonInstalling;
        private bool _dwgKbStartPipRequested;
        private bool _dwgKbAutoStartAttempted;
        // ---- 知识库自动安装 / 自动升级（零人工干预）----
        // _dwgKbAutoFlow 表示当前这轮 pip/Python 流程是自动发起的：失败只记日志 +
        // 退避重试，不弹模态框（无人值守时模态框会让托盘卡死）。
        private bool _dwgKbAutoFlow;
        private bool _dwgKbUpdateChecking;
        private bool _dwgKbAutoStartAfterInstall;
        private bool _dwgKbRestartAfterUpgrade;
        private string _dwgKbLatestVersion;
        /// <summary>本次 pip 任务开始前已安装的知识库版本，用于判断是否真的升级了。</summary>
        private string _dwgKbVersionBefore;
        private string _dwgKbPendingUpgrade;
        private DateTime _nextDwgKbCheckAt = DateTime.MinValue;
        private DateTime _dwgKbTaskRetryAt = DateTime.MinValue;
        private int _dwgKbTaskFailures;
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
        private DateTime _createdAt = DateTime.UtcNow;
        private DateTime _nextUpdateCheckAt = DateTime.MinValue;
        // 服务异常退出后自动拉起（退避 1/2/5/10/30 分钟，连续 5 次失败后停手）
        private const int ServerRestartMaxFailures = 5;
        private DateTime _serverRestartRetryAt = DateTime.MinValue;
        private int _serverRestartFailures;
        // 升级/安装时不再一开始就停服务；只有替换文件被占用（Windows 文件锁）时才
        // 释放包目录占用并重试（见 ReleasePackageDir）。这里是最多重试次数。
        private const int InstallStopMaxRetries = 2;
        private int _installStopRetries;
        private int _dwgKbStopRetries;
        // 用户点过「停止知识库服务」后不再自动拉起，直到手动启动或下次开托盘
        private bool _dwgKbUserStopped;
        private DateTime _dwgKbRestartRetryAt = DateTime.MinValue;
        private int _dwgKbRestartFailures;
        // 本机包升级后旧服务仍在跑：自动重启一次让新版本生效（带退避，最多 3 次）
        private DateTime _dwgKbSyncRetryAt = DateTime.MinValue;
        private int _dwgKbSyncFailures;
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

            _upgradeItem = new ToolStripMenuItem("升级到最新版");
            _upgradeItem.Click += delegate { UpgradeServer(); };

            _installItem = new ToolStripMenuItem("下载并安装 @lisp MCP Server");
            _installItem.Click += delegate { InstallServer(); };

            _nodeItem = new ToolStripMenuItem("安装 Node.js…");
            _nodeItem.ToolTipText = "自动下载安装 Node.js（国内走 npmmirror 镜像）";
            _nodeItem.Click += delegate { InstallNodeFromMirror(true); };

            _trayAutoItem = new ToolStripMenuItem("随 Windows 启动托盘");
            _trayAutoItem.ToolTipText = "开机后自动启动托盘，由托盘拉起各服务";
            _trayAutoItem.Click += delegate { ToggleTrayAutostart(); };

            _serverAutoItem = new ToolStripMenuItem("启动托盘时自动启动 MCP");
            _serverAutoItem.ToolTipText = "关闭后托盘只做管理，不主动启动 MCP 服务";
            _serverAutoItem.Click += delegate { ToggleServerAutostart(); };

            _mirrorItem = new ToolStripMenuItem("使用 npmmirror 国内镜像");
            _mirrorItem.ToolTipText = "国内网络建议开启，下载 Node.js / npm 包更快";
            _mirrorItem.Click += delegate { ToggleMirror(); };

            _autoInstallItem = new ToolStripMenuItem("启动时自动补齐运行环境");
            _autoInstallItem.ToolTipText = "缺 Node.js / @lisp/mcp / Python / 知识库时自动下载安装";
            _autoInstallItem.Click += delegate { ToggleAutoInstall(); };

            _autoUpgradeItem = new ToolStripMenuItem("自动升级 @lisp/mcp");
            _autoUpgradeItem.Click += delegate { ToggleAutoUpgrade(); };

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
            _dwgKbAutoStartItem.ToolTipText = "未安装时自动补齐 Python 与知识库包，然后启动";
            _dwgKbAutoStartItem.Click += delegate { ToggleDwgKbAutoStart(); };

            _dwgKbAutoUpgradeItem = new ToolStripMenuItem("自动检查新版本");
            _dwgKbAutoUpgradeItem.ToolTipText = "定时查 PyPI，发现新版本静默升级，完成后自动恢复服务";
            _dwgKbAutoUpgradeItem.Click += delegate { ToggleDwgKbAutoUpgrade(); };

            _dwgKbInstallItem = new ToolStripMenuItem("安装 / 升级知识库…");
            _dwgKbInstallItem.ToolTipText = "从 PyPI 安装或升级 atlisp-dwg-kb";
            _dwgKbInstallItem.Click += delegate { InstallDwgKb(); };

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
            _dwgKbMenu.DropDownItems.Add(_dwgKbAutoUpgradeItem);
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
            _settingsMenu.DropDownItems.Add(_autoInstallItem);
            _settingsMenu.DropDownItems.Add(_autoUpgradeItem);
            _settingsMenu.DropDownItems.Add(_mirrorItem);
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

                // 知识库重建结果由后台线程产生，气泡只能在这里（UI 线程）弹
                if (_dwgKbBalloonPending)
                {
                    _dwgKbBalloonPending = false;
                    Balloon(_dwgKbBalloonTitle, _dwgKbBalloonText, _dwgKbBalloonIcon);
                }

                // Python 装好了 → 在 UI 线程接着跑 pip（后台线程不能建任务窗口）
                if (_dwgKbStartPipRequested)
                {
                    _dwgKbStartPipRequested = false;
                    InstallDwgKb(_dwgKbAutoFlow);
                }

                // 后台线程查到的知识库新版本：在 UI 线程启动 pip（LongTask 只能在 UI 线程建）
                string pendingUpgrade = null;
                lock (_dwgKbLock)
                {
                    if (_dwgKbPendingUpgrade != null)
                    {
                        pendingUpgrade = _dwgKbPendingUpgrade;
                        _dwgKbPendingUpgrade = null;
                    }
                }
                if (pendingUpgrade != null) AutoUpgradeDwgKb(pendingUpgrade);

                // 启动后稍等片刻再补齐环境，避免和首轮 UI/健康检测抢线程
                if (_config.AutoInstall && !_autoInstallDone &&
                    (DateTime.UtcNow - _createdAt).TotalSeconds > 3)
                {
                    AutoBootstrap();
                }

                // 知识库自动启动：等首轮环境检测稳定后再拉，避免和 AutoBootstrap 抢线程。
                // 没装 Python/包时这里会触发自动安装，装好后自动拉起（见 EnsureDwgKbStartedOnLaunch）。
                if (_config.DwgKbAutoStart && !_dwgKbAutoStartAttempted &&
                    (DateTime.UtcNow - _createdAt).TotalSeconds > 5 &&
                    !TaskBusy() && !_pythonInstalling)
                {
                    EnsureDwgKbStartedOnLaunch();
                }

                if (_config.CheckUpdateOnStart && !_config.AutoUpgrade && !_startupUpdateChecked &&
                    (DateTime.UtcNow - _createdAt).TotalSeconds > 20)
                {
                    _startupUpdateChecked = true;
                    CheckUpdate(true);
                }

                MaybeAutoUpgrade();
                MaybeAutoUpgradeDwgKb();
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
            bool busy = _task != null && !_task.Finished;
            bool updating = busy || _downloadJob != null;

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
                ? "重新安装 / 修复安装"
                : "下载并安装 @lisp MCP Server";
            _nodeItem.Enabled = !updating;
            _nodeItem.Text = "安装 Node.js v" + _config.NodeVersion + "…";

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
            _autoUpgradeItem.Text = "自动升级 @lisp/mcp（每 " +
                (_config.AutoUpgradeHours > 0 ? _config.AutoUpgradeHours : 24) + " 小时）";

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
            string latest;
            lock (_dwgKbLock)
            {
                status = _dwgKbStatus;
                python = _dwgKbPython;
                latest = _dwgKbLatestVersion;
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
                if (!string.IsNullOrEmpty(latest) && installed &&
                    VersionUtil.IsNewer(latest, localVersion))
                {
                    text += " · 正在升级到 v" + latest + "…";
                }
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
                        " 比本机 v" + localVersion + " 新，可点「升级知识库」";
                }
                else if (localNewer)
                {
                    _dwgKbVersionHintItem.Text = "服务 v" + serviceVersion +
                        " 落后于本机 v" + localVersion + "（外部服务，需手动重启）";
                }
                else
                {
                    _dwgKbVersionHintItem.Text = "本机 v" + localVersion +
                        " 落后于服务 v" + serviceVersion + "，可点「升级知识库」";
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

            _dwgKbInstallItem.Enabled = !_dwgKbBuilding && !_pythonInstalling && !TaskBusy();
            if (installed)
            {
                string upgrade = "升级知识库（当前 v" + localVersion;
                if (!string.IsNullOrEmpty(latest) &&
                    VersionUtil.IsNewer(latest, localVersion))
                {
                    upgrade += " → v" + latest;
                }
                _dwgKbInstallItem.Text = upgrade + "）…";
            }
            else
            {
                _dwgKbInstallItem.Text = "安装知识库…";
            }

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
            bool canManage = local && !_dwgKbBuilding && !_pythonInstalling && !TaskBusy();
            _dwgKbStartItem.Visible = local;
            _dwgKbStartItem.Enabled = canManage && installed && !online && !ownedRunning;
            _dwgKbStopItem.Visible = local;
            _dwgKbStopItem.Enabled = canManage && (ownedRunning || online);
            _dwgKbRestartItem.Visible = local;
            _dwgKbRestartItem.Enabled = canManage && installed && (ownedRunning || online);
            _dwgKbAutoStartItem.Checked = _config.DwgKbAutoStart;
            // 未装包时也要能关掉「自动安装/自动启动」，否则用户没有出口
            _dwgKbAutoStartItem.Enabled = local;
            _dwgKbAutoUpgradeItem.Checked = _config.DwgKbAutoUpgrade;
            _dwgKbAutoUpgradeItem.Enabled = local;
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
                        "先用菜单「图纸知识库 → 安装 / 升级知识库…」安装 atlisp-dwg-kb。",
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
                    ScheduleDwgKbRetry("知识库服务启动失败：" + error);
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
                // 勾选那一刻就把服务拉起来，语义比「下次启动才生效」直观；
                // 还没装包时按配置自动补齐（Python → pip → 启动）。
                PythonInfo info = PythonLocator.Resolve(_config, false);
                if (!info.HasPackage && _config.AutoInstall) AutoInstallDwgKb();
                else StartDwgKbService();
            }
        }

        private void ToggleDwgKbAutoUpgrade()
        {
            _config.DwgKbAutoUpgrade = !_config.DwgKbAutoUpgrade;
            _config.Save();
            UpdateDwgKbUi();
            if (_config.DwgKbAutoUpgrade)
            {
                // 勾选后立刻查一次，不必等下一个定时周期
                _nextDwgKbCheckAt = DateTime.MinValue;
                _dwgKbTaskRetryAt = DateTime.MinValue;
            }
        }

        /// <summary>
        /// 知识库自动启动：地址必须是本机。没装包时（且 AutoInstall 开启）自动建环境：
        /// 没 Python → 下载静默安装；有 Python → pip 装包；装完自动拉起服务。
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
            if (_dwgKbAutoFlow || _pythonInstalling || TaskBusy()) return;
            if (DateTime.UtcNow < _dwgKbTaskRetryAt) return;

            PythonInfo info = PythonLocator.Resolve(_config, false);
            lock (_dwgKbLock) { _dwgKbPython = info; }

            if (!info.HasPackage)
            {
                if (!_config.AutoInstall)
                {
                    _dwgKbAutoStartAttempted = true;
                    return;
                }
                AppLog.Write("dwg-kb: auto-provision（Python=" +
                    (info.HasPython ? info.Version : "未安装") + "）");
                _dwgKbAutoStartAttempted = true;
                AutoInstallDwgKb();
                return;
            }

            _dwgKbAutoStartAttempted = true;
            AppLog.Write("dwg-kb: auto-start on launch");
            StartDwgKbService();
        }

        /// <summary>
        /// 定时检查知识库新版本并自动升级（间隔与 @lisp/mcp 共用 AutoUpgradeHours）。
        /// 只对「本机地址」生效：配成局域网服务器时本机装的包用不上。
        /// </summary>
        private void MaybeAutoUpgradeDwgKb()
        {
            if (!_config.DwgKbAutoUpgrade && !_config.AutoInstall) return;
            if (!DwgKbServer.IsLocalUrl(_config.DwgKbUrl)) return;
            if (TaskBusy() || _pythonInstalling || _dwgKbUpdateChecking || _dwgKbAutoFlow) return;

            DateTime now = DateTime.UtcNow;
            if (_nextDwgKbCheckAt == DateTime.MinValue)
            {
                if ((now - _createdAt).TotalSeconds < 30) return;
            }
            else if (now < _nextDwgKbCheckAt)
            {
                return;
            }
            if (now < _dwgKbTaskRetryAt) return;

            int hours = _config.AutoUpgradeHours > 0 ? _config.AutoUpgradeHours : 24;
            _nextDwgKbCheckAt = now.AddHours(hours);

            PythonInfo info = PythonLocator.Resolve(_config, false);
            lock (_dwgKbLock) { _dwgKbPython = info; }

            if (!info.HasPackage)
            {
                // 自动补齐：启动阶段没装完（或当时任务冲突）的在这里继续
                if (_config.AutoInstall && _config.DwgKbAutoStart) AutoInstallDwgKb();
                return;
            }
            if (!_config.DwgKbAutoUpgrade) return;
            StartDwgKbVersionCheck(info);
        }

        /// <summary>
        /// 后台线程查 PyPI 最新版本（HTTP + 可能的 pip index，几秒），
        /// 结果放 _dwgKbPendingUpgrade，由 UI 定时器启动 pip。
        /// </summary>
        private void StartDwgKbVersionCheck(PythonInfo info)
        {
            _dwgKbUpdateChecking = true;
            PythonInfo snapshot = info;
            ThreadPool.QueueUserWorkItem(delegate
            {
                string error;
                string latest = PythonRunner.CheckLatestVersion(snapshot, "atlisp-dwg-kb", out error);
                bool newer = !string.IsNullOrEmpty(latest) &&
                    VersionUtil.IsNewer(latest, snapshot.PackageVersion);
                lock (_dwgKbLock)
                {
                    _dwgKbUpdateChecking = false;
                    _dwgKbLatestVersion = latest;
                    if (newer) _dwgKbPendingUpgrade = latest;
                }
                if (string.IsNullOrEmpty(latest))
                {
                    AppLog.Write("dwg-kb update check failed: " + error);
                }
                else if (newer)
                {
                    AppLog.Write("dwg-kb update: " + snapshot.PackageVersion + " -> " + latest);
                }
            });
        }

        /// <summary>
        /// 静默升级：先停掉托盘启动的知识库进程（Windows 会锁 .pyd），pip 升级完成后
        /// 由 HandleTaskSuccess 自动拉起。不弹任务窗口、不询问，失败走退避重试。
        /// </summary>
        private void AutoUpgradeDwgKb(string latest)
        {
            if (TaskBusy() || _pythonInstalling) return;

            PythonInfo info = PythonLocator.Resolve(_config, false);
            lock (_dwgKbLock) { _dwgKbPython = info; }
            if (!info.HasPackage || !VersionUtil.IsNewer(latest, info.PackageVersion)) return;

            // 不在开始时停知识库：pip 先下载，真正替换 .pyd 被占用时失败处理里
            // 会停服务并重试（见 HandleTaskFailure）
            _dwgKbAutoFlow = true;
            AppLog.Write("dwg-kb auto-upgrade: " + info.PackageVersion + " -> " + latest);
            if (!_silent)
            {
                Balloon("正在自动升级知识库",
                    "atlisp-dwg-kb " + info.PackageVersion + " → " + latest +
                    "，完成后自动恢复服务。",
                    ToolTipIcon.Info);
            }
            RunPipTask(info, "自动升级知识库（v" + latest + "）", "dwgkb-upgrade-auto", false);
        }

        /// <summary>无人值守安装：没 Python 先装 Python，装完由定时器接着 pip 装包。</summary>
        private void AutoInstallDwgKb()
        {
            if (_dwgKbAutoFlow || _pythonInstalling) return;
            if (TaskBusy()) return;
            if (DateTime.UtcNow < _dwgKbTaskRetryAt) return;
            if (!DwgKbServer.IsLocalUrl(_config.DwgKbUrl)) return;

            _dwgKbAutoFlow = true;
            _dwgKbAutoStartAfterInstall = true;
            AppLog.Write("dwg-kb auto: 开始自动安装");
            InstallDwgKb(true);
        }

        /// <summary>自动流程失败后的退避：5 → 30 → 180 分钟，避免网络故障时反复下载。</summary>
        private void ScheduleDwgKbRetry(string reason)
        {
            _dwgKbTaskFailures++;
            int minutes = _dwgKbTaskFailures <= 1 ? 5 : (_dwgKbTaskFailures <= 2 ? 30 : 180);
            _dwgKbTaskRetryAt = DateTime.UtcNow.AddMinutes(minutes);
            _dwgKbAutoFlow = false;
            _dwgKbAutoStartAfterInstall = false;
            AppLog.Write("dwg-kb auto: " + reason + "（第 " + _dwgKbTaskFailures +
                " 次失败，" + minutes + " 分钟后重试）");
            // 按退避时间重新检查，而不是干等下一个整点
            _nextDwgKbCheckAt = _dwgKbTaskRetryAt;
            // 这个函数也可能从后台线程（Python 静默安装结束）调用，气泡交给 UI 定时器弹
            _dwgKbBalloonTitle = "知识库自动安装/升级失败";
            _dwgKbBalloonText = reason + "\r\n将在 " + minutes + " 分钟后自动重试。";
            _dwgKbBalloonIcon = ToolTipIcon.Warning;
            _dwgKbBalloonPending = true;
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
            if (TaskBusy() || _pythonInstalling || _dwgKbAutoFlow || _dwgKbUpdateChecking) return;
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
            if (TaskBusy() || _pythonInstalling || _dwgKbAutoFlow || _dwgKbUpdateChecking ||
                _dwgKbBuilding) return;
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

        /// <summary>
        /// 「安装 / 升级知识库」：从 PyPI 安装 atlisp-dwg-kb。
        /// 没 Python 先走自动安装 Python（用户目录、免 UAC），装完自动接着装包。
        /// auto=true 时用于无人值守流程：不弹确认框、不弹任务窗口，失败走退避重试。
        /// </summary>
        private void InstallDwgKb(bool auto = false)
        {
            if (_pythonInstalling)
            {
                if (!auto) Balloon("请稍候", "正在安装 Python，完成后会自动继续。", ToolTipIcon.Info);
                return;
            }
            if (TaskBusy())
            {
                if (!auto) Balloon("请稍候", "已有下载/更新任务正在进行。", ToolTipIcon.Info);
                return;
            }

            PythonInfo info = PythonLocator.Resolve(_config, false);
            lock (_dwgKbLock) { _dwgKbPython = info; }
            UpdateDwgKbUi();

            if (!info.HasPython)
            {
                if (auto)
                {
                    AppLog.Write("dwg-kb auto: 未检测到 Python，开始自动下载安装");
                    _dwgKbAutoFlow = true;
                    InstallPythonFromMirror();
                }
                else
                {
                    PromptInstallPython();
                }
                return;
            }
            if (!info.HasPip)
            {
                if (auto)
                {
                    ScheduleDwgKbRetry("Python " + info.Version + " 缺少 pip");
                }
                else
                {
                    ShowError("无法安装知识库",
                        "检测到 Python " + info.Version + "，但 pip 不可用。\r\n\r\n" +
                        "请重新安装 Python（勾选 pip），或手动执行：\r\n" +
                        info.PythonPath + " -m ensurepip --upgrade");
                }
                return;
            }

            // 不再升级前停止知识库：pip 先下载，只有在替换 .pyd 被占用时
            // HandleTaskFailure 会停服务并重试一次；成功后自动按原状态拉起。
            string title = info.HasPackage ? "升级知识库（PyPI）" : "安装知识库（PyPI）";
            string action = (info.HasPackage ? "dwgkb-upgrade" : "dwgkb-install") +
                (auto ? "-auto" : "");
            _dwgKbAutoFlow = auto;
            if (auto) AppLog.Write("dwg-kb auto: " + title);
            RunPipTask(info, title, action, !auto);
        }

        private void PromptInstallPython()
        {
            string version = _config.PythonVersion;
            string arch = PythonRunner.DetectArch();
            DialogResult result = MessageBox.Show(
                "未检测到 Python 3.10+。知识库（atlisp-dwg-kb）是 Python 包，需要先安装 Python。\r\n\r\n" +
                "是否自动下载并安装 Python v" + version + "（" + arch + "）？\r\n" +
                "约 25 MB，安装到用户目录：\r\n" + Paths.PythonDir + "\r\n" +
                "（无需管理员权限，不改系统 PATH）",
                "@lisp MCP 托盘 - 知识库",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Question);
            if (result != DialogResult.Yes) return;
            InstallPythonFromMirror();
        }

        private void InstallPythonFromMirror()
        {
            if (_pythonInstalling) return;

            string version = _config.PythonVersion;
            string arch = PythonRunner.DetectArch();
            string url = PythonRunner.BuildInstallerUrl(_config, version, arch);
            string filePath = Path.Combine(Paths.DownloadDir,
                "python-" + version + "-" + arch + ".exe");
            try { Directory.CreateDirectory(Paths.DownloadDir); } catch { }

            _downloadKind = "python";
            _downloadVersion = version;
            _downloadArch = arch;
            _downloadUrl = url;
            _downloadJob = new DownloadJob(url, filePath);

            if (_taskWindow != null && !_taskWindow.IsDisposed)
            {
                try { _taskWindow.Close(); } catch { }
            }
            OutputForm form = new OutputForm("自动安装 Python v" + version, "", true);
            form.FormClosed += delegate { if (_taskWindow == form) _taskWindow = null; };
            _taskWindow = form;
            form.Show();
            form.Append("未检测到 Python 3.10+，正在自动下载 v" + version +
                "（" + arch + "）\r\n");
            form.Append("下载地址：" + url + "\r\n");
            form.Append("安装目录：" + Paths.PythonDir + "（无需管理员权限）\r\n\r\n");

            Balloon("正在安装 Python", "下载 v" + version + "，完成后自动安装知识库…",
                ToolTipIcon.Info);
            AppLog.Write("python: 下载 " + url);
            _downloadJob.Start();
            if (_downloadJob.Finished) PollDownload();
        }

        /// <summary>
        /// 下载完成后的静默安装 + 接着装知识库。安装器是 GUI 程序（/quiet 静默），
        /// 用后台线程等它退出，避免卡住 UI 定时器。
        /// </summary>
        /// <summary>配置的 PythonVersion 的 major.minor（如 3.12），用于 winget 包名。</summary>
        private string PythonMinorVersion()
        {
            string version = _config.PythonVersion ?? "";
            string[] parts = version.Split('.');
            if (parts.Length >= 2) return parts[0] + "." + parts[1];
            return "3.12";
        }

        private void StartPythonInstall(string installerPath)
        {
            // 校验 Authenticode：只执行能确认来源的安装包（这是「不把自己变成 dropper」的关键）
            string signer;
            string sigError;
            if (!CodeSignature.Verify(installerPath, out signer, out sigError))
            {
                AppLog.Write("python: 安装包签名校验失败 " + sigError + "（" + installerPath + "）");
                try { File.Delete(installerPath); } catch { }
                if (_dwgKbAutoFlow)
                {
                    ScheduleDwgKbRetry("Python 安装包签名校验失败：" + sigError);
                }
                else
                {
                    ShowError("Python 安装包未通过校验",
                        "已拒绝执行签名校验失败的安装包：\r\n" + sigError + "\r\n\r\n" +
                        "安装包：" + installerPath + "\r\n\r\n" +
                        "可改用 winget 安装 Python：\r\n" +
                        "  winget install Python.Python." + PythonMinorVersion() + "\r\n" +
                        "装好后托盘会自动检测到。");
                }
                return;
            }
            if (string.IsNullOrEmpty(signer) ||
                signer.IndexOf("Python Software Foundation", StringComparison.OrdinalIgnoreCase) < 0)
            {
                AppLog.Write("python: 签名主体不是 PSF（仍放行，签名本身有效）：" + signer);
            }

            _pythonInstalling = true;
            string targetDir = Paths.PythonDir;
            if (_taskWindow != null && !_taskWindow.IsDisposed)
            {
                _taskWindow.SetStatus("正在安装 Python 到用户目录（无需管理员权限）…");
            }
            AppLog.Write("python: 静默安装 " + installerPath + " -> " + targetDir);

            ThreadPool.QueueUserWorkItem(delegate
            {
                string error;
                int code = PythonRunner.InstallSilently(installerPath, targetDir, out error);
                try { File.Delete(installerPath); } catch { }

                PythonLocator.Invalidate();
                PythonInfo info = PythonLocator.Resolve(_config, true);
                _pythonInstalling = false;
                lock (_dwgKbLock) { _dwgKbPython = info; }

                if (info.HasPython)
                {
                    // pip 任务要建窗口/LongTask，只能在 UI 线程启动：这里只挂个请求，
                    // 由 OnUiTimer 在下一拍调用 InstallDwgKb()。
                    _dwgKbStartPipRequested = true;
                    _dwgKbBalloonTitle = "Python 已安装";
                    _dwgKbBalloonText = "Python " + info.Version + "，继续安装知识库…";
                    _dwgKbBalloonIcon = ToolTipIcon.Info;
                }
                else
                {
                    if (_dwgKbAutoFlow)
                    {
                        ScheduleDwgKbRetry("安装 Python 失败" +
                            (string.IsNullOrEmpty(error) ? "（退出码 " + code + "）" : "：" + error));
                    }
                    else
                    {
                        _dwgKbBalloonTitle = "安装 Python 失败";
                        _dwgKbBalloonText = string.IsNullOrEmpty(error)
                            ? ("安装程序退出码 " + code)
                            : error;
                        _dwgKbBalloonIcon = ToolTipIcon.Error;
                    }
                }
                _dwgKbBalloonPending = true;
            });
        }

        private void RunPipTask(PythonInfo info, string title, string action)
        {
            RunPipTask(info, title, action, true);
        }

        private void RunPipTask(PythonInfo info, string title, string action, bool showWindow)
        {
            if (TaskBusy())
            {
                if (!showWindow) ScheduleDwgKbRetry("已有下载/更新任务正在进行");
                else Balloon("请稍候", "已有下载/更新任务正在进行。", ToolTipIcon.Info);
                return;
            }

            string logFile = NewTaskLogFile("pip");
            LongTask task = new LongTask(title, logFile);
            task.AppendLine("Python: " + info.PythonPath);
            task.AppendLine("命令: " + info.PythonPath +
                " -m pip install --upgrade atlisp-dwg-kb");
            // 上一次升级被中断时 pip 会留下 "~tlisp-dwg-kb" 目录，之后每条 pip 命令都刷
            // "Ignoring invalid distribution" 警告，这里先清掉（纯文件操作，不额外起进程）。
            int cleaned = PythonRunner.CleanBrokenDistributions(info.PythonPath, "atlisp-dwg-kb");
            if (cleaned > 0)
            {
                task.AppendLine("已清理 " + cleaned + " 个 pip 残留目录（~ 开头的无效分发包）");
            }
            _dwgKbVersionBefore = info.PackageVersion;
            task.AppendLine("");

            Process process = PythonRunner.CreatePipInstall(info.PythonPath, "atlisp-dwg-kb",
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
                if (showWindow)
                {
                    ShowError(title, "无法启动 Python 进程，请检查安装是否完整。");
                }
                else
                {
                    if (_dwgKbRestartAfterUpgrade)
                    {
                        _dwgKbRestartAfterUpgrade = false;
                        StartDwgKbService(true);
                    }
                    ScheduleDwgKbRetry("无法启动 pip 进程");
                }
                return;
            }

            _task = task;
            _taskAction = action;
            _restartAfterTask = false;
            _taskElevated = false;
            _showTaskWindow = showWindow;
            _taskWindow = null;
            task.Attach(process);
            if (showWindow) ShowTaskWindow(title, task);
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

        /// <summary>
        /// 下载并安装 Node.js。preferWinget=true（菜单手动触发）时先试 winget：
        /// winget 的清单带哈希校验、安装包直接来自官方，比托盘自己下载更干净。
        /// 自动补齐流程仍走 portable zip（免 UAC），失败才降级。
        /// </summary>
        private void InstallNodeFromMirror()
        {
            InstallNodeFromMirror(false);
        }

        private void InstallNodeFromMirror(bool preferWinget)
        {
            if (preferWinget)
            {
                string wingetPath = ProcessRunner.Where("winget.exe");
                if (!string.IsNullOrEmpty(wingetPath))
                {
                    AppLog.Write("node: 手动安装优先使用 winget");
                    InstallNodeWithWinget();
                    return;
                }
                AppLog.Write("node: 未找到 winget，回退到镜像 MSI");
            }
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
                string status = (_downloadKind == "python"
                        ? "正在下载 Python v"
                        : "正在下载 Node.js v") + _downloadVersion +
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
                if (_downloadKind == "python")
                {
                    // Python 下载失败不能走 Node 的降级链（那会去装 Node MSI）
                    _downloadKind = null;
                    AppLog.Write("python installer download failed: " + error +
                        " url=" + _downloadUrl);
                    if (_dwgKbAutoFlow)
                    {
                        ScheduleDwgKbRetry("下载 Python 安装包失败：" + error);
                    }
                    else
                    {
                        Balloon("下载 Python 失败", error + "\r\n可稍后重试，或手动安装 Python 3.10+。",
                            ToolTipIcon.Warning);
                    }
                    return;
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
                if (_downloadKind == "python")
                {
                    _downloadKind = null;
                    if (_dwgKbAutoFlow) ScheduleDwgKbRetry("Python 安装包大小校验失败");
                    else Balloon("下载 Python 失败", sizeError, ToolTipIcon.Warning);
                    return;
                }
                OnNodeDownloadFailed(sizeError);
                return;
            }

            if (_downloadKind == "portable")
            {
                string verifyError;
                if (!DownloadVerifier.VerifyNodeZip(path, _downloadVersion,
                    _config.NodeMirror, out verifyError))
                {
                    AppLog.Write("portable: Node.js 压缩包校验失败 " + verifyError);
                    try { File.Delete(path); } catch { }
                    _downloadKind = null;
                    OnNodeDownloadFailed("下载包校验失败：" + verifyError);
                    return;
                }
                AppLog.Write("portable Node.js downloaded: " + path);
                _downloadKind = null;
                _portableJob = new PortableInstallJob(path, Paths.PortableNodeDir);
                _portableJob.Start();
                return;
            }

            if (_downloadKind == "python")
            {
                AppLog.Write("python installer downloaded: " + path);
                _downloadKind = null;
                if (_taskWindow != null && !_taskWindow.IsDisposed)
                {
                    _taskWindow.Append("\r\n下载完成：" + path +
                        "（" + FormatBytes(actual) + "）\r\n");
                }
                StartPythonInstall(path);
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

            // 只执行签名有效的 MSI（来源可验证），校验失败就别把它变成 dropper
            string signer;
            string sigError;
            if (!CodeSignature.Verify(msiPath, out signer, out sigError))
            {
                AppLog.Write("node-msi: 签名校验失败 " + sigError + "（" + msiPath + "）");
                try { File.Delete(msiPath); } catch { }
                if (_bootstrapMode)
                {
                    ScheduleAutoInstallRetry();
                    Balloon("Node.js 安装包未通过校验",
                        sigError + "\r\n\r\n稍后自动重试，或改用 winget 安装。",
                        ToolTipIcon.Warning);
                }
                else
                {
                    ShowError("Node.js 安装包未通过校验",
                        "已拒绝执行签名校验失败的安装包：\r\n" + sigError + "\r\n\r\n" +
                        "安装包：" + msiPath + "\r\n\r\n" +
                        "可改用 winget（微软会校验清单哈希）：\r\n" +
                        "  winget install OpenJS.NodeJS.LTS");
                }
                return;
            }
            if (string.IsNullOrEmpty(signer) ||
                signer.IndexOf("OpenJS", StringComparison.OrdinalIgnoreCase) < 0)
            {
                AppLog.Write("node-msi: 签名主体不是 OpenJS（仍放行，签名本身有效）：" + signer);
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
            // 新的一轮安装：重置「文件被占用」重试计数（否则上一轮的失败会影响本轮）
            _installStopRetries = 0;
            // 不在开始时停服务：npm 先下载，真正替换文件时若被占用，失败处理里会停服务重试；
            // 但半装/残留的包目录同样会挡住 npm 改名，自动安装流程里静默释放一次。
            if (!EnsurePackageDirFree(info.PackageDir, !_bootstrapMode, shouldRunAfter)) return;
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
            // 新的一轮升级：重置「文件被占用」重试计数
            _installStopRetries = 0;
            // 不在开始时停服务（见 HandleTaskFailure 里的文件占用重试），但先探测一次
            // 包目录是否被别的进程占着——占着就现在处理掉，别等 npm 下完包才 EBUSY。
            if (!EnsurePackageDirFree(info.PackageDir, true, shouldRunAfter)) return;
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

        /// <summary>
        /// 释放 npm 包目录上的所有占用，为 `npm install -g` 让路。
        ///
        /// npm 替换全局包的方式是把整个包目录改名（`@atlisp/mcp` → `.mcp-XXXXXX`），
        /// 只要目录里还有进程的 CWD 或已映射的原生模块，Windows 就拒绝改名（EBUSY）。
        /// 托盘能控制的先停（自己拉起的服务、Windows 服务、自己的 CWD），剩下的
        /// 只能按「可执行文件路径 / 命令行里带包目录」匹配后结束——那通常是
        /// MCP 客户端拉起的 server、残留的 cad-worker 或从包目录运行的旧托盘。
        /// </summary>
        /// <param name="ask">true 时结束第三方进程前先确认（手动升级）；自动升级静默处理</param>
        /// <param name="blockers">失败时返回占用清单/原因，可直接展示给用户</param>
        private bool ReleasePackageDir(string packageDir, bool ask, out string blockers)
        {
            blockers = "";
            if (string.IsNullOrEmpty(packageDir) || !Directory.Exists(packageDir)) return true;

            Cursor.Current = Cursors.WaitCursor;
            try
            {
                return ReleasePackageDirCore(packageDir, ask, out blockers);
            }
            finally
            {
                Cursor.Current = Cursors.Default;
            }
        }

        private bool ReleasePackageDirCore(string packageDir, bool ask, out string blockers)
        {
            blockers = "";
            // 1) 托盘自己拉起的服务：它的 CWD 曾在包目录里，且 edge-js 原生模块已加载
            if (IsServerBusy()) StopServerForUpdate();

            // 2) 排除托盘自身的 CWD 占用（从包目录启动、自迁移又失败的情况）
            DetachCurrentDirectory(packageDir);

            // 3) Windows 服务模式：服务进程同样会锁目录
            try
            {
                bool serviceExists;
                bool serviceRunning;
                ServiceHelper.Query(out serviceExists, out serviceRunning, true);
                if (serviceExists && serviceRunning)
                {
                    string error = ServiceHelper.Stop();
                    AppLog.Write("locked: 停止 Windows 服务 " + (error == null ? "成功" : error));
                    int waited = 0;
                    while (ServiceHelper.IsRunning() && waited < 15000)
                    {
                        Thread.Sleep(300);
                        waited += 300;
                    }
                }
            }
            catch (Exception ex)
            {
                AppLog.Write("locked: 停止 Windows 服务失败: " + ex.Message);
            }

            // 4) 给句柄留一点释放时间（taskkill / sc stop 都是异步完成的）
            if (PackageDirLock.WaitFree(packageDir, 2500)) return true;

            // 5) 还有占用：找出来，必要时结束
            List<LockHolder> holders = PackageDirLock.Find(packageDir);
            if (holders == null)
            {
                AppLog.Write("locked: 无法枚举占用进程（PowerShell 不可用或被策略限制）");
                if (PackageDirLock.WaitFree(packageDir, 5000)) return true;
            }
            else if (holders.Count > 0)
            {
                // 只结束确定属于本包的进程（node / AtlispTray / AtlispUpdater）。
                // 命令行里刚好带这个路径的编辑器、终端等不碰，交给用户自己关。
                List<LockHolder> killable = new List<LockHolder>();
                List<LockHolder> others = new List<LockHolder>();
                for (int i = 0; i < holders.Count; i++)
                {
                    if (IsKillableHolder(holders[i])) killable.Add(holders[i]);
                    else others.Add(holders[i]);
                }
                AppLog.Write("locked: 包目录仍被占用 " + PackageDirLock.DescribeOneLine(holders));
                if (others.Count > 0)
                {
                    AppLog.Write("locked: 不自动结束的占用进程（请用户自己关）: " +
                        PackageDirLock.DescribeOneLine(others));
                }
                if (killable.Count > 0)
                {
                    if (ask && !ConfirmEndHolders(packageDir, killable))
                    {
                        blockers = PackageDirLock.Describe(holders) +
                            "（已取消，未结束这些进程）";
                        return false;
                    }
                    PackageDirLock.Kill(killable);
                    if (PackageDirLock.WaitFree(packageDir, 6000)) return true;
                }
            }

            List<LockHolder> remaining = null;
            if (holders != null && holders.Count > 0) remaining = PackageDirLock.Find(packageDir);
            blockers = PackageDirLock.Describe(remaining);
            if (string.IsNullOrEmpty(blockers))
            {
                blockers = "未能确定是哪个进程：可能是杀毒软件/索引服务正在扫描该目录，" +
                    "或者有命令行窗口/编辑器的「当前目录」就在这个目录里。\r\n";
            }
            if (IsInsideDir(Application.ExecutablePath, packageDir))
            {
                blockers += "托盘正在从包目录运行（" + Application.ExecutablePath +
                    "），结束托盘后重试，或重新执行一次 atlisp-tray 让它迁移到用户目录。\r\n";
            }
            return false;
        }

        /// <summary>结束第三方占用进程前的确认（手动升级才问）。</summary>
        private static bool ConfirmEndHolders(string packageDir, List<LockHolder> holders)
        {
            string message =
                "升级需要替换目录：\r\n" + packageDir + "\r\n\r\n" +
                "但以下进程正在使用它：\r\n" + PackageDirLock.Describe(holders) + "\r\n" +
                "结束它们才能继续升级。它们多半是 MCP 客户端（Claude Desktop / VSCode / " +
                "opencode 等）拉起的服务或残留的 node.exe，升级后需要在对应客户端里重启一次 " +
                "MCP 服务。\r\n\r\n是否结束这些进程并继续升级？";
            return MessageBox.Show(message, "升级 @lisp MCP Server",
                MessageBoxButtons.YesNo, MessageBoxIcon.Warning) == DialogResult.Yes;
        }

        /// <summary>
        /// 升级前预检：包目录被占用就先释放（手动升级会先问一次），避免把带宽和时间
        /// 花在一次注定失败的 npm 上（npm 是在安装末尾才去改名包目录的）。
        /// 返回 false 表示无法释放或用户取消，调用方应直接放弃本轮升级。
        /// </summary>
        private bool EnsurePackageDirFree(string packageDir, bool ask, bool restartIfFailed)
        {
            if (string.IsNullOrEmpty(packageDir) || !Directory.Exists(packageDir)) return true;
            // 服务正在启动时不要改名探测（它还在从包目录加载文件）；其余情况先探一下：
            // 目录真的空闲就不必停服务，npm 一边下载一边照常提供服务。
            if (_server.State != ServerState.Starting && !PackageDirLock.IsBusy(packageDir))
            {
                return true;
            }

            AppLog.Write("locked: 升级前探测到包目录被占用 dir=" + packageDir);
            string blockers;
            if (ReleasePackageDir(packageDir, ask, out blockers)) return true;

            if (!string.IsNullOrEmpty(blockers) &&
                blockers.IndexOf("已取消", StringComparison.Ordinal) >= 0)
            {
                Balloon("升级已取消", "占用的进程保留着，未执行升级。", ToolTipIcon.Info);
            }
            else if (!_silent)
            {
                ShowError("升级失败：包目录被占用",
                    PackageDirBusyMessage(packageDir, blockers, false));
            }
            else
            {
                AppLog.Write("upgrade: 包目录被占用，稍后重试");
            }
            if (restartIfFailed) _server.RestartAsync();
            return false;
        }

        /// <summary>包目录无法替换时给用户看的说明（对话框文本）。</summary>
        private static string PackageDirBusyMessage(string packageDir, string blockers,
            bool retriesExhausted)
        {
            return
                "npm 无法替换包目录（EBUSY / 文件被占用）。\r\n\r\n" +
                (string.IsNullOrEmpty(packageDir) ? "" : "目录：" + packageDir + "\r\n\r\n") +
                (string.IsNullOrEmpty(blockers)
                    ? (retriesExhausted
                        ? "已重试 " + InstallStopMaxRetries + " 次，目录仍不可替换。\r\n\r\n"
                        : "托盘已经停掉自己启动的服务并等待句柄释放，但仍未能释放该目录。\r\n\r\n")
                    : "仍然占用该目录：\r\n" + blockers + "\r\n") +
                "处理办法（任选其一）：\r\n" +
                "1) 关闭占用它的程序（MCP 客户端 / 旧版托盘 / 残留 node.exe）后，" +
                "在托盘菜单里重试升级；\r\n" +
                "2) 或关掉托盘后在命令行执行：\r\n" +
                "     npm install -g @atlisp/mcp@latest\r\n\r\n" +
                "查看谁在占用：任务管理器 → 详细信息，找 node.exe / AtlispTray.exe / " +
                "AtlispUpdater.exe，\r\n" +
                "  右键「打开文件所在位置」，确认路径是否在 @atlisp\\mcp 目录内。";
        }

        /// <summary>
        /// 是否是可以直接结束的占用者：本包的 node 进程（server / cad-worker）、
        /// 包内托盘与更新器。别的程序（编辑器、终端）哪怕命令行里带这个路径也不动。
        /// </summary>
        private static bool IsKillableHolder(LockHolder holder)
        {
            if (holder == null) return false;
            string name = holder.Name ?? "";
            if (name.IndexOf("node", StringComparison.OrdinalIgnoreCase) >= 0) return true;
            if (name.IndexOf("atlisp", StringComparison.OrdinalIgnoreCase) >= 0) return true;
            return false;
        }

        /// <summary>
        /// 托盘自己的当前目录如果在包目录里，Windows 会一直锁着包目录。切到临时目录即可释放。
        /// </summary>
        private static void DetachCurrentDirectory(string packageDir)
        {
            try
            {
                string cwd = Directory.GetCurrentDirectory();
                if (!IsInsideDir(cwd, packageDir)) return;
                string temp = Path.GetTempPath();
                Directory.SetCurrentDirectory(temp);
                AppLog.Write("locked: 托盘当前目录在包目录内，已切到 " + temp);
            }
            catch (Exception ex)
            {
                AppLog.Write("locked: 切换工作目录失败: " + ex.Message);
            }
        }

        private static bool IsInsideDir(string path, string dir)
        {
            if (string.IsNullOrEmpty(path) || string.IsNullOrEmpty(dir)) return false;
            try
            {
                string full = Path.GetFullPath(path).TrimEnd('\\');
                string root = Path.GetFullPath(dir).TrimEnd('\\');
                return full.StartsWith(root + "\\", StringComparison.OrdinalIgnoreCase);
            }
            catch
            {
                return false;
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

            int hours = _config.AutoUpgradeHours > 0 ? _config.AutoUpgradeHours : 24;
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
            _installStopRetries = 0;
            // 不在开始时停服务（见 HandleTaskFailure 里的文件占用重试）；
            // 自动升级静默释放占用（不弹确认框），失败就留给下一轮。
            if (!EnsurePackageDirFree(info.PackageDir, false, shouldRunAfter)) return;
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
            Process process = ProcessRunner.StartElevated(commandLine, logFile, out error);
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
            if (action != null &&
                (action.StartsWith("dwgkb-install", StringComparison.Ordinal) ||
                 action.StartsWith("dwgkb-upgrade", StringComparison.Ordinal)))
            {
                bool auto = action.EndsWith("-auto", StringComparison.Ordinal);
                bool upgraded = action.StartsWith("dwgkb-upgrade", StringComparison.Ordinal);
                PythonLocator.Invalidate();
                PythonInfo after = PythonLocator.Resolve(_config, true);
                lock (_dwgKbLock) { _dwgKbPython = after; }

                _dwgKbTaskFailures = 0;
                _dwgKbTaskRetryAt = DateTime.MinValue;
                _dwgKbStopRetries = 0;
                _dwgKbAutoFlow = false;

                bool restart = _dwgKbRestartAfterUpgrade;
                bool startFresh = _dwgKbAutoStartAfterInstall;
                _dwgKbRestartAfterUpgrade = false;
                _dwgKbAutoStartAfterInstall = false;
                string versionBefore = _dwgKbVersionBefore;
                _dwgKbVersionBefore = null;
                bool changed = upgraded && after.HasPackage &&
                    !string.Equals(after.PackageVersion, versionBefore,
                        StringComparison.OrdinalIgnoreCase);

                if (auto)
                {
                    if (upgraded && !changed)
                    {
                        AppLog.Write("dwg-kb auto: 已是最新 " +
                            (after.HasPackage ? after.PackageVersion : "?"));
                    }
                    else
                    {
                        AppLog.Write("dwg-kb auto: " + (upgraded ? "升级" : "安装") +
                            "完成 " + (after.HasPackage ? after.PackageVersion : "?"));
                    }
                }
                else
                {
                    string title;
                    string body;
                    if (!upgraded)
                    {
                        title = "知识库已安装";
                        body = (after.HasPackage ? "atlisp-dwg-kb " + after.PackageVersion
                            : "安装完成");
                    }
                    else if (changed)
                    {
                        title = "知识库已升级";
                        body = "atlisp-dwg-kb " + after.PackageVersion;
                    }
                    else
                    {
                        // pip 说 "Requirement already satisfied" 时不要把「没变」说成升级成功
                        title = "知识库已是最新";
                        body = "atlisp-dwg-kb " +
                            (after.HasPackage ? after.PackageVersion : versionBefore) +
                            " 已是 PyPI 上的最新版本";
                    }
                    Balloon(title, body +
                        "。\r\n本地启动：atlisp-dwg-kb serve（或在「设置知识库地址」里指向已有的知识库服务）。",
                        ToolTipIcon.Info);
                }

                // 升级前停过服务 → 恢复；自动流程安装完成 → 按配置拉起；
                // 手动安装且开了自动启动 → 也顺手拉起，语义一致。
                if (restart || (startFresh && _config.DwgKbAutoStart) ||
                    (!auto && _config.DwgKbAutoStart &&
                     DwgKbServer.IsLocalUrl(_config.DwgKbUrl)))
                {
                    StartDwgKbService(auto);
                }
                UpdateDwgKbUi();
                RefreshDwgKbStatus(true);
                return;
            }

            ServerLocator.Invalidate();
            ServerInfo info = ServerLocator.Resolve(_config, true);

            // 没有 .NET SDK 时安装用 --ignore-scripts 跳过了 edge-js 的安装脚本，
            // 这里补上它本该做的事（复制 VC 运行时 DLL）；正常安装时是幂等空操作。
            if (action == "install" || action == "upgrade" || action == "upgrade-auto")
            {
                _installStopRetries = 0;
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

            if (action != null &&
                (action.StartsWith("dwgkb-install", StringComparison.Ordinal) ||
                 action.StartsWith("dwgkb-upgrade", StringComparison.Ordinal)))
            {
                bool auto = action.EndsWith("-auto", StringComparison.Ordinal);
                bool upgraded = action.StartsWith("dwgkb-upgrade", StringComparison.Ordinal);

                // 现在升级不再提前停服务；pip 真正替换被占用的 .pyd/.dll 时会报
                // PermissionError / WinError 32，这时才停知识库并重试一次。
                if (_dwgKbStopRetries < 1 && LooksLikeFileLock(text))
                {
                    _dwgKbStopRetries++;
                    string stopError = null;
                    if (DwgKbServer.IsRunning() && DwgKbServer.Stop(out stopError))
                    {
                        _dwgKbRestartAfterUpgrade = true;
                        AppLog.Write("dwg-kb: 替换文件被占用，停止知识库后重试");
                    }
                    else
                    {
                        AppLog.Write("dwg-kb: 替换文件被占用，停止知识库未成功（继续重试）: " +
                            (stopError ?? "服务未运行"));
                    }
                    PythonInfo retryInfo = PythonLocator.Resolve(_config, false);
                    lock (_dwgKbLock) { _dwgKbPython = retryInfo; }
                    RunPipTask(retryInfo,
                        upgraded ? "升级知识库（PyPI）" : "安装知识库（PyPI）", action, !auto);
                    return;
                }

                // 自动升级失败：知识库可能在升级前被停掉了，先按旧版本恢复服务
                if (auto && _dwgKbRestartAfterUpgrade)
                {
                    _dwgKbRestartAfterUpgrade = false;
                    StartDwgKbService(true);
                }
                // pip 失败最常见的原因：网络（PyPI 超时）或 Python 安装缺 pip
                string hint = text.IndexOf("Could not find a version", StringComparison.OrdinalIgnoreCase) >= 0 ||
                    text.IndexOf("timed out", StringComparison.OrdinalIgnoreCase) >= 0 ||
                    text.IndexOf("ProxyError", StringComparison.OrdinalIgnoreCase) >= 0 ||
                    text.IndexOf("Connection", StringComparison.OrdinalIgnoreCase) >= 0
                    ? "看起来是网络问题。可换用国内镜像重试：\r\n" +
                      "  python -m pip install --upgrade atlisp-dwg-kb -i https://pypi.tuna.tsinghua.edu.cn/simple"
                    : "详细输出见任务窗口或 logs 目录下的 pip-*.log。";
                if (auto)
                {
                    ScheduleDwgKbRetry("pip 退出码 " + exitCode + "（" +
                        (upgraded ? "升级" : "安装") + "知识库）");
                    return;
                }
                ShowError(upgraded ? "升级知识库失败" : "安装知识库失败",
                    "pip 退出码 " + exitCode + "\r\n\r\n" + hint);
                Balloon("知识库安装失败", "pip 退出码 " + exitCode, ToolTipIcon.Warning);
                return;
            }

            // 升级/安装不再一开始就停服务：npm 真正替换包目录时才会撞上 Windows 文件锁
            // （EBUSY / EPERM + rename）。命中后释放包目录占用再重试（见 ReleasePackageDir）。
            bool npmFileLock = LooksLikeFileLock(text) &&
                (action == "install" || action == "upgrade" || action == "upgrade-auto");
            if (npmFileLock)
            {
                _installStopRetries++;
                bool autoUpgrade = action == "upgrade-auto";
                bool wasRunning = IsServerBusy();
                ServerInfo lockInfo = ServerLocator.Resolve(_config, false);
                string pkgDir = lockInfo == null ? "" : lockInfo.PackageDir;
                AppLog.Write("upgrade: 替换文件被占用（第 " + _installStopRetries + "/" +
                    InstallStopMaxRetries + " 次），开始释放包目录 dir=" + pkgDir);

                string blockers;
                bool released = ReleasePackageDir(pkgDir, !autoUpgrade, out blockers);
                if (released && _installStopRetries <= InstallStopMaxRetries)
                {
                    AppLog.Write("upgrade: 包目录已释放，重新执行 npm install（原服务" +
                        (wasRunning ? "已停止，升级后重启" : "未运行") + "）");
                    RunNpmTask(autoUpgrade
                            ? "自动升级 @lisp MCP Server"
                            : "升级 @lisp MCP Server",
                        NpmRunner.InstallServerArgs(_config), action, showWindow, wasRunning);
                    return;
                }

                AppLog.Write("upgrade: 包目录仍被占用 dir=" + pkgDir + " exitCode=" + exitCode);
                bool cancelled = !string.IsNullOrEmpty(blockers) &&
                    blockers.IndexOf("已取消", StringComparison.Ordinal) >= 0;
                if (cancelled)
                {
                    Balloon("升级已取消", "占用的进程保留着，未执行升级。", ToolTipIcon.Info);
                }
                else if (!_silent && !autoUpgrade)
                {
                    ShowError("升级失败：包目录被占用",
                        PackageDirBusyMessage(pkgDir, blockers,
                            _installStopRetries > InstallStopMaxRetries));
                }
                else
                {
                    AppLog.Write("upgrade: 包目录被占用，稍后重试");
                    Balloon("升级失败：包目录被占用",
                        "有进程在用 @atlisp/mcp 目录，关闭 MCP 客户端或托盘后重试。",
                        ToolTipIcon.Warning);
                }
                if (restartAfter)
                {
                    _server.RestartAsync();
                }
                return;
            }

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

            // 预检/重试时可能已经把服务停了（为了释放包目录），失败后要把旧版本的服务拉回来
            if ((action == "install" || action == "upgrade") && restartAfter)
            {
                _server.RestartAsync();
            }
            if (action == "node" && _restartAfterNodeInstall)
            {
                _restartAfterNodeInstall = false;
                _server.RestartAsync();
            }
        }

        /// <summary>
        /// 安装/升级失败输出里是否包含「本地文件被占用」的特征（Windows 文件锁）。
        /// 升级流程默认不停服务，只有命中这些特征时才停服务并重试一次。
        /// </summary>
        private static bool LooksLikeFileLock(string text)
        {
            if (string.IsNullOrEmpty(text)) return false;
            bool lockPhrase =
                text.IndexOf("EBUSY", StringComparison.OrdinalIgnoreCase) >= 0 ||
                text.IndexOf("resource busy", StringComparison.OrdinalIgnoreCase) >= 0 ||
                text.IndexOf("being used by another process", StringComparison.OrdinalIgnoreCase) >= 0 ||
                text.IndexOf("WinError 32", StringComparison.OrdinalIgnoreCase) >= 0 ||
                text.IndexOf("PermissionError", StringComparison.OrdinalIgnoreCase) >= 0 ||
                text.IndexOf("另一个程序正在使用", StringComparison.OrdinalIgnoreCase) >= 0 ||
                text.IndexOf("正在使用此文件", StringComparison.OrdinalIgnoreCase) >= 0 ||
                text.IndexOf("文件被占用", StringComparison.OrdinalIgnoreCase) >= 0;
            // npm 在 Windows 上替换被加载的文件时常见 EPERM + unlink/rename，
            // 单看 EPERM 会和「权限不足」混淆，所以只在伴随删除/改名时算文件锁。
            bool epermOnReplace =
                text.IndexOf("EPERM", StringComparison.OrdinalIgnoreCase) >= 0 &&
                (text.IndexOf("unlink", StringComparison.OrdinalIgnoreCase) >= 0 ||
                 text.IndexOf("rename", StringComparison.OrdinalIgnoreCase) >= 0);
            return lockPhrase || epermOnReplace;
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

            int hours = _config.AutoUpgradeHours > 0 ? _config.AutoUpgradeHours : 24;
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
            // 知识库的自动启动/自动升级也重新计时
            _nextDwgKbCheckAt = DateTime.MinValue;
            _dwgKbTaskRetryAt = DateTime.MinValue;
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
            builder.AppendLine("自动补齐环境 : " + (_config.AutoInstall ? "开" : "关") + BootstrapStateText());
            builder.AppendLine("自动升级     : " +
                (_config.AutoUpgrade
                    ? "每 " + (_config.AutoUpgradeHours > 0 ? _config.AutoUpgradeHours : 24) + " 小时检查并升级"
                    : "关"));
            builder.AppendLine("npm 源       : " +
                (string.IsNullOrEmpty(_config.NpmRegistry) ? "默认" : _config.NpmRegistry));
            builder.AppendLine("知识库地址   : " + _config.DwgKbUrl);
            builder.AppendLine("知识库自动   : " + (_config.DwgKbAutoStart ? "随托盘启动" : "手动启动") +
                " / " + (_config.DwgKbAutoUpgrade ? "自动升级" : "不自动升级"));
            PythonInfo python = PythonLocator.Resolve(_config, false);
            builder.AppendLine("知识库环境   : " + (python == null ? "检测中" : python.RuntimeText));
            builder.AppendLine("知识库最新版 : " +
                (string.IsNullOrEmpty(_dwgKbLatestVersion) ? "未检查" : "v" + _dwgKbLatestVersion));
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
                "托盘随 @lisp/mcp 自动升级（默认每小时检查一次）；\r\n" +
                "知识库（atlisp-dwg-kb）同样自动安装、自动升级、异常自愈。\r\n\r\n" +
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
