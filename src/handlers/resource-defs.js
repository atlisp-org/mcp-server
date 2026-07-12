import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const STANDARDS_DIR = path.join(__dirname, '..', 'standards');

export const RESOURCES = [
  { uri: 'atlisp://cad/info', name: 'CAD Info', description: 'CAD 连接信息', mimeType: 'application/json', subscribable: true },
  { uri: 'atlisp://dwg/entities', name: 'Entities', description: '图元列表。无参数时返回总数和按类型统计；有参数时返回 filtered 图文的 entity:properties 全属性 JSON（ObjectName, Handle, Layer, Color, Center, Radius 等），支持 ?type=LINE&layer=0&bbox=0,0,100,100', mimeType: 'application/json', subscribable: true },
  { uri: 'atlisp://dwg/text-content', name: 'Text Content', description: '文本内容及位置，用于语义分析。支持 ?layer=0&bbox=0,0,100,100&limit=5000&offset=0', mimeType: 'application/json', subscribable: true },
  { uri: 'atlisp://dwg/text-combined', name: 'Combined Text', description: '碎片文本按位置组合为段落，跨行续句拼接。支持 ?layer=0&bbox=0,0,100,100', mimeType: 'application/json', subscribable: true },
  { uri: 'atlisp://cad/events', name: 'CAD Events', description: 'CAD 变更事件通知 (实体创建/修改/删除, DWG 切换)', mimeType: 'application/json', subscribable: true },
  { uri: 'atlisp://dwg/name', name: 'DWG Name', description: '当前 DWG 文件名', mimeType: 'application/json', subscribable: true },
  { uri: 'atlisp://dwg/path', name: 'DWG Path', description: '文件完整路径', mimeType: 'application/json', subscribable: true },
  { uri: 'atlisp://dwg/block-refs', name: 'Block References', description: '块参照列表及属性值、动态块特性，支持路径方式 atlisp://dwg/block-refs/{blockName}', mimeType: 'application/json', subscribable: true },
  { uri: 'atlisp://dwg/tbl', name: 'Tables', description: 'CAD 表数据 (layer, block, textstyle, dimstyle, linetype, ucs, view, viewport, regapp)，支持路径方式 atlisp://dwg/tbl/layer', mimeType: 'application/json', subscribable: true },
  { uri: 'atlisp://cad/dwgs', name: 'DWG List', description: '所有打开的 DWG 文件列表', mimeType: 'application/json', subscribable: true },
  { uri: 'atlisp://packages', name: 'Packages', description: '已安装包列表', mimeType: 'application/json', subscribable: true },
  { uri: 'atlisp://platforms', name: 'Platforms', description: '支持的平台信息', mimeType: 'application/json', subscribable: false },
  { uri: 'atlisp://standards/drafting', name: 'Drafting Standards', description: 'CAD 制图规范', mimeType: 'application/json', subscribable: false },
  { uri: 'atlisp://standards/coding', name: 'Coding Standards', description: '@lisp 编码规范', mimeType: 'application/json', subscribable: false },
  { uri: 'atlisp://dwg/context', name: 'DWG Context', description: '当前图纸上下文摘要。返回文档名/路径/布局/UCS/图层列表/实体统计/系统变量组合信息，帮助快速了解当前 CAD 状态', mimeType: 'application/json', subscribable: true },
  { uri: 'atlisp://tools/relationships', name: 'Tool Relationships', description: '工具依赖关系图。描述工具间的调用链关系（如 select_entities → batch_delete），帮助理解工具组合使用方式', mimeType: 'application/json', subscribable: false },
  { uri: 'atlisp://dwg/analysis', name: 'Drawing Analysis', description: '当前图纸综合分析：实体类型统计、块使用统计、图层摘要、文字统计、系统变量快照。支持 ?type=summary（默认）或 ?type=detailed', mimeType: 'application/json', subscribable: true },
  { uri: 'atlisp://tools/categories', name: 'Tool Categories', description: '工具分类概览。列出所有分类及其包含的工具数量', mimeType: 'application/json', subscribable: false },
  { uri: 'atlisp://dwg/standards/check', name: 'Drawing Standards Check', description: '检查当前图纸是否符合加载的制图规范（图层命名、颜色、线型等规则）', mimeType: 'application/json', subscribable: false },
];

export const TBL_INFO = {
  layer: { name: '图层', fields: ['name', 'color', 'linetype', 'frozen', 'locked', 'on'] },
  block: { name: '块定义', fields: ['name', 'path', 'flags'] },
  textstyle: { name: '文字样式', fields: ['name', 'font', 'bigfont', 'height', 'width', 'oblique', 'flags'] },
  dimstyle: { name: '标注样式', fields: ['name', 'arrow', 'textheight', 'scale'] },
  linetype: { name: '线型', fields: ['name', 'description', 'pattern'] },
  ucs: { name: 'UCS', fields: ['name', 'origin', 'xaxis', 'yaxis'] },
  view: { name: '视图', fields: ['name', 'center', 'height', 'width'] },
  viewport: { name: '视口', fields: ['name', 'number', 'flags'] },
  regapp: { name: '注册应用', fields: ['name'] },
  plotstyle: { name: '打印样式', fields: ['name'] },
};

export const TBL_QUERIES = {
  layer: { name: 'layer', lisp: `(progn
(setq @d nil)
(setq @e (tblnext "layer" t))
(while @e
  (setq @d (cons (list
    (cons 2 (cdr (assoc 2 @e)))
    (cons 62 (cdr (assoc 62 @e)))
    (cons 6 (cdr (assoc 6 @e)))
    (cons 70 (cdr (assoc 70 @e)))
    (cons 60 (if (< (cdr (assoc 62 @e)) 0) 1 0))
  ) @d))
  (setq @e (tblnext "layer" nil)))
(list (cons 'table 'layer) (cons 'total (length @d)) (cons 'data (list (reverse @d)))))` },
  block: { name: 'block', lisp: `(progn
(setq @d nil)
(vlax-for e (vla-get-blocks (vla-get-activedocument (vlax-get-acad-object)))
  (if (not (and (vlax-property-available-p e 'isfoundation) (vlax-get e 'isfoundation)))
    (setq @d (cons (@:get-props e '("Name" "Count" "Handle" "ObjectName" "IsXRef" "IsXRefOverlay" "IsDynamicBlock" "HasAttributes" "HasExtensionDictionary" "Path" "Description" "Layout" "BlockScope")) @d))))
(list (cons 'table 'block) (cons 'total (length @d)) (cons 'data (list (reverse @d)))))` },
  style: { name: 'style', lisp: `(progn
(setq @d nil)
(vlax-for e (vla-get-textstyles (vla-get-activedocument (vlax-get-acad-object)))
  (setq @d (cons (@:get-props e '("Name" "FontFile" "BigFontFile" "Height" "Width" "ObliqueAngle" "TextGenerationFlag" "Handle" "ObjectName")) @d)))
(list (cons 'table 'style) (cons 'total (length @d)) (cons 'data (list (reverse @d)))))` },
  dimstyle: { name: 'dimstyle', lisp: `(progn
(setq @d nil)
(vlax-for e (vla-get-dimstyles (vla-get-activedocument (vlax-get-acad-object)))
  (setq @d (cons (@:get-props e '("Name" "Handle" "ObjectName")) @d)))
(list (cons 'table 'dimstyle) (cons 'total (length @d)) (cons 'data (list (reverse @d)))))` },
  ltype: { name: 'linetype', lisp: `(progn
(setq @d nil)
(vlax-for e (vla-get-linetypes (vla-get-activedocument (vlax-get-acad-object)))
  (setq @d (cons (@:get-props e '("Name" "Description" "PatternLength" "Handle" "ObjectName")) @d)))
(list (cons 'table 'linetype) (cons 'total (length @d)) (cons 'data (list (reverse @d)))))` },
};

export const TBL_KEY_ALIAS = {
  textstyle: 'style',
  textstyles: 'style',
  linetype: 'ltype',
};
