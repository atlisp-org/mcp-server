import { cad } from '../src/cad.js';

async function main() {
  if (!cad.isAvailable()) {
    console.log('CAD COM 仅支持 Windows');
    return;
  }

  const connected = await cad.connect();
  if (!connected) {
    console.log('未找到运行中的 CAD');
    return;
  }

  console.log(`已连接: ${cad.getPlatform()} ${cad.getVersion()}`);

  // 1. 创建文本实体 "中国"
  const createCode = `(entmake (list (cons 0 "TEXT") (cons 10 (list 0 0 0)) (cons 1 "中国") (cons 40 2.5)))`;
  const createResult = await cad.sendCommandWithResult(createCode);
  console.log('创建文本结果:', createResult);

  // 2. 读取刚创建的文本内容
  const readCode = `(cdr (assoc 1 (entget (entlast))))`;
  const textContent = await cad.sendCommandWithResult(readCode);
  console.log('读取文本内容:', textContent);

  // 3. 比对
  const expected = '"中国"';
  if (textContent === expected) {
    console.log('\n✓ 测试通过: 文本内容一致');
  } else {
    console.log(`\n✗ 测试失败: 期望 "${expected}", 得到 "${textContent}"`);
  }

  // 4. 清理: 删除测试创建的文本
  await cad.sendCommand('(entdel (entlast))\n');
  console.log('已清理测试实体');

  await cad.disconnect();
  console.log('已断开 CAD 连接');
}

main().catch(console.error);
