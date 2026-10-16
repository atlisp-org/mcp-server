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

const INDUSTRY_FILE_MAP = {
  '通用': 'drafting.json',
  '建筑': 'architectural.json',
  '结构': 'structural.json',
  '机械': 'mechanical.json',
  '电气': 'electrical.json',
  '暖通给排水': 'hvac.json',
  '土木道桥': 'civil.json',
  '测绘': 'surveying.json',
  '室内装饰': 'interior.json',
  '景观园林': 'landscape.json'
};

export function getIndustryStandards(industry) {
  const filename = INDUSTRY_FILE_MAP[industry];
  if (!filename) return { error: `未知行业: ${industry}` };
  const cacheKey = `industry:${filename}`;
  const cached = getCachedStandards(cacheKey);
  if (cached) return cached;
  const data = loadStandardsFile(filename);
  if (data) setCachedStandards(cacheKey, data);
  return data || { error: `行业规范文件加载失败: ${industry}` };
}

export function listAvailableStandards() {
  try {
    const files = fs.readdirSync(STANDARDS_DIR).filter(f => f.endsWith('.json'));
    return files.map(f => {
      const data = loadStandardsFile(f);
      if (!data) return null;
      const key = f.replace('.json', '');
      return {
        key,
        name: data.name || key,
        version: data.version || '1.0',
        description: data.description || '',
        categories: Object.keys(data.categories || {})
      };
    }).filter(Boolean);
  } catch (e) {
    log(`listAvailableStandards error: ${e.message}`);
    return [];
  }
}

export function mergeStandards(base, industry) {
  if (!base || base.error) return base;
  if (!industry || industry.error) return base;
  const merged = JSON.parse(JSON.stringify(base));
  for (const [cat, data] of Object.entries(industry.categories || {})) {
    if (!merged.categories[cat]) {
      merged.categories[cat] = data;
    } else if (data.rules) {
      merged.categories[cat].rules = [...(merged.categories[cat].rules || []), ...data.rules];
    }
  }
  return merged;
}
