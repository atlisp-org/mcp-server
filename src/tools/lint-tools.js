export const tools = [
  {
    name: 'analyze_lisp_code',
    description: '分析AutoLISP代码质量(70+检查规则:括号/参数/危险函数/未使用变量等)。返回JSON分析报告',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: '要分析的 AutoLISP 代码' },
        config: {
          type: 'object',
          description: 'lint 配置覆盖（可选），如 { checks: { parens: "error", unused_variable: "warn" } }',
        },
      },
      required: ['code'],
    },
  },
  {
    name: 'format_lisp_code',
    description: '格式化AutoLISP代码：调整缩进和对齐。tabWidth控制缩进空格数',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: '要格式化的 AutoLISP 代码' },
        tabWidth: { type: 'number', description: '缩进空格数（默认 2）' },
      },
      required: ['code'],
    },
  },
  {
    name: 'list_lint_rules',
    description: '列出所有可用的Lint检查规则及其说明',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'lint_project',
    description: '批量分析目录中所有AutoLISP文件的代码质量。跨文件检测悬空defun/重复定义/循环引用',
    inputSchema: {
      type: 'object',
      properties: {
        directory: { type: 'string', description: '要分析的目录路径' },
        config: {
          type: 'object',
          description: 'lint 配置覆盖（可选）',
        },
      },
      required: ['directory'],
    },
  },
];
