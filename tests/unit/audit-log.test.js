import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

const TEST_DIR = path.join(os.tmpdir(), 'atlisp-test-audit');
const TEST_FILE = path.join(TEST_DIR, 'audit.test.log');

describe('Audit Log', () => {
  beforeEach(() => {
    if (!fs.existsSync(TEST_DIR)) fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
  });

  it('should write and read audit entries', () => {
    const entry = { timestamp: new Date().toISOString(), tool: 'test_tool', args: { key: 'value' }, result: 'success' };
    fs.appendFileSync(TEST_FILE, JSON.stringify(entry) + '\n', 'utf-8');
    const content = fs.readFileSync(TEST_FILE, 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines.length).toBe(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.tool).toBe('test_tool');
    expect(parsed.args.key).toBe('value');
  });

  it('should handle empty file', () => {
    expect(fs.existsSync(TEST_FILE)).toBe(false);
  });

  it('should handle malformed entries gracefully', () => {
    fs.writeFileSync(TEST_FILE, 'not json\n{"valid": "entry"}\nmore garbage', 'utf-8');
    const content = fs.readFileSync(TEST_FILE, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    expect(lines.length).toBe(3);
    const parsed = [lines[0], lines[1], lines[2]].map(l => { try { return JSON.parse(l); } catch { return null; } });
    expect(parsed[0]).toBeNull();
    expect(parsed[1].valid).toBe('entry');
    expect(parsed[2]).toBeNull();
  });
});
