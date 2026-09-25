import { cad } from '../cad.js';
import { log } from '../logger.js';
import { parseLispRecursive, escapeLispString } from '../handler-utils.js';
import { ensureCad } from './resource-utils.js';
import { STANDARDS_DIR } from './resource-defs.js';
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
  if (entry && Date.now() - entry.timestamp < 60000) return entry.data;
  standardsCache.delete(key);
  return null;
}

function setCachedStandards(key, data) {
  standardsCache.set(key, { data, timestamp: Date.now() });
}

function getIndustryStandardsFile(industry) {
  const mapping = {
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
  return mapping[industry] || 'drafting.json';
}

const INDUSTRY_NAMES = {
  '通用': '通用', '编码': '编码', '建筑': '建筑', '结构': '结构',
  '机械': '机械', '电气': '电气', '暖通给排水': '暖通给排水',
  '土木道桥': '土木道桥', '测绘': '测绘', '室内装饰': '室内装饰',
  '景观园林': '景观园林'
};

function parseLayerResult(result) {
  const parsed = parseLispRecursive(result);
  if (!parsed || !Array.isArray(parsed)) return [];
  return parsed.map(p => {
    if (Array.isArray(p) && p.length >= 2) {
      const obj = {};
      for (let i = 0; i < p.length - 1; i += 2) {
        obj[String(p[i])] = p[i + 1];
      }
      return obj;
    }
    return null;
  }).filter(Boolean);
}

function matchRuleByPrefix(name, rules) {
  for (const rule of rules) {
    if (rule.prefix && name.startsWith(rule.prefix)) return rule;
    if (rule.name && rule.name === name) return rule;
  }
  return null;
}

const LAYER_QUERY = `(progn
  (setq layers nil)
  (setq le (tblnext "layer" t))
  (while le
    (setq ln (cdr (assoc 2 le)) lc (cdr (assoc 62 le)) ll (cdr (assoc 6 le)))
    (if (< lc 0) (setq lc (- lc)))
    (setq layers (cons (list "name" ln "color" lc "linetype" ll) layers))
    (setq le (tblnext "layer" nil)))
  (vl-prin1-to-string (reverse layers)))`;

const STYLE_QUERY = `(progn
  (setq styles nil)
  (setq st (tblnext "style" t))
  (while st
    (setq sn (cdr (assoc 2 st)) sf (cdr (assoc 3 st)) sh (cdr (assoc 40 st)))
    (setq styles (cons (list "name" sn "font" sf "height" sh) styles))
    (setq st (tblnext "style" nil)))
  (vl-prin1-to-string (reverse styles)))`;

const DIMSTYLE_QUERY = `(progn
  (setq styles nil)
  (setq ds (tblnext "dimstyle" t))
  (while ds
    (setq sn (cdr (assoc 2 ds)))
    (setq styles (cons (list "name" sn) styles))
    (setq ds (tblnext "dimstyle" nil)))
  (vl-prin1-to-string (reverse styles)))`;

export async function checkDrawingStandards(params = {}) {
  const { industry = '通用', categories = ['layers', 'colors', 'linetypes', 'textstyles', 'dimstyles', 'file_naming'], strict = false } = params;
  await ensureCad();
  const cacheKey = `standards:${industry}`;
  let standards = getCachedStandards(cacheKey);
  if (!standards) {
    const filename = getIndustryStandardsFile(industry);
    standards = loadStandardsFile(filename);
    if (!standards) return { ok: false, error: `行业规范文件加载失败: ${industry}` };
    setCachedStandards(cacheKey, standards);
  }
  const issues = [];
  try {
    if (categories.includes('layers') || categories.includes('colors') || categories.includes('linetypes')) {
      const result = await cad.sendCommandWithResult(LAYER_QUERY);
      const drawingLayers = parseLayerResult(result);
      if (categories.includes('layers')) issues.push(...checkLayerItems(standards, drawingLayers, strict));
      if (categories.includes('colors')) issues.push(...checkColorItems(standards, drawingLayers, strict));
      if (categories.includes('linetypes')) issues.push(...checkLinetypeItems(standards, drawingLayers, strict));
    }
    if (categories.includes('textstyles')) {
      const result = await cad.sendCommandWithResult(STYLE_QUERY);
      const drawingStyles = parseLayerResult(result);
      issues.push(...checkTextStyleItems(standards, drawingStyles));
    }
    if (categories.includes('dimstyles')) {
      const result = await cad.sendCommandWithResult(DIMSTYLE_QUERY);
      const drawingStyles = parseLayerResult(result);
      issues.push(...checkDimStyleItems(standards, drawingStyles));
    }
    if (categories.includes('file_naming')) {
      issues.push(...(await checkFileNamingItems(standards)));
    }
    return { ok: issues.length === 0, industry, categories, strict, issueCount: issues.length, issues };
  } catch (e) {
    log(`checkDrawingStandards error: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

function checkLayerItems(standards, drawingLayers, strict) {
  const issues = [];
  const rules = standards.categories?.layers?.rules || [];
  const requiredRules = rules.filter(r => r.required);
  for (const rule of requiredRules) {
    const found = drawingLayers.find(l => l.name === rule.name || (rule.prefix && l.name.startsWith(rule.prefix)));
    if (!found) {
      issues.push({ type: 'missing_required_layer', severity: 'error', category: 'layers', message: `缺少必需图层: ${rule.name || rule.prefix}`, expected: rule.name || rule.prefix });
    }
  }
  if (strict) {
    for (const rule of rules) {
      if (rule.prefix && !rule.name) {
        const matching = drawingLayers.filter(l => l.name.startsWith(rule.prefix));
        if (matching.length === 0) {
          issues.push({ type: 'missing_prefix_layer', severity: 'warning', category: 'layers', message: `缺少 ${rule.meaning || rule.prefix} 前缀的图层`, prefix: rule.prefix });
        }
      }
    }
  }
  return issues;
}

function checkColorItems(standards, drawingLayers, strict) {
  const issues = [];
  if (!strict) return issues;
  const colorRules = standards.categories?.colors?.rules || [];
  for (const layer of drawingLayers) {
    if (layer.name === '0') continue;
    const rule = matchRuleByPrefix(layer.name, standards.categories?.layers?.rules || []);
    if (rule && rule.color && layer.color !== rule.color) {
      const colorDesc = colorRules.find(c => c.color === rule.color);
      issues.push({ type: 'color_mismatch', severity: 'warning', category: 'colors', message: `图层 "${layer.name}" 颜色应为 ${rule.color}(${colorDesc?.name || ''})，实际为 ${layer.color}`, layer: layer.name, expected: rule.color, actual: layer.color });
    }
  }
  return issues;
}

function checkLinetypeItems(standards, drawingLayers, strict) {
  const issues = [];
  if (!strict) return issues;
  for (const layer of drawingLayers) {
    if (layer.name === '0') continue;
    const rule = matchRuleByPrefix(layer.name, standards.categories?.layers?.rules || []);
    if (rule && rule.linetype && layer.linetype !== rule.linetype) {
      issues.push({ type: 'linetype_mismatch', severity: 'warning', category: 'linetypes', message: `图层 "${layer.name}" 线型应为 ${rule.linetype}，实际为 ${layer.linetype}`, layer: layer.name, expected: rule.linetype, actual: layer.linetype });
    }
  }
  return issues;
}

function checkTextStyleItems(standards, drawingStyles) {
  const issues = [];
  const rules = standards.categories?.textstyles?.rules || [];
  for (const rule of rules) {
    if (rule.required && rule.name) {
      const found = drawingStyles.find(s => s.name === rule.name);
      if (!found) {
        issues.push({ type: 'missing_text_style', severity: 'error', category: 'textstyles', message: `缺少文字样式: ${rule.name}`, style: rule.name });
      }
    }
  }
  return issues;
}

function checkDimStyleItems(standards, drawingStyles) {
  const issues = [];
  const rules = standards.categories?.dimstyles?.rules || [];
  for (const rule of rules) {
    if (rule.required && rule.name) {
      const found = drawingStyles.find(s => s.name === rule.name);
      if (!found) {
        issues.push({ type: 'missing_dim_style', severity: 'error', category: 'dimstyles', message: `缺少标注样式: ${rule.name}`, style: rule.name });
      }
    }
  }
  return issues;
}

async function checkFileNamingItems(standards) {
  const issues = [];
  const rules = standards.categories?.file_naming?.rules || [];
  if (rules.length === 0) return issues;
  try {
    const result = await cad.sendCommandWithResult('(getvar "dwgname")');
    const filename = result?.replace(/"/g, '').trim();
    if (!filename || filename === 'Drawing1.dwg') return issues;
    const patternRule = rules.find(r => r.pattern);
    if (patternRule) {
      const pattern = patternRule.pattern
        .replace('项目编码', '[A-Za-z0-9]+')
        .replace('专业代码', '[A-Za-z]+')
        .replace('图纸类型', '[A-Za-z]+')
        .replace('序号', '[0-9]+')
        .replace(/\./g, '\\.');
      const regex = new RegExp(`^${pattern}$`);
      if (!regex.test(filename.replace(/\.dwg$/i, ''))) {
        issues.push({ type: 'file_naming_violation', severity: 'warning', category: 'file_naming', message: `文件名 "${filename}" 不符合命名规范`, expected: patternRule.pattern, example: patternRule.example });
      }
    }
  } catch {
    // 命名规则无效时忽略，不影响其他检查项
  }
  return issues;
}

export async function applyStandardsTemplate(params) {
  const { industry, overwrite = false } = params;
  if (!industry) return { ok: false, error: '必须指定行业' };
  await ensureCad();
  const filename = getIndustryStandardsFile(industry);
  const standards = loadStandardsFile(filename);
  if (!standards) return { ok: false, error: `行业规范文件加载失败: ${industry}` };
  const results = [];
  try {
    const layerRules = standards.categories?.layers?.rules || [];
    for (const rule of layerRules) {
      if (!rule.name) continue;
      const checkCode = `(tblsearch "LAYER" "${escapeLispString(rule.name)}")`;
      const exists = await cad.sendCommandWithResult(checkCode);
      const color = rule.color || 7;
      const linetype = rule.linetype || 'Continuous';
      if (!exists || exists === 'nil' || exists === '') {
        const createCode = `(command "_.LAYER" "_N" "${escapeLispString(rule.name)}" "_C" "${color}" "${escapeLispString(rule.name)}" "_L" "${escapeLispString(linetype)}" "${escapeLispString(rule.name)}" "")`;
        await cad.sendCommandWithResult(createCode);
        results.push({ type: 'created_layer', name: rule.name, color, linetype });
      } else if (overwrite) {
        const updateCode = `(command "_.LAYER" "_C" "${color}" "${escapeLispString(rule.name)}" "_L" "${escapeLispString(linetype)}" "${escapeLispString(rule.name)}" "")`;
        await cad.sendCommandWithResult(updateCode);
        results.push({ type: 'updated_layer', name: rule.name, color, linetype });
      } else {
        results.push({ type: 'skipped', name: rule.name, reason: 'already exists' });
      }
    }
    const textStyleRules = standards.categories?.textstyles?.rules || [];
    for (const rule of textStyleRules) {
      if (!rule.name) continue;
      const checkCode = `(tblsearch "STYLE" "${escapeLispString(rule.name)}")`;
      const exists = await cad.sendCommandWithResult(checkCode);
      if (!exists || exists === 'nil' || exists === '') {
        const font = rule.font || '宋体';
        const height = rule.height || 3.5;
        const width = rule.width || 0.7;
        const createCode = `(command "_.STYLE" "${escapeLispString(rule.name)}" "${escapeLispString(font)}" "${height}" "${width}" "0" "N" "N" "")`;
        await cad.sendCommandWithResult(createCode);
        results.push({ type: 'created_text_style', name: rule.name, font, height, width });
      } else {
        results.push({ type: 'skipped', name: rule.name, reason: 'already exists' });
      }
    }
    return {
      ok: true, industry, overwrite,
      appliedCount: results.filter(r => r.type.startsWith('created') || r.type.startsWith('updated')).length,
      skippedCount: results.filter(r => r.type === 'skipped').length,
      results
    };
  } catch (e) {
    log(`applyStandardsTemplate error: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

export async function listStandards(params = {}) {
  const { industry } = params;
  try {
    const files = fs.readdirSync(STANDARDS_DIR).filter(f => f.endsWith('.json'));
    const standards = [];
    for (const file of files) {
      const data = loadStandardsFile(file);
      if (!data) continue;
      const key = file.replace('.json', '');
      const name = INDUSTRY_NAMES[data.name?.replace('制图规范', '')?.replace('编码规范', '')?.trim()] || key;
      if (industry && !name.includes(industry) && key !== industry) continue;
      standards.push({
        key,
        name: data.name || key,
        version: data.version || '1.0',
        description: data.description || '',
        industry: INDUSTRY_NAMES[key] || key,
        categories: Object.keys(data.categories || {})
      });
    }
    return { count: standards.length, standards };
  } catch (e) {
    return { count: 0, standards: [], error: e.message };
  }
}

export async function loadStandards(params) {
  const { industry } = params;
  if (!industry) return { ok: false, error: '必须指定行业' };
  const cacheKey = `standards:${industry}`;
  let standards = getCachedStandards(cacheKey);
  if (!standards) {
    const filename = getIndustryStandardsFile(industry);
    standards = loadStandardsFile(filename);
    if (!standards) return { ok: false, error: `行业规范文件加载失败: ${industry}` };
    setCachedStandards(cacheKey, standards);
  }
  return { ok: true, industry, standards };
}

export async function saveStandards(params) {
  const { name, standards, overwrite = false } = params;
  if (!name || !standards) return { ok: false, error: '必须指定名称和规范内容' };
  const filePath = path.join(STANDARDS_DIR, `${name}.json`);
  if (!overwrite && fs.existsSync(filePath)) {
    return { ok: false, error: `规范文件已存在: ${name}.json，设置 overwrite=true 以覆盖` };
  }
  try {
    fs.writeFileSync(filePath, JSON.stringify(standards, null, 2), 'utf-8');
    standardsCache.delete(`standards:${name}`);
    return { ok: true, name, path: filePath };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function compareStandards(params) {
  const { standard1, standard2 } = params;
  if (!standard1 || !standard2) return { ok: false, error: '必须指定两个规范名称' };
  const s1 = loadStandardsFile(getIndustryStandardsFile(standard1));
  const s2 = loadStandardsFile(getIndustryStandardsFile(standard2));
  if (!s1) return { ok: false, error: `规范加载失败: ${standard1}` };
  if (!s2) return { ok: false, error: `规范加载失败: ${standard2}` };
  const diffs = [];
  const cats1 = Object.keys(s1.categories || {});
  const cats2 = Object.keys(s2.categories || {});
  for (const cat of cats1) {
    if (!cats2.includes(cat)) { diffs.push({ category: cat, type: 'only_in_first' }); continue; }
    const rules1 = s1.categories[cat]?.rules || [];
    const rules2 = s2.categories[cat]?.rules || [];
    const names1 = rules1.map(r => r.name || r.prefix || r.pattern).filter(Boolean);
    const names2 = rules2.map(r => r.name || r.prefix || r.pattern).filter(Boolean);
    for (const n of names1) { if (!names2.includes(n)) diffs.push({ category: cat, item: n, type: 'only_in_first' }); }
    for (const n of names2) { if (!names1.includes(n)) diffs.push({ category: cat, item: n, type: 'only_in_second' }); }
  }
  for (const cat of cats2) { if (!cats1.includes(cat)) diffs.push({ category: cat, type: 'only_in_second' }); }
  return { ok: true, standard1, standard2, diffCount: diffs.length, diffs };
}

export async function checkLayerNaming(params = {}) {
  const { industry = '通用' } = params;
  await ensureCad();
  const filename = getIndustryStandardsFile(industry);
  const standards = loadStandardsFile(filename);
  if (!standards) return { ok: false, error: `行业规范文件加载失败: ${industry}` };
  try {
    const result = await cad.sendCommandWithResult(LAYER_QUERY);
    const drawingLayers = parseLayerResult(result);
    return { ok: true, industry, layers: drawingLayers, issues: checkLayerItems(standards, drawingLayers, true) };
  } catch (e) { return { ok: false, error: e.message }; }
}

export async function checkColorConformity(params = {}) {
  const { industry = '通用' } = params;
  await ensureCad();
  try {
    const result = await cad.sendCommandWithResult(LAYER_QUERY);
    const drawingLayers = parseLayerResult(result);
    const standards = loadStandardsFile(getIndustryStandardsFile(industry)) || { categories: {} };
    return { ok: true, industry, layers: drawingLayers, issues: checkColorItems(standards, drawingLayers, true) };
  } catch (e) { return { ok: false, error: e.message }; }
}

export async function checkLinetypeConformity(params = {}) {
  const { industry = '通用' } = params;
  await ensureCad();
  try {
    const result = await cad.sendCommandWithResult(LAYER_QUERY);
    const drawingLayers = parseLayerResult(result);
    const standards = loadStandardsFile(getIndustryStandardsFile(industry)) || { categories: {} };
    return { ok: true, industry, layers: drawingLayers, issues: checkLinetypeItems(standards, drawingLayers, true) };
  } catch (e) { return { ok: false, error: e.message }; }
}

export async function checkLineweightConformity(params = {}) {
  const { industry = '通用' } = params;
  await ensureCad();
  try {
    const code = `(progn
  (setq layers nil)
  (setq le (tblnext "layer" t))
  (while le
    (setq ln (cdr (assoc 2 le)) lw (cdr (assoc 370 le)))
    (setq layers (cons (list "name" ln "lineweight" lw) layers))
    (setq le (tblnext "layer" nil)))
  (vl-prin1-to-string (reverse layers)))`;
    const result = await cad.sendCommandWithResult(code);
    const drawingLayers = parseLayerResult(result);
    const standards = loadStandardsFile(getIndustryStandardsFile(industry)) || { categories: {} };
    const lineweightRules = standards.categories?.lineweights?.rules || [];
    const issues = [];
    for (const layer of drawingLayers) {
      if (layer.name === '0') continue;
      if (layer.lineweight === -1 || layer.lineweight === undefined) {
        issues.push({ type: 'default_lineweight', severity: 'info', category: 'lineweights', message: `图层 "${layer.name}" 使用默认线宽`, layer: layer.name });
      } else if (lineweightRules.length > 0) {
        const validWeights = lineweightRules.map(r => r.weight);
        if (!validWeights.includes(layer.lineweight / 100)) {
          issues.push({ type: 'non_standard_lineweight', severity: 'warning', category: 'lineweights', message: `图层 "${layer.name}" 线宽 ${layer.lineweight / 100}mm 不在规范范围内`, layer: layer.name, lineweight: layer.lineweight / 100 });
        }
      }
    }
    return { ok: issues.length === 0, industry, layers: drawingLayers, issues };
  } catch (e) { return { ok: false, error: e.message }; }
}

export async function checkTextStyleConformity(params = {}) {
  const { industry = '通用' } = params;
  await ensureCad();
  try {
    const result = await cad.sendCommandWithResult(STYLE_QUERY);
    const drawingStyles = parseLayerResult(result);
    const standards = loadStandardsFile(getIndustryStandardsFile(industry)) || { categories: {} };
    return { ok: true, industry, styles: drawingStyles, issues: checkTextStyleItems(standards, drawingStyles) };
  } catch (e) { return { ok: false, error: e.message }; }
}

export async function checkDimStyleConformity(params = {}) {
  const { industry = '通用' } = params;
  await ensureCad();
  try {
    const result = await cad.sendCommandWithResult(DIMSTYLE_QUERY);
    const drawingStyles = parseLayerResult(result);
    const standards = loadStandardsFile(getIndustryStandardsFile(industry)) || { categories: {} };
    return { ok: true, industry, styles: drawingStyles, issues: checkDimStyleItems(standards, drawingStyles) };
  } catch (e) { return { ok: false, error: e.message }; }
}

export async function checkFileNaming(_params = {}) {
  await ensureCad();
  const standards = loadStandardsFile('drafting.json') || { categories: {} };
  const issues = await checkFileNamingItems(standards);
  return { ok: issues.length === 0, issues };
}

export async function generateComplianceReport(params = {}) {
  const { industry = '通用', format = 'json', outputFile } = params;
  const checkResult = await checkDrawingStandards({ industry, categories: ['layers', 'colors', 'linetypes', 'lineweights', 'textstyles', 'dimstyles', 'file_naming'], strict: true });
  const timestamp = new Date().toISOString();
  const report = {
    title: `${industry}行业制图规范合规报告`,
    industry,
    timestamp,
    summary: { total: checkResult.issueCount, errors: checkResult.issues.filter(i => i.severity === 'error').length, warnings: checkResult.issues.filter(i => i.severity === 'warning').length, infos: checkResult.issues.filter(i => i.severity === 'info').length },
    issues: checkResult.issues
  };
  if (format === 'json') {
    if (outputFile) { fs.writeFileSync(outputFile, JSON.stringify(report, null, 2), 'utf-8'); return { ok: true, path: outputFile, report }; }
    return { ok: true, report };
  }
  if (format === 'text') {
    const lines = [report.title, `行业: ${industry}`, `时间: ${timestamp}`, `问题总数: ${report.summary.total} (错误:${report.summary.errors} 警告:${report.summary.warnings} 信息:${report.summary.infos})`, '---'];
    for (const issue of checkResult.issues) lines.push(`[${issue.severity}] ${issue.category}: ${issue.message}`);
    const text = lines.join('\n');
    if (outputFile) { fs.writeFileSync(outputFile, text, 'utf-8'); return { ok: true, path: outputFile, text }; }
    return { ok: true, text };
  }
  if (format === 'html') {
    const rows = checkResult.issues.map(i => `<tr class="${i.severity}"><td>${i.severity}</td><td>${i.category}</td><td>${i.message}</td></tr>`).join('\n');
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${report.title}</title><style>body{font-family:sans-serif;margin:20px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:8px;text-align:left}th{background:#f5f5f5}.error{background:#fee}.warning{background:#fef3cd}.info{background:#d1ecf1}h1{font-size:1.4em}h2{font-size:1.1em;color:#555}</style></head><body><h1>${report.title}</h1><p>行业: ${industry} | 时间: ${timestamp}</p><h2>摘要</h2><p>总问题: ${report.summary.total} | 错误: ${report.summary.errors} | 警告: ${report.summary.warnings} | 信息: ${report.summary.infos}</p><h2>详细问题</h2><table><tr><th>级别</th><th>类别</th><th>描述</th></tr>${rows || '<tr><td colspan="3">无问题</td></tr>'}</table></body></html>`;
    if (outputFile) { fs.writeFileSync(outputFile, html, 'utf-8'); return { ok: true, path: outputFile, html }; }
    return { ok: true, html };
  }
  return { ok: false, error: `不支持的格式: ${format}` };
}
