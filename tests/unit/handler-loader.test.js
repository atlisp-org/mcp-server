import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HANDLER_MODULE_NAMES,
  handlerFileNames,
  toolNameToFuncName,
} from '../../src/handler-loader.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HANDLER_DIR = path.join(HERE, '../../src/handlers');

describe('handler-loader 工具名映射', () => {
  it('snake_case → camelCase，并保留显式 override', () => {
    expect(toolNameToFuncName('connect_cad')).toBe('connectCad');
    expect(toolNameToFuncName('list_packages')).toBe('listPackages');
    /* 这两个名字不能按规则机械转换，必须走 FUNCTION_OVERRIDES。 */
    expect(toolNameToFuncName('eval_lisp_with_result')).toBe('evalLisp');
    expect(toolNameToFuncName('set_entity')).toBe('setEntityProperty');
  });
});

describe('handler-loader 静态清单', () => {
  it('清单与 src/handlers/*-handlers.js 一致（新增 handler 不能漏改）', () => {
    const files = fs
      .readdirSync(HANDLER_DIR)
      .filter((f) => f.endsWith('-handlers.js'))
      .map((f) => f.replace('-handlers.js', ''))
      .sort();

    expect([...HANDLER_MODULE_NAMES].sort()).toEqual(files);
  });

  it('目录缺失时仍返回全部静态 handler 文件名', () => {
    const names = handlerFileNames([]);

    expect(names).toContain('cad-handlers.js');
    expect(names).toContain('draw-handlers.js');
    expect(names).toHaveLength(HANDLER_MODULE_NAMES.length);
  });

  it('合并 readdir 结果，不丢掉目录里的新 handler', () => {
    const names = handlerFileNames(['cad-handlers.js', 'new-handler-handlers.js']);

    expect(names).toContain('cad-handlers.js');
    expect(names).toContain('new-handler-handlers.js');
    expect(new Set(names).size).toBe(names.length);
  });
});
