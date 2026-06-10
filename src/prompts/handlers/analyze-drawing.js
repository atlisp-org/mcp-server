import { cad } from '../../cad.js';

export default async function handler(args) {
  let entities = { total: 0, byType: {} };
  let layers = [];
  try {
    if (cad.connected) {
      const entResult = await cad.sendCommandWithResult(
        '(progn(setq ss(ssget "_X"))(if ss(progn(setq elst(mapcar(quote(lambda(x)(cdr(assoc 0(entget x))))) (pickset:to-list ss)))(stat:stat elst))))'
      );
      if (entResult) {
        try { entities = JSON.parse(entResult); } catch {}
      }
      const layerResult = await cad.sendCommandWithResult(
        '(progn(setq res nil)(while(setq e(tblnext "LAYER"(null res)))(setq res(cons(cdr(assoc 2 e))res)))(reverse res))'
      );
      if (layerResult) {
        try { layers = JSON.parse(layerResult); } catch {}
      }
    }
  } catch {}

  const suggestions = [];
  if (entities.total > 1000) suggestions.push('- 图纸实体较多，建议使用图层分类管理');
  if (layers.length > 20) suggestions.push('- 图层较多，建议清理未使用的图层');
  if (entities.byType.LINE && entities.byType.LINE > 500) suggestions.push('- 线条较多，可考虑使用 BLOCK 减少实体数量');
  if (!entities.byType.DIMENSION) suggestions.push('- 未发现尺寸标注，建议添加标注');

  return {
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: `图纸分析报告：

**实体统计：** ${entities.total} 个
${Object.entries(entities.byType).map(([t, c]) => `- ${t}: ${c}`).join('\n')}

**图层列表：** ${layers.length} 个
${layers.slice(0, 10).join(', ')}${layers.length > 10 ? '...' : ''}

**建议：**
${suggestions.length ? suggestions.join('\n') : '- 图纸结构良好'}`
      }
    }]
  };
}
