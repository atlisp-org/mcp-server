// Authenticode 签名校验（wintrust!WinVerifyTrust）。
//
// 用途：
//   1. 托盘校验即将执行的下载物（Node.js MSI / Python 安装包）；
//   2. 更新器（AtlispUpdater.exe）校验即将覆盖/启动的新托盘 exe。
// 两个 exe 都编译进这个文件（见 build.ps1 / scripts/build-tray.mjs）。
//
// 注意：本文件必须保持 C# 5 语法（in-box csc.exe 的限制）。

using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography.X509Certificates;

namespace Atlisp.Tray
{
    internal static class CodeSignature
    {
        // WINTRUST_ACTION_GENERIC_VERIFY_V2
        private static readonly Guid ActionGenericVerifyV2 =
            new Guid("00AAC56B-CD44-11d0-8CC2-00C04FC295EE");

        private const int WTD_UI_NONE = 2;
        private const int WTD_REVOKE_NONE = 0;
        private const int WTD_CHOICE_FILE = 1;
        private const int WTD_STATEACTION_VERIFY = 1;
        private const int WTD_STATEACTION_CLOSE = 2;

        [DllImport("wintrust.dll", CharSet = CharSet.Unicode, PreserveSig = true,
            SetLastError = false)]
        private static extern int WinVerifyTrust(IntPtr hwnd,
            [MarshalAs(UnmanagedType.LPStruct)] Guid actionId, IntPtr data);

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct WINTRUST_FILE_INFO
        {
            public int cbStruct;
            public IntPtr pcwszFilePath;
            public IntPtr hFile;
            public IntPtr pgKnownSubject;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct WINTRUST_DATA
        {
            public int cbStruct;
            public IntPtr pPolicyCallbackData;
            public IntPtr pSIPClientData;
            public int dwUIChoice;
            public int fdwRevocationChecks;
            public int dwUnionChoice;
            public IntPtr pFile;
            public int dwStateAction;
            public IntPtr hWVTStateData;
            public IntPtr pwszURLReference;
            public int dwProvFlags;
            public int dwUIContext;
            public IntPtr pSignatureSettings;
        }

        /// <summary>
        /// 校验文件是否有**有效**的 Authenticode 签名。
        /// 未签名、签名损坏、证书链不可信都返回 false，并在 error 里说明原因
        /// （未签名时 error 固定为 "未签名"，调用方据此区分「没签」和「签坏了」）。
        /// </summary>
        public static bool Verify(string filePath, out string signer, out string error)
        {
            signer = null;
            error = null;

            if (string.IsNullOrEmpty(filePath) || !File.Exists(filePath))
            {
                error = "文件不存在";
                return false;
            }

            // 先读签名主体：没有签名时 CreateFromSignedFile 会抛异常
            try
            {
                X509Certificate cert = X509Certificate.CreateFromSignedFile(filePath);
                if (cert == null)
                {
                    error = "未签名";
                    return false;
                }
                X509Certificate2 cert2 = new X509Certificate2(cert);
                signer = cert2.Subject;
            }
            catch (Exception)
            {
                error = "未签名";
                return false;
            }

            try
            {
                // Windows 7 的 WINTRUST_DATA 布局与 Win8+ 不同，跳过链校验，
                // 只保留「有签名 + 能读出主体」这个弱校验（日志里能看到 signer）。
                Version os = Environment.OSVersion.Version;
                if (os.Major == 6 && os.Minor < 2)
                {
                    error = null;
                    return true;
                }

                int result = VerifyFile(filePath);
                if (result == 0)
                {
                    error = null;
                    return true;
                }
                error = "签名校验失败 (0x" + result.ToString("X8") + ")";
                return false;
            }
            catch (Exception ex)
            {
                error = "签名校验异常: " + ex.Message;
                return false;
            }
        }

        /// <summary>
        /// 要求签名有效，且签名主体包含指定关键字（例如 "Python Software Foundation"）。
        /// </summary>
        public static bool VerifyBy(string filePath, string subjectKeyword,
            out string signer, out string error)
        {
            if (!Verify(filePath, out signer, out error)) return false;
            if (string.IsNullOrEmpty(subjectKeyword)) return true;
            if (string.IsNullOrEmpty(signer) ||
                signer.IndexOf(subjectKeyword, StringComparison.OrdinalIgnoreCase) < 0)
            {
                error = "签名主体不是 " + subjectKeyword + "（实际：" +
                    (signer ?? "未知") + "）";
                return false;
            }
            return true;
        }

        private static int VerifyFile(string filePath)
        {
            IntPtr pathPtr = IntPtr.Zero;
            IntPtr fileInfoPtr = IntPtr.Zero;
            IntPtr dataPtr = IntPtr.Zero;
            try
            {
                pathPtr = Marshal.StringToHGlobalUni(filePath);

                WINTRUST_FILE_INFO fileInfo = new WINTRUST_FILE_INFO();
                fileInfo.cbStruct = Marshal.SizeOf(typeof(WINTRUST_FILE_INFO));
                fileInfo.pcwszFilePath = pathPtr;
                fileInfo.hFile = IntPtr.Zero;
                fileInfo.pgKnownSubject = IntPtr.Zero;
                fileInfoPtr = Marshal.AllocHGlobal(fileInfo.cbStruct);
                Marshal.StructureToPtr(fileInfo, fileInfoPtr, false);

                WINTRUST_DATA data = new WINTRUST_DATA();
                data.cbStruct = Marshal.SizeOf(typeof(WINTRUST_DATA));
                data.dwUIChoice = WTD_UI_NONE;
                data.fdwRevocationChecks = WTD_REVOKE_NONE;
                data.dwUnionChoice = WTD_CHOICE_FILE;
                data.pFile = fileInfoPtr;
                data.dwStateAction = WTD_STATEACTION_VERIFY;
                data.dwProvFlags = 0;
                data.dwUIContext = 0;
                dataPtr = Marshal.AllocHGlobal(data.cbStruct);
                Marshal.StructureToPtr(data, dataPtr, false);

                int result = WinVerifyTrust(IntPtr.Zero, ActionGenericVerifyV2, dataPtr);

                // 释放 WinVerifyTrust 内部状态
                data.dwStateAction = WTD_STATEACTION_CLOSE;
                Marshal.StructureToPtr(data, dataPtr, false);
                WinVerifyTrust(IntPtr.Zero, ActionGenericVerifyV2, dataPtr);
                return result;
            }
            finally
            {
                if (dataPtr != IntPtr.Zero) Marshal.FreeHGlobal(dataPtr);
                if (fileInfoPtr != IntPtr.Zero) Marshal.FreeHGlobal(fileInfoPtr);
                if (pathPtr != IntPtr.Zero) Marshal.FreeHGlobal(pathPtr);
            }
        }
    }
}
