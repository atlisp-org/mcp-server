function formatLispPoints(pointsStr) {
  const ptList = String(pointsStr).split(';').map(p => {
    const [x, y] = p.split(',').map(Number);
    return `(list ${x || 0} ${y || 0})`;
  });
  return `(list ${ptList.join(' ')})`;
}

export default async function handler(args) {
  const { action = 'centroid', points = '0,0;100,0;100,100;0,100' } = args;
  const ptsStr = formatLispPoints(points);

  const codeMap = {
    centroid: `(point:centroid ${ptsStr})`,
    convexhull: `(geometry:convexhull-by-graham-scan ${ptsStr})`,
    'dist-point-line': `(progn
  (setq ss (ssget ":S" (list (cons 0 "LINE"))))
  (if ss
    (progn
      (setq e (car (pickset:to-list ss)))
      (setq p1 (cdr (assoc 10 (entget e))))
      (setq p2 (cdr (assoc 11 (entget e))))
      (geometry:dist-pt-line (getpoint "\\n选择测量点: ") (list p1 p2))
    )
  )
)`,
    'in-curve-p': `(progn
  (setq e (car (pickset:to-list (ssget ":S" (list (cons 0 "LWPOLYLINE"))))))
  (if e (point:in-curve-p (getpoint "\\n选择测试点: ") e))
)`,
    transform: `(matrix:transformation (list 0 0 0) (list 2 2 1) 0 (list 0 0 0))`
  };

  const descMap = {
    centroid: `计算 ${points} 的几何中心（质心）`,
    convexhull: `计算 ${points} 的凸包（Graham Scan 算法）`,
    'dist-point-line': '选择一条直线，然后拾取一个点，计算点到直线的距离',
    'in-curve-p': '选择一个闭合 LWPOLYLINE，然后拾取一个点，检测点是否在曲线内部',
    transform: '坐标变换示例：缩放2倍 (matrix:transformation 平移 缩放 旋转 基点)'
  };

  const code = codeMap[action] || codeMap.centroid;
  const desc = descMap[action] || descMap.centroid;

  return {
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: `几何计算：${desc}\n\n\`\`\`lisp\n${code}\n\`\`\`\n\n使用 \`eval_lisp_with_result\` 执行获取结果。`
      }
    }]
  };
}
