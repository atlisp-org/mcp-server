import { describe, it, expect } from 'vitest';

describe('RBAC - Auth', () => {
  const ROLES = {
    admin: { can: ['*'] },
    operator: { can: ['read', 'write', 'batch'] },
    viewer: { can: ['read', 'list'] },
  };

  it('should allow admin all access', () => {
    expect(ROLES.admin.can.includes('*')).toBe(true);
  });

  it('should allow operator read and write', () => {
    expect(ROLES.operator.can).toContain('read');
    expect(ROLES.operator.can).toContain('write');
    expect(ROLES.operator.can).toContain('batch');
  });

  it('should allow viewer only read/list', () => {
    expect(ROLES.viewer.can).toContain('read');
    expect(ROLES.viewer.can).toContain('list');
    expect(ROLES.viewer.can).not.toContain('write');
  });
});
