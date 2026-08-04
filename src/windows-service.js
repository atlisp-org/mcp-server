import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

const SERVICE_NAME = 'atlisp-mcp';
const DISPLAY_NAME = '@lisp MCP Server';
const DESCRIPTION = 'MCP Server for @lisp on CAD - Bridge between AI Agent and AutoCAD/ZWCAD/GStarCAD/BricsCAD';
const LOG_DIR = process.env.ProgramData
  ? path.join(process.env.ProgramData, 'atlisp-mcp', 'logs')
  : path.join(process.env.APPDATA || process.cwd(), 'atlisp-mcp-logs');

function log(msg, color = '') {
  const prefix = color === 'red' ? '\x1b[31m[ERR]\x1b[0m'
    : color === 'green' ? '\x1b[32m[OK]\x1b[0m'
    : color === 'yellow' ? '\x1b[33m[WARN]\x1b[0m'
    : '\x1b[36m[INFO]\x1b[0m';
  console.log(`${prefix}  ${msg}`);
}

function isAdmin() {
  try {
    execSync('net session', { stdio: 'ignore', timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

function findSc() {
  for (const dir of [
    `${process.env.SystemRoot || 'C:\\Windows'}\\System32`,
    `${process.env.SystemRoot || 'C:\\Windows'}\\SysWOW64`,
  ]) {
    const p = path.join(dir, 'sc.exe');
    if (fs.existsSync(p)) return p;
  }
  return 'sc.exe';
}

function getScriptPath() {
  const entry = process.argv[1];
  if (!entry) return null;
  if (entry.includes('atlisp-mcp')) {
    if (!entry.includes('src' + path.sep)) return entry;
    return entry.replace('src' + path.sep + 'atlisp-mcp.js', 'dist' + path.sep + 'atlisp-mcp.js')
      .replace('src/atlisp-mcp.js', 'dist/atlisp-mcp.js');
  }
  const distPath = path.join(process.cwd(), 'dist', 'atlisp-mcp.js');
  if (fs.existsSync(distPath)) return distPath;
  return null;
}

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
  return {
    stdout: path.join(LOG_DIR, 'atlisp-mcp-stdout.log'),
    stderr: path.join(LOG_DIR, 'atlisp-mcp-stderr.log'),
  };
}

function runSc(args) {
  const sc = findSc();
  try {
    return execSync(`"${sc}" ${args}`, { encoding: 'utf8', timeout: 10000 });
  } catch (e) {
    return e.stdout || e.stderr || e.message;
  }
}

function promptPassword(user) {
  log(`Enter password for ${user}:`, 'yellow');
  try {
    const result = execSync(
      `powershell -NoProfile -Command "$sec=Read-Host -AsSecureString -Prompt 'Password for ${user}'; $bstr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec); [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)"`,
      { stdio: ['inherit', 'pipe', 'inherit'], timeout: 30000, encoding: 'utf8' }
    );
    return result.trim();
  } catch {
    log('Password prompt cancelled.', 'red');
    return null;
  }
}

function install(port, configFile, serviceUser, servicePassword) {
  const nodePath = process.execPath;
  const scriptPath = getScriptPath();
  if (!scriptPath || !fs.existsSync(scriptPath)) {
    log('atlisp-mcp.js not found. Run `npm install -g @atlisp/mcp` first.', 'red');
    return;
  }

  let extraArgs = `--port ${port}`;
  if (configFile) extraArgs += ` --config "${configFile}"`;

  const binPath = `"${nodePath}" "${scriptPath}" ${extraArgs}`;
  const logs = ensureLogDir();

  const existing = runSc(`query ${SERVICE_NAME}`);
  if (!existing.includes('FAILED')) {
    log(`Service '${SERVICE_NAME}' already exists. Removing...`, 'yellow');
    runSc(`stop ${SERVICE_NAME}`);
    runSc(`delete ${SERVICE_NAME}`);
  }

  // Determine service account
  let obj = 'LocalSystem';
  let password = null;

  if (serviceUser) {
    obj = serviceUser;
    if (serviceUser.toLowerCase() !== 'localsystem' && !servicePassword) {
      password = promptPassword(obj);
      if (password === null) return;
    } else {
      password = servicePassword || null;
    }
  } else {
    const domain = process.env.USERDOMAIN || '.';
    const username = process.env.USERNAME;
    obj = `${domain}\\${username}`;
    log(`Service will run as current user: ${obj}`, 'yellow');
    password = promptPassword(obj);
    if (password === null) return;
  }

  log(`Creating service as ${obj}...`);
  let createCmd = `create ${SERVICE_NAME} binPath= ${binPath} start= auto DisplayName= "${DISPLAY_NAME}" obj= "${obj}"`;
  if (password) createCmd += ` password= "${password}"`;
  const createResult = runSc(createCmd);
  if (createResult.includes('FAILED') || createResult.includes('失败')) {
    log(`Failed: ${createResult.trim()}`, 'red');
    return;
  }

  runSc(`description ${SERVICE_NAME} "${DESCRIPTION}"`);
  runSc(`failure ${SERVICE_NAME} reset= 86400 actions= restart/5000/restart/10000/restart/30000`);

  log('Starting service...');
  runSc(`start ${SERVICE_NAME}`);

  log(`Service '${SERVICE_NAME}' installed on port ${port}`, 'green');
  log(`Logs: ${logs.stdout}`, 'green');
}

function uninstall() {
  log('Stopping service...');
  runSc(`stop ${SERVICE_NAME}`);
  log('Removing service...');
  runSc(`delete ${SERVICE_NAME}`);
  log(`Service '${SERVICE_NAME}' removed.`, 'green');
}

function start() {
  runSc(`start ${SERVICE_NAME}`);
  log(`Service '${SERVICE_NAME}' started.`, 'green');
}

function stop() {
  runSc(`stop ${SERVICE_NAME}`);
  log(`Service '${SERVICE_NAME}' stopped.`);
}

function restart() {
  log('Restarting service...');
  runSc(`stop ${SERVICE_NAME}`);
  runSc(`start ${SERVICE_NAME}`);
}

function status() {
  const result = runSc(`query ${SERVICE_NAME}`);
  if (result.includes('FAILED') || result.includes('1060')) {
    log(`Service '${SERVICE_NAME}' is not installed.`, 'yellow');
    console.log(`\n  Install: atlisp-mcp --service install`);
    return;
  }
  const lines = result.split('\n').map(l => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (line.startsWith('SERVICE_NAME') || line.startsWith('DISPLAY_NAME')
      || line.startsWith('STATE') || line.startsWith('WIN32_EXIT_CODE')) {
      console.log(`  ${line}`);
    }
  }
  if (result.includes('RUNNING')) {
    log('Service is running', 'green');
  } else if (result.includes('STOPPED')) {
    log('Service is stopped', 'yellow');
  }
}

function logs(lines = 30) {
  const files = ensureLogDir();
  for (const [label, filepath] of [['stdout', files.stdout], ['stderr', files.stderr]]) {
    if (!fs.existsSync(filepath)) {
      console.log(`\n\x1b[36m=== ${label} (no file) ===\x1b[0m`);
      continue;
    }
    console.log(`\n\x1b[36m=== ${label} (${filepath}) ===\x1b[0m`);
    const content = fs.readFileSync(filepath, 'utf8');
    const allLines = content.split('\n').filter(Boolean);
    const tail = allLines.slice(-lines);
    for (const l of tail) console.log(`  ${l}`);
  }
}

export function runServiceCommand(args) {
  if (args.length === 0) {
    console.log(`
Usage: atlisp-mcp --service <action> [options]

Actions:
  install                   Install and start Windows service
  uninstall                 Stop and remove Windows service
  start                     Start service
  stop                      Stop service
  restart                   Restart service
  status                    Check service status
  logs                      Show recent logs

Options for install:
  --port <port>             HTTP port (default: 8110)
  --config <path>           Config file path
  --user <user>             Service account (default: current user)
  --password <password>     Service account password (prompted if omitted)
`);
    return;
  }

  const action = args[0];
  const cmdArgs = args.slice(1);

  let port = 8110;
  let configFile = '';
  let serviceUser = '';
  let servicePassword = '';
  for (let i = 0; i < cmdArgs.length; i++) {
    if (cmdArgs[i] === '--port' && cmdArgs[i + 1]) port = parseInt(cmdArgs[++i], 10);
    if (cmdArgs[i] === '--config' && cmdArgs[i + 1]) configFile = cmdArgs[++i];
    if (cmdArgs[i] === '--user' && cmdArgs[i + 1]) serviceUser = cmdArgs[++i];
    if (cmdArgs[i] === '--password' && cmdArgs[i + 1]) servicePassword = cmdArgs[++i];
  }

  const needsAdmin = ['install', 'uninstall', 'start', 'stop', 'restart'];
  if (needsAdmin.includes(action) && !isAdmin()) {
    log('Requesting administrator privileges...', 'yellow');
    const tmpPs1 = path.join(os.tmpdir(), `atlisp-mcp-elevate-${Date.now()}.ps1`);
    const allArgs = process.argv.slice(2).join(' ');
    fs.writeFileSync(tmpPs1,
      `Start-Process '${process.execPath}' -Verb RunAs -ArgumentList '${process.argv[1]} ${allArgs}' -WindowStyle Normal`,
      'utf8');
    try {
      execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tmpPs1}"`, { timeout: 120000 });
    } catch {
      log('Elevation cancelled or timed out.', 'red');
    }
    finally { try { fs.unlinkSync(tmpPs1); } catch {} }
    return;
  }

  const actions = ['install', 'uninstall', 'start', 'stop', 'restart', 'status', 'logs'];
  if (!actions.includes(action)) {
    log(`Unknown action: ${action}. Use: ${actions.join('/')}`, 'red');
    process.exit(1);
  }
  switch (action) {
    case 'install': install(port, configFile, serviceUser, servicePassword); break;
    case 'uninstall': uninstall(); break;
    case 'start': start(); break;
    case 'stop': stop(); break;
    case 'restart': restart(); break;
    case 'status': status(); break;
    case 'logs': logs(); break;
  }
}
