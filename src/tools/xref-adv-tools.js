export const tools = [
  {
    name: 'xref_notifications',
    description: '配置或查询外部参照更改通知。无参数时返回当前设置；传入 enable 时设置新值。',
    inputSchema: {
      type: 'object',
      properties: {
        enable: {
          type: 'boolean',
          description: '是否启用通知：true=启用, false=禁用, 不传则仅查询当前状态（可选）'
        }
      }
    }
  },
  {
    name: 'xref_compare',
    description: '比较外部参照与当前状态，返回参照内的实体列表',
    inputSchema: {
      type: 'object',
      properties: {
        xrefName: { type: 'string', description: '外部参照名称（可选，与 handle 二选一）' },
        handle: { type: 'string', description: '外部参照实体句柄（可选，与 xrefName 二选一）' }
      }
    }
  },
  {
    name: 'xref_convert_to_block',
    description: '将已附着的外部参照原地转换为块定义',
    inputSchema: {
      type: 'object',
      properties: {
        xrefName: { type: 'string', description: '外部参照名称（可选，与 handle 二选一）' },
        handle: { type: 'string', description: '外部参照实体句柄（可选，与 xrefName 二选一）' },
        bindType: { type: 'string', enum: ['bind', 'insert'], description: '绑定方式：bind（绑定）/ insert（插入），默认 bind（可选）' }
      }
    }
  },
  {
    name: 'xref_demote',
    description: '将嵌套外部参照降级到顶级',
    inputSchema: {
      type: 'object',
      properties: {
        parentXref: { type: 'string', description: '父外部参照名称或句柄' }
      },
      required: ['parentXref']
    }
  },
  {
    name: 'xref_path_relative',
    description: '批量转换外部参照路径为相对路径',
    inputSchema: {
      type: 'object',
      properties: {
        xrefNames: {
          oneOf: [
            { type: 'string', description: '指定为 "all" 转换所有外部参照' },
            { type: 'array', items: { type: 'string' }, description: '外部参照名称列表' }
          ],
          description: '外部参照名称数组或 "all"'
        }
      },
      required: ['xrefNames']
    }
  }
];
