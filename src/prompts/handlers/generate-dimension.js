function getDimensionStyleLisp(style) {
  if (style === 'horizontal' || style === 'vertical') return 'DIMLINEAR';
  return 'DIMALIGNED';
}

function getDimensionStyleLabel(style) {
  if (style === 'horizontal') return '水平';
  if (style === 'vertical') return '垂直';
  return 'aligned';
}

export default async function handler(args) {
  const { style = 'aligned' } = args;
  const lispStyle = getDimensionStyleLisp(style);
  const label = getDimensionStyleLabel(style);
  return {
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: `生成 ${label} 尺寸标注代码：

\`\`\`lisp
(command "_${lispStyle}" "0,0" "1000,0" "500,200" "")
\`\`\`

参数说明：
- 起点: 0,0
- 终点: 1000,0
- 标注位置: 500,200

执行后将创建 ${label} 尺寸标注。`
      }
    }]
  };
}
