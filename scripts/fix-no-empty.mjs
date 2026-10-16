// P0-2 no-empty 修复：为空 catch 块补日志
import fs from 'node:fs';

const R = [
  // audit-log.js（已有 logError）
  ['src/audit-log.js',
   `        try { fs.unlinkSync(rotated + '.gz'); } catch {}`,
   `        try { fs.unlinkSync(rotated + '.gz'); } catch (e) { logError(\`清理压缩文件失败: \${e.message}\`); }`],
  ['src/audit-log.js',
   `        if (entry.error) errors++;\n      } catch {}`,
   `        if (entry.error) errors++;\n      } catch (e) { logError(\`审计日志行解析失败，已跳过: \${e.message}\`); }`],
  // config.js 不能反向依赖 logger（logger 依赖 config），用 console.error
  ['src/config.js',
   `configWatchers.forEach(fn => { try { fn(config); } catch {} });`,
   `configWatchers.forEach(fn => { try { fn(config); } catch (e) { console.error('[config] watcher 回调失败:', e.message); } });`, 2],
  // external-handlers.js（已有 logError）
  ['src/handlers/external-handlers.js',
   `      } catch {}\n    }\n  }\n}`,
   `      } catch (e) { logError(\`探测候选路径失败: \${e.message}\`); }\n    }\n  }\n}`],
  // sheetset-handlers.js
  ['src/handlers/sheetset-handlers.js',
   `import path from 'path';`,
   `import path from 'path';\nimport { error as logError } from '../logger.js';`],
  ['src/handlers/sheetset-handlers.js',
   `        };\n      } catch {}`,
   `        };\n      } catch (e) { logError(\`图纸集比较数据解析失败: \${e.message}\`); }`],
  // skill-handlers.js ×7
  ['src/handlers/skill-handlers.js',
   `import fs from 'fs';`,
   `import fs from 'fs';\nimport { error as logError } from '../logger.js';`],
  ['src/handlers/skill-handlers.js',
   `try { if (fs.existsSync(CACHE_PATH)) return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8')); } catch {}`,
   `try { if (fs.existsSync(CACHE_PATH)) return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8')); } catch (e) { logError(\`skill 缓存读取失败: \${e.message}\`); }`],
  ['src/handlers/skill-handlers.js',
   `try { fs.writeFileSync(CACHE_PATH, JSON.stringify(data, null, 2), 'utf-8'); } catch {}`,
   `try { fs.writeFileSync(CACHE_PATH, JSON.stringify(data, null, 2), 'utf-8'); } catch (e) { logError(\`skill 缓存写入失败: \${e.message}\`); }`],
  ['src/handlers/skill-handlers.js',
   `            writeCache(index);\n        }\n    } catch {}`,
   `            writeCache(index);\n        }\n    } catch (e) { logError(\`skill 索引刷新失败: \${e.message}\`); }`],
  ['src/handlers/skill-handlers.js',
   `    try { fs.mkdirSync(SKILLS_DIR, { recursive: true }); } catch {}`,
   `    try { fs.mkdirSync(SKILLS_DIR, { recursive: true }); } catch (e) { logError(\`创建 skills 目录失败: \${e.message}\`); }`],
  ['src/handlers/skill-handlers.js',
   `                } catch {}\n            }\n        }\n    } catch {}\n    if (!results.length)`,
   `                } catch (e) { logError(\`读取 skill 描述失败: \${e.message}\`); }\n            }\n        }\n    } catch (e) { logError(\`扫描 skills 目录失败: \${e.message}\`); }\n    if (!results.length)`],
  ['src/handlers/skill-handlers.js',
   `                } catch {}\n                if (found) break;`,
   `                } catch (e) { logError(\`匹配 skill 文件失败: \${e.message}\`); }\n                if (found) break;`],
  ['src/handlers/skill-handlers.js',
   `        }\n    } catch {}\n    if (!found)`,
   `        }\n    } catch (e) { logError(\`扫描 skills 目录失败: \${e.message}\`); }\n    if (!found)`],
  // health-reporter.js（已有 logger）
  ['src/health-reporter.js',
   `        try { cad.ping(); } catch {}`,
   `        try { cad.ping(); } catch (e) { logError(\`health ping 失败: \${e.message}\`); }`],
  ['src/health-reporter.js',
   `    try { sseCount = sessionManager?.count?.() || 0; } catch {}`,
   `    try { sseCount = sessionManager?.count?.() || 0; } catch (e) { logError(\`获取 SSE 会话数失败: \${e.message}\`); }`],
  // lockfile.js
  ['src/lockfile.js',
   `import fs from 'node:fs';`,
   `import fs from 'node:fs';\nimport { error as logError } from './logger.js';`],
  ['src/lockfile.js',
   `            } catch {}\n            try { fs.unlinkSync(lp); } catch {}`,
   `            } catch (e) { logError(\`锁文件内容损坏，按陈旧锁处理: \${e.message}\`); }\n            try { fs.unlinkSync(lp); } catch (e) { logError(\`删除陈旧锁文件失败: \${e.message}\`); }`],
  ['src/lockfile.js',
   `            if (existing.pid !== process.pid) return;\n        } catch {}`,
   `            if (existing.pid !== process.pid) return;\n        } catch (e) { logError(\`锁文件读取失败: \${e.message}\`); }`],
  // logger.js 自身：避免递归，用 console.error
  ['src/logger.js',
   `    try { _logNotify(level, message); } catch {}`,
   `    try { _logNotify(level, message); } catch (e) { console.error('[logger] notify 回调失败:', e.message); }`],
  // prompts/handlers/analyze-drawing.js ×3
  ['src/prompts/handlers/analyze-drawing.js',
   `import cad from '../../cad.js';`,
   `import cad from '../../cad.js';\nimport { error as logError } from '../../logger.js';`],
  ['src/prompts/handlers/analyze-drawing.js',
   `        try { entities = JSON.parse(entResult); } catch {}`,
   `        try { entities = JSON.parse(entResult); } catch (e) { logError(\`实体列表解析失败: \${e.message}\`); }`],
  ['src/prompts/handlers/analyze-drawing.js',
   `        try { layers = JSON.parse(layerResult); } catch {}`,
   `        try { layers = JSON.parse(layerResult); } catch (e) { logError(\`图层列表解析失败: \${e.message}\`); }`],
  // prompts/loader.js（已有 logger）
  ['src/prompts/loader.js',
   `          builtinDefs[def.name] = def;\n        }\n      } catch {}`,
   `          builtinDefs[def.name] = def;\n        }\n      } catch (e) { logError(\`内置 prompt 加载失败: \${file}: \${e.message}\`); }`],
  ['src/prompts/loader.js',
   `          externalPrompts.push(prompt);\n        }\n      } catch {}`,
   `          externalPrompts.push(prompt);\n        }\n      } catch (e) { logError(\`外部 prompt 加载失败: \${file}: \${e.message}\`); }`],
  // routes.js（已有 logError）
  ['src/routes.js',
   `            try { await cad.ping(); } catch {}`,
   `            try { await cad.ping(); } catch (e) { logError('health ping 失败:', e.message); }`],
  ['src/routes.js',
   `        let sseCount = 0;\n        try { sseCount = sessionManager?.count?.() || 0; } catch {}`,
   `        let sseCount = 0;\n        try { sseCount = sessionManager?.count?.() || 0; } catch (e) { logError('获取 SSE 会话数失败:', e.message); }`],
  ['src/routes.js',
   `        let sseCount = 0;\n        try { sseCount = sessionManager?.count?.() || 0; } catch {}\n        res.json({\n            status: 'ok', timestamp: new Date().toISOString(),`,
   `        let sseCount = 0;\n        try { sseCount = sessionManager?.count?.() || 0; } catch (e) { logError('获取 SSE 会话数失败:', e.message); }\n        res.json({\n            status: 'ok', timestamp: new Date().toISOString(),`],
  // single-instance.js 沿用 console.error 风格
  ['src/single-instance.js',
   `      console.error(\`锁文件已清理: \${LOCK_FILE}\`);\n    }\n  } catch {}`,
   `      console.error(\`锁文件已清理: \${LOCK_FILE}\`);\n    }\n  } catch (e) {\n    console.error(\`[single-instance] 解锁检查失败: \${e.message}\`);\n  }`],
  // websocket-transport.js
  ['src/websocket-transport.js',
   `        try { ws.ping(); } catch {}`,
   `        try { ws.ping(); } catch (e) { logError('ws ping 失败:', e.message); }`],
  ['src/websocket-transport.js',
   `            try { ws.close(1001, 'Server shutting down'); } catch {}`,
   `            try { ws.close(1001, 'Server shutting down'); } catch (e) { logError('ws 关闭失败:', e.message); }`],
  // windows-service.js 使用自带 log()
  ['src/windows-service.js',
   `    finally { try { fs.unlinkSync(tmpPs1); } catch {} }`,
   `    finally { try { fs.unlinkSync(tmpPs1); } catch (e) { log(\`清理临时脚本失败: \${e.message}\`, 'yellow'); } }`],
];

let fail = 0;
for (const [file, from, to, expected] of R) {
  const n = expected ?? 1;
  const src = fs.readFileSync(file, 'utf8');
  const count = src.split(from).length - 1;
  if (count !== n) {
    console.error(`✗ ${file}: 命中 ${count} 次（期望 ${n}）: ${JSON.stringify(from.slice(0, 50))}`);
    fail++;
    continue;
  }
  fs.writeFileSync(file, n === 1 ? src.replace(from, to) : src.replaceAll(from, to));
}
console.log(fail ? `${fail} 处失败` : 'no-empty 全部修复');
process.exit(fail ? 1 : 0);
