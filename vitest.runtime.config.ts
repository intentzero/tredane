import { defineConfig } from 'vitest/config'

/** Integração no runtime Workers (createTestHarness). Separado dos unit tests Node. */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.harness.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
