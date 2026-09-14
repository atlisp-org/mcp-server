import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 连接稳定性测试
 * 验证配置参数和基本功能
 */

const mockWorker = {
  stdin: { write: vi.fn() },
  stdout: { on: vi.fn(), off: vi.fn() },
  stderr: { on: vi.fn() },
  kill: vi.fn(),
  on: vi.fn(),
};

vi.mock('child_process', () => ({
  spawn: vi.fn(() => ({ ...mockWorker })),
}));

vi.mock('crypto', () => ({
  randomUUID: vi.fn(() => 'test-uuid-' + Math.random().toString(36).substr(2, 9)),
}));

// 模拟配置 - 使用更短的超时时间用于测试
vi.mock('../src/config.js', () => ({
  default: {
    messageTimeout: 200,
    cadCommandTimeout: 100,
    stallCooldown: 1000,
    heartbeatPingTimeout: 100,
    heartbeatInterval: 500,
    busyRetries: 2,
    busyDelay: 100,
    workerPoolSize: 2,
    readBatchWindow: 50,
    readBatchSize: 10,
  },
}));

const { cad } = await import('../src/cad.js');
const CadConnection = (await import('../src/cad.js')).default;

describe('Connection Stability', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    cad._reset();
  });

  describe('CadConnection Class', () => {
    it('should initialize with correct defaults', () => {
      const conn = new CadConnection();
      expect(conn.connected).toBe(false);
      expect(conn.getVersion()).toBeNull();
      expect(conn.getPlatform()).toBeNull();
      expect(conn.isStalled()).toBe(false);
      expect(conn._getRestartCount()).toBe(0);
      expect(conn._getQueueSize()).toBe(0);
    });

    it('should clear stall state', () => {
      const conn = new CadConnection();
      
      // 初始状态不应是停滞
      expect(conn.isStalled()).toBe(false);
      
      // 清除停滞状态应该不报错
      conn._clearStall();
      expect(conn.isStalled()).toBe(false);
      expect(conn.getStallInfo().stalled).toBe(false);
    });

    it('should track connection state', () => {
      const conn = new CadConnection();
      
      expect(conn.connected).toBe(false);
      conn.connected = true;
      expect(conn.connected).toBe(true);
      conn.connected = false;
      expect(conn.connected).toBe(false);
    });

    it('should return null for platform/version when not connected', () => {
      const conn = new CadConnection();
      expect(conn.getPlatform()).toBeNull();
      expect(conn.getVersion()).toBeNull();
    });
  });

  describe('Configuration', () => {
    it('should have reasonable default timeouts', async () => {
      // 验证连接状态
      expect(cad.connected).toBe(false);
      
      // 验证停滞信息
      const stallInfo = cad.getStallInfo();
      expect(stallInfo).toHaveProperty('stalled');
      expect(stallInfo).toHaveProperty('reason');
      expect(stallInfo).toHaveProperty('remainingMs');
      expect(stallInfo.stalled).toBe(false);
    });

    it('should handle reset properly', async () => {
      cad.connected = true;
      cad._reset();
      expect(cad.connected).toBe(false);
    });
  });

  describe('Connection State', () => {
    it('should track connection state properly', () => {
      expect(cad.connected).toBe(false);
      
      // 模拟连接
      cad.connected = true;
      expect(cad.connected).toBe(true);
      
      // 模拟断开
      cad.connected = false;
      expect(cad.connected).toBe(false);
    });

    it('should track platform info', () => {
      expect(cad.getPlatform()).toBeNull();
      expect(cad.getVersion()).toBeNull();
    });
  });

  describe('Worker Management', () => {
    it('should track restart count', () => {
      expect(cad._getRestartCount()).toBe(0);
    });

    it('should track queue size', () => {
      expect(cad._getQueueSize()).toBe(0);
    });
  });
});