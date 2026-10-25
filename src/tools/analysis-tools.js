export const tools = [
  {
    name: 'cad_duplicates',
    description: '只读检查当前图纸中的重复实体（同类型、同图层、同几何）。用户说"检查重复实体/有没有重复图元"时优先用它，不要现写 LISP。返回重复组数、类型/图层签名和句柄列表；不修改图纸',
    inputSchema: {
      type: 'object',
      properties: {
        types: {
          type: 'array',
          items: { type: 'string' },
          description: '限定实体类型，如 ["LINE","CIRCLE","LWPOLYLINE","TEXT","INSERT"]；不传检查全部',
        },
        tolerance: {
          type: 'number',
          description: '坐标/数值比较容差（图纸单位），默认 1e-6；图纸坐标较大时可用 1e-3~1e-2',
        },
        maxGroups: {
          type: 'number',
          description: '最多返回多少组重复实体，默认 50，范围 1-500',
        },
      },
    },
  },
];
