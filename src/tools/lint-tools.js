export const tools = [
  {
    name: 'analyze_lisp_code',
    description: '分析 AutoLISP 代码质量。使用 @atlisp/parser 解析为 AST，通过 @atlisp/lint 执行 70+ 条检查规则（括号、参数数量、危险函数调用、命名约定、未使用变量等）',
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
    description: '格式化 AutoLISP 代码（缩进、括号对齐）。使用 @atlisp/lint 的 formatter 引擎',
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
    description: '列出 @atlisp/lint 所有可用的代码检查规则及其说明',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'lint_project',
    description: '对目录中的 AutoLISP 文件进行批量 lint 分析。跨文件检测悬空 defun、重复定义、模块循环等问题',
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
