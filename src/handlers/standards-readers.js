import { STANDARDS_DIR } from './resource-defs.js';
import { log } from '../logger.js';
import fs from 'fs';
import path from 'path';

const standardsCache = new Map();

function loadStandardsFile(filename) {
  const filePath = path.join(STANDARDS_DIR, filename);
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    log(`Error loading standards file ${filename}: ${e.message}`);
    return null;
  }
}

function getCachedStandards(key) {
  const entry = standardsCache.get(key);
  if (entry && Date.now() - entry.timestamp < 30000) return entry.data;
  standardsCache.delete(key);
  return null;
}

function setCachedStandards(key, data) {
  standardsCache.set(key, { data, timestamp: Date.now() });
}

export function getDraftingStandards() {
  const cached = getCachedStandards('drafting');
  if (cached) return cached;
  const data = loadStandardsFile('drafting.json');
  if (data) setCachedStandards('drafting', data);
  return data || { error: '制图规范文件加载失败' };
}

export function getCodingStandards() {
  const cached = getCachedStandards('coding');
  if (cached) return cached;
  const data = loadStandardsFile('coding.json');
  if (data) setCachedStandards('coding', data);
  return data || { error: '编码规范文件加载失败' };
}
