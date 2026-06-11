import fs from 'fs';
import path from 'path';
import os from 'os';
import zlib from 'zlib';
import { error as logError } from './logger.js';
import { ensureDir } from './handler-utils.js';

const AUDIT_DIR = path.join(os.homedir(), '@lisp', 'logs');
const AUDIT_FILE = path.join(AUDIT_DIR, 'audit.log');
const MAX_LOG_SIZE = 10 * 1024 * 1024;
const MAX_LOG_AGE = 90 * 24 * 60 * 60 * 1000;

function rotateIfNeeded() {
  try {
    if (fs.existsSync(AUDIT_FILE) && fs.statSync(AUDIT_FILE).size > MAX_LOG_SIZE) {
      const rotated = AUDIT_FILE.replace('.log', `.${Date.now()}.log`);
      fs.renameSync(AUDIT_FILE, rotated);
      try {
        const compressed = zlib.gzipSync(fs.readFileSync(rotated));
        fs.writeFileSync(rotated + '.gz', compressed);
        fs.unlinkSync(rotated);
      } catch (e) {
        logError(`Audit log compression failed, keeping raw file: ${e.message}`);
        try { fs.unlinkSync(rotated + '.gz'); } catch {}
      }
    }
  } catch (e) { logError(`Audit log rotation error: ${e.message}`); }
}

export function writeAuditEntry(entry) {
  try {
    ensureDir(AUDIT_DIR);
    rotateIfNeeded();
    const line = JSON.stringify({
      timestamp: entry.timestamp || new Date().toISOString(),
      tool: entry.tool,
      args: entry.args || {},
      sessionId: entry.sessionId || '',
      result: entry.result || null,
      error: entry.error || null,
      duration: entry.duration || 0,
      user: entry.user || '',
      role: entry.role || '',
    }) + '\n';
    fs.appendFileSync(AUDIT_FILE, line, 'utf-8');
  } catch (e) {
    logError(`Audit log write error: ${e.message}`);
  }
}

export function queryAuditLog(filters = {}) {
  try {
    if (!fs.existsSync(AUDIT_FILE)) return { total: 0, offset: 0, count: 0, entries: [] };
    const content = fs.readFileSync(AUDIT_FILE, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);

    let entries = lines.map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);

    if (filters.tool) entries = entries.filter(e => e.tool === filters.tool);
    if (filters.fromDate) entries = entries.filter(e => new Date(e.timestamp) >= new Date(filters.fromDate));
    if (filters.toDate) entries = entries.filter(e => new Date(e.timestamp) <= new Date(filters.toDate));
    if (filters.result) entries = entries.filter(e => e.result === filters.result);
    if (filters.user) entries = entries.filter(e => e.user === filters.user);
    if (filters.sessionId) entries = entries.filter(e => e.sessionId === filters.sessionId);

    entries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    const offset = filters.offset || 0;
    const limit = filters.limit || 100;
    const total = entries.length;

    return {
      total,
      offset,
      count: Math.min(limit, entries.length - offset),
      entries: entries.slice(offset, offset + limit),
    };
  } catch (e) {
    logError(`Audit query error: ${e.message}`);
    return { total: 0, offset: 0, count: 0, entries: [] };
  }
}

export function getAuditStats() {
  try {
    if (!fs.existsSync(AUDIT_FILE)) return { totalEntries: 0, tools: {}, errors: 0 };
    const content = fs.readFileSync(AUDIT_FILE, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);

    const toolCounts = {};
    let errors = 0;

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        toolCounts[entry.tool] = (toolCounts[entry.tool] || 0) + 1;
        if (entry.error) errors++;
      } catch {}
    }

    return {
      totalEntries: lines.length,
      tools: toolCounts,
      errors,
      fileSize: fs.existsSync(AUDIT_FILE) ? fs.statSync(AUDIT_FILE).size : 0,
      filePath: AUDIT_FILE,
    };
  } catch (e) {
    return { totalEntries: 0, tools: {}, errors: 0, fileSize: 0, filePath: AUDIT_FILE };
  }
}

export { AUDIT_FILE };
