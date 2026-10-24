// AtlispUpdater.exe —— @lisp MCP 托盘的独立更新器。
//
// 设计约束（重要，别随手改）：
//   · 这个 exe 刻意保持极简，**几乎不修改**。它的 hash 应长期不变，
//     Defender/SmartScreen 才有机会为它积累「已知文件 + 已下载很多次」的信誉；
//     改动频繁的托盘 exe 只是它要替换的「数据」。
//   · 不做任何联网动作（下载由托盘负责），不做持久化，不写注册表。
//   · 只做四件事：等旧进程退出 → 校验新文件（SHA256 + Authenticode）→ 覆盖 → 启动。
//
// 参数：
//   --target <exe>          要替换的文件（当前托盘）
//   --staged <exe>          新文件（托盘已下载/复制到同目录）
//   --sha256 <hex>          新文件的期望 SHA256（必须匹配）
//   --pid <n>               等这个进程退出后再替换
//   --restart <exe>         替换后启动哪个文件（默认为 --target）
//   --restart-args "<args>" 传给新进程的参数（如 "--silent --start-server"）
//   --version <v>           写入 AtlispTray.version 的版本号（托盘用它显示版本）
//   --log <dir>             日志目录（默认 %APPDATA%\atlisp-mcp\logs）
//
// 退出码：0 成功 / 2 等进程超时 / 3 校验失败 / 4 覆盖失败 / 5 启动失败 / 9 参数错误

using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using Atlisp.Tray;

namespace Atlisp.Updater
{
    internal static class Program
    {
        /// <summary>
        /// 固定版本号：更新器自身的版本**不随 npm 包版本变化**，这样它的 hash 能长期稳定。
        /// 只有真的改动本文件时才手动 +1。
        /// </summary>
        private const string UpdaterVersion = "1.0.0";

        private const string VersionFileName = "AtlispTray.version";

        private static string _logPath;

        private static void Main(string[] args)
        {
            int code = 9;
            try
            {
                code = Run(args);
            }
            catch (Exception ex)
            {
                Log("fatal: " + ex);
                code = 9;
            }
            Environment.ExitCode = code;
        }

        private static int Run(string[] args)
        {
            string target = Get(args, "--target");
            string staged = Get(args, "--staged");
            string expectedHash = Get(args, "--sha256");
            string pidText = Get(args, "--pid");
            string restart = Get(args, "--restart");
            string restartArgs = Get(args, "--restart-args");
            string version = Get(args, "--version");
            string logDir = Get(args, "--log");

            _logPath = Path.Combine(
                string.IsNullOrEmpty(logDir) ? DefaultLogDir() : logDir, "updater.log");
            Log("---- updater start v" + UpdaterVersion + " ----");

            if (string.IsNullOrEmpty(target) || string.IsNullOrEmpty(staged))
            {
                Log("缺少 --target / --staged");
                return 9;
            }
            if (string.IsNullOrEmpty(restart)) restart = target;
            Log("target=" + target + " staged=" + staged + " pid=" + (pidText ?? "-") +
                " restart=" + restart);

            if (!File.Exists(staged))
            {
                Log("暂存文件不存在（可能已被清理）：" + staged);
                return 3;
            }

            // 1) 内容校验：托盘算好的 SHA256，防止只下了一半 / 被替换过
            if (string.IsNullOrEmpty(expectedHash))
            {
                Log("缺少 --sha256，拒绝替换");
                return 9;
            }
            string actualHash = Sha256(staged);
            if (!string.Equals(actualHash, expectedHash, StringComparison.OrdinalIgnoreCase))
            {
                Log("SHA256 不匹配：期望 " + expectedHash + "，实际 " + actualHash);
                TryDelete(staged);
                return 3;
            }

            // 2) 签名校验：签了就必须有效；没签（开发构建）放行但记日志；
            //    签了但校验失败（被篡改 / 证书不可信）一律拒绝。
            string signer;
            string sigError;
            if (CodeSignature.Verify(staged, out signer, out sigError))
            {
                Log("新文件签名有效：" + signer);
            }
            else if (string.Equals(sigError, "未签名", StringComparison.Ordinal))
            {
                Log("新文件未签名（开发构建或尚未接入证书），继续替换");
            }
            else
            {
                Log("新文件签名无效，拒绝替换：" + sigError);
                TryDelete(staged);
                return 3;
            }

            // 3) 等旧托盘退出（镜像文件被占用时 Windows 不允许覆盖）
            int pid;
            if (int.TryParse(pidText, NumberStyles.Integer, CultureInfo.InvariantCulture,
                out pid) && pid > 0)
            {
                WaitForExit(pid, 120000);
            }
            else
            {
                Thread.Sleep(800);
            }

            // 4) 覆盖
            if (!Replace(staged, target)) return 4;

            // 5) 版本 sidecar：托盘 exe 的版本资源是固定的（保持 hash 稳定），
            //    真实版本号由这里写到同目录的 AtlispTray.version。
            if (!string.IsNullOrEmpty(version)) WriteVersionFile(target, version);

            // 6) 启动新版
            if (!string.IsNullOrEmpty(restart))
            {
                if (!Start(restart, restartArgs)) return 5;
            }
            Log("更新完成");
            return 0;
        }

        private static string Get(string[] args, string name)
        {
            if (args == null) return null;
            for (int i = 0; i < args.Length; i++)
            {
                if (string.Equals(args[i], name, StringComparison.OrdinalIgnoreCase))
                {
                    return i + 1 < args.Length ? args[i + 1] : null;
                }
                if (args[i] != null &&
                    args[i].StartsWith(name + "=", StringComparison.OrdinalIgnoreCase))
                {
                    return args[i].Substring(name.Length + 1);
                }
            }
            return null;
        }

        private static string DefaultLogDir()
        {
            return Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                "atlisp-mcp", "logs");
        }

        private static string Sha256(string path)
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

        private static void WaitForExit(int pid, int timeoutMs)
        {
            try
            {
                Process process = Process.GetProcessById(pid);
                if (!process.WaitForExit(timeoutMs))
                {
                    Log("等待旧进程 " + pid + " 超时，仍尝试替换");
                }
                process.Close();
            }
            catch (ArgumentException)
            {
                // 进程已经不在了：正常路径
            }
            catch (Exception ex)
            {
                Log("等待旧进程失败: " + ex.Message);
            }
            // 进程句柄释放后镜像可能还被短暂锁定，再等一拍
            Thread.Sleep(500);
        }

        private static bool Replace(string staged, string target)
        {
            for (int attempt = 0; attempt < 40; attempt++)
            {
                try
                {
                    File.Copy(staged, target, true);
                    TryDelete(staged);
                    Log("已替换 " + target);
                    return true;
                }
                catch (Exception ex)
                {
                    if (attempt == 39)
                    {
                        Log("替换失败（" + (attempt + 1) + " 次）：" + ex.Message);
                        return false;
                    }
                    Thread.Sleep(500);
                }
            }
            return false;
        }

        private static void WriteVersionFile(string target, string version)
        {
            try
            {
                string dir = Path.GetDirectoryName(target);
                if (string.IsNullOrEmpty(dir)) return;
                File.WriteAllText(Path.Combine(dir, VersionFileName), version,
                    new UTF8Encoding(false));
            }
            catch (Exception ex)
            {
                Log("写版本文件失败: " + ex.Message);
            }
        }

        private static bool Start(string exe, string arguments)
        {
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = exe;
                psi.Arguments = arguments ?? "";
                string dir = Path.GetDirectoryName(exe);
                if (!string.IsNullOrEmpty(dir)) psi.WorkingDirectory = dir;
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                Process.Start(psi);
                Log("已启动 " + exe + " " + (arguments ?? ""));
                return true;
            }
            catch (Exception ex)
            {
                Log("启动新版本失败: " + ex.Message);
                return false;
            }
        }

        private static void TryDelete(string path)
        {
            try { File.Delete(path); } catch (Exception) { }
        }

        private static void Log(string message)
        {
            try
            {
                string dir = Path.GetDirectoryName(_logPath);
                if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
                File.AppendAllText(_logPath,
                    DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " " + message + "\r\n",
                    new UTF8Encoding(false));
            }
            catch (Exception)
            {
                // 日志写不了不影响更新
            }
        }
    }
}
