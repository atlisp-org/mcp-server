import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{js,mjs}'],
    testTimeout: 10000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
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
