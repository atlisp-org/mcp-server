import { cad } from '../src/cad.js';

const connected = await cad.connect();
if (!connected) { console.error('未连接 CAD'); process.exit(1); }

console.log(`已连接: ${cad.getPlatform()} ${cad.getVersion()}`);

// 在 (100,100,0) 绘制文字 "中国"，字高 5
const code = `(entmake (list (cons 0 "TEXT") (cons 10 (list 100 100 0)) (cons 1 "中国") (cons 40 5)))`;
const result = await cad.sendCommandWithResult(code);
console.log('绘制结果:', result);

await cad.disconnect();
