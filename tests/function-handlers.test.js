import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSendCommandWithResult = vi.fn();
const mockConnect = vi.fn();
const mockCad = { connected: false, connect: mockConnect, sendCommandWithResult: mockSendCommandWithResult };

vi.mock('../src/cad.js', () => ({ cad: mockCad }));
vi.mock('../src/logger.js', () => ({ log: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), closeLog: vi.fn() }));

vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true),
    readFileSync: vi.fn().mockReturnValue(JSON.stringify({ all_functions: { f1: { name: 'string:length', description: 'Get string length' } } })),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
});

const { loadAtlibFunctionLib, getFunctionUsage, listSymbols } = await import('../src/handlers/function-handlers.js');

describe('function-handlers', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('loadAtlibFunctionLib returns data', async () => {
    const data = await loadAtlibFunctionLib();
    expect(data).toBeDefined();
    expect(data.all_functions).toBeDefined();
  });

  it('caches result on subsequent calls', async () => {
    const d1 = await loadAtlibFunctionLib();
    const d2 = await loadAtlibFunctionLib();
    expect(d2).toBe(d1);
  });

  it('getFunctionUsage returns usage when function exists', async () => {
    const result = await getFunctionUsage('string:length');
    expect(result).toBeDefined();
  });

  it('getFunctionUsage returns error for unknown', async () => {
    const result = await getFunctionUsage('nonexistent');
    expect(result.isError).toBe(true);
  });

  it('listSymbols returns result', async () => {
    const result = await listSymbols('string');
    expect(result).toBeDefined();
  });
});
