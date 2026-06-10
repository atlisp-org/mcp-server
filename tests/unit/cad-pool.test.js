import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { pool, POOL_STRATEGIES } from '../../src/cad-pool.js';
import { cad, createCadConnection, setActiveConnection, getActiveConnection } from '../../src/cad.js';

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

  it('should have default instance registered', () => {
    const stats = pool.getStats();
    expect(stats.total).toBe(1);
    expect(stats.active).toBe('default');
    expect(stats.maxPoolSize).toBe(3);
  });

  it('should reject setting active to non-existent key', () => {
    const result = pool.setActive('nonexistent');
    expect(result).toBe(false);
    // Active key should still be default
    expect(pool.getStats().active).toBe('default');
  });

  it('should list instances', () => {
    const instances = pool.listInstances();
    expect(instances.length).toBe(1);
    expect(instances[0].key).toBe('default');
    expect(instances[0].isActive).toBe(true);
  });

  it('should return stats with correct structure', () => {
    const stats = pool.getStats();
    expect(stats).toHaveProperty('total');
    expect(stats).toHaveProperty('maxPoolSize');
    expect(stats).toHaveProperty('active');
    expect(stats).toHaveProperty('instances');
    expect(stats.instances[0]).toHaveProperty('key');
    expect(stats.instances[0]).toHaveProperty('connected');
    expect(stats.instances[0]).toHaveProperty('queueSize');
    expect(stats.instances[0]).toHaveProperty('uptime');
  });

  it('should set active to default after removing active key', async () => {
    // Add a temp instance
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
    expect(pool.getStats().active).toBe('default');
    expect(pool.listInstances().length).toBe(1);
  });

  it('should not allow connecting beyond maxPoolSize when adding new keys', async () => {
    // Fill the pool to max
    pool['_maxPoolSize'] = 2;

    // We already have 'default', try to add one more
    const conn1 = createCadConnection();
    pool['_instances'].set('extra', {
      key: 'extra',
      connection: conn1,
      connected: false,
      lastPing: Date.now(),
      createdAt: Date.now(),
      label: 'extra',
      autoReconnect: false,
    });

    expect(pool['_instances'].size).toBe(2);

    // Now try to connect a new key (would exceed limit)
    await expect(pool.connect('overflow', null, { makeActive: false })).rejects.toThrow('连接池已满');
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
