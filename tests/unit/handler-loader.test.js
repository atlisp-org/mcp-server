import { describe, it, expect } from 'vitest';
import { join } from 'path';

describe('Handler Loader', () => {
  it('should map tools to modules correctly', () => {
    const toolModuleMap = {
      connect_cad: 'cad',
      list_packages: 'package',
      get_entity: 'entity',
      create_layer: 'layer',
      create_box: 'd3',
    };
    expect(toolModuleMap.connect_cad).toBe('cad');
    expect(toolModuleMap.create_box).toBe('d3');
  });

  it('should map tools to function names correctly', () => {
    const toolFunctionMap = {
      connect_cad: 'connectCad',
      list_packages: 'listPackages',
      create_layer: 'createLayer',
    };
    expect(toolFunctionMap.connect_cad).toBe('connectCad');
  });
});
