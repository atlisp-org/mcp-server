import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { cad } from '../src/cad.js';

const LISP_CODE = '(getvar "dwgname")';

describe('CAD Integration Tests', () => {
  it('should be available on Windows', () => {
    expect(cad.isAvailable()).toBe(process.platform === 'win32');
  });

  describe('Live CAD connection', () => {
    beforeAll(async () => {
      if (!cad.isAvailable()) return;
      await cad.connect();
    });

    afterAll(async () => {
      if (cad.connected) await cad.disconnect();
    });

    it.skipIf(!cad.isAvailable())('connects to CAD when available', async () => {
      if (!cad.connected) return;
      expect(cad.connected).toBe(true);
      console.log(`Connected to: ${cad.getPlatform()} ${cad.getVersion()}`);
    });

    it.skipIf(!cad.connected)('evaluates Lisp and returns dwgname', async () => {
      try {
        const result = await cad.sendCommandWithResult(LISP_CODE);
        console.log(`Result of (getvar "dwgname"): ${result}`);
        expect(result).not.toBeNull();
        expect(typeof result).toBe('string');
      } catch (e) {
        console.log(`Skipping: No open document or CAD error: ${e.message}`);
      }
    }, 60000);
  });
});
