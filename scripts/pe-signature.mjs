// 判断 PE 文件是否带 Authenticode 签名（只看证书表在不在，不校验证书链）。
//
// 用途：
//   1. scripts/build-tray-manifest.mjs —— 给发布清单写 `signed` 字段，
//      下载页据此决定要不要提示「未签名」的放行步骤；
//   2. scripts/upload-tray.mjs —— 拒绝把未签名的 exe 推到 atlisp.cn。
//
// 为什么不用 signtool / osslsigncode：发布脚本要在 Linux 与 Windows 上都能跑，
// 而这一步只是「有没有签名」的闸门；证书链与时间戳的校验交给 CI 的
// `signtool verify /pa` 和下载端的 WinVerifyTrust。
//
// 原理：PE 可选头里的 DataDirectory[IMAGE_DIRECTORY_ENTRY_SECURITY]（索引 4）
// 指向文件尾部的 WIN_CERTIFICATE 表，长度字段非 0 即表示存在签名。

const IMAGE_DIRECTORY_ENTRY_SECURITY = 4;
const PE32_MAGIC = 0x10b;
const PE32_PLUS_MAGIC = 0x20b;

/**
 * @param {Buffer} buffer 完整的 PE 文件内容
 * @returns {boolean} 是否带 Authenticode 证书表
 */
export function isAuthenticodeSigned(buffer) {
  try {
    if (!Buffer.isBuffer(buffer) || buffer.length < 0x40) return false;
    // MZ
    if (buffer.readUInt16LE(0) !== 0x5a4d) return false;
    const peOffset = buffer.readUInt32LE(0x3c);
    if (peOffset + 24 > buffer.length) return false;
    // PE\0\0
    if (buffer.readUInt32LE(peOffset) !== 0x00004550) return false;
    const magic = buffer.readUInt16LE(peOffset + 24);
    if (magic !== PE32_MAGIC && magic !== PE32_PLUS_MAGIC) return false;
    // 可选头的「标准字段 + Windows 专有字段」之后才是数据目录
    const optionalHeaderSize = magic === PE32_PLUS_MAGIC ? 112 : 96;
    const dataDirOffset = peOffset + 24 + optionalHeaderSize;
    const certDirOffset = dataDirOffset + IMAGE_DIRECTORY_ENTRY_SECURITY * 8;
    if (certDirOffset + 8 > buffer.length) return false;
    const certSize = buffer.readUInt32LE(certDirOffset + 4);
    return certSize > 0;
  } catch {
    return false;
  }
}
