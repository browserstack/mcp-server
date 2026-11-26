/// <reference types="vitest" />

// Vitest config for Stryker (npm run test:mutation) only. Normal runs use vite.config.ts.
//
// Unit tests only, no projects and no coverage: Stryker measures coverage itself.
// Keep setupFiles and the timeouts the same as vite.config.ts.
// Tests that read src/ as text skip themselves in a Stryker worker (itSourceText).
import { defineConfig } from 'vite'

export default defineConfig({
  test: {
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**'],
  },
})
