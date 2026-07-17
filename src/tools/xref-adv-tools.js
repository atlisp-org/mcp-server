export const tools = [
  {
    name: 'xref_notifications',
    description: '启用/禁用或查询外部参照变更通知(Xref Notifications)。无参数时返回当前启用状态。启用后当外部参照文件被修改时会收到提示。用户问"外部参照变更通知"时调用',
    inputSchema: {
      type: 'object',
      properties: {
        enable: {
          type: 'boolean',
          description: '是否启用通知: true=启用（修改外部文件时提醒）, false=禁用, 不传则仅查询当前状态（可选）'
        }
      }
    }
  },
  {
    name: 'xref_compare',
    description: '查看外部参照内的实体列表，与当前图形中的实体进行比较——识别外部参照中的图元类型和数量。传入 xrefName 或 handle 二选一。对比 xref_convert_to_block 可转为块',
    inputSchema: {
      type: 'object',
      properties: {
        xrefName: { type: 'string', description: '外部参照名称（可选，与 handle 二选一），如 "BASE_DWG"' },
        handle: { type: 'string', description: '外部参照实体句柄（可选，与 xrefName 二选一），如 "2A3"' }
      }
    }
  },
  {
    name: 'xref_convert_to_block',
    description: '将已附着的外部参照原地转为块定义——不再参照外部文件，内容永久嵌入当前图形。bind=绑定符号表(保留图层前缀), insert=插入方式(合并图层)。不可逆！用户说"把外部参照转成块"时调用。先 bind_xref 也可实现',
    inputSchema: {
      type: 'object',
      properties: {
        xrefName: { type: 'string', description: '外部参照名称（可选，与 handle 二选一），如 "BASE_DWG"' },
        handle: { type: 'string', description: '外部参照实体句柄（可选，与 xrefName 二选一），如 "2A3"' },
        bindType: { type: 'string', enum: ['bind', 'insert'], description: '绑定方式: "bind"=绑定符号表(保留原图层前缀), "insert"=插入方式(合并图层到当前图形)。默认 "bind"（可选）' }
      }
    }
  },
  {
    name: 'xref_demote',
    description: '将嵌套的外部参照降级到顶级——解除嵌套层次关系，直接引用最底层 DWG。用户说"解除xref嵌套/降级外部参照"时调用',
    inputSchema: {
      type: 'object',
      properties: {
        parentXref: { type: 'string', description: '父外部参照的名称（如 "BUILDING"）或句柄，解除其嵌套引用关系' }
      },
      required: ['parentXref']
    }
  },
  {
    name: 'xref_path_relative',
    description: '批量将外部参照的绝对路径转为相对路径（基于当前 DWG 所在目录）。传 "all" 转换所有外部参照。用户说"改成相对路径/转相对路径"时调用。配合 path_xref 可单独修改路径',
    inputSchema: {
      type: 'object',
      properties: {
        xrefNames: {
          oneOf: [
            { type: 'string', description: '传 "all" 转换所有外部参照为相对路径' },
            { type: 'array', items: { type: 'string' }, description: '外部参照名称列表，如 ["BASE_DWG", "REF_PLAN"]' }
          ],
          description: '外部参照名称数组或 "all"。如 ["BASE_DWG", "STRUCTURE"] 或 "all"'
        }
      },
      required: ['xrefNames']
    }
  }
];
