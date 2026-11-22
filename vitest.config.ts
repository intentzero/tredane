import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: [
      'node_modules/**',
      'dist/**',
      'site/**',
      // Runtime Cloudflare (createTestHarness) — `npm run test:runtime`
      'src/**/*.harness.test.ts',
    ],
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.test.ts'],
          exclude: ['src/client/**', 'src/**/*.harness.test.ts'],
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          // Include *.test.ts under src/client (panel helpers) — previously
          // orphaned: node project excludes src/client/** and jsdom only had *.tsx.
          include: ['src/client/**/*.test.tsx', 'src/client/**/*.test.ts'],
          setupFiles: ['./src/client/test/setup-jsdom.ts'],
        },
      },
    ],
  },
})
