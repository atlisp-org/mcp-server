import { execSync, spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

const WIN_RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const WIN_AUTOSTART_NAME = 'atlisp-mcp';

// `conhost.exe --headless` (Windows 10 1809+, kernel 10.0.17763) hosts node
// without any console window using a signed Windows component. On Windows 7/8
// (kernel 6.x) conhost has no --headless, but there is no Windows Terminal
// either, so `powershell -WindowStyle Hidden` reliably hides the window there.
function supportsHeadlessConhost() {
    const [major = 0, , build = 0] = os.release().split('.').map(n => parseInt(n, 10));
    if (major > 10) return true;
    if (major === 10) return build >= 17763;
    return false;
}

function getWindowsHiddenCommand() {
    if (!supportsHeadlessConhost()) {
        const base = `& '${process.execPath}' '${process.argv[1]}' --transport http`;
        return `powershell -WindowStyle Hidden -Command "${base}"`;
    }
    const conhost = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'conhost.exe');
    return `"${conhost}" --headless "${process.execPath}" "${process.argv[1]}" --transport http`;
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
        try {
            const out = execSync(
                `reg query "${WIN_RUN_KEY}" /v "${WIN_AUTOSTART_NAME}"`,
                { stdio: 'pipe', timeout: 5000, encoding: 'utf-8' }
            );
            const match = out.match(/([A-Za-z]:\\[^"]*\.js)/);
            return { installed: true, command: match ? match[1] : out.trim() };
        } catch {
            return { installed: false };
        }
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
