import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{js,mjs}'],
    testTimeout: 10000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      // vitest 4 默认在有失败用例时不产出报告（CI 里会静默拿到空数据），显式打开。
      reportOnFailure: true,
      thresholds: {
        statements: 58,
        lines: 60,
        functions: 55,
        branches: 50,
      },
      include: ['src/**/*.js'],
      exclude: [
        'src/html/**',
        'src/locales/**',
        'src/prompts/definitions/**',
        'src/standards/**',
      ],
    },
  },
});
