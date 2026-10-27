import { execSync, spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

const WIN_RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const WIN_AUTOSTART_NAME = 'atlisp-mcp';
const WIN_TRAY_AUTOSTART_NAME = 'atlisp-mcp-tray';

// `conhost.exe --headless` (Windows 10 1809+, kernel 10.0.17763) hosts node
// without any console window using a signed Windows component. On Windows 7/8
// (kernel 6.x) conhost has no --headless, but there is no Windows Terminal
// either, so `powershell -WindowStyle Hidden` reliably hides the window there.
function supportsHeadlessConhost(release = os.release()) {
    const [major = 0, , build = 0] = release.split('.').map(n => parseInt(n, 10));
    if (major > 10) return true;
    if (major === 10) return build >= 17763;
    return false;
}

/**
 * 构造 Windows 开机自启命令（纯函数，便于单测）。
 *
 * 由已签名的系统组件承载 node：新系统用 `conhost --headless`，旧系统退到
 * `powershell -WindowStyle Hidden`。全程没有自建 exe，所以不需要代码签名，
 * 也不会出现未签名 PE 被 Defender 误报的问题。
 */
export function buildWindowsAutostartCommand({
    execPath = process.execPath,
    scriptPath = process.argv[1],
    release = os.release(),
    systemRoot = process.env.SystemRoot || 'C:\\Windows',
    transport = 'http',
} = {}) {
    const tail = `"${execPath}" "${scriptPath}" --transport ${transport}`;
    if (supportsHeadlessConhost(release)) {
        // 显式拼反斜杠：Windows 命令里不能用 posix 分隔符
        const root = String(systemRoot).replace(/[\\/]+$/, '');
        const conhost = `${root}\\System32\\conhost.exe`;
        return `"${conhost}" --headless ${tail}`;
    }
    return `powershell -WindowStyle Hidden -Command "& '${execPath}' '${scriptPath}' --transport ${transport}"`;
}

function getWindowsHiddenCommand() {
    return buildWindowsAutostartCommand();
}

function regAdd(args) {
    const result = spawnSync('reg', args, { stdio: 'pipe', timeout: 5000, windowsHide: true });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(result.stderr.toString() || `reg exit code ${result.status}`);
    return result.stdout.toString();
}

function regDelete(args) {
    const result = spawnSync('reg', args, { stdio: 'pipe', timeout: 5000, windowsHide: true });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(result.stderr.toString() || `reg exit code ${result.status}`);
    return result.stdout.toString();
}

/** 读取 HKCU Run 里某个值的命令行；不存在返回 null。 */
function readRunValue(name) {
    try {
        const out = execSync(
            `reg query "${WIN_RUN_KEY}" /v "${name}"`,
            { stdio: 'pipe', timeout: 5000, encoding: 'utf-8' }
        );
        const line = out.split(/\r?\n/).find(l => l.trim().startsWith(name));
        if (!line) return null;
        const match = line.match(/REG_SZ\s+(.*)$/);
        return match ? match[1].trim() : out.trim();
    } catch {
        return null;
    }
}

function getStartupCommand() {
    return `"${process.execPath}" "${process.argv[1]}" --transport http`;
}

function xdgAutostartDir() {
    const xdg = process.env.XDG_CONFIG_HOME;
    return path.join(xdg || path.join(os.homedir(), '.config'), 'autostart');
}

export function installAutostart() {
    const platform = process.platform;

    if (platform === 'win32') {
        try {
            regAdd(['add', WIN_RUN_KEY, '/v', WIN_AUTOSTART_NAME, '/t', 'REG_SZ',
                '/d', getWindowsHiddenCommand(), '/f']);
            if (readRunValue(WIN_TRAY_AUTOSTART_NAME)) {
                console.error(
                    '提示：托盘也注册了开机自启（atlisp-mcp-tray），两者会抢同一个端口。' +
                    '建议二选一：想只留服务自启，就在托盘右键取消「随 Windows 启动」；' +
                    '想只留托盘，就运行 atlisp-mcp --uninstall-autostart。'
                );
            }
            console.error(`自动启动已安装 (HKCU\\...\\Run)`);
            return true;
        } catch (e) {
            console.error(`安装自动启动失败: ${e.message}`);
            return false;
        }
    }

    if (platform === 'darwin') {
        const plistDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
        const plistPath = path.join(plistDir, `com.atlisp.mcp.plist`);
        const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.atlisp.mcp</string>
    <key>ProgramArguments</key>
    <array>
        <string>${process.execPath}</string>
        <string>${process.argv[1]}</string>
        <string>--transport</string>
        <string>http</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
</dict>
</plist>`;
        try {
            if (!fs.existsSync(plistDir)) fs.mkdirSync(plistDir, { recursive: true });
            fs.writeFileSync(plistPath, plist, 'utf-8');
            execSync(`launchctl load "${plistPath}"`, { stdio: 'pipe', timeout: 5000 });
            console.error(`自动启动已安装 (LaunchAgent)`);
            return true;
        } catch (e) {
            console.error(`安装自动启动失败: ${e.message}`);
            return false;
        }
    }

    if (platform === 'linux') {
        const dir = xdgAutostartDir();
        const desktopPath = path.join(dir, 'atlisp-mcp.desktop');
        const cmd = getStartupCommand();
        const desktop = `[Desktop Entry]
Type=Application
Name=@lisp MCP Server
Exec=${cmd}
Terminal=false
X-GNOME-Autostart-enabled=true
`;
        try {
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(desktopPath, desktop, 'utf-8');
            console.error(`自动启动已安装 (XDG Autostart)`);
            return true;
        } catch (e) {
            console.error(`安装自动启动失败: ${e.message}`);
            return false;
        }
    }

    console.error(`当前平台 ${platform} 不支持自动启动`);
    return false;
}

export function uninstallAutostart() {
    const platform = process.platform;

    if (platform === 'win32') {
        try {
            regDelete(['delete', WIN_RUN_KEY, '/v', WIN_AUTOSTART_NAME, '/f']);
            console.error('自动启动已卸载');
            return true;
        } catch (e) {
            console.error(`卸载自动启动失败: ${e.message}`);
            return false;
        }
    }

    if (platform === 'darwin') {
        const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.atlisp.mcp.plist');
        try {
            execSync(`launchctl unload "${plistPath}"`, { stdio: 'pipe', timeout: 5000 });
            fs.unlinkSync(plistPath);
            console.error('自动启动已卸载');
            return true;
        } catch (e) {
            console.error(`卸载自动启动失败: ${e.message}`);
            return false;
        }
    }

    if (platform === 'linux') {
        const desktopPath = path.join(xdgAutostartDir(), 'atlisp-mcp.desktop');
        try {
            if (fs.existsSync(desktopPath)) fs.unlinkSync(desktopPath);
            console.error('自动启动已卸载');
            return true;
        } catch (e) {
            console.error(`卸载自动启动失败: ${e.message}`);
            return false;
        }
    }

    return false;
}

export function autostartStatus() {
    const platform = process.platform;

    if (platform === 'win32') {
        const command = readRunValue(WIN_AUTOSTART_NAME);
        const trayInstalled = Boolean(readRunValue(WIN_TRAY_AUTOSTART_NAME));
        if (!command) return { installed: false, trayInstalled };
        const match = command.match(/([A-Za-z]:\\[^"]*\.js)/);
        return {
            installed: true,
            command: match ? match[1] : command,
            fullCommand: command,
            trayInstalled,
        };
    }

    if (platform === 'darwin') {
        const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.atlisp.mcp.plist');
        return { installed: fs.existsSync(plistPath) };
    }

    if (platform === 'linux') {
        const desktopPath = path.join(xdgAutostartDir(), 'atlisp-mcp.desktop');
        return { installed: fs.existsSync(desktopPath) };
    }

    return { installed: false, error: `${platform} 不支持自动启动` };
}
