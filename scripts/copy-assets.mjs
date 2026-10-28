import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const src = (...p) => path.join(root, 'src', ...p);
const dist = (...p) => path.join(root, 'dist', ...p);

fs.mkdirSync(dist(), { recursive: true });

for (const f of ['cad-worker.js', 'lisp-security.js', 'logger.js', 'config.js', 'console-timestamp.js']) {
  fs.copyFileSync(src(f), dist(f));
}

function copyFiles(dirName) {
  const from = src(...dirName);
  const to = dist(...dirName);
  if (!fs.existsSync(from)) {
    console.warn(`[copy-assets] 源目录不存在，跳过: ${path.relative(root, from)}`);
    return;
  }
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    fs.copyFileSync(path.join(from, entry.name), path.join(to, entry.name));
  }
  console.log(`[copy-assets] ${path.relative(root, from)} -> ${path.relative(root, to)}`);
}

copyFiles(['html']);
copyFiles(['handlers']);
copyFiles(['prompts', 'definitions']);
