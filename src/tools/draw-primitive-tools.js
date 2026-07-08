export const tools = [
{
        name: 'draw_line',
        description: '绘制直线',
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
        description: '绘制圆',
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
        description: '绘制圆弧',
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
        description: '绘制矩形',
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
        description: '绘制正多边形',
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
        description: '绘制椭圆',
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
        description: '创建单行文字',
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
        description: '创建多行文字',
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
        description: '创建多段线，points格式: x1,y1 x2,y2 ...',
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
        description: '创建样条曲线',
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
        description: '创建点',
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
        description: '创建图案填充，points: 边界点序列',
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
    description: '创建螺旋（Helix）',
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
    description: '绘制圆环',
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
    description: '创建 2D 填充实体（SOLID）',
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
    description: '创建构造线（XLINE）',
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
    description: '创建射线（RAY）',
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
    description: '创建引线标注',
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
    description: '创建表格',
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
