import { getHandler, getHandlerModule } from './handler-loader.js';
import { streamEntitiesByType, streamTextContent, streamBlockRefs } from './streaming.js';
import { CAD_PLATFORMS, CAD_RESOURCE_URIS, SERVER_VERSION, BUILD_META } from './constants.js';
import { cad } from './cad.js';
import { pool } from './cad-pool.js';
import { tools } from './tools/index.js';
import { mcpContext } from './mcp-server-state.js';

import { registerWatch, removeWatch, listWatches, waitForWatch, createAndWait } from './trigger-engine.js';
import { validateLispCode, addToAllowlist, clearSessionAllowlist } from './lisp-security.js';
// @atlisp/lint（经 lint-analyzer）加载约 200ms，仅在 lint 工具真正调用时动态引入，
// 避免拖慢每次 MCP Server 冷启动。

import { executeInSession, getHistory, listSessions, closeSession } from './repl-engine.js';
import { registerWebhook, removeWebhook, listWebhooks, getWebhookLog } from './webhook-engine.js';
import { queryAuditLog, getAuditStats } from './audit-log.js';
import { setContext, getContext, listContext, deleteContext, clearContext } from './agent-context.js';
import { clearCache } from './handlers/resource-handlers.js';
import * as subMgr from './subscription-manager.js';

import { skill_search, skill_install, skill_list_installed, skill_uninstall, skill_list_categories } from './handlers/skill-handlers.js';
import { pluginList, pluginReload } from './handlers/plugin-handlers.js';
import { search_tools, list_tools_by_category, list_tools_by_industry, list_tools_by_priority, get_tool_info, list_prompts_handler, get_prompt_handler } from './handlers/meta-handlers.js';
import { peer_list, peer_scan, peer_connect, peer_disconnect, peer_forward, peer_call_tool, peer_cad_info, peer_cad_pool, peer_stats, peer_summary, peer_broadcast } from './handlers/peer-handlers.js';
import {
    dwgKbHealth, dwgKbStats, dwgKbSearch, dwgKbQuery, dwgKbListDrawings,
    dwgKbProjects, dwgKbLayers, dwgKbBlocks, dwgKbReviewQueue,
    dwgKbDrawingHistory, dwgKbCrossRef,
} from './handlers/dwg-kb-handlers.js';

// 注册实例切换回调：通知已订阅客户端刷新资源
// 缓存已在 cad-pool.setActive() 中通过 setInstanceKey() 自动隔离
pool.onInstanceSwitch(() => {
  for (const uri of CAD_RESOURCE_URIS) {
    if (subMgr.isSubscribed(uri)) {
      subMgr.notify(uri, null);
    }
  }
});

// Re-export handleToolCall from the executor module（同时在本模块内使用，
// 让 batch_concurrent_tasks 走完整的限速/校验/Undo/审计路径）
import { handleToolCall } from './tool-executor.js';
export { handleToolCall };

/**
 * @param {string} toolName
 * @param {(args: Record<string,any>) => any|any[]} [argMapper]
 * @returns {(args: Record<string,any>) => Promise<{content: {type:string,text:string}[], isError?: boolean}>}
 */
function lazy(toolName, argMapper) {
  return async (args) => {
    const handler = await getHandler(toolName);
    if (!handler) {
      /* 把版本/构建号带进错误：同一句「Handler not found」可能是旧 dist、
         精简安装（缺 handlers 目录）或 CAD 端/中继版本不一致，只有版本号
         能区分。前缀保持不变，agent 侧的 failure-signals 仍能识别。 */
      const build = BUILD_META
        ? `${SERVER_VERSION}/${BUILD_META.commit || 'unknown'}`
        : SERVER_VERSION;

      return {
        content: [{
          type: 'text',
          text: `Handler not found: ${toolName} (MCP ${build})；` +
            '可能是 MCP 服务版本与 CAD/Agent 不一致，或 handlers 目录缺失。请重启/升级 MCP 后重试。',
        }],
        isError: true,
      };
    }
    const mapped = argMapper ? argMapper(args) : args;
    if (Array.isArray(mapped)) return handler(...mapped);
    return handler(mapped);
  };
}

export const TOOL_HANDLERS = {

    // === CAD Connection ===
    open_cad:              lazy('open_cad', (a) => a?.platform),
    connect_cad:           lazy('connect_cad', (a) => a?.platform),
    get_platform_info:     () => ({ content: [{ type: 'text', text: `支持的 CAD 平台:\n${CAD_PLATFORMS.join('\n')}\n当前连接: ${cad.connected ? '已连接' : '未连接'}` }] }),
    get_system_status:      lazy('get_system_status'),
    bring_to_front:        lazy('bring_to_front'),
    send_esc:              lazy('send_esc'),

    // === Lisp Execution ===
    eval_lisp:             lazy('eval_lisp', (a) => a?.code),
    eval_lisp_with_result: lazy('eval_lisp_with_result', (a) => [a?.code, true, a?.encoding]),
    at_command:            lazy('at_command', (a) => a?.command),

    // === System ===
    get_cad_info:          lazy('get_cad_info'),
    cad_duplicates:        lazy('cad_duplicates'),
    new_document:          lazy('new_document'),
    install_atlisp:        lazy('install_atlisp'),
    init_atlisp:          lazy('init_atlisp'),
    get_system_variable: lazy('get_system_variable', (a) => a.name),
    set_system_variable: lazy('set_system_variable', (a) => [a.name, a.value]),

    // === Packages & Functions ===
    list_packages:         lazy('list_packages'),
    search_packages:       lazy('search_packages', (a) => a?.query),
    install_package:       lazy('install_package', (a) => a?.packageName),
    get_function_usage:    lazy('get_function_usage', (a) => [a?.name, a?.package]),
    list_symbols:          lazy('list_symbols', (a) => a?.package),
    import_funlib: async (a) => {
        const funMod = await getHandlerModule('function');
        const data = await funMod.loadAtlibFunctionLib();
        if (!data) return { content: [{ type: 'text', text: '加载函数库失败' }], isError: true };
        if (a.format === 'list') {
            const items = Object.values(data.all_functions || {}).map(f => `${f.name}: ${f.description || ''}`);
            return { content: [{ type: 'text', text: items.join('\n') }] };
        }
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },

    // === Prompts ===
    list_prompts: list_prompts_handler,
    get_prompt: get_prompt_handler,

    // === Entity Operations ===
    get_entity:           lazy('get_entity', (a) => a?.handle),
    set_entity:           lazy('set_entity', (a) => [a?.handle, a?.property, a?.value]),
    delete_entity:        lazy('delete_entity', (a) => a?.handle),
    get_entity_info:       lazy('get_entity_info', (a) => a?.handle),
    get_bounding_box: lazy('get_bounding_box', (a) => a.handle),

    // === Selection ===
    select_entities:      lazy('select_entities', (a) => a?.filter),
    select_all: lazy('select_all'),
    select_last: lazy('select_last'),
    select_by_color: lazy('select_by_color', (a) => a.colorIndex),

    // === Display Order ===
    bring_to_front_entity: lazy('bring_to_front_entity', (a) => a.handle),
    send_to_back_entity: lazy('send_to_back_entity', (a) => a.handle),
    bring_above_entity: lazy('bring_above_entity', (a) => [a.handle, a.referenceHandle]),
    send_below_entity: lazy('send_below_entity', (a) => [a.handle, a.referenceHandle]),

    // === Layer Operations ===
    create_layer:         lazy('create_layer', (a) => [a?.name, a?.color, a?.linetype]),
    delete_layer:         lazy('delete_layer', (a) => a?.name),
    set_layer:            lazy('set_layer', (a) => [a?.name, a?.property, a?.value]),
    set_current_layer:    lazy('set_current_layer', (a) => a?.name),
    layer_isolate: lazy('layer_isolate', (a) => a.name),
    layer_unisolate: lazy('layer_unisolate'),
    layer_freeze_all: lazy('layer_freeze_all'),
    layer_thaw_all: lazy('layer_thaw_all'),
    layer_lock_all: lazy('layer_lock_all'),
    layer_unlock_all: lazy('layer_unlock_all'),
    layer_merge: lazy('layer_merge', (a) => [a.sourceName, a.targetName]),

    // === Block Operations ===
    create_block:         lazy('create_block', (a) => [a?.name, a?.entities || '(princ)']),
    insert_block:         lazy('insert_block', (a) => [a?.blockName, a?.point, a?.scale, a?.rotation]),
    get_blocks:           lazy('get_blocks'),
    explode_block:         lazy('explode_block', (a) => a?.handle),
    get_block_attributes: lazy('get_block_attributes', (a) => a?.blockHandle),
    set_block_attribute:  lazy('set_block_attribute', (a) => [a?.blockHandle, a?.tag, a?.value]),
    batch_get_block_attributes: lazy('batch_get_block_attributes', (a) => a),
    batch_set_block_attributes: lazy('batch_set_block_attributes', (a) => a),
    get_dynamic_block_properties: lazy('get_dynamic_block_properties', (a) => a),
    set_dynamic_block_property: lazy('set_dynamic_block_property', (a) => a),
    get_block_parameters:  lazy('get_block_parameters', (a) => a),
    set_block_parameter:   lazy('set_block_parameter', (a) => a),
    list_visibility_states:lazy('list_visibility_states', (a) => a),
    set_visibility_state:  lazy('set_visibility_state', (a) => a),

    // === 图纸结构查询（图框识别）===
    // 注意：工具定义（src/tools/frame-tools.js）与这里的分派登记是**两份清单**，
    // 只加定义不加登记 → 工具出现在 tools/list 里，调用却报 HANDLER_NOT_FOUND
    // （实测踩过一次）。tests/unit/toolhandlers-coverage.test.js 会拦住这类漏登记。
    list_frames:          lazy('list_frames', (a) => a),

    // === DWG File Operations ===
    open_dwg:             lazy('open_dwg', (a) => a?.filePath),
    save_dwg:             lazy('save_dwg', (a) => a?.filePath),
    close_dwg:            lazy('close_dwg', (a) => a?.save),

    // === View Operations ===
    zoom_extents:         lazy('zoom_extents'),
    zoom_window:          lazy('zoom_window', (a) => [a?.p1, a?.p2]),
    create_named_view:    lazy('create_named_view', (a) => [a?.viewName, a?.center]),
    restore_named_view:   lazy('restore_named_view', (a) => a?.viewName),
    list_named_views:     lazy('list_named_views'),

    // === Export ===
    export_pdf:           lazy('export_pdf', (a) => [a?.outputPath, a?.layout]),
    export_dxf:           lazy('export_dxf', (a) => [a?.outputPath, a?.version]),
    export_dwf:           lazy('export_dwf', (a) => a?.outputPath),
    export_svg: lazy('export_svg', (a) => [a.outputPath, a.layout]),
    export_bmp: lazy('export_bmp', (a) => a.outputPath),
    export_stl: lazy('export_stl', (a) => [a.outputPath, a.handle]),
    export_dgn:            lazy('export_dgn', (a) => a?.filePath),

    // === Import ===
    import_dxf:            lazy('import_dxf', (a) => [a?.dxfPath, a?.explode]),
    import_dgn:            lazy('import_dgn', (a) => [a?.sourceFile, a?.targetFile]),

    // === Dimension ===
    create_dimension:     lazy('create_dimension', (a) => [a?.type, a?.points, a?.style]),
    get_dimension:        lazy('get_dimension', (a) => a?.handle),

    // === Hatch ===
    create_hatch:         lazy('create_hatch', (a) => [a?.patternName, a?.boundary, a?.scale, a?.angle]),
    set_hatch:            lazy('set_hatch', (a) => [a?.handle, a?.props]),

    // === UCS ===
    create_ucs:           lazy('create_ucs', (a) => [a?.name, a?.origin, a?.xAxis, a?.yAxis]),
    set_ucs:              lazy('set_ucs', (a) => a?.name),
    list_ucs:             lazy('list_ucs'),
    delete_ucs:           lazy('delete_ucs', (a) => a?.name),
    get_current_ucs:      lazy('get_current_ucs'),

    // === Layout ===
    create_layout:         lazy('create_layout', (a) => a?.name),
    set_layout:            lazy('set_layout', (a) => a?.name),
    list_layouts:          lazy('list_layouts'),
    delete_layout:         lazy('delete_layout', (a) => a?.name),
    get_current_layout:    lazy('get_current_layout'),
    rename_layout:         lazy('rename_layout', (a) => [a?.oldName, a?.newName]),

    // === Plot & Print ===
    plot_to_pdf:          lazy('plot_to_pdf', (a) => [a?.outputPath, a?.layout, a]),
    publish_layouts:      lazy('publish_layouts', (a) => a),
    plot_to_printer:      lazy('plot_to_printer', (a) => [a?.printerName, a?.layout]),
    batch_plot_wizard:    lazy('batch_plot_wizard', (a) => a),
    plot_device_management: lazy('plot_device_management', (a) => a),
    plot_log:             lazy('plot_log', (a) => a),
    plot_from_file_list:  lazy('plot_from_file_list', (a) => a),
    save_pdf_layout:       lazy('save_pdf_layout', (a) => [a?.layoutName, a?.outputPath, a?.plotDevice, a?.paperSize]),

    // === Page Setup ===
    create_page_setup: lazy('create_page_setup', (a) => [a.name, a.printer, a.paperSize, a.orientation, a.scale]),
    list_page_setups: lazy('list_page_setups'),
    set_page_setup: lazy('set_page_setup', (a) => [a.layout, a.pageSetupName]),
    import_page_setup: lazy('import_page_setup', (a) => [a.dwgPath, a.pageSetupName]),

    // === Group ===
    create_group:         lazy('create_group', (a) => [a?.name, a?.handles]),
    delete_group:          lazy('delete_group', (a) => a?.name),
    list_groups:          lazy('list_groups'),
    get_group_entities:   lazy('get_group_entities', (a) => a?.groupName),

    // === Measurement ===
    measure_distance:     lazy('measure_distance', (a) => [a?.p1, a?.p2]),
    measure_area:          lazy('measure_area', (a) => a?.points),

    // === Batch Operations ===
    batch_rename:          lazy('batch_rename', (a) => [a?.handles, a?.newNameTemplate, a?.startNum]),
    batch_move:            lazy('batch_move', (a) => [a?.handles, a?.fromLayer, a?.toLayer]),
    batch_copy:            lazy('batch_copy', (a) => [a?.handles, a?.dx, a?.dy, a?.dz]),
    batch_delete:          lazy('batch_delete', (a) => a?.handles),
    batch_set_color:       lazy('batch_set_color', (a) => [a?.handles, a?.color]),
    batch_explode:         lazy('batch_explode', (a) => a?.handles),
    batch_mirror:          lazy('batch_mirror', (a) => [a?.handles, a?.startPoint, a?.endPoint, a?.deleteOriginal]),
    batch_offset:          lazy('batch_offset', (a) => [a?.handles, a?.distance, a?.side]),
    batch_rotate:          lazy('batch_rotate', (a) => [a?.handles, a?.angle, a?.basePoint]),
    batch_scale:           lazy('batch_scale', (a) => [a?.handles, a?.scaleFactor, a?.basePoint]),
    batch_set_linetype:    lazy('batch_set_linetype', (a) => [a?.handles, a?.linetypeName]),
    batch_match_properties:lazy('batch_match_properties', (a) => [a?.sourceHandle, a?.targetHandles]),
    batch_create_group:    lazy('batch_create_group', (a) => [a?.name, a?.handles]),
    batch_add_to_group:    lazy('batch_add_to_group', (a) => [a?.groupName, a?.handles]),

    // === Single Entity Modify ===
    move_entity: lazy('move_entity', (a) => [a.handle, a.dx, a.dy, a.dz]),
    copy_entity: lazy('copy_entity', (a) => [a.handle, a.dx, a.dy, a.dz]),
    rotate_entity: lazy('rotate_entity', (a) => [a.handle, a.angle, a.basePoint]),
    scale_entity: lazy('scale_entity', (a) => [a.handle, a.scaleFactor, a.basePoint]),
    mirror_entity: lazy('mirror_entity', (a) => [a.handle, a.startPoint, a.endPoint, a.deleteOriginal]),
    offset_entity: lazy('offset_entity', (a) => [a.handle, a.distance, a.side]),
    array_rectangular: lazy('array_rectangular', (a) => [a.handle, a.rows, a.cols, a.rowSpacing, a.colSpacing]),
    array_polar: lazy('array_polar', (a) => [a.handle, a.center, a.count, a.angle]),

    // === Extended Data (Xdata) ===
    get_xdata:             lazy('get_xdata', (a) => [a?.handle, a?.appName]),
    set_xdata:             lazy('set_xdata', (a) => [a?.handle, a?.appName, a?.data]),
    delete_xdata:          lazy('delete_xdata', (a) => [a?.handle, a?.appName]),
    list_xdata_apps:       lazy('list_xdata_apps', (a) => a?.handle),
    get_all_entity_xdata:  lazy('get_all_entity_xdata', (a) => a?.handle),
    copy_xdata:            lazy('copy_xdata', (a) => [a?.sourceHandle, a?.targetHandle, a?.appName]),
    search_by_xdata:       lazy('search_by_xdata', (a) => [a?.appName, a?.key, a?.value]),
    export_xdata_to_file:  lazy('export_xdata_to_file', (a) => [a?.handle, a?.filePath]),
    import_xdata_from_file:lazy('import_xdata_from_file', (a) => [a?.handle, a?.filePath, a?.appName]),

    // === Sheet Set ===
    create_sheet_set:      lazy('create_sheet_set', (a) => [a?.name, a?.description]),
    open_sheet_set:        lazy('open_sheet_set', (a) => a?.filePath),
    list_sheet_sets:       lazy('list_sheet_sets'),
    add_sheet:             lazy('add_sheet', (a) => [a?.sheetSetName, a?.sheetName, a?.layoutName]),
    list_sheets:           lazy('list_sheets', (a) => a?.sheetSetName),
    delete_sheet:          lazy('delete_sheet', (a) => [a?.sheetSetName, a?.sheetName]),
    publish_sheet_set:     lazy('publish_sheet_set', (a) => [a?.sheetSetName, a?.outputDir, a?.format]),
    get_sheet_set_property:lazy('get_sheet_set_property', (a) => [a?.sheetSetName, a?.propertyName]),
    create_sheet_set_archive: lazy('create_sheet_set_archive', (a) => [a?.sheetSetName, a?.archivePath]),
    reorder_sheet:          lazy('reorder_sheet', (a) => [a?.sheetSetName, a?.sheetName, a?.newIndex]),
    create_subset:          lazy('create_subset', (a) => [a?.sheetSetName, a?.subsetName]),
    list_subsets:           lazy('list_subsets', (a) => a?.sheetSetName),
    set_sheet_property:     lazy('set_sheet_property', (a) => [a?.sheetSetName, a?.sheetName, a?.propertyName, a?.value]),
    sheet_set_publish_options:   lazy('sheet_set_publish_options', (a) => a),
    sheet_set_transmit:          lazy('sheet_set_transmit', (a) => a),
    sheet_set_compare:           lazy('sheet_set_compare', (a) => a),
    sheet_list_views:            lazy('sheet_list_views', (a) => a),
    sheet_import_layouts:        lazy('sheet_import_layouts', (a) => a),

    // === 3D Solids ===
    create_box:            lazy('create_box', (a) => [a?.center, a?.length, a?.width, a?.height]),
    create_sphere:         lazy('create_sphere', (a) => [a?.center, a?.radius]),
    create_cylinder:       lazy('create_cylinder', (a) => [a?.center, a?.radius, a?.height]),
    create_cone:           lazy('create_cone', (a) => [a?.center, a?.radius, a?.height]),
    create_torus:          lazy('create_torus', (a) => [a?.center, a?.majorRadius, a?.minorRadius]),
    create_wedge:          lazy('create_wedge', (a) => [a?.center, a?.length, a?.width, a?.height]),
    create_3d_face:        lazy('create_3d_face', (a) => a?.points),
    create_3d_polyline:    lazy('create_3d_polyline', (a) => a?.points),
    create_mesh:           lazy('create_mesh', (a) => [a?.rows, a?.columns, a?.points]),
    extrude_solid:         lazy('extrude_solid', (a) => [a?.profileHandle, a?.height, a?.taperAngle]),
    revolve_solid:         lazy('revolve_solid', (a) => [a?.profileHandle, a?.axisStart, a?.axisEnd, a?.angle]),
    create_region:         lazy('create_region', (a) => a?.handles),
    boolean_union:         lazy('boolean_union', (a) => a?.handles),
    boolean_subtract:      lazy('boolean_subtract', (a) => [a?.handles, a?.subtractFromHandles]),
    boolean_intersect:     lazy('boolean_intersect', (a) => a?.handles),
    slice_solid:           lazy('slice_solid', (a) => [a?.solidHandle, a?.planePoint, a?.planeNormal, a?.keepBoth]),
    create_loft_surface:   lazy('create_loft_surface', (a) => [a?.profileHandles, a?.guideHandles]),
    thicken_surface:       lazy('thicken_surface', (a) => [a?.surfaceHandle, a?.thickness]),
    offset_surface:        lazy('offset_surface', (a) => [a?.surfaceHandle, a?.distance]),
    get_3d_solid_info:     lazy('get_3d_solid_info', (a) => a?.handle),

    // === Styles ===
    create_dimension_style:lazy('create_dimension_style', (a) => [a?.name, a?.color, a?.arrow, a?.textStyle]),
    set_dimstyle_var:      lazy('set_dimstyle_var', (a) => [a?.styleName, a?.variable, a?.value]),
    list_dimension_styles: lazy('list_dimension_styles'),
    create_text_style:     lazy('create_text_style', (a) => [a?.name, a?.fontFile, a?.height, a?.width, a?.angle]),
    list_text_styles:      lazy('list_text_styles'),
    create_linetype:       lazy('create_linetype', (a) => [a?.name, a?.description, a?.pattern]),
    load_linetype:         lazy('load_linetype', (a) => [a?.linetypeName, a?.filePath]),
    list_linetypes:        lazy('list_linetypes'),
    create_mleader_style:  lazy('create_mleader_style', (a) => a?.name),
    set_mleader_style_prop:lazy('set_mleader_style_prop', (a) => [a?.styleName, a?.property, a?.value]),
    list_mleader_styles:   lazy('list_mleader_styles'),

    // === Cloud Line ===
    create_cloud_line:     lazy('create_cloud_line', (a) => [a?.startPoint, a?.endPoint, a?.bulge, a?.arcRadius]),
    convert_to_cloud_line: lazy('convert_to_cloud_line', (a) => a?.handle),

    // === PDF Underlay ===
    attach_pdf:            lazy('attach_pdf', (a) => [a?.point, a?.pdfPath, a?.scale, a?.rotation]),
    list_attached_pdfs:    lazy('list_attached_pdfs'),
    reload_pdf:            lazy('reload_pdf', (a) => a?.pdfHandle),
    detach_pdf:            lazy('detach_pdf', (a) => a?.pdfHandle),
    get_pdf_info:          lazy('get_pdf_info', (a) => a?.pdfHandle),
    batch_attach_pdfs:     lazy('batch_attach_pdfs', (a) => [a?.pdfFiles, a?.basePoint, a?.spacing, a?.direction]),

    // === DGN/DWF Underlay ===
    create_dgn_underlay:   lazy('create_dgn_underlay', (a) => [a?.dgnPath, a?.point, a?.scale]),
    create_dwf_underlay:   lazy('create_dwf_underlay', (a) => [a?.dwfPath, a?.point, a?.scale]),

    // === Hyperlink ===
    create_hyperlink:      lazy('create_hyperlink', (a) => [a?.handle, a?.url, a?.description]),
    remove_hyperlink:      lazy('remove_hyperlink', (a) => a?.handle),

    // === Xref ===
    attach_xref:           lazy('attach_xref', (a) => a),
    detach_xref:           lazy('detach_xref', (a) => a),
    reload_xref:           lazy('reload_xref', (a) => a),
    unload_xref:           lazy('unload_xref', (a) => a),
    list_xrefs:            lazy('list_xrefs'),
    bind_xref:             lazy('bind_xref', (a) => a),
    clip_xref:             lazy('clip_xref', (a) => a),
    path_xref:             lazy('path_xref', (a) => a),
    xref_notifications:    lazy('xref_notifications', (a) => a),
    xref_compare:          lazy('xref_compare', (a) => a),
    xref_convert_to_block: lazy('xref_convert_to_block', (a) => a),
    xref_demote:           lazy('xref_demote', (a) => a),
    xref_path_relative:    lazy('xref_path_relative', (a) => a),

    // === Constraints ===
    add_geom_constraint:   lazy('add_geom_constraint', (a) => a),
    add_dim_constraint:    lazy('add_dim_constraint', (a) => a),
    del_constraint:        lazy('del_constraint', (a) => a),
    list_constraints:      lazy('list_constraints'),

    // === Edit Operations ===
    trim_entity: lazy('trim_entity', (a) => [a.handle, a.cuttingEdgeHandle]),
    extend_entity: lazy('extend_entity', (a) => [a.handle, a.boundaryHandle]),
    fillet: lazy('fillet', (a) => [a.handle1, a.handle2, a.radius]),
    chamfer: lazy('chamfer', (a) => [a.handle1, a.handle2, a.distance1, a.distance2]),
    break_entity: lazy('break_entity', (a) => [a.handle, a.point1, a.point2]),
    join_entities: lazy('join_entities', (a) => a.handles),
    stretch: lazy('stretch', (a) => [a.handles, a.basePoint, a.displacement]),

    // === Viewport ===
    create_viewport: lazy('create_viewport', (a) => [a.layout, a.corner1, a.corner2]),
    create_polygonal_viewport: lazy('create_polygonal_viewport', (a) => [a.layout, a.points]),
    set_viewport_scale: lazy('set_viewport_scale', (a) => [a.handle, a.scale]),
    lock_viewport: lazy('lock_viewport', (a) => a.handle),
    unlock_viewport: lazy('unlock_viewport', (a) => a.handle),
    maximize_viewport: lazy('maximize_viewport', (a) => a.handle),
    minimize_viewport: lazy('minimize_viewport'),

    // === Purge & Audit ===
    purge_all: lazy('purge_all'),
    purge_blocks: lazy('purge_blocks', (a) => a.namePattern),
    purge_layers: lazy('purge_layers', (a) => a.namePattern),
    purge_styles: lazy('purge_styles', (a) => a.namePattern),
    purge_registered_apps: lazy('purge_registered_apps', (a) => a.namePattern),
    drawing_audit: lazy('drawing_audit'),
    drawing_recover: lazy('drawing_recover', (a) => a.filePath),
    overkill: lazy('overkill', (a) => a.handles),

    // === Spatial Find ===
    find_entities_near_point: lazy('find_entities_near_point', (a) => [a.point, a.radius]),
    find_entities_in_window: lazy('find_entities_in_window', (a) => [a.corner1, a.corner2]),
    find_entities_crossing: lazy('find_entities_crossing', (a) => [a.corner1, a.corner2]),
    find_entities_intersecting: lazy('find_entities_intersecting', (a) => a.fencePoints),
    find_entities_in_polygon: lazy('find_entities_in_polygon', (a) => a.points),

    // === Text Operations ===
    find_text: lazy('find_text', (a) => [a.pattern, a.caseSensitive]),
    replace_text: lazy('replace_text', (a) => [a.pattern, a.replacement, a.caseSensitive]),
    set_text_height: lazy('set_text_height', (a) => [a.handle, a.height]),
    set_text_style_name: lazy('set_text_style_name', (a) => [a.handle, a.styleName]),
    justify_text: lazy('justify_text', (a) => [a.handle, a.justification]),
    convert_text_to_mtext: lazy('convert_text_to_mtext', (a) => a.handles),
    explode_text: lazy('explode_text', (a) => a.handle),

    // === Drawing ===
    draw_line: lazy('draw_line', (a) => [a.p1, a.p2]),
    draw_circle: lazy('draw_circle', (a) => [a.center, a.radius]),
    draw_arc: lazy('draw_arc', (a) => [a.center, a.radius, a.startAngle, a.endAngle]),
    draw_rectangle: lazy('draw_rectangle', (a) => [a.corner1, a.corner2]),
    draw_polygon: lazy('draw_polygon', (a) => [a.center, a.sides, a.radius]),
    draw_ellipse: lazy('draw_ellipse', (a) => [a.center, a.majorAxis, a.minorAxis]),
    draw_text: lazy('draw_text', (a) => [a.text, a.point, a.height]),
    draw_mtext: lazy('draw_mtext', (a) => [a.text, a.point, a.width]),
    draw_polyline: lazy('draw_polyline', (a) => [a.points, a.closed]),
    draw_spline: lazy('draw_spline', (a) => a.points),
    draw_point: lazy('draw_point', (a) => a.point),
    draw_hatch: lazy('draw_hatch', (a) => [a.points, a.pattern]),
    draw_helix: lazy('draw_helix', (a) => [a.center, a.topRadius, a.bottomRadius, a.height, a.turns]),
    draw_donut: lazy('draw_donut', (a) => [a.center, a.innerRadius, a.outerRadius]),
    draw_2d_solid: lazy('draw_2d_solid', (a) => [a.p1, a.p2, a.p3, a.p4]),
    draw_xline: lazy('draw_xline', (a) => [a.point, a.direction]),
    draw_ray: lazy('draw_ray', (a) => [a.point, a.direction]),
    draw_leader: lazy('draw_leader', (a) => [a.points, a.annotation]),
    draw_table: lazy('draw_table', (a) => [a.insertionPoint, a.rows, a.columns, a.rowHeight, a.colWidth]),

    // === Batch Concurrent ===
    batch_concurrent_tasks: async (a) => {
        if (!a.tasks || !Array.isArray(a.tasks) || a.tasks.length === 0) {
            return { content: [{ type: 'text', text: '需要 tasks 数组' }], isError: true };
        }
        if (a.tasks.length > 50) {
            return { content: [{ type: 'text', text: '最多支持 50 个并发任务' }], isError: true };
        }

        const parentCtx = mcpContext.getStore();
        const results = await Promise.allSettled(a.tasks.map(async (task, idx) => {
            // 每个子任务在独立 AsyncLocalStorage 上下文中执行，避免并发写 _toolInstance 竞态；
            // 统一走 handleToolCall，使限速/参数校验/Undo/审计对子工具同样生效。
            const childCtx = { ...(parentCtx || {}) };
            if (task.instance) childCtx._toolInstance = task.instance;
            const childArgs = task.instance ? { ...(task.args || {}), instance: task.instance } : (task.args || {});

            try {
                const result = await mcpContext.run(childCtx, () =>
                    handleToolCall(task.tool, childArgs, { sessionId: parentCtx?.sessionId })
                );
                return { index: idx, tool: task.tool, instance: task.instance, ok: !result?.isError, data: result?.content?.[0]?.text || result };
            } catch (e) {
                return { index: idx, tool: task.tool, instance: task.instance, ok: false, error: e.message };
            }
        }));

        const output = results.map((r, idx) => {
            if (r.status === 'fulfilled') return r.value;
            return { index: idx, tool: a.tasks[idx].tool, instance: a.tasks[idx].instance, ok: false, error: r.reason?.message || 'Unknown error' };
        });

        return { content: [{ type: 'text', text: JSON.stringify(output, null, 2) }] };
    },

    // === Batch Transaction ===
    batch_transaction:      lazy('batch_transaction'),



    // === Watch / Trigger ===
    watch_register: (a) => {
        try {
            const result = registerWatch(a);
            return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        } catch (e) {
            return { content: [{ type: 'text', text: e.message }], isError: true };
        }
    },
    watch_remove: (a) => {
        const ok = removeWatch(a.id);
        return { content: [{ type: 'text', text: ok ? `触发器 ${a.id} 已移除` : `触发器 ${a.id} 未找到` }] };
    },
    watch_list: () => {
        const result = listWatches();
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
    watch_wait: async (a) => {
        try {
            const result = await waitForWatch(a.id, a.timeout || 30000);
            return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        } catch (e) {
            return { content: [{ type: 'text', text: e.message }], isError: true };
        }
    },
    watch_create_and_wait: async (a) => {
        try {
            const result = await createAndWait(a, a.timeout || 30000);
            return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        } catch (e) {
            return { content: [{ type: 'text', text: e.message }], isError: true };
        }
    },

    // === REPL ===
    lisp_repl: async (a) => {
        const result = await executeInSession(a.sessionId, a.code);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
    lisp_repl_history: (a) => {
        const history = getHistory(a.sessionId);
        if (!history) return { content: [{ type: 'text', text: JSON.stringify({ error: 'Session not found' }) }], isError: true };
        return { content: [{ type: 'text', text: JSON.stringify(history) }] };
    },
    lisp_repl_list: () => {
        return { content: [{ type: 'text', text: JSON.stringify(listSessions()) }] };
    },
    lisp_repl_close: (a) => {
        const ok = closeSession(a.sessionId);
        return { content: [{ type: 'text', text: JSON.stringify({ success: ok }) }] };
    },

    // === Streaming ===
    stream_entities: async (a) => {
        const result = await streamEntitiesByType({ type: a.type, layer: a.layer, chunk: a.chunk, offset: a.offset });
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
    stream_text: async (a) => {
        const result = await streamTextContent({ layer: a.layer, offset: a.offset, limit: a.limit });
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
    stream_block_refs: async (a) => {
        const result = await streamBlockRefs({ blockName: a.blockName, offset: a.offset, limit: a.limit });
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },

    // === Webhook ===
    webhook_register: (a) => {
        try {
            const result = registerWebhook(a);
            return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        } catch (e) {
            return { content: [{ type: 'text', text: e.message }], isError: true };
        }
    },
    webhook_list: () => {
        const result = listWebhooks();
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
    webhook_remove: (a) => {
        const ok = removeWebhook(a.id);
        return { content: [{ type: 'text', text: ok ? `Webhook ${a.id} 已移除` : `Webhook ${a.id} 未找到` }] };
    },
    webhook_log: (a) => {
        const logs = getWebhookLog(a.id);
        return { content: [{ type: 'text', text: JSON.stringify(logs, null, 2) }] };
    },

    // === External Data ===
    external_db_query:   lazy('external_db_query', (a) => a),
    import_external_data: lazy('import_external_data', (a) => a),
    export_to_external:  lazy('export_to_external', (a) => a),
    list_data_sources:   lazy('list_data_sources'),

    // === 图纸知识库（atlisp-dwg-kb，只读 HTTP 查询）===
    // 全部直连 Node handler（不经 CAD/LISP）：知识库没起时返回 reachable:false，
    // 而不是抛错——否则模型会把「服务没开」读成「查不到图纸」。
    dwg_kb_health:           (a) => dwgKbHealth(a),
    dwg_kb_stats:            (a) => dwgKbStats(a),
    dwg_kb_search:           (a) => dwgKbSearch(a),
    dwg_kb_query:            (a) => dwgKbQuery(a),
    dwg_kb_list_drawings:    (a) => dwgKbListDrawings(a),
    dwg_kb_projects:         (a) => dwgKbProjects(a),
    dwg_kb_layers:           (a) => dwgKbLayers(a),
    dwg_kb_blocks:           (a) => dwgKbBlocks(a),
    dwg_kb_review_queue:     (a) => dwgKbReviewQueue(a),
    dwg_kb_drawing_history:  (a) => dwgKbDrawingHistory(a),
    dwg_kb_cross_ref:        (a) => dwgKbCrossRef(a),

    // === Lint & Analysis ===
    analyze_lisp_code: async (a) => {
        const { analyzeLispCode } = await import('./lint-analyzer.js');
        const result = analyzeLispCode(a.code, { lintConfig: a.config });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
    format_lisp_code: async (a) => {
        try {
            const { formatCode } = await import('@atlisp/lint/dist/formatter.js');
            const formatted = formatCode(a.code, { tabWidth: a.tabWidth || 2 });
            return { content: [{ type: 'text', text: formatted }] };
        } catch (e) {
            return { content: [{ type: 'text', text: `格式化失败: ${e.message}` }], isError: true };
        }
    },
    list_lint_rules: async () => {
        try {
            const { RULES } = await import('@atlisp/lint/dist/rules.js');
            const list = RULES.map(r => ({ rule: r.name, severity: r.severity || 'warn', description: r.description || '', fixable: !!r.fix }));
            return { content: [{ type: 'text', text: JSON.stringify(list, null, 2) }] };
        } catch (e) {
            return { content: [{ type: 'text', text: `获取规则列表失败: ${e.message}` }], isError: true };
        }
    },
    lint_project: async (a) => {
        if (!a.directory) return { content: [{ type: 'text', text: '需要 directory 参数' }], isError: true };
        try {
            const { lintProject } = await import('@atlisp/lint/dist/project.js');
            const results = await lintProject(a.directory, a.config || {});
            return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
        } catch (e) {
            return { content: [{ type: 'text', text: `项目分析失败: ${e.message}` }], isError: true };
        }
    },

    // === Debug ===
    debug_start: lazy('debug_start', (a) => a),
    debug_step: lazy('debug_step', (a) => a),
    debug_evaluate: lazy('debug_evaluate', (a) => a),
    debug_get_state: lazy('debug_get_state', (a) => a),
    debug_stop: lazy('debug_stop', (a) => a),

    // === Sandbox (Security) ===
    sandbox_validate: (a) => {
        const result = validateLispCode(a.code, a.sessionId || null);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
    sandbox_allowlist_add: (a) => {
        addToAllowlist(a.sessionId, a.ruleIndex);
        return { content: [{ type: 'text', text: `规则索引 ${a.ruleIndex} 已添加到会话 ${a.sessionId} 的 allowlist` }] };
    },
    sandbox_allowlist_clear: (a) => {
        clearSessionAllowlist(a.sessionId);
        return { content: [{ type: 'text', text: `会话 ${a.sessionId} 的 allowlist 已清除` }] };
    },

    // === Audit Log ===
    audit_log_query: (a) => {
        const result = queryAuditLog(a);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
    audit_log_stats: () => {
        const result = getAuditStats();
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },

    // === CAD Pool ===
    cad_pool_discover: async () => {
        const instances = await pool.discover();
        return { content: [{ type: 'text', text: JSON.stringify(instances, null, 2) }] };
    },
    cad_pool_switch: (a) => {
        const ok = pool.setActive(a.key);
        if (ok) {
            clearCache();
            for (const uri of CAD_RESOURCE_URIS) {
                if (subMgr.isSubscribed(uri)) {
                    subMgr.notify(uri, null);
                }
            }
        }
        return { content: [{ type: 'text', text: ok ? `已切换到实例 ${a.key}` : `实例 ${a.key} 不存在` }] };
    },
    cad_pool_health: async () => {
        const results = await pool.healthCheck();
        return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
    },
    cad_pool_stats: () => {
        const stats = pool.getStats();
        return { content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }] };
    },
    cad_pool_connect: async (a) => {
        const ok = await pool.connect(a.key, a.platform, { label: a.label, pid: a.pid, makeActive: a.makeActive !== false, forceLaunch: !!a.forceLaunch });
        const label = a.key || (a.pid != null ? `PID ${a.pid}` : 'default');
        return { content: [{ type: 'text', text: ok ? `实例 "${label}" 已连接` : `实例 "${label}" 连接失败` }] };
    },
    cad_pool_disconnect: async (a) => {
        const ok = await pool.disconnect(a.key);
        return { content: [{ type: 'text', text: ok ? `实例 "${a.key}" 已断开` : `实例 "${a.key}" 未找到` }] };
    },
    cad_pool_list: () => {
        const list = pool.listInstances();
        return { content: [{ type: 'text', text: JSON.stringify(list, null, 2) }] };
    },
    session_pin_instance: (a) => {
        const ctx = mcpContext.getStore();
        if (!pool.getConnection(a.key)) {
            return { content: [{ type: 'text', text: `实例 "${a.key}" 未连接` }], isError: true };
        }
        ctx.instanceKey = a.key;
        return { content: [{ type: 'text', text: `会话已绑定到实例 "${a.key}"` }] };
    },
    session_unpin_instance: () => {
        const ctx = mcpContext.getStore();
        ctx.instanceKey = null;
        return { content: [{ type: 'text', text: '已取消实例绑定' }] };
    },

    // === Agent Context ===
    agent_set_context: async (a) => {
        const ctx = mcpContext.getStore();
        setContext(ctx?.sessionId || 'default', a.key, a.value);
        return { content: [{ type: 'text', text: `已设置 ${a.key}` }] };
    },
    agent_get_context: async (a) => {
        const ctx = mcpContext.getStore();
        const val = getContext(ctx?.sessionId || 'default', a.key);
        return { content: [{ type: 'text', text: val !== undefined ? JSON.stringify(val) : 'nil' }] };
    },
    agent_list_context: async () => {
        const ctx = mcpContext.getStore();
        const keys = listContext(ctx?.sessionId || 'default');
        return { content: [{ type: 'text', text: JSON.stringify(keys) }] };
    },
    agent_delete_context: async (a) => {
        const ctx = mcpContext.getStore();
        deleteContext(ctx?.sessionId || 'default', a.key);
        return { content: [{ type: 'text', text: `已删除 ${a.key}` }] };
    },
    agent_clear_context: async () => {
        const ctx = mcpContext.getStore();
        clearContext(ctx?.sessionId || 'default');
        return { content: [{ type: 'text', text: '上下文已清除' }] };
    },

    // === Peer Discovery ===
    peer_list,
    peer_scan,
    peer_connect,
    peer_disconnect,
    peer_forward,
    peer_call_tool,
    peer_cad_info,
    peer_cad_pool,
    peer_stats,
    peer_summary,
    peer_broadcast,

    // === Meta Tools ===
    search_tools,
    list_tools_by_category,
    list_tools_by_industry,
    list_tools_by_priority,
    get_tool_info,

    // === Skill Management ===
    skill_search,
    skill_install,
    skill_list_installed,
    skill_uninstall,
    skill_list_categories,

    // === Plugin Management ===
    plugin_list: pluginList,
    plugin_reload: pluginReload,
};

export { tools };
