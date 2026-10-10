import { describe, it, expect } from 'vitest';
import {
  resolveApiKeyRole,
  getApiKeyRole,
  safeKeyEqual,
  isAuthConfigured,
  canAccess,
  getToolPermission,
} from '../../src/auth.js';

describe('safeKeyEqual', () => {
  it('returns true for identical strings', () => {
    expect(safeKeyEqual('secret-key', 'secret-key')).toBe(true);
  });

  it('returns false for different strings', () => {
    expect(safeKeyEqual('secret-key', 'secret-KEY')).toBe(false);
  });

  it('returns false for length mismatch without throwing', () => {
    expect(safeKeyEqual('short', 'a-much-longer-key')).toBe(false);
  });

  it('returns false for non-strings', () => {
    expect(safeKeyEqual(null, 'x')).toBe(false);
    expect(safeKeyEqual(undefined, undefined)).toBe(false);
  });
});

describe('resolveApiKeyRole', () => {
  it('returns admin when no auth is configured (backward-compatible local mode)', () => {
    expect(resolveApiKeyRole(null, { apiKey: '', apiKeys: [] })).toBe('admin');
    expect(resolveApiKeyRole('anything', { apiKey: '', apiKeys: [] })).toBe('admin');
  });

  it('returns admin for the legacy single apiKey', () => {
    expect(resolveApiKeyRole('root-key', { apiKey: 'root-key', apiKeys: [] })).toBe('admin');
  });

  it('returns null for a wrong key when auth is configured', () => {
    expect(resolveApiKeyRole('wrong', { apiKey: 'root-key', apiKeys: [] })).toBe(null);
    expect(resolveApiKeyRole(null, { apiKey: 'root-key', apiKeys: [] })).toBe(null);
  });

  it('resolves per-key roles from apiKeys', () => {
    const cfg = { apiKey: '', apiKeys: [{ key: 'k-viewer', role: 'viewer' }, { key: 'k-op' }] };
    expect(resolveApiKeyRole('k-viewer', cfg)).toBe('viewer');
    expect(resolveApiKeyRole('k-op', cfg)).toBe('operator');
    expect(resolveApiKeyRole('nope', cfg)).toBe(null);
  });
});

describe('isAuthConfigured', () => {
  it('detects apiKey and apiKeys', () => {
    expect(isAuthConfigured({ apiKey: '', apiKeys: [] })).toBe(false);
    expect(isAuthConfigured({ apiKey: 'x', apiKeys: [] })).toBe(true);
    expect(isAuthConfigured({ apiKey: '', apiKeys: [{ key: 'x' }] })).toBe(true);
  });
});

describe('getApiKeyRole', () => {
  it('keeps historical semantics: configured but unmatched => viewer', () => {
    expect(getApiKeyRole('nope', { apiKey: 'root', apiKeys: [] })).toBe('viewer');
    expect(getApiKeyRole('root', { apiKey: 'root', apiKeys: [] })).toBe('admin');
    expect(getApiKeyRole(null, { apiKey: '', apiKeys: [] })).toBe('admin');
  });
});

describe('RBAC permissions', () => {
  it('maps tool families to permissions', () => {
    expect(getToolPermission('get_entity')).toBe('read');
    expect(getToolPermission('delete_entity')).toBe('write');
    expect(getToolPermission('batch_delete')).toBe('batch');
  });

  it('viewer cannot access write tools', () => {
    expect(canAccess('viewer', 'get_entity')).toBe(true);
    expect(canAccess('viewer', 'delete_entity')).toBe(false);
  });

  it('admin can access everything', () => {
    expect(canAccess('admin', 'delete_entity')).toBe(true);
  });
});
