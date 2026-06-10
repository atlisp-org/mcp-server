import { cad } from '../cad.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { log, error as logError } from '../logger.js';
import { escapeLispString } from '../handler-utils.js';

const DATA_DIR = path.join(os.homedir(), '.atlisp', 'data');
const MAX_FILE_SIZE = 10 * 1024 * 1024;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function validateSourcePath(source) {
  const sanitized = source.replace(/[^a-zA-Z0-9_\-]/g, '_');
  if (sanitized !== source) {
    logError(`external-handlers: sanitized source "${source}" -> "${sanitized}"`);
  }
  const filePath = path.resolve(DATA_DIR, sanitized);
  if (!filePath.startsWith(path.resolve(DATA_DIR) + path.sep) && filePath !== path.resolve(DATA_DIR)) {
    throw new Error('路径穿越检测: 数据源路径必须位于 DATA_DIR 内');
  }
  return filePath;
}

function checkFileSize(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_FILE_SIZE) {
      throw new Error(`文件过大 (${(stat.size / 1024 / 1024).toFixed(1)}MB)，最大允许 ${MAX_FILE_SIZE / 1024 / 1024}MB`);
    }
  } catch (e) {
    if (e.code === 'ENOENT') return;
    throw e;
  }
}

function scanDataSources() {
  ensureDataDir();
  const sources = [];
  try {
    const files = fs.readdirSync(DATA_DIR);
    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      if (['.csv', '.json', '.db', '.sqlite'].includes(ext)) {
        sources.push({ name: file.replace(ext, ''), file, type: ext.slice(1) });
      }
    }
  } catch (e) { logError(`external-handlers: scanDataSources error: ${e.message}`); }
  return sources;
}

function queryCSV(filePath, filters = {}) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim());
    const row = {};
    headers.forEach((h, idx) => { row[h] = values[idx] || ''; });

    let match = true;
    for (const [key, val] of Object.entries(filters)) {
      if (row[key] !== undefined && String(row[key]) !== String(val)) { match = false; break; }
    }
    if (match) rows.push(row);
  }
  return rows;
}

export function externalDbQuery(args) {
  const { source, query, filters } = args;
  ensureDataDir();

  if (!source) {
    const sources = scanDataSources();
    return { content: [{ type: 'text', text: JSON.stringify({ sources }) }] };
  }

  let filePath;
  try { filePath = validateSourcePath(source); } catch (e) { return { content: [{ type: 'text', text: e.message }], isError: true }; }
  checkFileSize(filePath);
  if (!fs.existsSync(filePath)) {
    for (const ext of ['.csv', '.json']) {
      const altPath = validateSourcePath(source + ext);
      if (fs.existsSync(altPath)) {
        checkFileSize(altPath);
        const ext2 = path.extname(altPath).toLowerCase();
        if (ext2 === '.csv') {
          const rows = queryCSV(altPath, filters || {});
          return { content: [{ type: 'text', text: JSON.stringify({ source, rows, count: rows.length }) }] };
        } else if (ext2 === '.json') {
          const data = JSON.parse(fs.readFileSync(altPath, 'utf-8'));
          return { content: [{ type: 'text', text: JSON.stringify({ source, data }) }] };
        }
      }
    }
    return { content: [{ type: 'text', text: `数据源 "${source}" 未找到` }], isError: true };
  }

  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.csv') {
    checkFileSize(filePath);
    const rows = queryCSV(filePath, filters || {});
    return { content: [{ type: 'text', text: JSON.stringify({ source, rows, count: rows.length }) }] };
  } else if (ext === '.json') {
    checkFileSize(filePath);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return { content: [{ type: 'text', text: JSON.stringify({ source, data }) }] };
  }

  return { content: [{ type: 'text', text: `不支持的数据源类型: ${ext}` }], isError: true };
}

export function importExternalData(args) {
  const { source, targetLayer, mapping } = args;
  ensureDataDir();

  let filePath;
  try { filePath = validateSourcePath(source); } catch (e) { return { content: [{ type: 'text', text: e.message }], isError: true }; }
  if (!fs.existsSync(filePath)) {
    for (const ext of ['.csv', '.json']) {
      try {
        const altPath = validateSourcePath(source + ext);
        if (fs.existsSync(altPath)) { filePath = altPath; break; }
      } catch {}
    }
  }
  if (!fs.existsSync(filePath)) {
    return { content: [{ type: 'text', text: `数据源 "${source}" 未找到` }], isError: true };
  }

  let rows = [];
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.csv') {
    rows = queryCSV(filePath);
  } else if (ext === '.json') {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    rows = Array.isArray(data) ? data : (data.rows || data.data || []);
  }

  if (rows.length === 0) {
    return { content: [{ type: 'text', text: '数据为空' }] };
  }

  const layer = targetLayer || 'ImportedData';
  const createEntities = [];

  for (const row of rows) {
    const x = parseFloat(row[mapping?.x || 'x' || 'X']);
    const y = parseFloat(row[mapping?.y || 'y' || 'Y']);
    const z = parseFloat(row[mapping?.z || 'z' || 'Z'] || '0');
    const label = row[mapping?.label || 'label' || 'name'] || '';

    if (!isNaN(x) && !isNaN(y)) {
      if (label) {
        createEntities.push(`(entmakex (list (cons 0 "POINT") (cons 10 (list ${x} ${y} ${z})) (cons 8 "${escapeLispString(layer)}") (cons 1 "${escapeLispString(label)}")))`);
      } else {
        createEntities.push(`(entmakex (list (cons 0 "POINT") (cons 10 (list ${x} ${y} ${z})) (cons 8 "${escapeLispString(layer)}")))`);
      }
    }
  }

  if (createEntities.length === 0) {
    return { content: [{ type: 'text', text: '没有有效的坐标数据可以导入' }] };
  }

  return cad.sendCommandWithResult(`(progn ${createEntities.join('\n')} (princ (strcat "导入了 " (itoa ${createEntities.length}) " 个实体到图层 ${layer}")))`).then(result => {
    return { content: [{ type: 'text', text: result || `导入了 ${createEntities.length} 个实体到图层 "${layer}"` }] };
  });
}

export function exportToExternal(args) {
  const { format, outputFile, filter } = args;
  ensureDataDir();

  const lisp = `(progn
    (setq ss (ssget "_X" '(${filter ? `(8 . "${escapeLispString(filter.layer || '*')}")` : ''}))
    (setq n (sslength ss))
    (setq result nil)
    (setq i 0)
    (while (< i n)
      (setq e (ssname ss i))
      (setq elist (entget e))
      (setq result (cons (list (cdr (assoc 0 elist)) (cdr (assoc 5 elist)) (cdr (assoc 8 elist)) (cdr (assoc 10 elist))) result))
      (setq i (1+ i)))
    (reverse result))`;

  return cad.sendCommandWithResult(lisp).then(raw => {
    let entities;
    try { entities = JSON.parse(raw); } catch { entities = []; }

    const exportData = entities.map(e => ({
      type: e[0], handle: e[1], layer: e[2], point: e[3]
    }));

    const outFile = outputFile || path.join(DATA_DIR, `export_${Date.now()}.${format || 'json'}`);
    const dir = path.dirname(outFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    if (format === 'csv') {
      const csv = 'type,handle,layer,point\n' + exportData.map(e => `"${e.type}","${e.handle}","${e.layer}","${e.point}"`).join('\n');
      fs.writeFileSync(outFile, csv, 'utf-8');
    } else {
      fs.writeFileSync(outFile, JSON.stringify(exportData, null, 2), 'utf-8');
    }

    return { content: [{ type: 'text', text: JSON.stringify({ exported: exportData.length, file: outFile, format: format || 'json' }) }] };
  });
}

export function listDataSources() {
  const sources = scanDataSources();
  return { content: [{ type: 'text', text: JSON.stringify({ sources }) }] };
}
