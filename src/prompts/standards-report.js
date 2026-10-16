import { generateComplianceReport } from '../handlers/standards-handlers.js';

export async function handler(params = {}) {
  const { industry = '通用', format = 'json', outputFile } = params;
  
  const result = await generateComplianceReport({
    industry,
    format,
    outputFile
  });
  
  const response = {
    message: `正在生成${industry}行业制图规范合规报告...`,
    result: result,
    recommendations: []
  };
  
  if (result.ok) {
    response.recommendations.push(`成功生成${format.toUpperCase()}格式报告`);
    if (outputFile) {
      response.recommendations.push(`报告已保存到: ${outputFile}`);
    }
    
    const report = result.report || {};
    if (report.summary) {
      const { total, errors, warnings, infos } = report.summary;
      response.recommendations.push(`检查结果: ${total} 个问题 (错误:${errors} 警告:${warnings} 信息:${infos})`);
      
      if (errors > 0) {
        response.recommendations.push('发现错误，建议立即修复');
      } else if (warnings > 0) {
        response.recommendations.push('发现警告，建议修复');
      } else {
        response.recommendations.push('图纸符合规范要求');
      }
    }
  } else {
    response.recommendations.push('生成报告失败，请检查错误信息');
  }
  
  return response;
}
