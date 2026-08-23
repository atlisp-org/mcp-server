import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CANDIDATES = [
  'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
  'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe',
];

if (process.platform !== 'win32') {
  console.log('[build:rot] 非 Windows 平台，跳过 cad-rothelper.dll 编译');
  process.exit(0);
}

const csc = CANDIDATES.find((p) => fs.existsSync(p));
if (!csc) {
  console.error('[build:rot] 未找到 csc.exe（需要 .NET Framework v4.0.30319）');
  process.exit(1);
}

fs.mkdirSync(path.join(process.cwd(), 'dist'), { recursive: true });
execFileSync(csc, ['/target:library', '/out:dist\\cad-rothelper.dll', 'src\\cad-rothelper.cs'], {
  stdio: 'inherit',
});
console.log('[build:rot] dist/cad-rothelper.dll 编译完成');
