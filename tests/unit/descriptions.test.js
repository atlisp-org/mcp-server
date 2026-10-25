// 工具与资源描述守卫。
//
// 描述是模型唯一的「使用说明书」：漏写参数含义、丢掉与相邻工具的分工、资源描述被
// 实时数据整段覆盖，都会让模型反复试错。这里把最低质量标准固化成测试，避免新增
// 工具/资源时又退回一句话描述。
import { describe, it, expect } from 'vitest';
import { tools } from '../../src/tools/index.js';
import { RESOURCES, RESOURCE_TEMPLATES } from '../../src/handlers/resource-defs.js';
import { getStandardsByKey, listAvailableStandards } from '../../src/handlers/standards-readers.js';

const MIN_TOOL_DESC = 40;
const MIN_PARAM_DESC = 8;
const MIN_RESOURCE_DESC = 40;
const MIN_TEMPLATE_DESC = 20;

describe('工具描述', () => {
  it('每个工具都有 name / description / title / inputSchema', () => {
    for (const t of tools) {
      expect(typeof t.name, `${t.name} name`).toBe('string');
      expect(t.name.length).toBeGreaterThan(0);
      expect(typeof t.description, `${t.name} description`).toBe('string');
      expect(typeof t.title, `${t.name} title`).toBe('string');
      expect(t.title.length).toBeGreaterThan(0);
      expect(t.inputSchema, `${t.name} inputSchema`).toBeTypeOf('object');
      expect(t.inputSchema.type, `${t.name} inputSchema.type`).toBe('object');
    }
  });

  it('工具名唯一', () => {
    const seen = new Set();
    for (const t of tools) {
      expect(seen.has(t.name), `重复工具名: ${t.name}`).toBe(false);
      seen.add(t.name);
    }
  });

  it('描述足够长、带使用提示，并保留注解尾注', () => {
    for (const t of tools) {
      const desc = t.description || '';
      // addAnnotations 会追加【类别】…尾注，模型据此判断读写/破坏性
      expect(desc, `${t.name} 缺少注解尾注`).toContain('【类别】');
      const body = desc.split('\n【类别】')[0].trim();
      expect(body.length, `${t.name} 描述过短`).toBeGreaterThanOrEqual(MIN_TOOL_DESC);
      // 至少说明「什么时候用/前置条件/对比工具」之一
      expect(body, `${t.name} 缺少使用场景提示`)
        .toMatch(/用户|当|用于|适合|前置|调用|场景|对比|注意|默认|返回/);
    }
  });

  it('每个入参都有可读描述（instance 由框架注入，不在此校验）', () => {
    for (const t of tools) {
      const props = t.inputSchema?.properties || {};
      for (const [key, prop] of Object.entries(props)) {
        if (key === 'instance') continue;
        expect(prop, `${t.name}.${key} 缺少 schema`).toBeTypeOf('object');
        expect(prop.description, `${t.name}.${key} 缺少描述`).toBeTruthy();
        expect(prop.description.length, `${t.name}.${key} 描述过短: ${prop.description}`)
          .toBeGreaterThanOrEqual(MIN_PARAM_DESC);
      }
    }
  });

  it('outputSchema 的字段也都有描述', () => {
    for (const t of tools) {
      for (const [key, prop] of Object.entries(t.outputSchema?.properties || {})) {
        expect(prop.description, `${t.name}.output.${key} 缺少描述`).toBeTruthy();
      }
    }
  });

  it('只读与破坏性注解互斥', () => {
    for (const t of tools) {
      const ann = t.annotations || {};
      expect(ann.readOnlyHint && ann.destructiveHint, `${t.name} 同时标了只读与破坏性`).toBeFalsy();
    }
  });
});

describe('资源描述', () => {
  it('URI 唯一、字段齐全、mimeType 合法', () => {
    const seen = new Set();
    for (const r of RESOURCES) {
      expect(r.uri, 'uri').toMatch(/^atlisp:\/\/[^\s]+$/);
      expect(seen.has(r.uri), `重复资源 URI: ${r.uri}`).toBe(false);
      seen.add(r.uri);
      expect(r.name, `${r.uri} name`).toBeTruthy();
      expect(r.mimeType, `${r.uri} mimeType`).toBe('application/json');
      expect(typeof r.subscribable, `${r.uri} subscribable`).toBe('boolean');
    }
  });

  it('描述说明用途、返回内容与限制', () => {
    for (const r of RESOURCES) {
      const desc = r.description || '';
      expect(desc.length, `${r.uri} 描述过短`).toBeGreaterThanOrEqual(MIN_RESOURCE_DESC);
      // 描述应说明返回什么（字段/结构），而不是只有一句用途
      expect(desc, `${r.uri} 未说明返回内容`).toMatch(/\{|返回|读取|列表|清单|规范|状态/);
    }
  });

  it('支持 query 参数的资源在描述里写明参数名', () => {
    const QUERY_PARAMS = {
      'atlisp://dwg/entities': ['type', 'layer', 'bbox'],
      'atlisp://dwg/text-content': ['layer', 'bbox', 'offset', 'limit'],
      'atlisp://dwg/text-combined': ['layer', 'bbox', 'offset', 'limit'],
      'atlisp://dwg/block-refs': ['offset', 'limit'],
      'atlisp://packages': ['name', 'search'],
      'atlisp://dwg/analysis': ['type'],
      'atlisp://dwg/frames': ['layer', 'minSize', 'scales', 'tolRatio', 'includeInner', 'includeUnmatched', 'offset', 'limit'],
      'atlisp://tools/industries': ['name'],
    };
    for (const [uri, params] of Object.entries(QUERY_PARAMS)) {
      const r = RESOURCES.find(x => x.uri === uri);
      expect(r, `缺少资源 ${uri}`).toBeDefined();
      expect(r.description, `${uri} 未提示支持 query`).toContain('?');
      for (const p of params) {
        expect(r.description, `${uri} 描述缺少参数 ?${p}`).toContain(p);
      }
    }
  });

  it('资源模板都有模板占位、且与静态资源不重复', () => {
    const staticUris = new Set(RESOURCES.map(r => r.uri));
    const seen = new Set();
    for (const t of RESOURCE_TEMPLATES) {
      expect(t.name, 'template name').toBeTruthy();
      expect(t.mimeType, `${t.name} mimeType`).toBe('application/json');
      expect(t.description.length, `${t.name} 描述过短`).toBeGreaterThanOrEqual(MIN_TEMPLATE_DESC);
      expect(t.uriTemplate, `${t.name} 应含变量占位`).toContain('{');
      expect(seen.has(t.uriTemplate), `重复模板: ${t.uriTemplate}`).toBe(false);
      seen.add(t.uriTemplate);
      expect(staticUris.has(t.uriTemplate), `模板与静态资源重复: ${t.uriTemplate}`).toBe(false);
    }
  });
});

describe('行业规范资源', () => {
  it('standards 索引返回全部规范文件', () => {
    const all = listAvailableStandards();
    expect(all.length).toBeGreaterThan(0);
    expect(all.map(s => s.key)).toContain('drafting');
    expect(all.map(s => s.key)).toContain('architectural');
  });

  it('getStandardsByKey 支持模板里的 key', () => {
    const drafting = getStandardsByKey('drafting');
    expect(drafting.error).toBeUndefined();
    expect(drafting.categories).toBeTypeOf('object');
  });

  it('未知 key 返回可用列表而不是抛错', () => {
    const res = getStandardsByKey('nope');
    expect(res.error).toContain('nope');
    expect(res.available).toContain('drafting');
  });

  it('拒绝路径穿越', () => {
    const res = getStandardsByKey('../package.json');
    expect(res.error).toBeTruthy();
    expect(res.available.length).toBeGreaterThan(0);
  });
});
