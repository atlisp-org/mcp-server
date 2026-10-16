// =============================================================================
// resource-tool-meta.js — 工具元数据资源实现
//
// 从 resource-handlers.js 按域拆出（非 *-handlers.js 命名，不触发 handler-loader
// 自动发现，避免重复注册）。提供：
//   - getToolCategories    工具分类统计 (atlisp://tools/categories)
//   - getToolIndustries    行业维度工具统计 (atlisp://tools/industries)
//   - getToolRelationships 工具协作关系图 (atlisp://tools/relationships)
// 对外由 resource-handlers.js 的 readResource 调用，不直接注册为 MCP handler。
// =============================================================================
import { tools } from '../tools/index.js';
import { computeEffectivePriority, prioRank } from '../tools/params-utils.js';
import { getAuditStats } from '../audit-log.js';

export function getToolCategories() {
  const cats = {};
  for (const t of tools) {
    const cat = t.annotations?.category || '其他';
    if (!cats[cat]) cats[cat] = { count: 0, tools: [] };
    cats[cat].count++;
    cats[cat].tools.push(t.name);
  }
  return Object.entries(cats).map(([category, info]) => ({
    category, count: info.count, tools: info.tools,
  })).sort((a, b) => b.count - a.count);
}

export function getToolIndustries(name) {
  const usage = (() => { try { return getAuditStats()?.tools || {}; } catch { return {}; } })();
  const byIndustry = {};
  for (const t of tools) {
    const inds = t.annotations?.industry || ['通用'];
    for (const ind of inds) {
      if (!byIndustry[ind]) byIndustry[ind] = { count: 0, tools: [] };
      byIndustry[ind].count++;
      const usageCount = usage[t.name] ?? 0;
      byIndustry[ind].tools.push({
        name: t.name,
        priority: t.annotations?.priority || 'common',
        effectivePriority: computeEffectivePriority(t.annotations?.priority || 'common', usageCount).priority,
        hot: computeEffectivePriority(t.annotations?.priority || 'common', usageCount).hot,
        description: (t.description || '').split('\n')[0].replace(/【类别】.*$/, '').trim(),
        usageCount,
      });
    }
  }
  const entries = Object.entries(byIndustry).map(([industry, info]) => ({ industry, ...info }))
    .sort((a, b) => b.count - a.count);
  if (!name) return entries;
  const hit = entries.find(e => e.industry === name);
  if (!hit) return { error: `未找到行业: ${name}` };
  hit.tools.sort((x, y) => {
    const pr = prioRank(x.effectivePriority) - prioRank(y.effectivePriority);
    if (pr !== 0) return pr;
    return (y.usageCount ?? 0) - (x.usageCount ?? 0);
  });
  return hit;
}

export function getToolRelationships() {
  return {
    selection: {
      tools: ['select_entities', 'select_all', 'select_last', 'select_by_color', 'find_entities_in_window', 'find_entities_near_point'],
      next: ['batch_delete', 'batch_move', 'batch_copy', 'batch_set_layer', 'batch_set_color', 'batch_set_linetype', 'batch_rotate', 'batch_scale', 'batch_mirror', 'batch_explode', 'batch_match_properties'],
    },
    drawing: {
      tools: ['draw_line', 'draw_circle', 'draw_arc', 'draw_rectangle', 'draw_polygon', 'draw_polyline', 'draw_spline', 'draw_text', 'draw_mtext', 'draw_ellipse'],
      next: ['get_entity', 'set_entity', 'batch_match_properties', 'copy_entity', 'move_entity', 'rotate_entity', 'scale_entity'],
    },
    editing: {
      tools: ['trim_entity', 'extend_entity', 'fillet', 'chamfer', 'break_entity', 'join_entities', 'stretch', 'offset_entity', 'mirror_entity'],
      next: ['get_entity', 'set_entity'],
    },
    batch_ops: {
      tools: ['batch_copy', 'batch_move', 'batch_delete', 'batch_set_layer', 'batch_set_color', 'batch_explode', 'batch_rotate', 'batch_scale'],
      previous: ['select_entities', 'select_all'],
      next: ['save_dwg'],
    },
    export: {
      tools: ['export_pdf', 'export_dxf', 'export_dwf', 'export_svg', 'export_stl', 'export_bmp'],
      previous: ['open_dwg', 'new_document', 'save_dwg'],
      next: [],
    },
    layers: {
      tools: ['create_layer', 'set_layer', 'layer_isolate', 'layer_freeze_all', 'layer_thaw_all', 'layer_lock_all', 'layer_unlock_all', 'layer_merge'],
      next: ['set_current_layer', 'batch_set_layer'],
    },
    blocks: {
      tools: ['get_blocks', 'insert_block', 'explode_block', 'get_block_attributes', 'set_block_attribute', 'get_dynamic_block_properties'],
      previous: ['select_entities'],
      next: ['save_dwg'],
    },
    analysis: {
      tools: ['analyze_lisp_code', 'stream_entities', 'stream_text', 'stream_block_refs', 'get_entity_info', 'get_bounding_box', 'measure_distance', 'measure_area'],
      previous: [],
      next: [],
    },
  };
}
