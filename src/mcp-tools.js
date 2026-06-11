import fs from 'fs';
import path from 'path';
import os from 'os';
import { getHandler, getHandlerModule } from './handler-loader.js';
import { listPrompts, getPrompt } from './handlers/prompt-handlers.js';
import { streamEntitiesByType, streamTextContent, streamBlockRefs } from './streaming.js';
import { CAD_PLATFORMS } from './constants.js';
import { cad } from './cad.js';
import { pool } from './cad-pool.js';
import { tools } from './tools/index.js';
import { mcpContext } from './mcp-server-state.js';
import { executePipeline, savePipeline, listPipelines, loadPipeline, deletePipeline } from './pipeline-engine.js';
import { registerWatch, removeWatch, listWatches, waitForWatch, createAndWait } from './trigger-engine.js';
import { validateLispCode, addToAllowlist, clearSessionAllowlist } from './lisp-sandbox.js';
import { executeInSession, getHistory, listSessions, closeSession } from './repl-engine.js';
import { registerWebhook, removeWebhook, listWebhooks, getWebhookLog } from './webhook-engine.js';
import { queryAuditLog, getAuditStats } from './audit-log.js';
import { setContext, getContext, listContext, deleteContext, clearContext } from './agent-context.js';

// Re-export handleToolCall from the executor module
export { handleToolCall } from './tool-executor.js';

function lazy(toolName, argMapper) {
  return async (args) => {
    const handler = await getHandler(toolName);
    if (!handler) return { content: [{ type: 'text', text: `Handler not found: ${toolName}` }], isError: true };
    const mapped = argMapper ? argMapper(args) : args;
    if (Array.isArray(mapped)) return handler(...mapped);
    return handler(mapped);
  };
}

export const TOOL_HANDLERS = {

    // === CAD Connection ===
    connect_cad:           lazy('connect_cad', (a) => a?.platform),
    get_platform_info:     () => ({ content: [{ type: 'text', text: `支持的 CAD 平台:\n${CAD_PLATFORMS.join('\n')}\n当前连接: ${cad.connected ? '已连接' : '未连接'}` }] }),
    get_system_status:      lazy('get_system_status'),
    bring_to_front:        lazy('bring_to_front'),

    // === Lisp Execution ===
    eval_lisp:             lazy('eval_lisp', (a) => a?.code),
    eval_lisp_with_result: lazy('eval_lisp_with_result', (a) => [a?.code, true, a?.encoding]),
    at_command:            lazy('at_command', (a) => a?.command),

    // === System ===
    get_cad_info:          lazy('get_cad_info'),
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
    list_prompts: async () => {
        const prompts = await listPrompts();
        return { content: [{ type: 'text', text: JSON.stringify(prompts) }] };
    },
    get_prompt: async (a) => {
        const prompt = await getPrompt(a.name, a.args || {});
        return { content: prompt.messages.map(m => ({ type: 'text', text: m.content.text || m.content })) };
    },

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
    batch_set_layer:      lazy('batch_set_layer', (a) => [a?.handles, a?.layerName]),
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

    // === Pipeline ===
    batch_transaction:      lazy('batch_transaction'),
    pipeline_execute: async (a) => {
        if (!a.steps || !Array.isArray(a.steps) || a.steps.length === 0) {
            return { content: [{ type: 'text', text: 'pipeline_execute 需要 steps 数组' }], isError: true };
        }
        const result = await executePipeline(a.steps, {});
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
    pipeline_save: async (a) => {
        if (!a.name || !a.steps) {
            return { content: [{ type: 'text', text: 'pipeline_save 需要 name 和 steps' }], isError: true };
        }
        await savePipeline(a.name, a.steps);
        return { content: [{ type: 'text', text: `管道 "${a.name}" 已保存` }] };
    },
    pipeline_list: async () => {
        const pipelines = listPipelines();
        return { content: [{ type: 'text', text: JSON.stringify(pipelines, null, 2) }] };
    },
    pipeline_run: async (a) => {
        if (!a.name) {
            return { content: [{ type: 'text', text: 'pipeline_run 需要 name' }], isError: true };
        }
        const pipeline = loadPipeline(a.name);
        if (!pipeline) {
            return { content: [{ type: 'text', text: `管道 "${a.name}" 未找到` }], isError: true };
        }
        const result = await executePipeline(pipeline.steps, {});
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
    pipeline_delete: async (a) => {
        if (!a.name) {
            return { content: [{ type: 'text', text: 'pipeline_delete 需要 name' }], isError: true };
        }
        const ok = deletePipeline(a.name);
        return { content: [{ type: 'text', text: ok ? `管道 "${a.name}" 已删除` : `管道 "${a.name}" 未找到` }] };
    },

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
        const ok = await pool.connect(a.key, a.platform, { label: a.label, makeActive: a.makeActive !== false });
        return { content: [{ type: 'text', text: ok ? `实例 "${a.key}" 已连接` : `实例 "${a.key}" 连接失败` }] };
    },
    cad_pool_disconnect: async (a) => {
        const ok = await pool.disconnect(a.key);
        return { content: [{ type: 'text', text: ok ? `实例 "${a.key}" 已断开` : `实例 "${a.key}" 未找到` }] };
    },
    cad_pool_list: () => {
        const list = pool.listInstances();
        return { content: [{ type: 'text', text: JSON.stringify(list, null, 2) }] };
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

    // === Meta Tools ===
    search_tools: async (a) => {
        const q = (a.query || '').toLowerCase();
        const results = tools.filter(t => t.name.toLowerCase().includes(q) || (t.description || '').toLowerCase().includes(q));
        const text = results.length ? `找到 ${results.length} 个工具:\n${results.map(t => `${t.name}: ${t.description}`).join('\n')}` : `未找到包含 "${a.query}" 的工具`;
        return { content: [{ type: 'text', text }] };
    },
    list_tools_by_category: async (a) => {
        const categories = {};
        for (const t of tools) {
            let cat = '其他';
            const n = t.name;
            if (/^(draw_|create_3d_|create_box|create_cone|create_cylinder|create_sphere|create_torus|create_wedge|extrude_|revolve_|boolean_|slice_solid|thicken_|offset_surface|create_loft_|create_region)/.test(n)) cat = '绘图与3D';
            else if (/^(move_|copy_|rotate_|scale_|mirror_|offset_|array_|batch_)/.test(n)) cat = '修改';
            else if (/^(trim_|extend_|fillet|chamfer|break_|join_|stretch)/.test(n)) cat = '编辑';
            else if (/^(create_layer|delete_layer|set_layer|layer_)/.test(n)) cat = '图层';
            else if (/^(create_block|insert_block|explode_block|get_block|set_block|batch_get_block|batch_set_block)/.test(n)) cat = '块';
            else if (/^(create_dim|list_dim|set_dim|create_hatch|set_hatch)/.test(n)) cat = '标注与填充';
            else if (/^(create_ucs|set_ucs|delete_ucs|list_ucs|get_current_ucs|create_layout|delete_layout|rename_layout|set_layout|list_layouts|get_current_layout)/.test(n)) cat = '坐标系与布局';
            else if (/^(create_viewport|set_viewport|lock_viewport|unlock_viewport|maximize_viewport)/.test(n)) cat = '视口';
            else if (/^find_/.test(n)) cat = '空间查询';
            else if (/^(select_|get_entity|set_entity|delete_entity|get_bounding_box)/.test(n)) cat = '选择与属性';
            else if (/^(open_dwg|save_dwg|export_|import_|close_dwg|publish_)/.test(n)) cat = '文件';
            else if (/^(plot_|save_pdf|batch_plot|publish_layouts)/.test(n)) cat = '打印';
            else if (/^(get_xdata|set_xdata|delete_xdata|list_xdata|copxy_xdata|search_by_xdata|export_xdata|import_xdata)/.test(n)) cat = '扩展数据';
            else if (/^(create_sheet|open_sheet|list_sheet|add_sheet|delete_sheet|publish_sheet|sheet_|reorder_sheet|create_subset|list_subset|set_sheet)/.test(n)) cat = '图纸集';
            else if (/^(attach_|detach_|reload_|list_attached|get_pdf|create_dgn|create_dwf|import_dxf|import_dgn|export_dgn|create_hyper|remove_hyper|xref|bind_xref|clip_xref|path_xref)/.test(n)) cat = '参照与底图';
            else if (/^(create_text|create_mleader|create_linetype|list_text|list_linetype|list_mleader|load_linetype|create_dimension_style|set_dimstyle|list_dimension_styles|set_mleader_style)/.test(n)) cat = '样式';
            else if (/^(purge_|drawing_audit|drawing_recover|overkill)/.test(n)) cat = '清理';
            else if (/^(find_text|replace_text|set_text_|justify_|convert_text|explode_text)/.test(n)) cat = '文字';
            else if (/^(eval_lisp|connect_cad|get_cad|get_platform|get_system|at_command|new_document|bring_to_front|install_atlisp|init_atlisp|get_system_status)/.test(n)) cat = '系统';
            else if (/^(list_packages|search_packages|install_package|get_function_usage|list_symbols|import_funlib)/.test(n)) cat = '包与函数';
            else if (/^(pipeline_|watch_|lisp_repl|webhook_|sandbox_|audit_|cad_pool_|external_|list_data|export_to|import_external)/.test(n)) cat = '高级';
            else if (/^(list_prompts|get_prompt|search_tools|list_tools_by_category)/.test(n)) cat = '元工具';
            else if (/^(agent_)/.test(n)) cat = 'Agent上下文';
            if (!categories[cat]) categories[cat] = [];
            categories[cat].push(t.name);
        }
        if (a.category) {
            const names = categories[a.category];
            return { content: [{ type: 'text', text: names ? `${a.category} (${names.length}):\n${names.join('\n')}` : `未找到分类: ${a.category}` }] };
        }
        const lines = [];
        for (const [cat, names] of Object.entries(categories)) {
            lines.push(`## ${cat} (${names.length})`);
        }
        lines.push(`\n共 ${Object.keys(categories).length} 个分类`);
        return { content: [{ type: 'text', text: lines.join('\n') }] };
    },

    // === Skill Management ===
    skill_search: async (a) => {
        const registryUrl = process.env.SKILL_REGISTRY_URL || 'https://raw.githubusercontent.com/atlisp/skill-registry/main/index.json';
        const cachePath = path.join(os.homedir(), '.atlisp', 'skill-registry-cache.json');
        let cache = null;
        try { if (fs.existsSync(cachePath)) cache = JSON.parse(fs.readFileSync(cachePath, 'utf-8')); } catch {}
        let index = cache && (Date.now() - cache.fetchedAt < 3600000) ? cache : null;
        if (!index) {
            try {
                const resp = await fetch(registryUrl, { headers: { 'User-Agent': 'atlisp-mcp' } });
                if (resp.ok) {
                    index = await resp.json();
                    index.fetchedAt = Date.now();
                    try { fs.writeFileSync(cachePath, JSON.stringify(index, null, 2), 'utf-8'); } catch {}
                }
            } catch {}
        }
        if (!index || !index.skills) return { content: [{ type: 'text', text: '无法获取 skill 注册表索引' }], isError: true };
        const q = (a.query || '').toLowerCase();
        const results = index.skills.filter(s =>
            s.name.toLowerCase().includes(q) ||
            (s.description || '').toLowerCase().includes(q) ||
            (s.tags || []).some(t => t.toLowerCase().includes(q))
        );
        if (!results.length) return { content: [{ type: 'text', text: `未找到匹配 "${a.query}" 的 skill` }] };
        const lines = [`找到 ${results.length} 个 skill:\n`];
        for (const s of results) {
            lines.push(`**${s.name}**`);
            if (s.description) lines.push(`  描述: ${s.description}`);
            if (s.tags?.length) lines.push(`  标签: ${s.tags.join(', ')}`);
            if (s.version) lines.push(`  版本: ${s.version}`);
            lines.push('');
        }
        return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
    skill_install: async (a) => {
        if (!a.name) return { content: [{ type: 'text', text: '需要 skill 名称' }], isError: true };
        const registryUrl = process.env.SKILL_REGISTRY_URL || 'https://raw.githubusercontent.com/atlisp/skill-registry/main/index.json';
        const cachePath = path.join(os.homedir(), '.atlisp', 'skill-registry-cache.json');
        let cache = null;
        try { if (fs.existsSync(cachePath)) cache = JSON.parse(fs.readFileSync(cachePath, 'utf-8')); } catch {}
        let index = cache;
        if (!index || (Date.now() - index.fetchedAt > 3600000)) {
            try {
                const resp = await fetch(registryUrl, { headers: { 'User-Agent': 'atlisp-mcp' } });
                if (resp.ok) {
                    index = await resp.json();
                    index.fetchedAt = Date.now();
                    try { fs.writeFileSync(cachePath, JSON.stringify(index, null, 2), 'utf-8'); } catch {}
                }
            } catch {}
        }
        if (!index || !index.skills) return { content: [{ type: 'text', text: '无法获取 skill 注册表索引' }], isError: true };
        const skill = index.skills.find(s => s.name === a.name);
        if (!skill) return { content: [{ type: 'text', text: `未找到 skill: ${a.name}` }], isError: true };
        const downloadUrl = skill.download_url || skill.url;
        if (!downloadUrl) return { content: [{ type: 'text', text: `Skill "${a.name}" 没有下载地址` }], isError: true };
        let content;
        try {
            const resp = await fetch(downloadUrl, { headers: { 'User-Agent': 'atlisp-mcp' } });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            content = await resp.text();
        } catch (e) {
            return { content: [{ type: 'text', text: `下载失败: ${e.message}` }], isError: true };
        }
        const skillsDir = path.join(os.homedir(), '.atlisp', 'skills');
        try { fs.mkdirSync(skillsDir, { recursive: true }); } catch {}
        const safeName = a.name.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '-').substring(0, 40);
        const skillFile = path.join(skillsDir, `skill-${safeName}.md`);
        if (fs.existsSync(skillFile)) {
            return { content: [{ type: 'text', text: `Skill "${a.name}" 已安装 (${skillFile})` }], isError: true };
        }
        let finalContent = content;
        if (!content.match(/^---\n/)) {
            const tags = (skill.tags || []).join(', ');
            finalContent = `---\nname: ${a.name}\ndescription: ${skill.description || ''}\ntags: ${tags}\n---\n\n${content}`;
        }
        fs.writeFileSync(skillFile, finalContent, 'utf-8');
        return { content: [{ type: 'text', text: `✅ ${skill.name} 安装成功\n文件: ${skillFile}${skill.version ? `\n版本: ${skill.version}` : ''}` }] };
    },
    skill_list_installed: async () => {
        const skillsDir = path.join(os.homedir(), '.atlisp', 'skills');
        if (!fs.existsSync(skillsDir)) return { content: [{ type: 'text', text: '暂无已安装的 skill' }] };
        const results = [];
        try {
            const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isFile() && entry.name.endsWith('.md')) {
                    const fullPath = path.join(skillsDir, entry.name);
                    try {
                        const raw = fs.readFileSync(fullPath, 'utf-8');
                        const match = raw.match(/^---\n([\s\S]*?)\n---/);
                        if (match) {
                            const fm = {};
                            for (const line of match[1].split('\n')) {
                                const sep = line.indexOf(':');
                                if (sep > 0) fm[line.slice(0, sep).trim()] = line.slice(sep + 1).trim();
                            }
                            results.push({ name: fm.name || entry.name.replace('.md', ''), description: fm.description || '', tags: fm.tags || '' });
                        } else {
                            results.push({ name: entry.name.replace('.md', ''), description: '', tags: '' });
                        }
                    } catch {}
                }
            }
        } catch {}
        if (!results.length) return { content: [{ type: 'text', text: '暂无已安装的 skill' }] };
        const lines = [`已安装 ${results.length} 个 skill:\n`];
        for (const s of results) {
            lines.push(`**${s.name}**${s.description ? ` — ${s.description}` : ''}`);
            if (s.tags) lines.push(`  标签: ${s.tags}`);
        }
        return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
    skill_uninstall: async (a) => {
        if (!a.name) return { content: [{ type: 'text', text: '需要 skill 名称' }], isError: true };
        const skillsDir = path.join(os.homedir(), '.atlisp', 'skills');
        if (!fs.existsSync(skillsDir)) return { content: [{ type: 'text', text: `未安装 skill: ${a.name}` }], isError: true };
        let found = null;
        try {
            const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isFile() && entry.name.endsWith('.md')) {
                    const fullPath = path.join(skillsDir, entry.name);
                    try {
                        const raw = fs.readFileSync(fullPath, 'utf-8');
                        const match = raw.match(/^---\n([\s\S]*?)\n---/);
                        if (match) {
                            for (const line of match[1].split('\n')) {
                                if (line.startsWith('name:') && line.slice(5).trim() === a.name) { found = fullPath; break; }
                            }
                        } else if (entry.name.replace('.md', '') === a.name) { found = fullPath; }
                    } catch {}
                    if (found) break;
                }
            }
        } catch {}
        if (!found) return { content: [{ type: 'text', text: `未安装 skill: ${a.name}` }], isError: true };
        fs.unlinkSync(found);
        return { content: [{ type: 'text', text: `✅ ${a.name} 已卸载` }] };
    },
    skill_list_categories: async () => {
        const registryUrl = process.env.SKILL_REGISTRY_URL || 'https://raw.githubusercontent.com/atlisp/skill-registry/main/index.json';
        const cachePath = path.join(os.homedir(), '.atlisp', 'skill-registry-cache.json');
        let cache = null;
        try { if (fs.existsSync(cachePath)) cache = JSON.parse(fs.readFileSync(cachePath, 'utf-8')); } catch {}
        let index = cache && (Date.now() - cache.fetchedAt < 3600000) ? cache : null;
        if (!index) {
            try {
                const resp = await fetch(registryUrl, { headers: { 'User-Agent': 'atlisp-mcp' } });
                if (resp.ok) {
                    index = await resp.json();
                    try { fs.writeFileSync(cachePath, JSON.stringify(index, null, 2), 'utf-8'); } catch {}
                }
            } catch {}
        }
        if (!index || !index.skills) return { content: [{ type: 'text', text: '无法获取 skill 注册表索引' }], isError: true };
        const cats = new Set();
        for (const s of index.skills) for (const t of (s.tags || [])) cats.add(t);
        const sorted = Array.from(cats).sort();
        return { content: [{ type: 'text', text: sorted.length ? `注册表分类 (${sorted.length}):\n${sorted.join('\n')}` : '暂无分类' }] };
    },
};

export { tools };
