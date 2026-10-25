import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const STANDARDS_DIR = path.join(__dirname, '..', 'standards');

// 资源描述约定（写给模型看，不是给人看的文档）：
//   1. 先讲「拿到什么」（返回结构/字段），再讲「什么时候用」，最后讲「参数与注意」。
//   2. 与工具的关系要写明（如「需要事件内容请用 watch_create」），避免模型在资源与工具之间反复试。
//   3. 参数写成 ?k=v 形式，便于直接拼 URI。
export const RESOURCES = [
  {
    uri: 'atlisp://cad/info',
    name: 'CAD Info',
    description: 'CAD 连接概况：connected、platform（AutoCAD/ZWCAD/GStarCAD/BricsCAD）、version、busy。'
      + '用于确认当前连的是哪个 CAD、是否空闲；CAD 未启动时返回 connected=false 且不会自动拉起。'
      + '需要 Worker 状态/熔断/@lisp 就绪等深度诊断时改用 get_system_status 工具。',
    mimeType: 'application/json', subscribable: true,
  },
  {
    uri: 'atlisp://dwg/entities',
    name: 'Entities',
    description: '当前图纸图元。不带参数只返回 {total, summary:[{type,count}]}（按类型直方图，响应小）；'
      + '带任一过滤参数返回 {total, entities:[{ObjectName,Handle,Layer,Color,Linetype,Center,Radius,...}]} 全属性平铺对象。'
      + '参数：?type=LINE（DXF 类型名）、?layer=0（图层名）、?bbox=0,0,100,100（左下/右上角点，大图建议加）。'
      + '只需要统计时不要带参数；按空间关系找图元用 find_entities_in_window 等工具。',
    mimeType: 'application/json', subscribable: true,
  },
  {
    uri: 'atlisp://dwg/text-content',
    name: 'Text Content',
    description: '图纸文字内容与位置 {texts:[{text,plainText,type,layer,position,height,handle}]}，plainText 是清洗后的可读文本。'
      + '适合语义检索图纸内容（说明、图签、标注文字）。参数：?layer=0、?bbox=0,0,100,100、?offset=0&limit=5000'
      + '（limit 默认 5000、上限 5000，超过用 offset 翻页）。需要把碎片文字拼成段落时读 text-combined；'
      + '只找关键词用 find_text 工具。',
    mimeType: 'application/json', subscribable: true,
  },
  {
    uri: 'atlisp://dwg/text-combined',
    name: 'Combined Text',
    description: '把碎片文字按坐标合并成段落 {total, blocks:[{text,y,rowCount,lines}], medianHeight}，'
      + '同一行按 X 排序拼接、跨行未断句时续接。适合读图签/设计说明这类被拆成多个 TEXT 的成段文字。'
      + '参数同 text-content：?layer=0&bbox=0,0,100,100&offset=0&limit=5000。',
    mimeType: 'application/json', subscribable: true,
  },
  {
    uri: 'atlisp://cad/events',
    name: 'CAD Events',
    description: '图纸变更通知入口。订阅本 URI 后，服务端在每个修改图纸的工具执行后推送 '
      + 'notifications/resources/updated（不推送事件内容，客户端收到后重读相关资源）；'
      + '直接读取返回当前快照 {entityCount,dwgName,dwgPath,timestamp}，不含历史事件。'
      + '需要事件内容/回调时用 watch_create 或 webhook_register 工具。',
    mimeType: 'application/json', subscribable: true,
  },
  {
    uri: 'atlisp://dwg/name',
    name: 'DWG Name',
    description: '当前 DWG 文件名 {name}（不含目录，未命名时可能为 Drawing1.dwg）。'
      + '执行 open_dwg/new_document/save_dwg 后本资源会被标记更新。'
      + '要完整路径读 dwg/path，要图纸画像读 dwg/context。',
    mimeType: 'application/json', subscribable: true,
  },
  {
    uri: 'atlisp://dwg/path',
    name: 'DWG Path',
    description: '当前 DWG 的完整路径与文件名 {path,name}。用于确认保存位置，或给其他工具/脚本传文件路径。'
      + '从未保存过的新图 path 可能为空或只有文件名；多文档环境下先读 cad/dwgs 确认活动文档。',
    mimeType: 'application/json', subscribable: true,
  },
  {
    uri: 'atlisp://dwg/block-refs',
    name: 'Block References',
    description: '块参照列表 {total,offset,limit,nextOffset,blockRefs:[{handle,blockName,insertionPoint,scale,rotation,'
      + 'attributes,dynamicProperties,isDynamic,attrReadFailed}]}。'
      + '参数：?offset=0&limit=500（不传 limit 返回全部，limit 上限为 MAX_ENTITY_LIMIT 默认 20000；'
      + 'total 是过滤后的全量条数，翻页请用 nextOffset 而不是 offset+本页条数）。'
      + '路径方式 atlisp://dwg/block-refs/{blockName} 按块名过滤（块名可含 $、中文、空格，需 URL 编码）并可叠加分页参数。'
      + '要块定义清单用 dwg/tbl/block；批量改属性用 set_block_attribute 工具。',
    mimeType: 'application/json', subscribable: true,
  },
  {
    uri: 'atlisp://dwg/tbl',
    name: 'Tables',
    description: 'CAD 符号表数据。不带参数返回全部已支持的表 {layer:{total,data},block:{...},...}（响应大）；'
      + '推荐路径方式 atlisp://dwg/tbl/{table} 只读一张表，返回 {table,total,data}。'
      + 'table 可选：layer(名称/颜色/线型/冻结/锁定/开关)、block(块定义名称/路径/标志)、'
      + 'textstyle(同 style)、dimstyle、linetype(同 ltype)。'
      + '注意：传其它名字会回落成「读全部表」；表数据是只读快照，改图层/样式请用对应工具。',
    mimeType: 'application/json', subscribable: true,
  },
  {
    uri: 'atlisp://cad/dwgs',
    name: 'DWG List',
    description: '所有已打开 DWG 文档列表 [{name,path}]。多图环境下先读本资源再决定操作哪张图；'
      + '切换活动文档用 open_dwg 工具（本资源只列清单，不切换）。',
    mimeType: 'application/json', subscribable: true,
  },
  {
    uri: 'atlisp://packages',
    name: 'Packages',
    description: 'CAD 内已安装 @lisp 包列表 [{name,version,description,fullName,author,category,url,loaded}]。'
      + '参数：?name=base（精确匹配包名）、?search=json（按名称/描述/全名模糊匹配，大小写不敏感）。'
      + '查可安装的包（云端仓库）用 list_packages/search_packages 工具，装包用 install_package。',
    mimeType: 'application/json', subscribable: true,
  },
  {
    uri: 'atlisp://platforms',
    name: 'Platforms',
    description: '支持的 CAD 平台列表及各自可加载的文件扩展名 '
      + '（AutoCAD: .fas/.vlx，ZWCAD: .zelx/.vls，GStarCAD: .fas/.vlx，BricsCAD: .des）。'
      + '静态数据、不需要 CAD 连接；排查连接问题时配合 system/cad-status 一起看。',
    mimeType: 'application/json', subscribable: false,
  },
  {
    uri: 'atlisp://standards/drafting',
    name: 'Drafting Standards',
    description: '通用 CAD 制图规范（drafting.json）：图层命名、颜色、线型、线宽、文字样式、标注样式、打印、文件命名规则。'
      + '既是 check_drawing_standards/generate_compliance_report 的判定依据，也可直接读来了解项目约定。'
      + '按行业分册见 atlisp://standards/{key}（如 architectural/structural/mechanical）。',
    mimeType: 'application/json', subscribable: false,
  },
  {
    uri: 'atlisp://standards/coding',
    name: 'Coding Standards',
    description: '@lisp AutoLISP 编码规范（coding.json）：命名、包结构、文件组织、文档注释、错误处理、'
      + '函数定义、平台兼容、性能、国际化。写或审 AutoLISP 代码前读一遍；可机检的规则用 list_lint_rules 工具查看。',
    mimeType: 'application/json', subscribable: false,
  },
  {
    uri: 'atlisp://dwg/context',
    name: 'DWG Context',
    description: '返回当前图纸上下文摘要（一次聚合、响应小）：docName/docPath/platform/entityCount/layerCount/layerNames，'
      + '外加 extra 里的当前布局(layout)、UCS(ucs)、INSUNITS、LTSCALE、图形界限(limmin/limmax)与范围(extmin/extmax)。'
      + '进入一张陌生图纸时先读它建立单位/范围/图层印象；要实体类型直方图与文字/块统计读 dwg/analysis。',
    mimeType: 'application/json', subscribable: true,
  },
  {
    uri: 'atlisp://tools/relationships',
    name: 'Tool Relationships',
    description: '工具协作关系图：按场景（selection/drawing/editing/batch_ops/export/layers/blocks/analysis）'
      + '给出常用工具及推荐的前后置工具（如 select_entities → batch_delete）。'
      + '规划多步操作链时参考；单个工具的参数与返回值用 get_tool_info 工具查。',
    mimeType: 'application/json', subscribable: false,
  },
  {
    uri: 'atlisp://dwg/analysis',
    name: 'Drawing Analysis',
    description: '当前图纸综合分析（服务端一次聚合）。?type=summary（默认）返回实体总数与类型直方图、'
      + '图层数量与状态、文字数量与字高区间（含 textTypes/textLayers 分布）、块引用统计'
      + '（blockUsage 按 INSERT 真实引用数降序，最多 50 条）、关键系统变量；'
      + '?type=detailed 追加图层明细 layers、块定义明细 blockDefs，且 blockUsage 不截断（响应可达数百 KB）。'
      + '建立图纸画像先用 summary，需要逐条核对再用 detailed。',
    mimeType: 'application/json', subscribable: true,
  },
  {
    uri: 'atlisp://tools/categories',
    name: 'Tool Categories',
    description: '工具分类概览 [{category,count,tools:[name]}]（按工具数降序）。用于了解工具箱全貌与命名；'
      + '具体工具参数用 get_tool_info，按行业浏览用 tools/industries，检索用 search_tools 工具。',
    mimeType: 'application/json', subscribable: false,
  },
  {
    uri: 'atlisp://tools/industries',
    name: 'Tool Industries',
    description: '按行业分组的工具概览 [{industry,count,tools:[...]}]，行业含通用/建筑/结构/机械/电气/暖通给排水/'
      + '土木道桥/制造/测绘/室内装饰/景观园林。?name=建筑 返回该行业的推荐工具集'
      + '（每项含 priority/effectivePriority/hot/usageCount，按优先级与真实调用次数排序）。'
      + '不确定该用哪个工具时按行业找。',
    mimeType: 'application/json', subscribable: false,
  },
  {
    uri: 'atlisp://dwg/standards/check',
    name: 'Drawing Standards Check',
    description: '按已加载的制图规范快速抽查当前图纸：只检查规范中 required 的图层是否存在，'
      + '返回 {ok, issues:[{type,message}]}。不查颜色/线型/字高等细则；'
      + '完整合规检查用 check_drawing_standards 或 generate_compliance_report 工具。',
    mimeType: 'application/json', subscribable: false,
  },
  {
    uri: 'atlisp://standards',
    name: 'Standards Index',
    description: '可用的制图规范清单 [{key,name,version,description,categories}]。'
      + '按 key 读取具体规范：atlisp://standards/{key}，可选 drafting（通用）、coding（编码）、'
      + 'architectural、structural、mechanical、electrical、hvac、civil、surveying、interior、landscape。',
    mimeType: 'application/json', subscribable: false,
  },
  {
    uri: 'atlisp://dwg/frames',
    name: 'Drawing Frames',
    description: '图框识别：列出图纸中的标准图框及其图幅/加长/比例，三条通道——属性块（source="attr-block"，'
      + '优先：INSERT 带属性，比例从图签 比例/出图比例/SCALE 解析，attributes/fields 给原始与归一化键值）、'
      + '非属性块（source="block"，仅 CAD 端 lib 可用时：frame:ref-box 包围盒 + frame:match-all + 图签文字指纹判定）、'
      + '几何（source="polyline"：闭合 4 顶点矩形多段线）。同位置按 attr-block > block > polyline 保留一条。'
      + 'CAD 端装好 @lisp lib 时判定核心调 lib 的 frame:*（多出非属性块通道、包围盒回退、图签散文字补全），'
      + '缺失时回落自包含实现，响应 lib 字段标明本次走的路径。'
      + '支持 ?layer=PUB_TITLE（可逗号分隔多图层，内部按 <OR> 组合）、?minSize=0（最小短边长度，小于此值的候选忽略）、'
      + '?scales=1,50,100（覆盖默认比例表 1/5/10/20/25/30/40/50/70/100/120/150/200/250/300/400/500/1000）、'
      + '?tolRatio=0.0035（宽高比容差，默认即可识别约 0.1% 偏差的加长图幅，如 336400×118800）、'
      + '?tolLen=0.001（短边相对容差）、?includeInner=false（true 则保留并标注内框）、'
      + '?includeUnmatched=true（返回配不上标准表的候选，按面积降序最多 200 条，便于人工复核"很像但没命中"的加长图幅）、'
      + '?offset=0&limit=500（frames 按面积降序后分页，响应含 total/offset/limit/nextOffset，nextOffset>=total 表示没有下一页）。'
      + '响应含 frameCount/unmatchedCount/sources（三条通道条数）与 lib（是否走了 lib 路径）。注意：几何只能给物理尺寸解读（A1@1:100 与 A3@1:200 是同一矩形，'
      + '其余解读在 alternatives），真实出图比例应以图签属性 fields.scale 或图内比例文字为准',
    mimeType: 'application/json',
    subscribable: true,
  },
  {
    uri: 'atlisp://system/cad-status',
    name: 'CAD Status',
    description: '所有 CAD 实例的连接与停滞状态 {active,total,instances:[{key,connected,platform,version,label,'
      + 'queueSize,stall:{stalled,reason,remainingMs},isActive}]}。'
      + '用于判断是否有实例卡死/排队/冷却中、是否需要新开实例；多实例切换用 cad_pool_* 系列工具。',
    mimeType: 'application/json', subscribable: false,
  },
];

// =============================================================================
// 资源模板（resources/templates/list）
//
// 只登记「带变量」的 URI；静态资源在 RESOURCES 里已有完整描述，重复登记只会
// 让 client 看到两份不一致的说明。描述同样面向模型：讲清返回结构与参数取值。
// =============================================================================
export const RESOURCE_TEMPLATES = [
  {
    uriTemplate: 'atlisp://dwg/entity/{handle}',
    name: 'Entity by Handle',
    description: '按句柄读单个实体 {type,handle,layer,color,linetype,elevation}。句柄来自 get_entity / select_entities / '
      + 'dwg/entities 的 Handle 字段；需要端点/圆心/半径等几何细节用 get_entity 工具。',
    mimeType: 'application/json',
  },
  {
    uriTemplate: 'atlisp://dwg/entities{?type,layer,bbox}',
    name: 'Filtered Entities',
    description: '按类型/图层/范围过滤图元，返回 {total, entities:[全属性对象]}（ObjectName/Handle/Layer/Color/Center/Radius 等）。'
      + 'bbox 格式 x1,y1,x2,y2；不带参数只返回 {total,summary} 类型直方图。',
    mimeType: 'application/json',
  },
  {
    uriTemplate: 'atlisp://dwg/text-content{?layer,bbox,offset,limit}',
    name: 'Text Content',
    description: '图纸文字及坐标 {texts:[{text,plainText,type,layer,position,height,handle}]}。'
      + 'limit 默认 5000、上限 5000，超出用 offset 翻页。',
    mimeType: 'application/json',
  },
  {
    uriTemplate: 'atlisp://dwg/text-combined{?layer,bbox,offset,limit}',
    name: 'Combined Text',
    description: '碎片文字按坐标合并为段落 {total,blocks:[{text,y,rowCount,lines}],medianHeight}，适合读图签与设计说明。',
    mimeType: 'application/json',
  },
  {
    uriTemplate: 'atlisp://packages{?name,search}',
    name: 'Package Search',
    description: '已安装 @lisp 包列表：?name=base 精确匹配包名，?search=json 对名称/描述/全名做模糊匹配。'
      + '查可安装的包请用 list_packages 工具。',
    mimeType: 'application/json',
  },
  {
    uriTemplate: 'atlisp://dwg/block-refs/{blockName}{?offset,limit}',
    name: 'Block References',
    description: '按块名读块参照 {total,offset,limit,nextOffset,blockRefs:[...]}（块名含 $/中文/空格需 URL 编码）。'
      + '翻页用返回的 nextOffset，不要用 offset+本页条数。',
    mimeType: 'application/json',
  },
  {
    uriTemplate: 'atlisp://dwg/tbl/{tbl}',
    name: 'CAD Tables',
    description: '读单张符号表 {table,total,data}。tbl 可选 layer/block/textstyle/dimstyle/linetype；'
      + '不带 table 或传其它名字会读全部表（响应大）。',
    mimeType: 'application/json',
  },
  {
    uriTemplate: 'atlisp://dwg/analysis{?type}',
    name: 'Drawing Analysis',
    description: '图纸综合分析：?type=summary（默认）返回实体/图层/文字/块引用计数与系统变量；'
      + '?type=detailed 追加图层与块定义明细（响应可达数百 KB）。',
    mimeType: 'application/json',
  },
  {
    uriTemplate: 'atlisp://dwg/frames{?layer,minSize,scales,offset,limit,includeInner,includeUnmatched}',
    name: 'Drawing Frames',
    description: '图框识别 {frames,unmatched,sources,lib,...}：按图层/比例表/宽高比容差过滤，支持分页与「像但没命中」候选复核。',
    mimeType: 'application/json',
  },
  {
    uriTemplate: 'atlisp://tools/industries{?name}',
    name: 'Tool Industries',
    description: '按行业浏览工具：不带参数列各行业的工具数量；?name=建筑 返回该行业推荐工具集'
      + '（含 priority/usageCount，按优先级与真实调用次数排序）。',
    mimeType: 'application/json',
  },
  {
    uriTemplate: 'atlisp://standards/{standard}',
    name: 'Industry Standards',
    description: '按 key 读制图/编码规范：drafting（通用）、coding（编码）、architectural、structural、mechanical、'
      + 'electrical、hvac、civil、surveying、interior、landscape。未知 key 返回可用列表。',
    mimeType: 'application/json',
  },
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
