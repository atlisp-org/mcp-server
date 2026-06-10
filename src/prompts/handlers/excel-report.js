export default async function handler(args) {
  const { visible = 'false', savePath = '' } = args;
  const code = `(progn
  ;; 1. 统计图纸实体
  (setq ss (ssget "_X"))
  (setq elst (if ss (pickset:to-list ss) nil))
  (setq type-count (if elst (stat:stat (mapcar (function (lambda (x) (cdr (assoc 0 (entget x))))) elst)) nil))
  
  ;; 2. 创建Excel
  (setq xl (excel:new ${visible === 'true' ? 'nil' : 't'}))
  
  ;; 3. 写表头
  (excel:set-rangevalue xl 1 "实体类型")
  (excel:set-rangevalue xl "B1" "数量")
  
  ;; 4. 写入数据
  (setq row 2)
  (foreach item type-count
    (excel:set-rangevalue xl (list row 1) (car item))
    (excel:set-rangevalue xl (list row 2) (cdr item))
    (setq row (1+ row))
  )
  
  ;; 5. 获取图层列表
  (setq layers (layer:list))
  (excel:set-rangevalue xl (list 1 4) "图层列表")
  (setq row 2)
  (foreach lay layers
    (excel:set-rangevalue xl (list row 4) lay)
    (setq row (1+ row))
  )
  
  ${savePath ? `(excel:saveas xl "${savePath}")` : ''}
  (princ (strcat "Excel报表已生成，共 " (itoa (1- row)) " 行数据"))
)`;

  return {
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: `导出CAD实体统计到Excel报表：

\`\`\`lisp
${code}
\`\`\`
${savePath ? `\n保存路径: ${savePath}` : '\n注意：请替换Excel为可见模式后手动保存'}

使用 \`eval_lisp\` 执行。`
      }
    }]
  };
}
