import { applyStandardsTemplate, loadStandards } from '../handlers/standards-handlers.js';

export async function handler(params = {}) {
  const { industry, overwrite = 'false' } = params;
  
  if (!industry) {
    return {
      message: '请指定行业模板',
      error: '必须指定 industry 参数',
      availableIndustries: ['建筑', '结构', '机械', '电气', '暖通给排水', '土木道桥', '测绘', '室内装饰', '景观园林']
    };
  }
  
  const overwriteMode = overwrite === 'true';
  
  const standardsResult = await loadStandards({ industry });
  if (!standardsResult.ok) {
    return {
      message: `加载${industry}行业规范失败`,
      error: standardsResult.error
    };
  }
  
  const result = await applyStandardsTemplate({
    industry,
    overwrite: overwriteMode
  });
  
  const response = {
    message: `正在应用${industry}行业制图规范模板...`,
    result: result,
    recommendations: []
  };
  
  if (result.ok) {
    response.recommendations.push(`成功应用${industry}行业模板`);
    if (result.appliedCount > 0) {
      response.recommendations.push(`创建/更新了 ${result.appliedCount} 个项目`);
    }
    if (result.skippedCount > 0) {
      response.recommendations.push(`跳过了 ${result.skippedCount} 个已存在的项目`);
    }
    response.recommendations.push('建议使用 check_drawing_standards 验证应用结果');
  } else {
    response.recommendations.push('应用模板失败，请检查错误信息');
  }
  
  return response;
}
