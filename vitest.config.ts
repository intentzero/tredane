import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: [
      'node_modules/**',
      'dist/**',
      // Runtime Cloudflare (createTestHarness) — `npm run test:runtime`
      'src/**/*.harness.test.ts',
    ],
  },
})
