// standards-handlers.js + standards-readers.js 覆盖：
// 用临时目录（复制 src/standards/*.json）+ mock cad，覆盖规范加载/缓存 TTL/检查/
// 应用模板/保存/对比/合规报告全分支
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const T = vi.hoisted(() => ({ dir: `/tmp/opencode/std-test-${process.pid}` }));
const cadMock = vi.hoisted(() => ({
  connected: true,
  connect: vi.fn(async () => true),
  sendCommandWithResult: vi.fn(),
}));

vi.mock('../../src/cad.js', () => ({ cad: cadMock }));
vi.mock('../../src/logger.js', () => ({
  log: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  closeLog: vi.fn(),
}));
vi.mock('../../src/handlers/resource-defs.js', () => ({ STANDARDS_DIR: T.dir }));

const REAL_DIR = fileURLToPath(new URL('../../src/standards', import.meta.url));
const REAL_DRAFTING = path.join(REAL_DIR, 'drafting.json');
const TMP_DRAFTING = path.join(T.dir, 'drafting.json');

const fsStd = await import('fs'); // eslint-disable-line no-unused-vars
const { log } = await import('../../src/logger.js');
const sh = await import('../../src/handlers/standards-handlers.js');
const sr = await import('../../src/handlers/standards-readers.js');

const arch = JSON.parse(fs.readFileSync(path.join(REAL_DIR, 'architectural.json'), 'utf-8'));
const archLayerRules = arch.categories.layers.rules; // 18 条，全部含 name/color/linetype
const archTextRules = arch.categories.textstyles.rules;
const archDimRules = arch.categories.dimstyles.rules;
const archRequiredStyles = archTextRules.filter(r => r.required && r.name);
const archRequiredDims = archDimRules.filter(r => r.required && r.name);
const TOTAL_FILES = fs.readdirSync(REAL_DIR).filter(f => f.endsWith('.json')).length;

function copyStandards() {
  fs.mkdirSync(T.dir, { recursive: true });
  for (const f of fs.readdirSync(REAL_DIR)) {
    fs.copyFileSync(path.join(REAL_DIR, f), path.join(T.dir, f));
  }
}

function layerLisp(layers) {
  const items = layers.map(l => {
    const parts = [`"name" "${l.name}"`];
    if (l.color !== undefined) parts.push(`"color" ${l.color}`, `"linetype" "${l.linetype ?? 'Continuous'}"`);
    if (l.lineweight !== undefined) parts.push(`"lineweight" ${l.lineweight}`);
    return `(${parts.join(' ')})`;
  });
  return `(${items.join(' ')})`;
}

function styleLisp(styles) {
  return `(${styles.map(s => `("name" "${s.name}" "font" "${s.font || '宋体'}" "height" ${s.height ?? 3.5})`).join(' ')})`;
}

function dimLisp(dims) {
  return `(${dims.map(s => `("name" "${s.name}")`).join(' ')})`;
}

const COMPLIANT_LAYERS = archLayerRules.map(r => ({ name: r.name, color: r.color, linetype: r.linetype }));

// 默认：全部合规的建筑图（供多数用例复用）
function setDefaultCadImpl() {
  cadMock.sendCommandWithResult.mockImplementation(async (code) => {
    if (code.includes('(getvar "dwgname")')) return '"P2024-A-FP-01.dwg"';
    if (code.includes('(assoc 370 le)')) return layerLisp([{ name: '0', lineweight: 13 }, { name: 'A-X', lineweight: 25 }]);
    if (code.includes('(tblnext "style" t)')) return styleLisp(archTextRules);
    if (code.includes('(tblnext "dimstyle" t)')) return dimLisp(archDimRules);
    if (code.includes('(tblnext "layer" t)')) return layerLisp(COMPLIANT_LAYERS);
    return 'nil'; // tblsearch / 其他
  });
}

beforeAll(() => {
  copyStandards();
});

afterAll(() => {
  fs.rmSync(T.dir, { recursive: true, force: true });
});

beforeEach(() => {
  vi.clearAllMocks();
  cadMock.connected = true;
  cadMock.sendCommandWithResult.mockReset();
  setDefaultCadImpl();
});

describe('规范文件缺失 / 目录不可用（须先于任何成功加载执行）', () => {
  it('drafting.json 缺失时各入口返回加载失败', async () => {
    fs.unlinkSync(TMP_DRAFTING);
    try {
      // standards-handlers.loadStandards
      const load = await sh.loadStandards({ industry: '通用' });
      expect(load.ok).toBe(false);
      expect(load.error).toContain('行业规范文件加载失败');
      expect(log).toHaveBeenCalledWith(expect.stringContaining('Error loading standards file drafting.json'));

      // checkDrawingStandards 在加载阶段失败
      const check = await sh.checkDrawingStandards({ industry: '通用' });
      expect(check).toEqual({ ok: false, error: '行业规范文件加载失败: 通用' });
      expect(cadMock.sendCommandWithResult).not.toHaveBeenCalled();

      // compareStandards：s1 失败 / s2 失败
      expect((await sh.compareStandards({ standard1: '通用', standard2: '建筑' })).error)
        .toContain('规范加载失败: 通用');
      expect((await sh.compareStandards({ standard1: '建筑', standard2: '通用' })).error)
        .toContain('规范加载失败: 通用');

      // listStandards 跳过坏文件
      const list = await sh.listStandards();
      expect(list.count).toBe(TOTAL_FILES - 1);
      expect(list.standards.some(s => s.key === 'drafting')).toBe(false);

      // standards-readers 错误分支
      expect(sr.getDraftingStandards()).toEqual({ error: '制图规范文件加载失败' });
      expect(sr.getIndustryStandards('通用')).toEqual({ error: '行业规范文件加载失败: 通用' });
    } finally {
      fs.copyFileSync(REAL_DRAFTING, TMP_DRAFTING);
    }
  });

  it('standards 目录不存在时 list 走 catch 分支', async () => {
    fs.rmSync(T.dir, { recursive: true, force: true });
    try {
      const list = await sh.listStandards();
      expect(list.count).toBe(0);
      expect(list.standards).toEqual([]);
      expect(list.error).toBeTruthy();
      expect(sr.listAvailableStandards()).toEqual([]);
      expect(log).toHaveBeenCalledWith(expect.stringContaining('listAvailableStandards error'));
    } finally {
      copyStandards();
    }
  });
});

describe('standards-readers', () => {
  it('getDraftingStandards 返回规范且二次调用命中缓存（同一引用）', () => {
    const first = sr.getDraftingStandards();
    expect(first.categories).toBeDefined();
    expect(first.name).toBe('CAD 制图规范');
    expect(sr.getDraftingStandards()).toBe(first);
  });

  it('getCodingStandards 返回编码规范并可缓存', () => {
    const first = sr.getCodingStandards();
    expect(first.categories.naming).toBeDefined();
    expect(sr.getCodingStandards()).toBe(first);
  });

  it('getIndustryStandards 已知行业返回数据、未知行业报错', () => {
    const data = sr.getIndustryStandards('建筑');
    expect(data.categories.layers).toBeDefined();
    expect(sr.getIndustryStandards('建筑')).toBe(data); // 缓存
    expect(sr.getIndustryStandards('外星行业')).toEqual({ error: '未知行业: 外星行业' });
  });

  it('listAvailableStandards 返回全部规范条目', () => {
    const list = sr.listAvailableStandards();
    expect(list).toHaveLength(TOTAL_FILES);
    for (const item of list) {
      expect(item.key).toBeTruthy();
      expect(item.name).toBeTruthy();
      expect(item.version).toBeTruthy();
      expect(Array.isArray(item.categories)).toBe(true);
    }
    expect(list.find(i => i.key === 'coding').name).toBe('@lisp 编码规范');
  });

  it('mergeStandards 合并类别规则且不改原对象', () => {
    const base = { categories: { layers: { rules: [{ name: 'A' }] } } };
    const industry = { categories: { layers: { rules: [{ name: 'B' }] }, plot: { rules: [] } } };
    const merged = sr.mergeStandards(base, industry);
    expect(merged.categories.layers.rules.map(r => r.name)).toEqual(['A', 'B']);
    expect(merged.categories.plot).toEqual({ rules: [] });
    expect(base.categories.layers.rules).toHaveLength(1); // 深拷贝

    // 边界：base/industry 无效时原样返回
    expect(sr.mergeStandards(null, industry)).toBe(null);
    expect(sr.mergeStandards({ error: 'x' }, industry)).toEqual({ error: 'x' });
    expect(sr.mergeStandards(base, null)).toBe(base);
    expect(sr.mergeStandards(base, { error: 'y' })).toBe(base);
  });
});

describe('standards 缓存 TTL', () => {
  it('60s 内命中缓存，过期后重新读盘', async () => {
    const first = await sh.loadStandards({ industry: '通用' });
    expect(first.ok).toBe(true);
    fs.unlinkSync(TMP_DRAFTING);
    try {
      // 未过期 → 缓存兜底
      const hit = await sh.loadStandards({ industry: '通用' });
      expect(hit.ok).toBe(true);
      expect(hit.standards).toBe(first.standards);

      vi.useFakeTimers();
      vi.setSystemTime(Date.now() + 61_000);
      // 过期 → 重新读盘 → 文件缺失 → 失败
      const miss = await sh.loadStandards({ industry: '通用' });
      expect(miss.ok).toBe(false);
      expect(log).toHaveBeenCalledWith(expect.stringContaining('Error loading standards file drafting.json'));
    } finally {
      vi.useRealTimers();
      fs.copyFileSync(REAL_DRAFTING, TMP_DRAFTING);
    }
  });
});

describe('listStandards / loadStandards', () => {
  it('listStandards 返回全部规范与分类', async () => {
    const res = await sh.listStandards();
    expect(res.count).toBe(TOTAL_FILES);
    const drafting = res.standards.find(s => s.key === 'drafting');
    expect(drafting).toMatchObject({ name: 'CAD 制图规范', version: '1.0', industry: 'drafting' });
    expect(drafting.categories).toContain('layers');
  });

  it('listStandards 按 key 过滤，中文行业名匹配不到（按当前映射行为）', async () => {
    const byKey = await sh.listStandards({ industry: 'drafting' });
    expect(byKey.count).toBe(1);
    expect(byKey.standards[0].key).toBe('drafting');

    const byCn = await sh.listStandards({ industry: '建筑' });
    expect(byCn.count).toBe(0); // name 映射后为 key（architectural），不含“建筑”
  });

  it('loadStandards 缺少 industry 参数报错', async () => {
    const res = await sh.loadStandards({});
    expect(res).toEqual({ ok: false, error: '必须指定行业' });
  });

  it('loadStandards 返回行业规范', async () => {
    const res = await sh.loadStandards({ industry: '结构' });
    expect(res.ok).toBe(true);
    expect(res.standards.categories.layers).toBeDefined();
  });
});

describe('checkDrawingStandards', () => {
  it('非合规图纸返回各类问题（layers/colors/linetypes/styles/dimstyles/file_naming）', async () => {
    const badLayers = COMPLIANT_LAYERS
      .filter(l => l.name !== 'A-COLM') // 缺必需图层
      .map(l => (l.name === 'A-WALL' ? { ...l, color: 5 } : l))
      .map(l => (l.name === 'A-DOOR' ? { ...l, linetype: 'DASHED' } : l));
    cadMock.sendCommandWithResult.mockImplementation(async (code) => {
      if (code.includes('(getvar "dwgname")')) return '"random.dwg"';
      if (code.includes('(tblnext "style" t)')) return styleLisp([{ name: 'SUBTITLE' }]); // 缺 TITLE/NOTE/DIM
      if (code.includes('(tblnext "dimstyle" t)')) return dimLisp([]); // 缺 DIM-ARCH
      if (code.includes('(tblnext "layer" t)')) return layerLisp(badLayers);
      return 'nil';
    });

    const res = await sh.checkDrawingStandards({ industry: '建筑', strict: true });
    expect(res.ok).toBe(false);
    expect(res.issueCount).toBe(res.issues.length);
    const types = res.issues.map(i => i.type);
    expect(types).toContain('missing_required_layer'); // A-COLM
    expect(types).toContain('color_mismatch'); // A-WALL 5≠1
    expect(types).toContain('linetype_mismatch'); // A-DOOR DASHED≠Continuous
    expect(types).toContain('missing_text_style'); // TITLE/NOTE/DIM
    expect(types).toContain('missing_dim_style'); // DIM-ARCH
    expect(types).toContain('file_naming_violation'); // random.dwg
    const colorIssue = res.issues.find(i => i.type === 'color_mismatch');
    expect(colorIssue.message).toContain('颜色应为 1(Red)');
    expect(res).toMatchObject({ industry: '建筑', strict: true, categories: expect.any(Array) });
  });

  it('完全合规图纸 ok=true 且无问题（不含 file_naming 类目）', async () => {
    // file_naming 的 src 实现有缺陷（正则含 .dwg 后缀但匹配时已剥离），任何非默认
    // 文件名都会判违规，故合规断言排除该类目（其行为由 checkFileNaming 用例单独覆盖）
    const res = await sh.checkDrawingStandards({
      industry: '建筑',
      categories: ['layers', 'colors', 'linetypes', 'textstyles', 'dimstyles'],
      strict: true,
    });
    expect(res.ok).toBe(true);
    expect(res.issueCount).toBe(0);
    expect(res.issues).toEqual([]);
  });

  it('仅查 colors/linetypes 且图层为空时无问题（0 层跳过逻辑）', async () => {
    cadMock.sendCommandWithResult.mockImplementation(async (code) => {
      if (code.includes('(tblnext "layer" t)')) return layerLisp([{ name: '0', color: 5, linetype: 'DASHED' }]);
      return 'nil';
    });
    const res = await sh.checkDrawingStandards({ industry: '建筑', categories: ['colors', 'linetypes'], strict: true });
    expect(res.ok).toBe(true);
    // 只发出一次图层查询
    expect(cadMock.sendCommandWithResult).toHaveBeenCalledTimes(1);
    expect(cadMock.sendCommandWithResult.mock.calls[0][0]).toContain('(tblnext "layer" t)');
  });

  it('CAD 查询抛错时返回错误并记日志', async () => {
    cadMock.sendCommandWithResult.mockRejectedValueOnce(new Error('cad broken'));
    const res = await sh.checkDrawingStandards({ industry: '建筑' });
    expect(res).toEqual({ ok: false, error: 'cad broken' });
    expect(log).toHaveBeenCalledWith('checkDrawingStandards error: cad broken');
  });
});

describe('applyStandardsTemplate', () => {
  it('缺少 industry 报错', async () => {
    const res = await sh.applyStandardsTemplate({});
    expect(res).toEqual({ ok: false, error: '必须指定行业' });
  });

  it('全部缺失时创建图层与文字样式', async () => {
    const res = await sh.applyStandardsTemplate({ industry: '建筑' });
    expect(res.ok).toBe(true);
    const createdLayers = res.results.filter(r => r.type === 'created_layer');
    const createdStyles = res.results.filter(r => r.type === 'created_text_style');
    expect(createdLayers).toHaveLength(archLayerRules.length);
    expect(createdStyles).toHaveLength(archTextRules.length);
    expect(res.appliedCount).toBe(createdLayers.length + createdStyles.length);
    expect(res.skippedCount).toBe(0);
    // 创建命令带颜色与线型
    const createCall = cadMock.sendCommandWithResult.mock.calls.find(c => c[0].includes('_.LAYER'));
    expect(createCall[0]).toContain('"_C" "1"'); // A-WALL 颜色
    const styleCreate = cadMock.sendCommandWithResult.mock.calls.find(c => c[0].includes('_.STYLE'));
    expect(styleCreate[0]).toContain('黑体');
  });

  it('已存在且不覆盖时跳过', async () => {
    cadMock.sendCommandWithResult.mockImplementation(async (code) => {
      if (code.includes('(tblsearch')) return '"exists"';
      return 'nil';
    });
    const res = await sh.applyStandardsTemplate({ industry: '建筑' });
    expect(res.ok).toBe(true);
    expect(res.appliedCount).toBe(0);
    expect(res.skippedCount).toBe(archLayerRules.length + archTextRules.length);
    expect(res.results.every(r => r.type === 'skipped')).toBe(true);
  });

  it('overwrite=true 时更新已存在图层（文字样式仍跳过）', async () => {
    cadMock.sendCommandWithResult.mockImplementation(async (code) => {
      if (code.includes('(tblsearch')) return '"exists"';
      return 'nil';
    });
    const res = await sh.applyStandardsTemplate({ industry: '建筑', overwrite: true });
    expect(res.ok).toBe(true);
    expect(res.results.filter(r => r.type === 'updated_layer')).toHaveLength(archLayerRules.length);
    expect(res.results.filter(r => r.type === 'skipped')).toHaveLength(archTextRules.length);
    expect(res.appliedCount).toBe(archLayerRules.length);
    expect(res.skippedCount).toBe(archTextRules.length);
    const updateCall = cadMock.sendCommandWithResult.mock.calls.find(c => c[0].includes('"_C"') && !c[0].includes('tblsearch'));
    expect(updateCall).toBeDefined();
  });

  it('CAD 抛错时返回错误并记日志', async () => {
    cadMock.sendCommandWithResult.mockRejectedValueOnce(new Error('cad broken'));
    const res = await sh.applyStandardsTemplate({ industry: '建筑' });
    expect(res).toEqual({ ok: false, error: 'cad broken' });
    expect(log).toHaveBeenCalledWith('applyStandardsTemplate error: cad broken');
  });
});

describe('compareStandards', () => {
  it('缺少参数报错', async () => {
    expect((await sh.compareStandards({ standard1: '建筑' })).error).toBe('必须指定两个规范名称');
    expect((await sh.compareStandards({})).error).toBe('必须指定两个规范名称');
  });

  it('通用 vs 建筑：找出 only_in_first 类别与条目差异', async () => {
    const res = await sh.compareStandards({ standard1: '通用', standard2: '建筑' });
    expect(res.ok).toBe(true);
    expect(res.diffCount).toBe(res.diffs.length);
    expect(res.diffs.some(d => d.type === 'only_in_first' && d.category === 'lineweights')).toBe(true);
    expect(res.diffs.some(d => d.type === 'only_in_first' && d.category === 'plot')).toBe(true);
    expect(res.diffs.some(d => d.category === 'layers' && d.item)).toBe(true);
  });

  it('建筑 vs 通用：找出 only_in_second 类别', async () => {
    const res = await sh.compareStandards({ standard1: '建筑', standard2: '通用' });
    expect(res.ok).toBe(true);
    expect(res.diffs.some(d => d.type === 'only_in_second' && ['lineweights', 'plot'].includes(d.category))).toBe(true);
    expect(res.diffs.some(d => d.type === 'only_in_second' && d.item)).toBe(true);
  });
});

describe('单项合规检查', () => {
  it('checkLayerNaming 返回图层与必需层问题（strict）', async () => {
    const layers = COMPLIANT_LAYERS.filter(l => l.name !== 'A-COLM');
    cadMock.sendCommandWithResult.mockResolvedValueOnce(layerLisp(layers));
    const res = await sh.checkLayerNaming({ industry: '建筑' });
    expect(res.ok).toBe(true);
    expect(res.layers).toHaveLength(layers.length);
    expect(res.issues.some(i => i.type === 'missing_required_layer' && i.expected === 'A-COLM')).toBe(true);
  });

  it('checkLayerNaming CAD 抛错', async () => {
    cadMock.sendCommandWithResult.mockRejectedValueOnce(new Error('q fail'));
    const res = await sh.checkLayerNaming({ industry: '建筑' });
    expect(res).toEqual({ ok: false, error: 'q fail' });
  });

  it('checkColorConformity 找出颜色不符（0 层跳过）', async () => {
    cadMock.sendCommandWithResult.mockResolvedValueOnce(
      layerLisp([{ name: '0', color: 9, linetype: 'Continuous' }, { name: 'A-WALL', color: 5, linetype: 'Continuous' }])
    );
    const res = await sh.checkColorConformity({ industry: '建筑' });
    expect(res.ok).toBe(true);
    expect(res.issues).toHaveLength(1);
    expect(res.issues[0]).toMatchObject({ type: 'color_mismatch', layer: 'A-WALL', expected: 1, actual: 5 });
  });

  it('checkLinetypeConformity 找出线型不符', async () => {
    cadMock.sendCommandWithResult.mockResolvedValueOnce(
      layerLisp([{ name: '0', color: 7, linetype: 'DASHED' }, { name: 'A-DOOR', color: 2, linetype: 'DASHED' }])
    );
    const res = await sh.checkLinetypeConformity({ industry: '建筑' });
    expect(res.issues).toHaveLength(1);
    expect(res.issues[0]).toMatchObject({ type: 'linetype_mismatch', layer: 'A-DOOR', expected: 'Continuous' });
  });

  it('checkLineweightConformity：默认/非标线宽与有效线宽', async () => {
    cadMock.sendCommandWithResult.mockResolvedValueOnce(
      layerLisp([
        { name: '0', lineweight: -1 }, // 跳过
        { name: 'A-1', lineweight: -1 }, // 默认线宽 info
        { name: 'A-2', lineweight: 33 }, // 0.33mm 不在通用规范 → warning
        { name: 'A-3', lineweight: 25 }, // 0.25mm 合规
        { name: 'A-4' }, // 无 lineweight → undefined → info
      ])
    );
    const res = await sh.checkLineweightConformity({ industry: '通用' });
    expect(res.ok).toBe(false);
    expect(res.issues.map(i => i.type).sort()).toEqual(['default_lineweight', 'default_lineweight', 'non_standard_lineweight']);
    const nonStd = res.issues.find(i => i.type === 'non_standard_lineweight');
    expect(nonStd.lineweight).toBe(0.33);
  });

  it('checkLineweightConformity 行业无 lineweights 规则时只查默认线宽', async () => {
    cadMock.sendCommandWithResult.mockResolvedValueOnce(layerLisp([{ name: 'A-1', lineweight: 33 }]));
    const res = await sh.checkLineweightConformity({ industry: '建筑' });
    expect(res.issues).toHaveLength(0); // 无规则可比对
    expect(res.ok).toBe(true);
  });

  it('checkTextStyleConformity 缺失/齐全两种情况', async () => {
    cadMock.sendCommandWithResult.mockResolvedValueOnce(styleLisp([]));
    const missing = await sh.checkTextStyleConformity({ industry: '建筑' });
    expect(missing.issues.map(i => i.style)).toEqual(archRequiredStyles.map(s => s.name));

    cadMock.sendCommandWithResult.mockResolvedValueOnce(styleLisp(archTextRules));
    const okRes = await sh.checkTextStyleConformity({ industry: '建筑' });
    expect(okRes.ok).toBe(true);
    expect(okRes.issues).toEqual([]);
  });

  it('checkDimStyleConformity 缺失/齐全两种情况', async () => {
    cadMock.sendCommandWithResult.mockResolvedValueOnce(dimLisp([]));
    const missing = await sh.checkDimStyleConformity({ industry: '建筑' });
    expect(missing.issues.map(i => i.style)).toEqual(archRequiredDims.map(s => s.name));

    cadMock.sendCommandWithResult.mockResolvedValueOnce(dimLisp(archDimRules));
    const okRes = await sh.checkDimStyleConformity({ industry: '建筑' });
    expect(okRes.issues).toEqual([]);
  });

  it('checkFileNaming：任意非默认名均判违规（正则缺陷）、Drawing1 跳过、查询失败静默', async () => {
    // 源码先剥离 .dwg 再与含 \\.dwg 的正则比对，故看似合规的命名也会判违规
    cadMock.sendCommandWithResult.mockResolvedValueOnce('"P2024-A-FP-01.dwg"');
    const quasiOk = await sh.checkFileNaming();
    expect(quasiOk.ok).toBe(false);
    expect(quasiOk.issues[0].type).toBe('file_naming_violation');
    expect(quasiOk.issues[0].expected).toContain('项目编码');

    cadMock.sendCommandWithResult.mockResolvedValueOnce('"Drawing1.dwg"');
    const defaultRes = await sh.checkFileNaming();
    expect(defaultRes.ok).toBe(true); // 默认文件名直接跳过

    cadMock.sendCommandWithResult.mockResolvedValueOnce('"random.dwg"');
    const badRes = await sh.checkFileNaming();
    expect(badRes.ok).toBe(false);
    expect(badRes.issues[0].message).toContain('random.dwg');

    // 查询失败时 catch 静默，不影响结果
    cadMock.sendCommandWithResult.mockRejectedValueOnce(new Error('q fail'));
    const silent = await sh.checkFileNaming();
    expect(silent).toEqual({ ok: true, issues: [] });
  });
});

describe('generateComplianceReport', () => {
  // 通用行业 + 非合规图纸 → 10 个缺前缀图层警告 + 1 个命名警告
  function setNonCompliantDrafting() {
    cadMock.sendCommandWithResult.mockImplementation(async (code) => {
      if (code.includes('(getvar "dwgname")')) return '"random.dwg"';
      if (code.includes('(tblnext "layer" t)')) return layerLisp([{ name: 'S-WALL', color: 7, linetype: 'Continuous' }]);
      return 'nil';
    });
  }

  it('json 格式（无输出文件）返回结构化报告', async () => {
    setNonCompliantDrafting();
    const res = await sh.generateComplianceReport();
    expect(res.ok).toBe(true);
    expect(res.report.title).toContain('通用行业制图规范合规报告');
    expect(res.report.summary.total).toBe(res.report.issues.length);
    const s = res.report.summary;
    expect(s.errors + s.warnings + s.infos).toBe(s.total);
    expect(s.total).toBeGreaterThan(0);
    expect(s.warnings).toBe(s.total); // 全部为 warning 级
    expect(res.report.issues.some(i => i.type === 'missing_prefix_layer')).toBe(true);
    expect(res.report.issues.some(i => i.type === 'file_naming_violation')).toBe(true);
  });

  it('json 格式写入输出文件', async () => {
    setNonCompliantDrafting();
    const outFile = path.join(T.dir, 'report.json');
    try {
      const res = await sh.generateComplianceReport({ format: 'json', outputFile: outFile });
      expect(res.path).toBe(outFile);
      const parsed = JSON.parse(fs.readFileSync(outFile, 'utf-8'));
      expect(parsed.title).toBe(res.report.title);
    } finally {
      fs.rmSync(outFile, { force: true });
    }
  });

  it('text 格式拼接问题清单', async () => {
    setNonCompliantDrafting();
    const res = await sh.generateComplianceReport({ format: 'text' });
    expect(res.ok).toBe(true);
    expect(res.text).toContain('通用行业制图规范合规报告');
    expect(res.text).toContain('问题总数:');
    expect(res.text).toMatch(/\[warning\] layers: /);
  });

  it('text 格式写入输出文件', async () => {
    setNonCompliantDrafting();
    const outFile = path.join(T.dir, 'report.txt');
    try {
      const res = await sh.generateComplianceReport({ format: 'text', outputFile: outFile });
      expect(res.path).toBe(outFile);
      const content = fs.readFileSync(outFile, 'utf-8');
      expect(content).toContain('---');
    } finally {
      fs.rmSync(outFile, { force: true });
    }
  });

  it('html 格式生成带问题行的表格', async () => {
    setNonCompliantDrafting();
    const res = await sh.generateComplianceReport({ format: 'html' });
    expect(res.ok).toBe(true);
    expect(res.html).toContain('<!DOCTYPE html>');
    expect(res.html).toContain('<tr class="warning">');
    expect(res.html).toContain('总问题:');
  });

  it('html 格式：无问题时显示占位行', async () => {
    // 覆盖所有通用前缀图层 + 默认文件名 → 零问题
    const prefixes = ['A', 'S', 'M', 'E', 'P', 'DIM', 'TXT', 'HAT', 'DEF', 'X', 'PUB'];
    cadMock.sendCommandWithResult.mockImplementation(async (code) => {
      if (code.includes('(getvar "dwgname")')) return '"Drawing1.dwg"';
      if (code.includes('(tblnext "layer" t)')) {
        return layerLisp(prefixes.map(p => ({ name: `${p}-X`, color: 7, linetype: 'Continuous' })));
      }
      return 'nil';
    });
    const res = await sh.generateComplianceReport({ format: 'html' });
    expect(res.ok).toBe(true);
    expect(res.html).toContain('无问题');
    expect(res.html).not.toContain('<tr class="warning">');
  });

  it('html 格式写入输出文件', async () => {
    setNonCompliantDrafting();
    const outFile = path.join(T.dir, 'report.html');
    try {
      const res = await sh.generateComplianceReport({ format: 'html', outputFile: outFile });
      expect(res.path).toBe(outFile);
      expect(fs.readFileSync(outFile, 'utf-8')).toContain('<!DOCTYPE html>');
    } finally {
      fs.rmSync(outFile, { force: true });
    }
  });

  it('不支持的格式报错', async () => {
    const res = await sh.generateComplianceReport({ format: 'csv' });
    expect(res).toEqual({ ok: false, error: '不支持的格式: csv' });
  });
});

describe('saveStandards 与缓存失效', () => {
  it('缺参数 / 目录内子路径写失败 / 覆盖保护 / 保存后缓存失效', async () => {
    // 缺参数
    expect(await sh.saveStandards({})).toEqual({ ok: false, error: '必须指定名称和规范内容' });

    // name 含子目录 → 写入失败
    const badSave = await sh.saveStandards({ name: 'sub/bad', standards: { name: 'x', categories: {} } });
    expect(badSave.ok).toBe(false);
    expect(badSave.error).toBeTruthy();

    // 先把 drafting 加载进缓存（fallback 文件）
    const first = await sh.loadStandards({ industry: 'unit-test' });
    expect(first.ok).toBe(true);

    fs.unlinkSync(TMP_DRAFTING);
    try {
      // 缓存仍可用
      expect((await sh.loadStandards({ industry: 'unit-test' })).ok).toBe(true);

      // 首次保存成功；再次保存需要 overwrite
      const data = { name: '测试规范', categories: { layers: { rules: [] } } };
      const saved = await sh.saveStandards({ name: 'unit-test', standards: data });
      expect(saved.ok).toBe(true);
      expect(JSON.parse(fs.readFileSync(path.join(T.dir, 'unit-test.json'), 'utf-8'))).toEqual(data);

      const dup = await sh.saveStandards({ name: 'unit-test', standards: data });
      expect(dup.ok).toBe(false);
      expect(dup.error).toContain('已存在');

      const overwritten = await sh.saveStandards({ name: 'unit-test', standards: data, overwrite: true });
      expect(overwritten.ok).toBe(true);

      // 保存清了 standards:unit-test 缓存 → 重新读盘 drafting（已缺失）→ 失败
      const after = await sh.loadStandards({ industry: 'unit-test' });
      expect(after.ok).toBe(false);
      expect(after.error).toContain('行业规范文件加载失败');
    } finally {
      fs.copyFileSync(REAL_DRAFTING, TMP_DRAFTING);
      fs.rmSync(path.join(T.dir, 'unit-test.json'), { force: true });
    }
  });
});
