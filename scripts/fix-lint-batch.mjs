// P0-2 lint 存量修复：精确字符串替换，唯一命中校验
import fs from 'node:fs';

const R = [
  // [file, old, new]
  ['src/audit-log.js', `const MAX_LOG_SIZE = 10 * 1024 * 1024;\nconst MAX_LOG_AGE = 90 * 24 * 60 * 60 * 1000;\n`, `const MAX_LOG_SIZE = 10 * 1024 * 1024;\n`],
  ['src/autostart.js', `        const plistPath = path.join(plistDir, \`com.atlisp.mcp.plist\`);\n        const cmd = getStartupCommand().replace(/"/g, '&quot;');\n`, `        const plistPath = path.join(plistDir, \`com.atlisp.mcp.plist\`);\n`],
  ['src/cad-launcher.js', `export async function ensureCadInstance({\n  preferredPlatforms = AUTO_LAUNCH_PLATFORMS,\n  timeout = 30000,\n} = {}) {`, `export async function ensureCadInstance({\n  preferredPlatforms = AUTO_LAUNCH_PLATFORMS,\n  timeout: _timeout = 30000,\n} = {}) {`],
  ['src/cad-pool.js', `    for (const [key, timer] of this._reconnectTimers) {`, `    for (const [, timer] of this._reconnectTimers) {`],
  ['src/handler-utils.js', `  const { cad, resolveCadConnection } = await import('./cad.js');`, `  const { resolveCadConnection } = await import('./cad.js');`],
  ['src/handlers/block-handlers.js', `    const filter = args.filter || '';\n    const blockName = args.blockName || '';`, `    const blockName = args.blockName || '';`],
  ['src/handlers/dim-hatch-handlers.js', `        const result = await cad.sendCommandWithResult(code);\n        return { content: [{ type: 'text', text: \`已更新填充属性\` }] };`, `        await cad.sendCommandWithResult(code);\n        return { content: [{ type: 'text', text: \`已更新填充属性\` }] };`],
  ['src/handlers/file-handlers.js', `        const result = await cad.sendCommandWithResult(code);\n        return { content: [{ type: 'text', text: '已关闭图形' }] };`, `        await cad.sendCommandWithResult(code);\n        return { content: [{ type: 'text', text: '已关闭图形' }] };`],
  ['src/handlers/viewport-handlers.js', `        const result = await cad.sendCommandWithResult(code);\n        return { content: [{ type: 'text', text: '已最小化视口' }] };`, `        await cad.sendCommandWithResult(code);\n        return { content: [{ type: 'text', text: '已最小化视口' }] };`],
  ['src/handlers/xref-handlers.js', '    const result = await cad.sendCommandWithResult(\n      `(command "_.XATTACH"', '    await cad.sendCommandWithResult(\n      `(command "_.XATTACH"'],
  ['src/handlers/entity-handlers.js', `    let propCode = '';\n    switch (property) {`, `    let propCode;\n    switch (property) {`],
  ['src/handlers/layer-handlers.js', `    let propCode = '';\n    switch (property) {`, `    let propCode;\n    switch (property) {`],
  ['src/handlers/external-handlers.js', `  const { source, query, filters } = args;`, `  const { source, filters } = args;`],
  ['src/handlers/external-handlers.js', `    const x = parseFloat(row[mapping?.x || 'x' || 'X']);\n    const y = parseFloat(row[mapping?.y || 'y' || 'Y']);\n    const z = parseFloat(row[mapping?.z || 'z' || 'Z'] || '0');\n    const label = row[mapping?.label || 'label' || 'name'] || '';`,
    `    const col = (mappedKey, fallbackKeys) => mappedKey || fallbackKeys.find((k) => k in row) ?? fallbackKeys[0];\n    const x = parseFloat(row[col(mapping?.x, ['x', 'X'])]);\n    const y = parseFloat(row[col(mapping?.y, ['y', 'Y'])]);\n    const z = parseFloat(row[col(mapping?.z, ['z', 'Z'])] ?? '0');\n    const label = row[col(mapping?.label, ['label', 'name'])] || '';`],
  ['src/handlers/pdf-annotation-handlers.js', `    const results = [];\n    const pt = Array.isArray(basePoint) ? basePoint.join(' ') : basePoint;\n    for (let i = 0; i < pdfFiles.length; i++) {`, `    const results = [];\n    for (let i = 0; i < pdfFiles.length; i++) {`],
  ['src/handlers/query-print-handlers.js', `  const format = args.format || 'PDF';\n  const merge = args.merge !== false;\n\n  const results = [];`, `  const format = args.format || 'PDF';\n\n  const results = [];`],
  ['src/handlers/query-print-handlers.js', `  let fileList = [];\n  if (Array.isArray(args.fileList)) {`, `  let fileList;\n  if (Array.isArray(args.fileList)) {`],
  ['src/handlers/resource-handlers.js', `      const prev = cur[cur.length - 1];\n      const localH = prev.height || mh;\n      if (item.x - prev.x > xGapRatio) {`, `      const prev = cur[cur.length - 1];\n      if (item.x - prev.x > xGapRatio) {`],
  ['src/handlers/resource-readers.js', `      const prev = cur[cur.length - 1];\n      const localH = prev.height || mh;\n      if (item.x - prev.x > xGapRatio) {`, `      const prev = cur[cur.length - 1];\n      if (item.x - prev.x > xGapRatio) {`],
  ['src/handlers/resource-handlers.js', `async function getDrawingAnalysis(params = {}) {`, `async function getDrawingAnalysis(_params = {}) {`],
  ['src/handlers/style-handlers.js', `export async function createCloudLine(startPoint, endPoint, bulge = 1, arcRadius = 0) {`, `export async function createCloudLine(startPoint, endPoint, bulge = 1, _arcRadius = 0) {`],
  ['src/handlers/text-handlers.js', `        const caseSensitive = params.caseSensitive ? 'T' : 'nil';\n        const code = \`(progn`, `        const code = \`(progn`],
  ['src/routes.js', `                const { server, transport } = await getOrCreateSessionServer(sessionId);`, `                const { transport } = await getOrCreateSessionServer(sessionId);`],
  ['src/routes.js', `    const { server, transport } = await getOrCreateSessionServer(sessionId);\n    transport.resetCleanupTimer();\n    return mcpContext.run({ sessionId }, async () => {\n        return transport.handleRequest(body);`, `    const { transport } = await getOrCreateSessionServer(sessionId);\n    transport.resetCleanupTimer();\n    return mcpContext.run({ sessionId }, async () => {\n        return transport.handleRequest(body);`],
  ['src/routes.js', `    const { server, transport } = await getOrCreateSessionServer(sessionId);\n    transport.resetCleanupTimer();\n\n    const body = req.body;`, `    const { transport } = await getOrCreateSessionServer(sessionId);\n    transport.resetCleanupTimer();\n\n    const body = req.body;`],
  ['src/session-transport.js', `      const { resolve, reject, timeout } = this._pendingRequests.get(id);\n      clearTimeout(timeout);\n      this._pendingRequests.delete(id);\n      resolve(message);`, `      const { resolve, timeout } = this._pendingRequests.get(id);\n      clearTimeout(timeout);\n      this._pendingRequests.delete(id);\n      resolve(message);`],
  ['src/session-transport.js', `    for (const [id, { reject, timeout }] of this._pendingRequests) {`, `    for (const { reject, timeout } of this._pendingRequests.values()) {`],
  ['src/sse-session-manager.js', `        let successCount = 0;\n        for (const [clientId, session] of this.#sessions) {`, `        let successCount = 0;\n        for (const session of this.#sessions.values()) {`],
  ['src/sse-session.js', `        send: (data, done = false) => {`, `        send: (data, _done = false) => {`],
  ['src/streaming.js', `export async function streamTextContent({ layer = null, bbox = null, offset = 0, limit = 100 }) {`, `export async function streamTextContent({ layer = null, bbox: _bbox = null, offset = 0, limit = 100 }) {`],
  ['src/websocket-transport.js', `    stopCadPolling();\n    if (_wss) {\n        for (const [clientId, ws] of connectedClients) {`, `    stopCadPolling();\n    if (_wss) {\n        for (const ws of connectedClients.values()) {`],
  ['src/windows-service.js', `  let obj = 'LocalSystem';\n  let password = null;`, `  let obj;\n  let password;`],
  ['src/prompts/loader.js', `      const merged = { ...extPrompt, action: args.action || 'default' };\n      const action = args.action || 'default';`, `      const action = args.action || 'default';`],
  ['src/cad.js', `        for (const [id, entry] of this._pendingRequests) {`, `        for (const entry of this._pendingRequests.values()) {`],
  ['src/cad.js', `    for (const [id, { reject, timeout }] of this._pendingRequests) {`, `    for (const { reject, timeout } of this._pendingRequests.values()) {`],
  // grouping.js: 删除第 143 行的重复 key（保留机械分类定义）
  ['src/tools/grouping.js', `  export_dgn: ['测绘', '土木道桥', '通用'],\n  create_3d_face: ['测绘', '机械', '通用'],\n`, `  export_dgn: ['测绘', '土木道桥', '通用'],\n`],
];

// preserve-caught-error：补 { cause }
R.push(
  ['src/webhook-engine.js', null, null], // 占位，稍后单独处理（需看上下文）
);

let fail = 0;
for (const [file, from, to] of R) {
  if (from === null) continue;
  const src = fs.readFileSync(file, 'utf8');
  const count = src.split(from).length - 1;
  if (count !== 1) {
    console.error(`✗ ${file}: 命中 ${count} 次（期望 1 次）: ${JSON.stringify(from.slice(0, 60))}`);
    fail++;
    continue;
  }
  fs.writeFileSync(file, src.replace(from, to));
}
console.log(fail ? `${fail} 处失败` : '全部替换成功');
process.exit(fail ? 1 : 0);
