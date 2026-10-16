import { checkDrawingStandards, listStandards } from '../handlers/standards-handlers.js';

export async function handler(params = {}) {
  const { industry = '通用', categories = 'all', strict = 'false' } = params;
  
  const categoryList = categories === 'all' 
    ? ['layers', 'colors', 'linetypes', 'lineweights', 'textstyles', 'dimstyles', 'file_naming']
    : categories.split(',').map(c => c.trim());
  
  const strictMode = strict === 'true';
  
  const result = await checkDrawingStandards({
    industry,
    categories: categoryList,
    strict: strictMode
  });
  
  const standardsList = await listStandards({});
  
  const response = {
    message: `正在检查图纸是否符合${industry}行业制图规范...`,
    checkResult: result,
    availableStandards: standardsList.standards || [],
    recommendations: []
  };
  
  if (result.ok) {
    response.recommendations.push('图纸符合规范要求');
  } else {
    const errors = result.issues.filter(i => i.severity === 'error');
    const warnings = result.issues.filter(i => i.severity === 'warning');
    
    if (errors.length > 0) {
      response.recommendations.push(`发现 ${errors.length} 个错误，需要修复`);
    }
    if (warnings.length > 0) {
      response.recommendations.push(`发现 ${warnings.length} 个警告，建议修复`);
    }
    
    response.recommendations.push('可以使用 apply_standards_template 工具应用标准模板');
    response.recommendations.push('可以使用 generate_compliance_report 工具生成详细报告');
  }
  
  return response;
}
