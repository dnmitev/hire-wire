import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/src/**/*.test.ts'],
    exclude: ['**/node_modules/**'],
    globalSetup: ['test/global-setup.ts'],
    // Every test file shares one Postgres and truncates in beforeEach, so files must not overlap.
    fileParallelism: false,
    hookTimeout: 120_000,
  },
});
