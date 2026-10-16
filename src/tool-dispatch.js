import { clearCache } from './handlers/resource-handlers.js';
import * as subMgr from './subscription-manager.js';

function clearAndNotify(uris) {
  for (const uri of uris) {
    clearCache(uri);
    if (subMgr.isSubscribed(uri)) {
      subMgr.notify(uri, null);
    }
  }
}

const ENTITIES = ['atlisp://dwg/entities'];
const TBL = ['atlisp://dwg/tbl'];
const BLOCK_REFS = ['atlisp://dwg/block-refs'];
const TEXT = ['atlisp://dwg/text-content'];
const GROUPS = ['atlisp://dwg/groups'];

/**
 * 资源失效规则表。**顺序敏感**：从上往下第一条命中的规则生效，因此更具体的
 * 规则（或历史上先匹配的规则）必须排在前面。每条规则命中条件为
 * `prefixes` 任一前缀匹配 或 `exact` 精确匹配。
 *
 * @type {{ prefixes?: string[], exact?: string[], uris: string[] }[]}
 */
const RULES = [
  { prefixes: ['draw_', 'create_3d_'], uris: ENTITIES },
  {
    prefixes: ['batch_', 'boolean_'],
    exact: [
      'explode_block', 'explode_text', 'insert_block', 'overkill', 'stretch',
      'trim_entity', 'extend_entity', 'fillet', 'chamfer', 'break_entity', 'join_entities',
      'offset_entity', 'mirror_entity', 'move_entity', 'copy_entity', 'rotate_entity', 'scale_entity',
      'array_rectangular', 'array_polar',
    ],
    uris: [...ENTITIES, ...BLOCK_REFS],
  },
  { prefixes: ['delete_', 'purge_'], uris: [...ENTITIES, ...BLOCK_REFS, ...TBL] },
  {
    prefixes: ['create_layer', 'delete_layer', 'set_layer', 'layer_'],
    exact: ['set_current_layer'],
    uris: TBL,
  },
  {
    prefixes: ['create_dimension', 'create_text_style', 'create_linetype', 'load_linetype', 'create_mleader_style'],
    uris: TBL,
  },
  { prefixes: ['create_block'], uris: [...BLOCK_REFS, ...TBL] },
  {
    prefixes: ['open_dwg', 'close_dwg'],
    exact: ['new_document'],
    uris: ['atlisp://dwg/name', 'atlisp://dwg/path', 'atlisp://cad/dwgs', ...TBL, ...ENTITIES, ...BLOCK_REFS, ...TEXT],
  },
  { exact: ['save_dwg'], uris: ['atlisp://dwg/name', 'atlisp://dwg/path'] },
  {
    prefixes: ['attach_xref', 'detach_xref', 'reload_xref', 'bind_xref', 'unload_xref', 'clip_xref', 'path_xref', 'xref_'],
    uris: [...TBL, ...ENTITIES],
  },
  { prefixes: ['attach_pdf', 'detach_pdf', 'import_dxf', 'import_dgn', 'export_'], uris: ENTITIES },
  { prefixes: ['set_xdata', 'delete_xdata', 'copy_xdata', 'import_xdata'], uris: ENTITIES },
  { prefixes: ['create_hyperlink', 'remove_hyperlink'], uris: ENTITIES },
  { exact: ['connect_cad'], uris: ['atlisp://cad/info', ...TBL, 'atlisp://dwg/name', 'atlisp://dwg/path', 'atlisp://cad/dwgs', 'atlisp://packages'] },
  { prefixes: ['install_', 'init_'], uris: ['atlisp://packages', 'atlisp://cad/info'] },
  { prefixes: ['create_group', 'delete_group', 'batch_create_group', 'batch_add_to_group'], uris: GROUPS },
  {
    prefixes: ['set_block_attribute', 'batch_set_block_attribute', 'set_dynamic_block_property', 'set_block_parameter', 'set_visibility_state'],
    uris: BLOCK_REFS,
  },
  { exact: ['set_entity'], uris: ENTITIES },
];

function ruleMatches(rule, toolName) {
  if (rule.exact && rule.exact.includes(toolName)) return true;
  if (rule.prefixes) {
    for (const prefix of rule.prefixes) {
      if (toolName.startsWith(prefix)) return true;
    }
  }
  return false;
}

export function notifyResourceChanges(toolName) {
  for (const rule of RULES) {
    if (ruleMatches(rule, toolName)) {
      return clearAndNotify(rule.uris);
    }
  }
}

export { RULES as _RESOURCE_INVALIDATION_RULES };
