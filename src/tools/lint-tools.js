export const tools = [
  {
    name: 'analyze_lisp_code',
    description: '使用70+检查规则分析AutoLISP代码质量，返回JSON分析报告。当用户说"检查代码/分析Lisp"时调用。规则涵盖：括号平衡、参数数量、危险函数(quit/exit/startapp)、未使用变量、多余括号、覆盖内建函数等。报告含每条规则的级别error/warn和建议。与 format_lisp_code 配合使用',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: '要分析的AutoLISP源代码字符串。支持多行代码。纯文本，不需额外引号包裹' },
        config: {
          type: 'object',
          description: 'lint配置覆盖对象（可选）。格式如 { checks: { parens: "error", unused_variable: "warn" } }。不传使用默认配置（--lint-preset参数或 atlisp-lint.json 配置文件）',
        },
      },
      required: ['code'],
    },
  },
  {
    name: 'format_lisp_code',
    description: '格式化AutoLISP代码：自动调整缩进、括号对齐和空格规范化。当用户说"格式化代码/整理代码"时调用。对不规范代码自动重排增强可读性。tabWidth控制缩进。与 analyze_lisp_code 配合先分析再格式化',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: '要格式化的AutoLISP源代码字符串。支持多行代码。会自动修复多余/缺少的空格和换行' },
        tabWidth: { type: 'number', description: '缩进空格数，默认 2。常用：2(紧凑)或4(宽松)。范围 1-8' },
      },
      required: ['code'],
    },
  },
  {
    name: 'list_lint_rules',
    description: '列出所有可用的AutoLISP语法检查规则及其说明和默认级别。当用户说"有哪些规则/查看lint规则"时调用。每条规则含：规则名、级别(error/warn/off)、说明。可用于配置 analyze_lisp_code 的 config 参数',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'lint_project',
    description: '批量分析指定目录中所有.lsp/.fas文件，跨文件检测代码质量问题。当用户说"检查整个项目/批量分析"时调用。检测：悬空defun(未调用函数)、重复定义、循环引用、未使用文件等。输出汇总报告含每个文件的检查结果',
    inputSchema: {
      type: 'object',
      properties: {
        directory: { type: 'string', description: '要分析的目录完整路径，如 "C:\\projects\\lisp-app\\src"。目录下所有.lsp/.fas文件将被递归扫描分析' },
        config: {
          type: 'object',
          description: 'lint配置覆盖对象（可选），格式同 analyze_lisp_code 的 config 参数。不传使用默认配置',
        },
      },
      required: ['directory'],
    },
  },
];
