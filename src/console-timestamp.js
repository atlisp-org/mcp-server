// 控制台输出加时间戳：给 console.log/info/warn/error 的首个字符串参数
// 前置本地时间（YYYY-MM-DD HH:mm:ss.SSS），让运行时日志每行带时间。
// 协议通道（stdio JSON-RPC、cad-worker 的 stdout 协议）直接走 process.stdout.write，
// 不经过 console，因此不受影响。

const METHODS = ['log', 'info', 'warn', 'error'];

let enabled = false;
const originals = new Map();

function pad(n, width = 2) {
  return String(n).padStart(width, '0');
}

function formatTime(date) {
  const d = date || new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function wrap(fn) {
  return function timestamped(...args) {
    if (typeof args[0] === 'string') {
      args[0] = `${formatTime()} ${args[0]}`;
    }
    return fn.apply(this, args);
  };
}

export function enableConsoleTimestamp() {
  if (enabled) return;
  for (const m of METHODS) {
    originals.set(m, console[m]);
    console[m] = wrap(console[m]);
  }
  enabled = true;
}

export function disableConsoleTimestamp() {
  if (!enabled) return;
  for (const m of METHODS) {
    if (originals.has(m)) console[m] = originals.get(m);
  }
  originals.clear();
  enabled = false;
}

export function isConsoleTimestampEnabled() {
  return enabled;
}
