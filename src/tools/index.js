import { tools as cad_tools } from './cad-tools.js';
import { tools as package_tools } from './package-tools.js';
import { tools as info_tools } from './info-tools.js';
import { tools as entity_tools } from './entity-tools.js';
import { tools as layer_tools } from './layer-tools.js';
import { tools as block_tools } from './block-tools.js';
import { tools as drawing_tools } from './drawing-tools.js';
import { tools as dim_hatch_tools } from './dim-hatch-tools.js';
import { tools as ucs_layout_tools } from './ucs-layout-tools.js';
import { tools as query_print_tools } from './query-print-tools.js';
import { tools as batch_tools } from './batch-tools.js';

import { tools as xdata_tools } from './xdata-tools.js';
import { tools as sheetset_tools } from './sheetset-tools.js';
import { tools as sheetset_adv_tools } from './sheetset-adv-tools.js';
import { tools as three_d_tools } from './3d-tools.js';
import { tools as style_tools } from './style-tools.js';
import { tools as pdf_tools } from './pdf-tools.js';
import { tools as xref_tools } from './xref-tools.js';
import { tools as xref_adv_tools } from './xref-adv-tools.js';
import { tools as constraint_tools } from './constraint-tools.js';
import { tools as parametric_tools } from './parametric-tools.js';
import { tools as plot_adv_tools } from './plot-adv-tools.js';

import { tools as trigger_tools } from './trigger-tools.js';
import { tools as repl_tools } from './repl-tools.js';
import { tools as stream_tools } from './stream-tools.js';
import { tools as webhook_tools } from './webhook-tools.js';
import { tools as external_tools } from './external-tools.js';
import { tools as sandbox_tools } from './sandbox-tools.js';
import { tools as audit_tools } from './audit-tools.js';
import { tools as pool_tools } from './pool-tools.js';
import { tools as draw_tools } from './draw-primitive-tools.js';
import { tools as edit_tools } from './edit-tools.js';
import { tools as viewport_tools } from './viewport-tools.js';
import { tools as purge_tools } from './purge-tools.js';
import { tools as spatial_tools } from './spatial-tools.js';
import { tools as text_tools } from './text-tools.js';
import { tools as skill_tools } from './skill-tools.js';
import { tools as plugin_tools } from './plugin-tools.js';
import { tools as context_tools } from './context-tools.js';
import { tools as batch_transaction_tools } from './batch-transaction-tools.js';
import { tools as lint_tools } from './lint-tools.js';
import { tools as debug_tools } from './debug-tools.js';
import { tools as concurrent_tools } from './concurrent-tools.js';
import { tools as peer_tools } from './peer-tools.js';
import { tools as standards_tools } from './standards-tools.js';
import { tools as frame_tools } from './frame-tools.js';
import { TOOL_INDUSTRIES, CORE_TOOLS, RARE_TOOLS, RARE_CATEGORIES } from './grouping.js';

const READ_ONLY_TOOLS = new Set([
  'get_cad_info', 'get_platform_info', 'get_system_status',
  'list_packages', 'search_packages', 'get_function_usage', 'list_symbols',
  'get_entity', 'select_entities', 'get_blocks', 'get_block_attributes',
  'get_dimension', 'get_xdata', 'get_all_entity_xdata', 'list_xdata_apps',
  'list_prompts', 'get_prompt', 'import_funlib',
  'list_named_views', 'list_ucs', 'get_current_ucs', 'list_layouts', 'get_current_layout',
  'list_groups', 'get_group_entities', 'measure_distance', 'measure_area',
  'get_entity_info', 'get_bounding_box',
  'list_text_styles', 'list_dimension_styles', 'list_linetypes',
  'list_mleader_styles',
  'list_attached_pdfs', 'get_pdf_info',
  'list_xrefs', 'xref_notifications',
  'list_constraints',
  'get_dynamic_block_properties', 'get_block_parameters',
  'list_visibility_states',
  'list_sheet_sets', 'list_sheets', 'list_subsets', 'get_sheet_set_property',
  'sheet_list_views', 'sheet_set_compare',
  'list_page_setups',
  'list_data_sources',
  'external_db_query',
  'list_tools_by_category', 'search_tools', 'get_tool_info',
  'list_tools_by_industry', 'list_tools_by_priority',
  'get_system_variable',
  'audit_log_query', 'audit_log_stats',
  'cad_pool_list', 'cad_pool_stats', 'cad_pool_health',
  'get_3d_solid_info',
  'watch_list', 'webhook_list', 'webhook_log',
  'lisp_repl_list', 'lisp_repl_history',
  'agent_list_context', 'agent_get_context',
  'find_entities_near_point', 'find_entities_in_window',
  'find_entities_crossing', 'find_entities_intersecting',
  'find_entities_in_polygon',
  'find_text',
  'stream_entities', 'stream_text', 'stream_block_refs',
  'skill_search', 'skill_list_installed', 'skill_list_categories',
  'plugin_list',
  'analyze_lisp_code',
  'format_lisp_code',
  'list_lint_rules',
  'lint_project',
  'debug_get_state',
  'check_drawing_standards', 'list_standards', 'load_standards', 'compare_standards',
  'check_layer_naming', 'check_color_conformity', 'check_linetype_conformity',
  'check_lineweight_conformity', 'check_text_style_conformity', 'check_dim_style_conformity',
  'check_file_naming', 'generate_compliance_report',
  // 图框识别：只读查询（扫多段线 + 算尺寸，不改图）
  'list_frames',
]);

const DEPRECATED_TOOLS = new Set([
  'plot_to_pdf',
  'save_pdf_layout',
]);

const EXTRA_DESTRUCTIVE = new Set([
  'overkill', 'batch_explode', 'explode_block', 'explode_text',
  'boolean_union', 'boolean_subtract', 'boolean_intersect', 'slice_solid',
  'batch_mirror', 'batch_rename', 'batch_offset', 'batch_rotate', 'batch_scale',
  'batch_set_color', 'batch_set_linetype', 'stretch',
]);

const DESTRUCTIVE_TOOLS = new Set([
  ...EXTRA_DESTRUCTIVE,
  'delete_entity', 'delete_group', 'delete_layer', 'delete_layout', 'delete_ucs',
  'delete_sheet', 'delete_xdata', 'detach_pdf', 'detach_xref', 'remove_hyperlink',
  'purge_all', 'purge_blocks', 'purge_layers', 'purge_styles', 'purge_registered_apps',
  'layer_merge', 'batch_delete', 'batch_rename', 'explode_block', 'explode_text',
  'apply_standards_template',
]);

const IDEMPOTENT_WRITE_TOOLS = new Set([
  'set_system_variable', 'set_current_layer', 'save_dwg',
  'init_atlisp', 'install_atlisp', 'open_cad', 'connect_cad', 'bring_to_front',
  'cad_pool_connect', 'cad_pool_disconnect', 'cad_pool_switch',
  'agent_set_context', 'agent_delete_context', 'agent_clear_context',
  'set_page_setup', 'create_page_setup',
]);

const OPEN_WORLD_TOOLS = new Set([
  'install_atlisp', 'init_atlisp', 'install_package', 'import_funlib',
  'skill_install', 'skill_search', 'skill_list_categories',
  'webhook_register', 'webhook_remove',
  'external_db_query', 'import_external_data', 'export_to_external',
  'import_dxf', 'import_dgn', 'import_page_setup',
  'load_linetype',
]);

function getToolCategory(name) {
  const n = name;
  if (/^(draw_|create_3d_|create_box|create_cone|create_cylinder|create_sphere|create_torus|create_wedge|extrude_|revolve_|boolean_|slice_solid|thicken_|offset_surface|create_loft_|create_region|create_cloud_line|convert_to_cloud_line|get_3d_solid_info|create_mesh)/.test(n)) return '绘图与3D';
  if (/^(move_entity|copy_entity|rotate_entity|scale_entity|mirror_entity|offset_entity|array_)/.test(n)) return '修改';
  if (/^batch_(?!get_block_attr|set_block_attr|plot_wizard|attach_pdfs)/.test(n)) return '修改';
  if (/^(trim_|extend_|fillet|chamfer|break_|join_|stretch)/.test(n)) return '编辑';
  if (/^(create_layer|delete_layer|set_layer|set_current_layer|layer_)/.test(n)) return '图层';
  if (/^(create_block|insert_block|explode_block|get_block(?!_param)|set_block(?!_param)|batch_get_block_attr|batch_set_block_attr)/.test(n)) return '块';
  if (/^(get_block_parameters|set_block_parameter)/.test(n)) return '块';
  if (/^(create_dim(?!ension_style)|get_dim|list_dim(?!ension_styles)|set_dim(?!style)|create_hatch|set_hatch)/.test(n)) return '标注与填充';
  if (/^(create_ucs|set_ucs|delete_ucs|list_ucs|get_current_ucs|create_layout|delete_layout|rename_layout|set_layout|list_layouts|get_current_layout)/.test(n)) return '坐标系与布局';
  if (/^(create_viewport|set_viewport|lock_viewport|unlock_viewport|maximize_viewport|minimize_viewport|create_polygonal_viewport|zoom_|create_named_view|restore_named_view|list_named_views)/.test(n)) return '视口';
  if (/^find_text/.test(n)) return '文字';
  if (/^find_/.test(n)) return '空间查询';
  if (/^(select_|get_entity|set_entity|delete_entity|get_bounding_box|create_group|delete_group|list_groups|get_group_entities|measure_|send_to_back_entity|bring_above_entity|send_below_entity)/.test(n)) return '选择与属性';
  if (/^(get_dynamic_block_prop|set_dynamic_block_prop|list_visibility|set_visibility)/.test(n)) return '块';
  if (/^(open_dwg|save_dwg|export_(?!to_external)|import_(?!external_data)|close_dwg|publish_(?!sheet_set|layout))/u.test(n)) return '文件';
  if (/^(export_to_external|import_external_data)/.test(n)) return '高级';
  if (/^publish_sheet_set/.test(n)) return '图纸集';
  if (/^publish_layouts/.test(n)) return '打印';
  if (/^(plot_|save_pdf_layout|batch_plot_wizard)/.test(n)) return '打印';
  if (/^(create_page_setup|list_page_setups|set_page_setup|import_page_setup)/.test(n)) return '打印';
  if (/^(get_xdata|set_xdata|delete_xdata|list_xdata_apps|copy_xdata|search_by_xdata|export_xdata_to_file|import_xdata_from_file|get_all_entity_xdata)/.test(n)) return '扩展数据';
  if (/^(create_sheet|open_sheet|list_sheet|add_sheet|delete_sheet|reorder_sheet|create_subset|list_subset|set_sheet)/.test(n)) return '图纸集';
  if (/^(get_sheet_set_prop|sheet_set_publish|sheet_set_transmit|sheet_set_compare|sheet_list_views|sheet_import_layouts)/.test(n)) return '图纸集';
  if (/^(attach_|detach_|reload_|list_attached|get_pdf_info|create_dgn|create_dwf|import_dxf|import_dgn|export_dgn|create_hyper|remove_hyper|batch_attach_pdfs)/.test(n)) return '参照与底图';
  if (/^(attach_xref|detach_xref|reload_xref|unload_xref|list_xrefs|bind_xref|clip_xref|path_xref|xref_)/.test(n)) return '参照与底图';
  if (/^(create_text_style|create_mleader_style|create_linetype|load_linetype|list_text_styles|list_linetypes|list_mleader_styles|create_dimension_style|set_dimstyle_var|list_dimension_styles|set_mleader_style_prop)/.test(n)) return '样式';
  if (/^(purge_|drawing_audit|drawing_recover|overkill)/.test(n)) return '清理';
  if (/^(replace_text|set_text_|justify_|convert_text|explode_text)/.test(n)) return '文字';
  if (/^(eval_lisp|open_cad|connect_cad|get_cad|get_platform|get_system|at_command|new_document|bring_to_front|send_esc|install_atlisp|init_atlisp|get_system_status|get_system_variable|set_system_variable)/.test(n)) return '系统';
  if (/^(list_packages|search_packages|install_package|get_function_usage|list_symbols|import_funlib)/.test(n)) return '包与函数';
  if (/^(watch_|lisp_repl|webhook_|sandbox_|audit_|cad_pool_|session_|external_db_query|list_data_sources|stream_|analyze_lisp_code|format_lisp_code|list_lint_rules|lint_project)/.test(n)) return '高级';
  if (/^debug_/.test(n)) return '高级';
  if (/^skill_/.test(n)) return '高级';
  if (/^plugin_/.test(n)) return '高级';
  if (/^(check_|apply_|list_|load_|save_|compare_|generate_compliance)/.test(n) && /standards|layer_naming|color_conformity|linetype_conformity|lineweight_conformity|text_style_conformity|dim_style_conformity|file_naming/.test(n)) return '规范标准';
  if (/^(add_geom_constraint|add_dim_constraint|del_constraint|list_constraints)/.test(n)) return '约束';
  // 图框识别属于「图纸结构查询」，归入选择与属性档（该档在 minimal profile 下可见）
  if (n === 'list_frames') return '选择与属性';
  if (/^(list_prompts|get_prompt|search_tools|list_tools_by_category|list_tools_by_industry|list_tools_by_priority|get_tool_info)/.test(n)) return '元工具';
  if (/^(agent_)/.test(n)) return 'Agent上下文';
  return '其他';
}

function buildUsageFooter(tool, flags) {
  const access = flags.destructive ? '破坏性·不可逆' : (flags.readOnly ? '只读·安全' : '写入');
  const scope = flags.openWorld ? '｜【外部】访问文件/网络' : '';
  return `\n【类别】${flags.category}｜【操作】${access}｜【幂等】${flags.idempotent ? '是' : '否'}${scope}`;
}

/**
 * 由工具描述生成人类友好的 title（MCP 2025-06-18 起工具可带 title 字段）。
 * 取描述首段（第一个句号前），过长截断，解析失败回退为工具名。
 * @param {{name: string, description?: string}} tool
 * @returns {string}
 */
function deriveTitle(tool) {
  const desc = String(tool.description || '').split(/\r?\n/)[0].trim();
  if (!desc) return tool.name;
  let title = desc.split('。')[0].trim();
  if (title === desc) {
    const dotIdx = desc.indexOf('. ');
    if (dotIdx > 0) title = desc.slice(0, dotIdx).trim();
  }
  title = title.replace(/[,，;；:：、]+$/u, '').trim();
  if (!title) return tool.name;
  if (title.length > 64) title = `${title.slice(0, 63).trimEnd()}…`;
  return title;
}

function addAnnotations(tool) {
  const isDeprecated = DEPRECATED_TOOLS.has(tool.name);
  const isPoolTool = tool.name.startsWith('cad_pool_') || tool.name === 'session_pin_instance' || tool.name === 'session_unpin_instance';
  const schema = { ...(tool.inputSchema || {}) };
  if (!isPoolTool && schema.properties) {
    schema.properties = {
      ...schema.properties,
      instance: { type: 'string', description: '目标 CAD 实例 key（可选，默认活动实例）。如 "autocad", "zwcad"', optional: true },
    };
  }
  const flags = {
    readOnly: READ_ONLY_TOOLS.has(tool.name),
    destructive: DESTRUCTIVE_TOOLS.has(tool.name),
    idempotent: READ_ONLY_TOOLS.has(tool.name) || IDEMPOTENT_WRITE_TOOLS.has(tool.name),
    openWorld: OPEN_WORLD_TOOLS.has(tool.name),
    category: getToolCategory(tool.name),
    industry: TOOL_INDUSTRIES[tool.name] || ['通用'],
    priority: getToolPriority(tool.name),
  };
  return {
    ...tool,
    description: `${tool.description || ''}${buildUsageFooter(tool, flags)}`,
    inputSchema: schema,
    title: tool.title || deriveTitle(tool),
    ...(isDeprecated ? { deprecated: true, title: `${tool.name} (deprecated)` } : {}),
    annotations: {
      readOnlyHint: flags.readOnly,
      destructiveHint: flags.destructive,
      idempotentHint: flags.idempotent,
      openWorldHint: flags.openWorld,
      category: flags.category,
      industry: flags.industry,
      priority: flags.priority,
      ...(isDeprecated ? { deprecatedReason: 'This tool has been superseded. Check documentation for alternatives.' } : {}),
    },
  };
}

function getToolPriority(name) {
  if (CORE_TOOLS.has(name)) return 'core';
  if (RARE_TOOLS.has(name) || RARE_CATEGORIES.has(getToolCategory(name))) return 'rare';
  return 'common';
}

export { READ_ONLY_TOOLS, DESTRUCTIVE_TOOLS };
export const tools = [
  ...cad_tools,
  ...package_tools,
  ...info_tools,
  ...entity_tools,
  ...layer_tools,
  ...block_tools,
  ...drawing_tools,
  ...dim_hatch_tools,
  ...ucs_layout_tools,
  ...query_print_tools,
  ...batch_tools,

  ...xdata_tools,
  ...sheetset_tools,
  ...sheetset_adv_tools,
  ...three_d_tools,
  ...style_tools,
  ...pdf_tools,
  ...xref_tools,
  ...xref_adv_tools,
  ...constraint_tools,
  ...parametric_tools,
  ...plot_adv_tools,

  ...trigger_tools,
  ...repl_tools,
  ...stream_tools,
  ...webhook_tools,
  ...external_tools,
  ...sandbox_tools,
  ...audit_tools,
  ...pool_tools,
  ...draw_tools, ...edit_tools, ...viewport_tools, ...purge_tools, ...spatial_tools, ...text_tools, ...context_tools,
  ...batch_transaction_tools,
  ...skill_tools,
  ...plugin_tools,
  ...lint_tools,
  ...debug_tools,
  ...concurrent_tools,
  ...peer_tools,
  ...standards_tools,
  ...frame_tools,
].map(addAnnotations);

export const toolsByName = new Map(tools.map(t => [t.name, t]));

import config from '../config.js';

// ===================== Token 成本治理：工具暴露档位 =====================
// 361 个工具 schema 全量下发约 178KB（≈84k tokens），对多数任务是纯 token 浪费。
// 档位按 addAnnotations() 写入的 annotations.category 划分（映射见 getToolCategory）：
//
// | 档位       | 工具数(约) | 包含 category                                                                  |
// |------------|-----------|---------------------------------------------------------------------------------|
// | minimal    | 104       | 系统、选择与属性、图层、绘图与3D、空间查询、包与函数、元工具                       |
// | standard   | 228       | minimal + 修改、编辑、块、标注与填充、文字、打印、文件、视口、坐标系与布局、样式、扩展数据 |
// | full       | 361       | 全部（默认，行为与档位引入前完全一致）                                            |
//
// 只影响 tools/list 等发现接口（getVisibleTools）；被过滤的工具仍可通过 search_tools /
// list_tools_by_category 检索并直接调用（工具调用校验走完整 toolsByName）。
export const PROFILE_CATEGORIES = {
  minimal: new Set([
    '系统', '选择与属性', '图层', '绘图与3D', '空间查询', '包与函数', '元工具',
  ]),
  standard: new Set([
    '系统', '选择与属性', '图层', '绘图与3D', '空间查询', '包与函数', '元工具',
    '修改', '编辑', '块', '标注与填充', '文字', '打印', '文件',
    '视口', '坐标系与布局', '样式', '扩展数据',
  ]),
  full: null, // null = 不按 category 过滤
};

/** 未知档位（如 CLI 传入拼写错误）回落到 full，保证不会把工具全部藏掉。 */
export function normalizeToolProfile(profile) {
  return Object.prototype.hasOwnProperty.call(PROFILE_CATEGORIES, profile) ? profile : 'full';
}

const _visibleCache = { key: null, result: null };

/**
 * 按 config.toolProfile 与 config.toolCategories 过滤后的可见工具。
 * 仅影响 tools/list 等发现接口；工具调用校验仍使用完整 toolsByName。
 */
export function getVisibleTools() {
  const profile = normalizeToolProfile(config?.toolProfile);
  const cats = config?.toolCategories;
  const catsKey = Array.isArray(cats) && cats.length > 0 ? cats.join(',') : '';
  const key = `${profile}|${catsKey}`;
  if (_visibleCache.key === key) return _visibleCache.result;
  let result = tools;
  const allowedCats = PROFILE_CATEGORIES[profile];
  if (allowedCats) {
    result = result.filter(t => allowedCats.has(t.annotations?.category));
  }
  if (catsKey) {
    result = result.filter(t => cats.includes(t.annotations?.category));
  }
  _visibleCache.key = key;
  _visibleCache.result = result;
  return result;
}

// 启动体积日志：工具总数、profile、JSON 序列化 KB。放在模块尾部（tools 数组已建好），
// 便于排查 token 成本；序列化只执行一次，耗时可忽略。测试进程（NODE_ENV=test）跳过，
// 避免每个测试文件都往 DEBUG_FILE 写一条。
import { log as loggerLog } from '../logger.js';
if (process.env.NODE_ENV !== 'test') {
  const visible = getVisibleTools();
  const kb = (bytes) => Math.round(bytes / 1024);
  loggerLog('tools registered', {
    total: tools.length,
    visible: visible.length,
    profile: normalizeToolProfile(config?.toolProfile),
    schemaKB: kb(Buffer.byteLength(JSON.stringify(tools))),
    visibleSchemaKB: kb(Buffer.byteLength(JSON.stringify(visible))),
  });
}
