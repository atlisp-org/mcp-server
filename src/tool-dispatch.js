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

export function notifyResourceChanges(toolName) {
  const ENTITIES = ['atlisp://dwg/entities'];
  const TBL = ['atlisp://dwg/tbl'];
  const BLOCK_REFS = ['atlisp://dwg/block-refs'];
  const TEXT = ['atlisp://dwg/text-content'];
  const GROUPS = ['atlisp://dwg/groups'];

  if (toolName.startsWith('draw_') || toolName.startsWith('create_3d_') || toolName === 'draw_hatch') {
    return clearAndNotify(ENTITIES);
  }
  if (toolName.startsWith('batch_') || toolName.startsWith('boolean_') ||
      ['explode_block', 'explode_text', 'insert_block', 'overkill', 'stretch',
       'trim_entity', 'extend_entity', 'fillet', 'chamfer', 'break_entity', 'join_entities',
       'offset_entity', 'mirror_entity', 'move_entity', 'copy_entity', 'rotate_entity', 'scale_entity',
       'array_rectangular', 'array_polar',
      ].includes(toolName)) {
    return clearAndNotify([...ENTITIES, ...BLOCK_REFS]);
  }
  if (toolName.startsWith('delete_') || toolName.startsWith('purge_')) {
    return clearAndNotify([...ENTITIES, ...BLOCK_REFS, ...TBL]);
  }
  if (toolName.startsWith('create_layer') || toolName.startsWith('delete_layer') ||
      toolName.startsWith('set_layer') || toolName.startsWith('layer_') ||
      toolName === 'set_current_layer') {
    return clearAndNotify(TBL);
  }
  if (toolName.startsWith('create_dimension') || toolName.startsWith('create_text_style') ||
      toolName.startsWith('create_linetype') || toolName.startsWith('load_linetype') ||
      toolName.startsWith('create_mleader_style')) {
    return clearAndNotify(TBL);
  }
  if (toolName.startsWith('create_block') || toolName === 'insert_block') {
    return clearAndNotify([...BLOCK_REFS, ...TBL]);
  }
  if (toolName.startsWith('open_dwg') || toolName.startsWith('close_dwg') ||
      toolName === 'new_document') {
    return clearAndNotify(['atlisp://dwg/name', 'atlisp://dwg/path', 'atlisp://cad/dwgs', ...TBL, ...ENTITIES, ...BLOCK_REFS, ...TEXT]);
  }
  if (toolName === 'save_dwg') {
    return clearAndNotify(['atlisp://dwg/name', 'atlisp://dwg/path']);
  }
  if (toolName.startsWith('attach_xref') || toolName.startsWith('detach_xref') ||
      toolName.startsWith('reload_xref') || toolName.startsWith('bind_xref') ||
      toolName.startsWith('unload_xref') || toolName.startsWith('clip_xref') ||
      toolName.startsWith('path_xref') || toolName.startsWith('xref_')) {
    return clearAndNotify([...TBL, ...ENTITIES]);
  }
  if (toolName.startsWith('attach_pdf') || toolName.startsWith('detach_pdf') ||
      toolName.startsWith('import_dxf') || toolName.startsWith('import_dgn') ||
      toolName.startsWith('export_')) {
    return clearAndNotify(ENTITIES);
  }
  if (toolName.startsWith('set_xdata') || toolName.startsWith('delete_xdata') ||
      toolName.startsWith('copy_xdata') || toolName.startsWith('import_xdata')) {
    return clearAndNotify(ENTITIES);
  }
  if (toolName.startsWith('create_hyperlink') || toolName.startsWith('remove_hyperlink')) {
    return clearAndNotify(ENTITIES);
  }
  if (toolName === 'connect_cad') {
    return clearAndNotify(['atlisp://cad/info', ...TBL, 'atlisp://dwg/name', 'atlisp://dwg/path', 'atlisp://cad/dwgs', 'atlisp://packages']);
  }
  if (toolName.startsWith('install_') || toolName.startsWith('init_')) {
    return clearAndNotify(['atlisp://packages', 'atlisp://cad/info']);
  }
  if (toolName.startsWith('create_group') || toolName.startsWith('delete_group') ||
      toolName.startsWith('batch_create_group') || toolName.startsWith('batch_add_to_group')) {
    return clearAndNotify(GROUPS);
  }
  if (toolName.startsWith('set_block_attribute') || toolName.startsWith('batch_set_block_attribute') ||
      toolName.startsWith('set_dynamic_block_property') || toolName.startsWith('set_block_parameter') ||
      toolName.startsWith('set_visibility_state')) {
    return clearAndNotify(BLOCK_REFS);
  }
  if (toolName === 'set_entity') {
    return clearAndNotify(ENTITIES);
  }
  if (toolName.startsWith('create_page_setup') || toolName.startsWith('set_page_setup')) {
    return;
  }
}
