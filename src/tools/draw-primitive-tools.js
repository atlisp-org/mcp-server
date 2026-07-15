export const tools = [
{
        name: 'draw_line',
        description: '画直线段。p1起点 p2终点',
        inputSchema: {
            type: 'object',
            properties: {
                p1: { type: 'string', description: '起点坐标，如 0,0' },
                p2: { type: 'string', description: '终点坐标，如 100,100' }
            },
            required: ['p1', 'p2']
        }
    },
{
        name: 'draw_circle',
        description: '画圆。中心点+半径',
        inputSchema: {
            type: 'object',
            properties: {
                center: { type: 'string', description: '圆心坐标，如 50,50' },
                radius: { type: 'number', description: '半径' }
            },
            required: ['center', 'radius']
        }
    },
{
        name: 'draw_arc',
        description: '画圆弧。中心点+半径+起始角度+终止角度（度）',
        inputSchema: {
            type: 'object',
            properties: {
                center: { type: 'string', description: '圆心坐标，如 50,50' },
                radius: { type: 'number', description: '半径' },
                startAngle: { type: 'number', description: '起始角度（度）' },
                endAngle: { type: 'number', description: '终止角度（度）' }
            },
            required: ['center', 'radius', 'startAngle', 'endAngle']
        }
    },
{
        name: 'draw_rectangle',
        description: '画矩形。两个对角点确定',
        inputSchema: {
            type: 'object',
            properties: {
                corner1: { type: 'string', description: '第一个角点坐标' },
                corner2: { type: 'string', description: '对角点坐标' }
            },
            required: ['corner1', 'corner2']
        }
    },
{
        name: 'draw_polygon',
        description: '画正多边形。中心点+边数(>=3)+半径',
        inputSchema: {
            type: 'object',
            properties: {
                center: { type: 'string', description: '中心点坐标' },
                sides: { type: 'integer', description: '边数', minimum: 3 },
                radius: { type: 'number', description: '内切圆或外接圆半径' }
            },
            required: ['center', 'sides', 'radius']
        }
    },
{
        name: 'draw_ellipse',
        description: '画椭圆。中心+长轴端点+短轴端点(或短长比)',
        inputSchema: {
            type: 'object',
            properties: {
                center: { type: 'string', description: '椭圆中心坐标' },
                majorAxis: { type: 'string', description: '长轴端点坐标' },
                minorAxis: { type: 'string', description: '短轴端点坐标或轴长比' }
            },
            required: ['center', 'majorAxis', 'minorAxis']
        }
    },
{
        name: 'draw_text',
        description: '创建单行文字(TEXT)。指定内容和插入点',
        inputSchema: {
            type: 'object',
            properties: {
                text: { type: 'string', description: '文字内容' },
                point: { type: 'string', description: '插入点坐标' },
                height: { type: 'number', description: '文字高度' }
            },
            required: ['text', 'point']
        }
    },
{
        name: 'draw_mtext',
        description: '创建多行文字(MTEXT)。指定内容、插入点和文本框宽度',
        inputSchema: {
            type: 'object',
            properties: {
                text: { type: 'string', description: '文字内容' },
                point: { type: 'string', description: '插入点坐标' },
                width: { type: 'number', description: '文本框宽度' }
            },
            required: ['text', 'point']
        }
    },
{
        name: 'draw_polyline',
        description: '创建多段线(Polyline)，由直线段和弧段组成的连续线。可闭合',
        inputSchema: {
            type: 'object',
            properties: {
                points: { type: 'string', description: '顶点坐标列表，如 0,0 100,0 100,100' },
                closed: { type: 'boolean', description: '是否闭合' }
            },
            required: ['points']
        }
    },
{
        name: 'draw_spline',
        description: '创建样条曲线(SPLINE)，通过控制点拟合光滑曲线',
        inputSchema: {
            type: 'object',
            properties: {
                points: { type: 'string', description: '控制点坐标列表' }
            },
            required: ['points']
        }
    },
{
        name: 'draw_point',
        description: '创建点(Point)实体',
        inputSchema: {
            type: 'object',
            properties: {
                point: { type: 'string', description: '点坐标' }
            },
            required: ['point']
        }
    },
{
        name: 'draw_hatch',
        description: '创建图案填充。points为边界点序列，pattern为填充图案名(如ANSI31)',
        inputSchema: {
            type: 'object',
            properties: {
                points: { type: 'string', description: '边界点坐标列表' },
                pattern: { type: 'string', description: '填充图案名，如 ANSI31' }
            },
            required: ['points']
        }
    },
  {
    name: 'draw_helix',
    description: '创建螺旋(Helix)。指定中心、顶底半径、高度和圈数',
    inputSchema: {
      type: 'object',
      properties: {
        center: { type: 'string', description: '中心点坐标，如 0,0,0' },
        topRadius: { type: 'number', description: '顶部半径' },
        bottomRadius: { type: 'number', description: '底部半径' },
        height: { type: 'number', description: '高度' },
        turns: { type: 'number', description: '圈数（默认 3）' }
      },
      required: ['center', 'topRadius', 'bottomRadius', 'height']
    }
  },
  {
    name: 'draw_donut',
    description: '画圆环(Donut)。指定中心、内径和外径',
    inputSchema: {
      type: 'object',
      properties: {
        center: { type: 'string', description: '圆心坐标，如 50,50' },
        innerRadius: { type: 'number', description: '内径' },
        outerRadius: { type: 'number', description: '外径' }
      },
      required: ['center', 'innerRadius', 'outerRadius']
    }
  },
  {
    name: 'draw_2d_solid',
    description: '创建2D填充实体(SOLID)。四个点构成填充区域',
    inputSchema: {
      type: 'object',
      properties: {
        p1: { type: 'string', description: '第一点坐标' },
        p2: { type: 'string', description: '第二点坐标' },
        p3: { type: 'string', description: '第三点坐标' },
        p4: { type: 'string', description: '第四点坐标' }
      },
      required: ['p1', 'p2', 'p3', 'p4']
    }
  },
  {
    name: 'draw_xline',
    description: '创建构造线(XLINE)无限长直线',
    inputSchema: {
      type: 'object',
      properties: {
        point: { type: 'string', description: '经过点坐标' },
        direction: { type: 'string', description: '方向向量，如 1,0,0' }
      },
      required: ['point', 'direction']
    }
  },
  {
    name: 'draw_ray',
    description: '创建射线(RAY)从一点出发的无限长线',
    inputSchema: {
      type: 'object',
      properties: {
        point: { type: 'string', description: '起点坐标' },
        direction: { type: 'string', description: '方向向量，如 1,0,0' }
      },
      required: ['point', 'direction']
    }
  },
  {
    name: 'draw_leader',
    description: '创建引线标注(Leader)。指引线和注释文字',
    inputSchema: {
      type: 'object',
      properties: {
        points: { type: 'string', description: '引线顶点坐标列表，如 0,0 10,0 20,0' },
        annotation: { type: 'string', description: '注释文字（可选）' }
      },
      required: ['points']
    }
  },
  {
    name: 'draw_table',
    description: '创建表格。指定插入点、行列数、行高列宽',
    inputSchema: {
      type: 'object',
      properties: {
        insertionPoint: { type: 'string', description: '插入点坐标' },
        rows: { type: 'integer', description: '行数' },
        columns: { type: 'integer', description: '列数' },
        rowHeight: { type: 'number', description: '行高（默认 10）' },
        colWidth: { type: 'number', description: '列宽（默认 20）' }
      },
      required: ['insertionPoint', 'rows', 'columns']
    }
  }
];
