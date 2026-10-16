import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSendCommand = vi.fn();
const mockSendCommandWithResult = vi.fn();
const mockConnect = vi.fn();

const mockCad = {
  connected: false,
  connect: mockConnect,
  sendCommand: mockSendCommand,
  sendCommandWithResult: mockSendCommandWithResult,
};

vi.mock('../src/cad.js', () => ({
  cad: mockCad,
  resolveCadConnection: () => mockCad,
}));

vi.mock('../src/logger.js', () => ({
  log: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  closeLog: vi.fn(),
}));

const {
  drawLine,
  drawCircle,
  drawArc,
  drawRectangle,
  drawPolygon,
  drawEllipse,
  drawText,
  drawMtext,
  drawPolyline,
  drawSpline,
  drawPoint,
  drawHatch,
  drawHelix,
  drawDonut,
  draw2dSolid,
  drawXline,
  drawRay,
  drawLeader,
  drawTable,
} = await import('../src/handlers/draw-handlers.js');

describe('draw-handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCad.connected = false;
    mockSendCommand.mockResolvedValue(undefined);
    mockConnect.mockResolvedValue(true);
  });

  const expectDisconnected = async (fn, args) => {
    mockConnect.mockResolvedValue(false);
    const result = await fn(...args);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('未连接');
  };

  const expectSuccess = async (fn, args, expectedText) => {
    mockCad.connected = true;
    const result = await fn(...args);
    expect(result.content[0].text).toContain(expectedText);
  };

  describe('drawLine', () => {
    it('returns error when CAD not connected', () => expectDisconnected(drawLine, ['0,0', '100,100']));
    it('draws line successfully', () => expectSuccess(drawLine, ['0,0', '100,100'], '已绘制直线'));
  });

  describe('drawCircle', () => {
    it('returns error when CAD not connected', () => expectDisconnected(drawCircle, ['50,50', 25]));
    it('draws circle successfully', () => expectSuccess(drawCircle, ['50,50', 25], '已绘制圆'));
  });

  describe('drawArc', () => {
    it('returns error when CAD not connected', () => expectDisconnected(drawArc, ['50,50', 30, 0, 180]));
    it('draws arc successfully', () => expectSuccess(drawArc, ['50,50', 30, 0, 180], '已绘制圆弧'));
  });

  describe('drawRectangle', () => {
    it('returns error when CAD not connected', () => expectDisconnected(drawRectangle, ['0,0', '100,50']));
    it('draws rectangle successfully', () => expectSuccess(drawRectangle, ['0,0', '100,50'], '已绘制矩形'));
  });

  describe('drawPolygon', () => {
    it('returns error when CAD not connected', () => expectDisconnected(drawPolygon, ['50,50', 6, 30]));
    it('draws polygon successfully', () => expectSuccess(drawPolygon, ['50,50', 6, 30], '已绘制正6边形'));
  });

  describe('drawEllipse', () => {
    it('returns error when CAD not connected', () => expectDisconnected(drawEllipse, ['50,50', '40,0', '0,20']));
    it('draws ellipse successfully', () => expectSuccess(drawEllipse, ['50,50', '40,0', '0,20'], '已绘制椭圆'));
  });

  describe('drawText', () => {
    it('returns error when CAD not connected', () => expectDisconnected(drawText, ['Hello', '0,0', 5]));
    it('draws text successfully', () => expectSuccess(drawText, ['Hello', '0,0', 5], '已创建单行文字'));
  });

  describe('drawMtext', () => {
    it('returns error when CAD not connected', () => expectDisconnected(drawMtext, ['Multi\nLine', '0,0', 100]));
    it('draws mtext successfully', () => expectSuccess(drawMtext, ['Multi\nLine', '0,0', 100], '已创建多行文字'));
  });

  describe('drawPolyline', () => {
    it('returns error when CAD not connected', () => expectDisconnected(drawPolyline, ['0,0 100,0 100,100', false]));
    it('draws polyline successfully', () => expectSuccess(drawPolyline, ['0,0 100,0 100,100', false], '已创建多段线'));
  });

  describe('drawSpline', () => {
    it('returns error when CAD not connected', () => expectDisconnected(drawSpline, ['0,0 25,50 50,25 75,75']));
    it('draws spline successfully', () => expectSuccess(drawSpline, ['0,0 25,50 50,25 75,75'], '已创建样条曲线'));
  });

  describe('drawPoint', () => {
    it('returns error when CAD not connected', () => expectDisconnected(drawPoint, ['50,50']));
    it('draws point successfully', () => expectSuccess(drawPoint, ['50,50'], '已创建点'));
  });

  describe('drawHatch', () => {
    it('returns error when CAD not connected', () => expectDisconnected(drawHatch, ['0,0 100,0 100,100 0,100', 'ANSI31']));
    it('draws hatch successfully', () => expectSuccess(drawHatch, ['0,0 100,0 100,100 0,100', 'ANSI31'], '已创建图案填充'));
  });

  describe('drawHelix', () => {
    it('returns error when CAD not connected', () => expectDisconnected(drawHelix, ['0,0,0', 10, 30, 50, 3]));
    it('draws helix successfully', () => expectSuccess(drawHelix, ['0,0,0', 10, 30, 50, 3], '已创建螺旋'));
  });

  describe('drawDonut', () => {
    it('returns error when CAD not connected', () => expectDisconnected(drawDonut, ['50,50', 10, 20]));
    it('draws donut successfully', () => expectSuccess(drawDonut, ['50,50', 10, 20], '已绘制圆环'));
  });

  describe('draw2dSolid', () => {
    it('returns error when CAD not connected', () => expectDisconnected(draw2dSolid, ['0,0', '100,0', '100,50', '0,50']));
    it('draws 2d solid successfully', () => expectSuccess(draw2dSolid, ['0,0', '100,0', '100,50', '0,50'], '已创建 2D 实体'));
  });

  describe('drawXline', () => {
    it('returns error when CAD not connected', () => expectDisconnected(drawXline, ['50,50', '1,0']));
    it('draws xline successfully', () => expectSuccess(drawXline, ['50,50', '1,0'], '已创建构造线'));
  });

  describe('drawRay', () => {
    it('returns error when CAD not connected', () => expectDisconnected(drawRay, ['50,50', '1,1']));
    it('draws ray successfully', () => expectSuccess(drawRay, ['50,50', '1,1'], '已创建射线'));
  });

  describe('drawLeader', () => {
    it('returns error when CAD not connected', () => expectDisconnected(drawLeader, ['0,0 10,0 20,0', 'Note']));
    it('draws leader successfully', () => expectSuccess(drawLeader, ['0,0 10,0 20,0', 'Note'], '已创建引线标注'));
  });

  describe('drawTable', () => {
    it('returns error when CAD not connected', () => expectDisconnected(drawTable, ['0,0', 5, 3, 10, 20]));
    it('draws table successfully', () => expectSuccess(drawTable, ['0,0', 5, 3, 10, 20], '已创建表格'));
  });
});
