# @lisp MCP Server 完整函数参考

## 概述

AI Agent 通过 MCP 协议与 CAD (AutoCAD/ZWCAD/GStarCAD/BricsCAD) 交互。以下函数均来自 `@lisp` 标准库，使用时需先 `(in-package :@)` 或加包名前缀调用。

## 连接 CAD

```
工具: connect_cad
```

## 可用工具

### 1. eval_lisp - 执行代码（无返回值）
### 2. eval_lisp_with_result - 执行代码并返回结果
### 3. get_cad_info / get_platform_info - 获取CAD/平台信息
### 4. list_packages / search_packages / install_package - 包管理
### 5. import_funlib - 导入函数库数据到 AI Agent（格式: json 或 list）

---

## @lisp 标准库函数速查（66个包）

### 1. entity - 实体创建与操作（核心包，62个文件）

```lisp
;; 获取DXF组码
(entity:getdxf ename 0)                    ;; 获取类型
(entity:getdxf ename '(0 8 62 10))         ;; 获取多组码

;; 修改DXF组码
(entity:putdxf ename 8 "NEW-LAYER")        ;; 改图层
(entity:putdxf ename 62 1)                 ;; 改颜色（ACI）

;; 边界框
(entity:getbox ent)                        ;; 获取最小包围盒
(entity:getbox ent 100)                    ;; 带偏移

;; 创建实体
(entity:make-circle (list 0 0) 50)         ;; 画圆
(entity:make-lwpolyline pts nil 0 nil 0)   ;; 画多段线
(entity:addtext "文本" (list 0 0) 100 0)   ;; 添加文字
(entity:make-mtext "多行文本" (list 0 0) 200 0)
```

### 2. layer - 图层管理（23个文件）

```lisp
(layer:list)                               ;; 列出所有图层
(layer:make "WALL" 1 "Continuous" 0)       ;; 创建图层（颜色1=红）
(layer:freeze '("WALL" "DOOR") 1)          ;; 冻结
(layer:thaw '("WALL") 1)                   ;; 解冻
(layer:lock '("WALL") 1)                   ;; 锁定
(layer:unlock '("WALL") 1)                 ;; 解锁
(layer:off '("WALL"))                      ;; 关闭
(layer:on '("WALL"))                       ;; 打开
(layer:set-color "WALL" 3)                 ;; 设颜色（ACI）
(layer:delete "OLD-LAYER")                 ;; 删除
```

### 3. block - 块操作（22个文件）

```lisp
(block:list)                               ;; 列出所有块定义
(block:insert "块名" "dwg路径" pt 0 1)     ;; 插入块
(block:get-attributes blkref)              ;; 获取属性 (tag . value)
(block:set-attributes blkref lst)          ;; 设置属性
(block:get-dynamic-properties blk)         ;; 动态块属性
(block:set-dynprop blk "宽度" 2000)        ;; 设置动态块参数
(block:get-effectivename blkref)           ;; 动态块实际名称
```

### 4. curve - 曲线分析（45个文件）

```lisp
(curve:inters obj1 obj2 0)                 ;; 求交点（0=不延伸）
(curve:join entlst 100)                    ;; 合并线段（PEDIT Join）
(curve:subsegments obj)                    ;; 获取子段数
(curve:subsegment-points obj param)        ;; 获取子段端点
(curve:pickclosepointto obj pt)            ;; 曲线上最近点
```

### 5. pickset - 选择集操作（34个文件）

```lisp
(pickset:to-list ss)                       ;; 选择集→ename列表
(pickset:to-vlalist ss)                    ;; 选择集→vla-object列表
(pickset:getbox ss 0)                      ;; 选择集包围盒
(pickset:erase ss)                         ;; 删除选择集中所有实体
(pickset:join ss1 ss2)                     ;; 合并选择集
(pickset:intersect ss1 ss2)                ;; 交集
(pickset:sub ss1 ss2)                      ;; 差集
(pickset:ssget "选择对象: " nil)           ;; 提示用户选择
(pickset:sort-by-box ss)                   ;; 按包围盒排序
(pickset:zoom ss)                          ;; 缩放到选择集
```

### 6. string - 字符串处理（38个文件）

```lisp
(string:format "Hello, {0}!" (list "World"))     ;; 格式化
(string:split "a,b,c" ",")                       ;; 拆分（支持多字符分隔符）
(string:to-list "a,b,c" ",")                     ;; 拆分到列表（单分隔符）
(string:subst-all "new" "old" "old-old-text")    ;; 全部替换
(string:trim-space "  text  ")                   ;; 去除首尾空格
(string:ltrim "  text")                          ;; 左去空格
(string:rtrim "text  ")                          ;; 右去空格
(string:number2chinese 12345)                    ;; 数字→中文大写
(string:regexp-search "\\d+" "abc123def456")     ;; 正则搜索
(string:regexp-replace "\\d+" "a1b2" "X")        ;; 正则替换
(string:from-list '("a" "b" "c") ",")            ;; 列表→字符串
```

### 7. list - 列表操作（58个文件）

```lisp
(list:sort '(3 1 4 1 5 9) '<)                    ;; 无损排序
(list:flatten '((1 2) (3 (4 5))))                ;; 展平嵌套列表
(list:split '(1 2 3 4 5 6) 2)                    ;; 分组：(1 2) (3 4) (5 6)
(list:split-2d '(1 2 3 4 5 6))                   ;; 平展→二维点
(list:delsame '(1 2 2 3 3 3))                    ;; 去重
(list:intersect '(1 2 3) '(2 3 4))               ;; 交集
(list:union '(1 2 3) '(2 3 4))                   ;; 并集
(list:difference '(1 2 3) '(2 3 4))              ;; 差集
(list:group-by '("a1" "b1" "a2") (function (lambda (x) (substr x 1 1))))  ;; 按首字母分组
(list:insert-nth '(1 3 4) 1 2)                   ;; 插入到索引
(list:remove-nth '(1 2 3 4) 1)                   ;; 删除索引
```

### 8. m - 数学函数（59个文件）

```lisp
(m:random 100)                                   ;; 随机数 [0,100)
(m:rtos 3.14159 2)                               ;; 四舍五入保留2位
(m:gcd 12 18)                                    ;; 最大公约数
(m:factorial 5)                                  ;; 阶乘
(m:sinh 1.0) (m:cosh 1.0) (m:tanh 1.0)          ;; 双曲函数
(m:arsinh 1.0)                                   ;; 反双曲
(m:decimal-to-fraction 0.75)                     ;; 小数→分数
(m:reduce-fraction 6 8)                          ;; 约分
(m:dec2base 255 16)                              ;; 十进制→十六进制
(m:base2dec "FF" 16)                             ;; 十六进制→十进制
```

### 9. point - 点坐标处理（10个文件）

```lisp
(point:mid '(0 0) '(100 100))                    ;; 中点
(point:centroid '((0 0) (100 0) (100 100) (0 100)))  ;; 质心
(point:in-curve-p pt ename)                      ;; 点是否在闭合曲线内
(point:in-box pt p1 p2)                          ;; 点是否在矩形内
(point:div '(0 0) '(100 0) 5)                    ;; 等分线段
(point:2d-to-3d '(1 2))                          ;; 转3D
(point:3d-to-2d '(1 2 3))                        ;; 转2D
```

### 10. geometry - 几何计算（16个文件）

```lisp
(geometry:angle '((0 0) (100 100)))              ;; 线段与轴夹角
(geometry:convexhull-by-graham-scan pts)         ;; 凸包（Graham Scan）
(geometry:convexhull-by-jarvis pts)              ;; 凸包（Jarvis March）
(geometry:dist-pt-line pt '(p1 p2))              ;; 点到直线距离
(geometry:transform '(0 0) '(2 2) 0 '(0 0))      ;; 坐标变换
(geometry:turn-left-p p1 p2 p3)                  ;; 左转检测
(geometry:box-intersectp box1 box2)              ;; 矩形相交检测
```

### 11. matrix - 矩阵变换（20个文件）

```lisp
(matrix:mxm m q)                                 ;; 矩阵乘法
(matrix:mxv m v)                                 ;; 矩阵×向量
(matrix:trp m)                                   ;; 矩阵转置
(matrix:rotation-x angle)                        ;; X轴旋转矩阵
(matrix:rotation-y angle)                        ;; Y轴旋转矩阵
(matrix:rotation-z angle)                        ;; Z轴旋转矩阵
(matrix:translation '(100 0 0))                  ;; 平移矩阵
(matrix:scale '(2 2 1))                          ;; 缩放矩阵
(matrix:transformation '(0 0 0) '(2 2 1) 0 '(0 0 0))  ;; 综合变换
```

### 12. color - 颜色转换（8个文件）

```lisp
(color:aci2rgb 1)                                ;; ACI→RGB (1=红 → (255 0 0))
(color:rgb 255 0 0)                              ;; 计算RGB合成值
(color:rgb2css '(255 0 0))                       ;; RGB→CSS (#FF0000)
(color:truecolor2rgb 16711680)                   ;; TrueColor→RGB
(color:rgb2truecolor '(255 0 0))                 ;; RGB→TrueColor
```

### 13. json - JSON编解码（5个文件）

```lisp
(json:encode-from-alist '((name . "客厅") (area . 45.5)))  ;; alist→JSON
(json:decode-json-from-string "{\"name\":\"客厅\"}")       ;; JSON→alist（服务器API）
(json:parse "{\"key\":\"val\"}")                           ;; 纯Lisp解析（无需服务器）
```

### 14. text - MTEXT处理（11个文件）

```lisp
(text:box ent-text)                              ;; 文字包围盒
(text:parse-mtext str)                           ;; 解析MTEXT格式码
(text:remove-fmt str)                            ;; 去除MTEXT格式
(text:from-markdown "**粗体** 文本")             ;; Markdown→MTEXT
(text:mtext2text ename)                          ;; MTEXT→多个TEXT
```

### 15. stat - 统计（5个文件）

```lisp
(stat:stat '(A A B C C C))                      ;; 频次统计 → ((A . 2) (B . 1) (C . 3))
(stat:classify '((A . 10) (B . 20) (A . 5)))    ;; 分组求和 → ((A . 15) (B . 20))
(stat:mode '(1 2 2 3 3 3))                      ;; 众数
(stat:print lst)                                 ;; 表格打印
```

### 16. ui - 界面交互（18个文件）

```lisp
(ui:select "选择图层" '("WALL" "DOOR" "WINDOW"))  ;; 单选列表
(ui:input "用户登录" '(("用户名" string) ("密码" password)))  ;; 多字段输入
(ui:confirm '("确认删除？" "确定" "取消"))           ;; 确认框
(ui:progress current max)                           ;; 进度条
(ui:dyndraw ents pt-base)                           ;; 动态拖拽
(ui:dynquery func)                                  ;; 动态查询
```

### 17. cl - Common Lisp兼容函数（5个文件）

```lisp
(cl:acons key value alist)                        ;; alist添加键值对
(cl:format nil "~A + ~A = ~A" (list 1 2 3))      ;; CL格式字符串
(cl:pairlis '(A B) '(1 2))                        ;; 并行列表→alist
(cl:rassoc value alist)                            ;; 按值反向搜索alist
```

### 18. excel - Excel自动化（33个文件）

```lisp
(setq xl (excel:new t))                           ;; 新建Excel（隐藏）
(setq xl (excel:open "d:/data.xlsx" nil))         ;; 打开Excel（显示）
(excel:get-rangevalue xl 1)                       ;; 获取A1单元格
(excel:get-rangevalue xl '(1 1))                  ;; 获取第1行第1列
(excel:set-rangevalue xl "A1" "标题")             ;; 设置A1
(excel:add-sheet xl "Sheet2")                     ;; 添加工作表
(excel:save xl)                                   ;; 保存
(excel:saveas xl "d:/out.xlsx")                   ;; 另存为
(excel:quit xl)                                   ;; 关闭Excel
```

### 19. word - Word自动化（7个文件）

```lisp
(setq wd (word:new nil))                          ;; 新建Word（显示）
(setq wd (word:open "d:/doc.docx" t))             ;; 打开Word（隐藏）
(word:write-line wd "Hello World")                ;; 写入文本
(word:save wd "d:/out.docx")                      ;; 保存
(word:quit wd)                                    ;; 关闭Word
```

### 20. datetime - 日期时间（11个文件）

```lisp
(datetime:current-time "yyyy-mm-dd HH:MM:SS")     ;; 当前时间
(datetime:mktime '2024 1 1 0 0 0)                ;; → Unix时间戳
(datetime:rfc1123-to-lisp "Mon, 01 Jan 2024 00:00:00 GMT")  ;; RFC1123→Lisp列表
(datetime:leap-yearp 2024)                        ;; 闰年检测
```

### 21. re - 正则表达式（3个文件，基于VBScript.RegExp）

```lisp
(re:match "\\d+" "abc123")                        ;; 匹配 → ("123")
(re:search "\\d+" "abc123def456")                 ;; 搜索 → 匹配信息
(re:replace "\\d+" "a1b2" "X")                    ;; 替换 → "aXbX"
```

### 22. ini - INI文件处理（5个文件）

```lisp
(setq ini (ini:parse "config.ini"))               ;; 解析INI→alist
(ini:get ini "section" "key")                     ;; 读取INI值
(ini:set ini "section" "key" "value")             ;; 设置INI值
(ini:save ini "config.ini")                       ;; 保存INI
```

### 23. base64 - Base64编解码（4个文件）

```lisp
(base64:encode '(72 101 108 108 111))             ;; 编码
(base64:decode "SGVsbG8=")                        ;; 解码
(base64:encode-from-file "d:/file.dat")           ;; 文件→Base64
(base64:base64-to-file str "d:/out.dat")          ;; Base64→文件
```

### 24. clipboard - 系统剪贴板（4个文件）

```lisp
(clipboard:init)                                   ;; 初始化
(clipboard:setdata "text")                        ;; 设置剪贴板
(clipboard:getdata)                                ;; 获取剪贴板内容
(clipboard:cleardata)                              ;; 清空剪贴板
```

### 25. DCL对话框（25个文件）

```lisp
(dcl:dialog "mydlg")                              ;; 创建DCL对话框
(dcl:new "mydlg")                                 ;; 加载DCL
(dcl:show)                                        ;; 显示对话框
(dcl:button key label width height)               ;; 按钮
(dcl:text key label width height)                 ;; 文本
(dcl:input key label width)                       ;; 输入框
```

### 26. 其他实用包

```lisp
;; 文件操作
(file:merge "out.lsp" '("a.lsp" "b.lsp"))        ;; 合并文件
(file:parse-ini "config.ini")                     ;; 解析INI
(file:read-stream fh)                             ;; 读二进制流

;; 符号表
(tbl:list "LAYER")                                 ;; 列出图层
(tbl:list "BLOCK")                                 ;; 列出块
(tbl:list "DIMSTYLE")                              ;; 列出标注样式
(tbl:rename "LAYER" "old" "new")                  ;; 重命名表项

;; 布局
(layout:list)                                      ;; 列出布局
(layout:rename "布局1" "新布局")                   ;; 重命名布局
(layout:make-viewport '(0 0) '(1000 800))          ;; 创建视口

;; 组
(group:make '(e1 e2) "GROUP1")                    ;; 创建组
(group:list)                                       ;; 列出组
(group:to-entlist group)                           ;; 组→实体列表

;; 硬件信息
(hdinfo:get-hd-serial)                             ;; 硬盘序列号
(hdinfo:get-mac)                                   ;; MAC地址
(hdinfo:get-cpuid)                                 ;; CPU ID

;; 系统
(system:dir "c:/temp")                             ;; 列出目录
(system:explorer "c:/temp")                        ;; 打开文件夹
(system:python "print('hello')")                   ;; 执行Python
(system:which "notepad.exe")                       ;; 查找可执行文件
(system:platform)                                  ;; Windows版本信息

;; 表/CSV
(table:make pt "标题" '("列1" "列2") data)        ;; 创建CAD表格
(table:read-csv "data.csv")                        ;; 读取CSV
(table:write-csv "out.csv" lst)                   ;; 写入CSV

;; SVG导出
(svg:export ss "d:/output.svg")                    ;; 导出SVG

;; 扩展数据
(xdata:put ename "MYAPP" '("data" 100 1.5))       ;; 附加XData
(xdata:delete ename)                                ;; 删除XData

;; CAD环境
(std:catchapply fun args)                          ;; 安全执行函数
(std:undo doc)                                     ;; 撤销标记
(std:addmenu "MG" "弹出" '("CMD1" "CMD2") "*")    ;; 添加菜单
```

### 27. 包前缀速查

```
:@       - @lisp全局命名空间
entity:  - 实体操作          layer:   - 图层操作
block:   - 块操作            curve:   - 曲线分析
pickset: - 选择集            string:  - 字符串
list:    - 列表操作          m:       - 数学
point:   - 点坐标            geometry:- 几何
matrix:  - 矩阵变换          color:   - 颜色
json:    - JSON编解码        text:    - 文本处理
stat:    - 统计              ui:      - 界面交互
cl:      - Common Lisp       excel:   - Excel
word:    - Word              datetime:- 日期时间
re:      - 正则表达式        ini:     - INI文件
base64:  - Base64编解码      clipboard:- 剪贴板
dcl:     - 对话框            system:  - 系统工具
table:   - CAD表格/CSV       svg:     - SVG导出
xdata:   - 扩展数据          group:   - 组管理
layout:  - 布局管理          std:     - 系统工具
hdinfo:  - 硬件信息          file:    - 文件操作
tbl:     - 符号表            p:       - 类型判断
```

---

## @lisp MCP 内置 Prompts

MCP Server 提供以下预定义 prompts（可在支持 MCP prompts 的客户端中使用）：

| Prompt | 功能 | 参数 |
|--------|------|------|
| `draw-residential` | 生成农村民居平面布置图 | width, depth, rooms |
| `draw-floor-plan` | 生成建筑楼层平面图 | floor, scale |
| `analyze-drawing` | 分析当前图纸统计信息 | 无 |
| `batch-draw-lines` | 批量绘制线段 | count, length |
| `generate-dimension` | 生成尺寸标注 | style |
| `export-entities` | 导出图纸实体统计 | format |
| `manage-layers` | 图层管理 | action, layers, color |
| `manage-blocks` | 块操作 | action, blockName, insertPoint, scale |
| `curve-analysis` | 曲线分析 | action, distance |
| `geometry-calc` | 几何计算 | action, points |
| `text-process` | 文本处理 | action, markdown |
| `pickset-filter` | 选择集操作 | action, dxfType, layerName |
| `color-convert` | 颜色转换 | action, value |
| `json-exchange` | JSON 数据交换 | action, data |
| `excel-report` | Excel 报表 | visible, savePath |
| `string-process` | 字符串处理 | action, input, arg1, arg2 |

---

## 典型工作流

### 图纸实体统计流程
```
1. connect_cad → 连接到 CAD
2. eval_lisp_with_result → (stat:stat (mapcar (function (lambda (x) (cdr (assoc 0 (entget x))))) (pickset:to-list (ssget "_X"))))
3. 分析返回的实体类型分布
```

### 图层整理流程
```
1. eval_lisp_with_result → (layer:list)
2. eval_lisp → (layer:freeze '("图层1" "图层2") 1)
3. eval_lisp → (layer:lock '("图层3") 1)
4. eval_lisp_with_result 再次验证
```

### Excel报表导出流程
```
1. eval_lisp_with_result → 统计实体数据
2. eval_lisp → 创建Excel并写入数据
3. eval_lisp_with_result → 确认保存路径
```

---

## 注意事项

1. **包前缀**：调用 @lisp 库函数时需加包名前缀，如 `entity:make-circle`
2. **括号匹配**：发送 LISP 代码前确保括号匹配
3. **中文字符**：包含中文的结果用 `vl-princ-to-string` 处理
4. **CAD 状态**：确保 CAD 已启动且文档已打开
5. **仅 Windows**：MCP Server 依赖 COM 互操作，仅支持 Windows
6. **import_funlib**：可用此工具将完整函数库导入 AI 上下文
