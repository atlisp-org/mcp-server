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
import { tools as context_tools } from './context-tools.js';
import { tools as batch_transaction_tools } from './batch-transaction-tools.js';
import { tools as lint_tools } from './lint-tools.js';

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
  'list_tools_by_category', 'search_tools',
  'get_system_variable',
  'audit_log_query', 'audit_log_stats',
  'cad_pool_list', 'cad_pool_stats', 'cad_pool_health',
  'get_3d_solid_info',
  'list_watches', 'list_webhooks', 'webhook_log',
  'lisp_repl_list', 'lisp_repl_history',
  'agent_list_context', 'agent_get_context',
  'find_entities_near_point', 'find_entities_in_window',
  'find_entities_crossing', 'find_entities_intersecting',
  'find_entities_in_polygon',
  'find_text',
  'stream_entities', 'stream_text', 'stream_block_refs',
  'skill_search', 'skill_list_installed', 'skill_list_categories',
  'analyze_lisp_code',
  'format_lisp_code',
  'list_lint_rules',
  'lint_project',
]);

const DEPRECATED_TOOLS = new Set([
]);

const EXTRA_DESTRUCTIVE = new Set([
  'overkill', 'batch_explode', 'explode_block', 'explode_text',
  'boolean_union', 'boolean_subtract', 'boolean_intersect', 'slice_solid',
  'batch_mirror', 'batch_rename', 'batch_offset', 'batch_rotate', 'batch_scale',
  'batch_set_color', 'batch_set_linetype', 'stretch',
]);

function addAnnotations(tool) {
  const isDeprecated = DEPRECATED_TOOLS.has(tool.name);
  return {
    ...tool,
    ...(isDeprecated ? { deprecated: true, title: `${tool.name} (deprecated)` } : {}),
    annotations: {
      readOnlyHint: READ_ONLY_TOOLS.has(tool.name),
      destructiveHint: tool.name.startsWith('delete_') || tool.name.startsWith('purge_') ||
        tool.name.startsWith('boolean_') || EXTRA_DESTRUCTIVE.has(tool.name),
      ...(isDeprecated ? { deprecatedReason: 'This tool has been superseded. Check documentation for alternatives.' } : {}),
    },
  };
}

export { READ_ONLY_TOOLS };
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
  ...lint_tools,
].map(addAnnotations);

export const toolsByName = new Map(tools.map(t => [t.name, t]));
