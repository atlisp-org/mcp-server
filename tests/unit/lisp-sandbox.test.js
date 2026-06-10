import { describe, it, expect } from 'vitest';

const DANGEROUS_PATTERNS = [
  { re: /\beval\s*[(\s]/i },
  { re: /\bstartapp\s*[(\s]/i },
  { re: /\bvla-Delete\b/i },
  { re: /\bvla-Save\b/i },
];

function validateLispCode(code) {
  const withoutStrings = code.replace(/"([^"\\]*(?:\\.[^"\\]*)*)"/g, '');
  const withoutComments = withoutStrings.replace(/;.*$/gm, '');
  for (const { re } of DANGEROUS_PATTERNS) {
    if (re.test(withoutComments)) {
      return { valid: false };
    }
  }
  return { valid: true };
}

describe('Lisp Sandbox', () => {
  it('should block eval', () => {
    expect(validateLispCode('(eval (quote (+ 1 2)))').valid).toBe(false);
  });

  it('should block startapp', () => {
    expect(validateLispCode('(startapp "notepad.exe")').valid).toBe(false);
  });

  it('should allow safe code', () => {
    expect(validateLispCode('(+ 1 2 3)').valid).toBe(true);
    expect(validateLispCode('(setq a 10)').valid).toBe(true);
    expect(validateLispCode('(princ "Hello World")').valid).toBe(true);
  });

  it('should strip strings before checking', () => {
    expect(validateLispCode('(princ "eval is not called here")').valid).toBe(true);
  });

  it('should strip comments before checking', () => {
    expect(validateLispCode('(+ 1 2) ; this eval is commented').valid).toBe(true);
  });

  it('should block vla-Delete', () => {
    expect(validateLispCode('(vla-Delete obj)').valid).toBe(false);
  });

  it('should block vla-Save', () => {
    expect(validateLispCode('(vla-Save doc)').valid).toBe(false);
  });
});
