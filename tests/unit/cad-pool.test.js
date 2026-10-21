import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { pool, POOL_STRATEGIES } from '../../src/cad-pool.js';
import { cad, createCadConnection, setActiveConnection, getActiveConnection, onCadConnected } from '../../src/cad.js';

vi.mock('../../src/config.js', () => ({
  default: {
    port: 8110,
    host: '0.0.0.0',
    transport: 'stdio',
    maxPoolSize: 3,
  },
  getConfig: (key) => null,
}));

describe('CadConnectionPool', () => {
  beforeEach(() => {
    // Reset pool state: disconnect all and clear
    // We can't easily reset internal state, but we test in isolation
  });

  afterEach(async () => {
    await pool.disconnectAll();
  });

  it('should start empty', () => {
    const stats = pool.getStats();
    expect(stats.total).toBe(0);
    expect(stats.active).toBeNull();
    expect(stats.maxPoolSize).toBe(3);
  });

  it('should reject setting active to non-existent key', () => {
    const result = pool.setActive('nonexistent');
    expect(result).toBe(false);
    expect(pool.getStats().active).toBeNull();
  });

  it('should list instances when empty', () => {
    const instances = pool.listInstances();
    expect(instances.length).toBe(0);
  });

  it('切换活动实例时补发连接事件（@lisp 自动安装依赖）', () => {
    const cb = vi.fn();
    onCadConnected(cb);
    const conn = createCadConnection();
    pool['_instances'].set('notify', {
      key: 'notify',
      connection: conn,
      connected: true,
      platform: 'AutoCAD',
      version: '2026',
      lastPing: Date.now(),
      createdAt: Date.now(),
      label: 'notify',
      autoReconnect: false,
    });

    pool.setActive('notify');

    expect(cb).toHaveBeenCalledWith(expect.objectContaining({
      connection: conn, platform: 'AutoCAD', version: '2026', reason: 'activate',
    }));
  });

  it('should return stats with correct structure', () => {
    const stats = pool.getStats();
    expect(stats).toHaveProperty('total');
    expect(stats).toHaveProperty('maxPoolSize');
    expect(stats).toHaveProperty('active');
    expect(stats).toHaveProperty('instances');
    expect(Array.isArray(stats.instances)).toBe(true);
  });

  it('should fall back to null active key after removing the only instance', async () => {
    const conn = createCadConnection();
    pool['_instances'].set('temp', {
      key: 'temp',
      connection: conn,
      connected: false,
      lastPing: Date.now(),
      createdAt: Date.now(),
      label: 'temp',
      autoReconnect: false,
    });
    pool.setActive('temp');
    expect(pool.getStats().active).toBe('temp');

    await pool.disconnect('temp');
    expect(pool.getStats().active).toBeNull();
    expect(pool.listInstances().length).toBe(0);
  });

  it('should fall back to next instance after removing the active key', async () => {
    const conn1 = createCadConnection();
    const conn2 = createCadConnection();
    pool['_instances'].set('a', {
      key: 'a', connection: conn1, connected: false, lastPing: Date.now(), createdAt: Date.now(), label: 'a', autoReconnect: false,
    });
    pool['_instances'].set('b', {
      key: 'b', connection: conn2, connected: false, lastPing: Date.now(), createdAt: Date.now(), label: 'b', autoReconnect: false,
    });
    pool.setActive('a');
    expect(pool.getStats().active).toBe('a');
    expect(pool.listInstances().length).toBe(2);

    await pool.disconnect('a');
    expect(pool.getStats().active).toBe('b');
    expect(pool.listInstances().length).toBe(1);
  });

  it('should not allow connecting beyond maxPoolSize when adding new keys', async () => {
    pool['_maxPoolSize'] = 1;

    pool['_instances'].set('existing', {
      key: 'existing',
      connection: createCadConnection(),
      connected: false,
      lastPing: Date.now(),
      createdAt: Date.now(),
      label: 'existing',
      autoReconnect: false,
    });

    expect(pool['_instances'].size).toBe(1);

    // Now try to connect a new key (would exceed limit)
    await expect(pool.connect('overflow', null, { makeActive: false })).rejects.toThrow('连接池已满');
  });

  it('连接失败时复用同一连接对象并回收 worker，不泄漏连接', async () => {
    const conn = createCadConnection();
    vi.spyOn(conn, 'connect').mockResolvedValue(false);
    const release = vi.spyOn(conn, 'releaseResources').mockImplementation(() => {});

    pool['_instances'].set('retry', {
      key: 'retry',
      connection: conn,
      connected: false,
      lastPing: Date.now(),
      createdAt: Date.now(),
      label: 'retry',
      autoReconnect: true,
    });

    await pool.connect('retry', 'AutoCAD', { makeActive: false });
    await pool.connect('retry', 'AutoCAD', { makeActive: false });

    // 两次重试仍是同一个连接对象（否则每次重试都留下一个带 worker + 心跳的连接）
    expect(pool['_instances'].get('retry').connection).toBe(conn);
    expect(release).toHaveBeenCalledTimes(2);
  });
});

describe('cad delegation wrapper', () => {
  it('should delegate methods to active connection', () => {
    expect(cad).toHaveProperty('connect');
    expect(cad).toHaveProperty('sendCommand');
    expect(cad).toHaveProperty('sendCommandWithResult');
    expect(cad).toHaveProperty('getVersion');
    expect(cad).toHaveProperty('getPlatform');
    expect(cad).toHaveProperty('isAvailable');
    expect(cad).toHaveProperty('isBusy');
    expect(cad).toHaveProperty('disconnect');
    expect(cad).toHaveProperty('ping');
    expect(cad).toHaveProperty('_getQueueSize');
    expect(cad).toHaveProperty('_getRestartCount');
  });

  it('should reflect connected state from active connection', () => {
    expect(cad.connected).toBe(false);
    // Connected state is mutable through the proxy
    cad.connected = true;
    expect(cad.connected).toBe(true);
    cad.connected = false;
  });
});

describe('createCadConnection factory', () => {
  it('should create independent connections', () => {
    const conn1 = createCadConnection();
    const conn2 = createCadConnection();

    expect(conn1).not.toBe(conn2);
    expect(conn1.isAvailable()).toBe(conn2.isAvailable());
    expect(conn1.connected).toBe(false);
    expect(conn2.connected).toBe(false);
  });

  it('should each have unique connection IDs', () => {
    const conn1 = createCadConnection();
    const conn2 = createCadConnection();
    expect(conn1.getConnectionId()).not.toBe(conn2.getConnectionId());
  });
});

describe('setActiveConnection', () => {
  it('should change where cad delegates to', () => {
    const conn = createCadConnection();
    const orig = getActiveConnection();

    setActiveConnection(conn);
    expect(getActiveConnection()).toBe(conn);

    // Restore
    setActiveConnection(orig);
    expect(getActiveConnection()).toBe(orig);
  });
});

describe('POOL_STRATEGIES', () => {
  it('should define round-robin strategy', () => {
    expect(POOL_STRATEGIES.ROUND_ROBIN).toBe('round-robin');
  });

  it('should define least-busy strategy', () => {
    expect(POOL_STRATEGIES.LEAST_BUSY).toBe('least-busy');
  });

  it('should define manual strategy', () => {
    expect(POOL_STRATEGIES.MANUAL).toBe('manual');
  });
});
