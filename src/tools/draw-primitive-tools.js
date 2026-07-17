export const tools = [
{
        name: 'draw_line',
        description: '创建直线段(LINE)。当用户说"画线/画直线/连线"时调用。返回新创建实体的句柄。p1/p2 为坐标字符串，支持 2D "x,y" 或 3D "x,y,z"。idempotent——每次调用创建一条新线段。',
        inputSchema: {
            type: 'object',
            properties: {
                p1: { type: 'string', description: '起点坐标，如 "0,0" 或 "10,20,0"' },
                p2: { type: 'string', description: '终点坐标，如 "100,100" 或 "50,50,30"' }
            },
            required: ['p1', 'p2']
        }
    },
{
        name: 'draw_circle',
        description: '创建圆(CIRCLE)。当用户说"画圆/画个圈"时调用。返回新创建实体的句柄。idempotent——每次调用创建一个新圆。',
        inputSchema: {
            type: 'object',
            properties: {
                center: { type: 'string', description: '圆心坐标，如 "50,50"' },
                radius: { type: 'number', description: '半径值，必须 > 0' }
            },
            required: ['center', 'radius']
        }
    },
{
        name: 'draw_arc',
        description: '创建圆弧(ARC)。当用户说"画弧/画圆弧"时调用。返回新创建实体的句柄。角度单位为度(°)，0°=右侧水平方向，逆时针为正。idempotent。',
        inputSchema: {
            type: 'object',
            properties: {
                center: { type: 'string', description: '圆心坐标，如 "50,50"' },
                radius: { type: 'number', description: '圆弧半径，必须 > 0' },
                startAngle: { type: 'number', description: '起始角度（度），如 0 = 右侧水平方向' },
                endAngle: { type: 'number', description: '终止角度（度），如 180 = 左侧水平方向' }
            },
            required: ['center', 'radius', 'startAngle', 'endAngle']
        }
    },
{
        name: 'draw_rectangle',
        description: '创建矩形多段线(RECTANGLE)。当用户说"画矩形/画方框"时调用。返回新创建实体的句柄。idempotent。',
        inputSchema: {
            type: 'object',
            properties: {
                corner1: { type: 'string', description: '第一个角点坐标，如 "0,0"' },
                corner2: { type: 'string', description: '对角点坐标，如 "100,80"' }
            },
            required: ['corner1', 'corner2']
        }
    },
{
        name: 'draw_polygon',
        description: '创建正多边形(POLYGON)。当用户说"画多边形/画正多边形"时调用。返回新创建实体的句柄。sides >= 3，radius 为内切圆(inscribed)或外接圆(circumscribed)半径。idempotent。',
        inputSchema: {
            type: 'object',
            properties: {
                center: { type: 'string', description: '中心点坐标，如 "50,50"' },
                sides: { type: 'integer', description: '边数，最小 3，如 5=五边形,6=六边形,8=八边形', minimum: 3 },
                radius: { type: 'number', description: '内切圆或外接圆半径，必须 > 0' }
            },
            required: ['center', 'sides', 'radius']
        }
    },
{
        name: 'draw_ellipse',
        description: '创建椭圆(ELLIPSE)。当用户说"画椭圆/画扁圆"时调用。返回新创建实体的句柄。idempotent。',
        inputSchema: {
            type: 'object',
            properties: {
                center: { type: 'string', description: '椭圆中心坐标，如 "50,50"' },
                majorAxis: { type: 'string', description: '长轴端点坐标（相对于中心），如 "50,0" 表示水平长轴' },
                minorAxis: { type: 'string', description: '短轴端点坐标或长短轴比，如 "0,30" 或 "0.6"' }
            },
            required: ['center', 'majorAxis', 'minorAxis']
        }
    },
{
        name: 'draw_text',
        description: '创建单行文字(TEXT)。当用户说"写字/写文字/加文字"时调用。返回新创建实体的句柄。idempotent。如需多行文字(自动换行)请用 draw_mtext。',
        inputSchema: {
            type: 'object',
            properties: {
                text: { type: 'string', description: '文字内容，支持中英文' },
                point: { type: 'string', description: '插入点坐标（左下角对齐），如 "50,50"' },
                height: { type: 'number', description: '文字高度，如 2.5, 5, 10。默认使用当前文字样式高度' }
            },
            required: ['text', 'point']
        }
    },
{
        name: 'draw_mtext',
        description: '创建多行文字(MTEXT)。当用户说"写多行文字/加段落文字"时调用。返回新创建实体的句柄。自动换行，支持多行内容(\\n)。对比 draw_text 支持宽文本框自动换行。idempotent。',
        inputSchema: {
            type: 'object',
            properties: {
                text: { type: 'string', description: '文字内容，支持中英文，多行用 \\n 分隔' },
                point: { type: 'string', description: '插入点坐标，如 "50,50"' },
                width: { type: 'number', description: '文本框宽度（自动换行宽度），如 100。默认根据内容自适应' }
            },
            required: ['text', 'point']
        }
    },
{
        name: 'draw_polyline',
        description: '创建多段线(Polyline)，由直线段和弧段首尾相连组成的连续线。当用户说"画多段线/画连续线"时调用。返回新创建实体的句柄。设置 closed=true 可闭合首尾。idempotent。',
        inputSchema: {
            type: 'object',
            properties: {
                points: { type: 'string', description: '顶点坐标列表，空格分隔，如 "0,0 100,0 100,100 0,100"' },
                closed: { type: 'boolean', description: '是否闭合首尾顶点。true=闭合, false=开放（默认）' }
            },
            required: ['points']
        }
    },
{
        name: 'draw_spline',
        description: '创建样条曲线(SPLINE)，通过控制点拟合的光滑曲线。当用户说"画样条线/画曲线"时调用。返回新创建实体的句柄。idempotent。',
        inputSchema: {
            type: 'object',
            properties: {
                points: { type: 'string', description: '控制点坐标列表，空格分隔，如 "0,0 25,50 50,25 75,75 100,0"' }
            },
            required: ['points']
        }
    },
{
        name: 'draw_point',
        description: '创建点实体(POINT)。当用户说"画点/标记点"时调用。返回新创建实体的句柄。idempotent。点样式由 PDMODE 系统变量控制。',
        inputSchema: {
            type: 'object',
            properties: {
                point: { type: 'string', description: '点坐标，如 "50,50" 或 "10,20,30"（3D）' }
            },
            required: ['point']
        }
    },
{
        name: 'draw_hatch',
        description: '创建图案填充(HATCH)。当用户说"贴图案/填充"时调用。返回新创建实体的句柄。points 为闭合边界点序列。pattern 可选 ANSI31(斜线)/ANSI32(交叉线)/BRICK(砖)/AR-CONC(混凝土)/SOLID(实心)等。idempotent。对比 create_hatch 方式不同——此工具用 points 边界，create_hatch 用边界实体选择。',
        inputSchema: {
            type: 'object',
            properties: {
                points: { type: 'string', description: '闭合边界点坐标列表，空格分隔，如 "0,0 100,0 100,100 0,100"' },
                pattern: { type: 'string', description: '填充图案名，如 ANSI31(斜线), ANSI32(交叉斜线), BRICK(砖), DOTS(点), SOLID(实心)' }
            },
            required: ['points']
        }
    },
  {
    name: 'draw_helix',
    description: '创建螺旋(HELIX)。当用户说"画螺旋/画弹簧"时调用。返回新创建实体的句柄。topRadius=0 时生成锥形螺旋。idempotent。',
    inputSchema: {
      type: 'object',
      properties: {
        center: { type: 'string', description: '中心点坐标，如 "0,0,0"。支持 3D' },
        topRadius: { type: 'number', description: '顶部半径，如 10。设为 0 可创建锥形螺旋' },
        bottomRadius: { type: 'number', description: '底部半径，如 30。必须 > 0' },
        height: { type: 'number', description: '螺旋总高度，如 50' },
        turns: { type: 'number', description: '圈数（默认 3），如 5=五圈' }
      },
      required: ['center', 'topRadius', 'bottomRadius', 'height']
    }
  },
  {
    name: 'draw_donut',
    description: '创建圆环/填充圆环(DONUT)。当用户说"画圆环/画环"时调用。返回新创建实体的句柄。idempotent。',
    inputSchema: {
      type: 'object',
      properties: {
        center: { type: 'string', description: '圆心坐标，如 "50,50"' },
        innerRadius: { type: 'number', description: '内径，如 10。设为 0 创建实心圆' },
        outerRadius: { type: 'number', description: '外径，如 20。必须大于 innerRadius' }
      },
      required: ['center', 'innerRadius', 'outerRadius']
    }
  },
  {
    name: 'draw_2d_solid',
    description: '创建2D填充实体(SOLID)。当用户说"画填充面/画色块"时调用。返回新创建实体的句柄。四个点 p1→p2→p3→p4 构成四边形填充区域。idempotent。',
    inputSchema: {
      type: 'object',
      properties: {
        p1: { type: 'string', description: '第一点坐标，如 "0,0"' },
        p2: { type: 'string', description: '第二点坐标，如 "100,0"' },
        p3: { type: 'string', description: '第三点坐标，如 "100,50"' },
        p4: { type: 'string', description: '第四点坐标，如 "0,50"。与 p3 相同可创建三角形' }
      },
      required: ['p1', 'p2', 'p3', 'p4']
    }
  },
  {
    name: 'draw_xline',
    description: '创建构造线/无限长直线(XLINE)。当用户说"画构造线/画辅助线"时调用。返回新创建实体的句柄。通过一点并沿方向无限延伸。idempotent。对比 draw_line(线段)和 draw_ray(射线)。',
    inputSchema: {
      type: 'object',
      properties: {
        point: { type: 'string', description: '经过点坐标，如 "50,50"' },
        direction: { type: 'string', description: '方向向量，如 "1,0"（水平）、"0,1"（垂直）、"1,1"（45°）' }
      },
      required: ['point', 'direction']
    }
  },
  {
    name: 'draw_ray',
    description: '创建射线(RAY)，从一点出发无限延伸。当用户说"画射线"时调用。返回新创建实体的句柄。对比 draw_line(双向有限)和 draw_xline(双向无限)。idempotent。',
    inputSchema: {
      type: 'object',
      properties: {
        point: { type: 'string', description: '起点坐标，如 "50,50"' },
        direction: { type: 'string', description: '方向向量，如 "1,0"（水平向右）、"0,1"（垂直向上）' }
      },
      required: ['point', 'direction']
    }
  },
  {
    name: 'draw_leader',
    description: '创建引线标注(LEADER)。当用户说"画引线/指示标注"时调用。返回新创建实体的句柄。由折线和可选注释文字组成。points 至少 2 个顶点。idempotent。',
    inputSchema: {
      type: 'object',
      properties: {
        points: { type: 'string', description: '引线顶点坐标列表，空格分隔。至少2点，如 "0,0 10,0 20,0"' },
        annotation: { type: 'string', description: '注释文字内容（可选），如 "此处为门"。不传则仅绘制引线' }
      },
      required: ['points']
    }
  },
  {
    name: 'draw_table',
    description: '创建表格(TABLE)。当用户说"画表格/创建表格"时调用。返回新创建实体的句柄。支持设置行数列数及行列尺寸。idempotent。',
    inputSchema: {
      type: 'object',
      properties: {
        insertionPoint: { type: 'string', description: '插入点坐标（表格左上角），如 "50,50"' },
        rows: { type: 'integer', description: '行数（不含标题行），如 5, 10, 20' },
        columns: { type: 'integer', description: '列数，如 3, 5, 10' },
        rowHeight: { type: 'number', description: '行高（默认 10）。如 8, 15' },
        colWidth: { type: 'number', description: '列宽（默认 20）。如 30, 50' }
      },
      required: ['insertionPoint', 'rows', 'columns']
    }
  }
];
