/// <reference types="vitest" />

import { defineConfig } from 'vite'

export default defineConfig({
  test: {
    setupFiles: ['./tests/setup.ts'],
    // 5s is vitest's default and it is too tight for this suite on a loaded machine.
    // Several tests build the whole server factory before asserting anything, and a
    // handful walk 198 eval cases; in isolation each takes 1-3s, but run in parallel
    // alongside other work they cross 5s and fail on TIME rather than on a number.
    //
    // That failure mode is worse than a slow suite: 21 tests "failed" in one run and
    // passed in the next with no code change, which trains a reader to re-run instead
    // of to look. The budget is generous rather than tuned, because the thing being
    // bounded is a hang, not a performance target.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    projects: [
      // tests/manual run offline, so they stay in the unit project.
      {
        extends: true,
        test: { name: 'unit', include: ['tests/**/*.test.ts'], exclude: ['tests/e2e/**'] },
      },
      { extends: true, test: { name: 'e2e', include: ['tests/e2e/**/*.e2e.test.ts'] } },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'],
      reporter: ['text-summary', 'cobertura', 'html', 'json-summary'],
      reportsDirectory: 'reports/coverage',
      // Floors = main measured on 2026-11-26, minus 1 pt, rounded down. Raise by hand.
      // Lower only with QA approval.
      thresholds: {
        lines: 77,
        branches: 72,
        functions: 79,
        statements: 77,
        'src/tools/capability-registry/**': { lines: 95, branches: 87 },
        'src/lib/**': { lines: 83, branches: 82 },
      },
    },
  },
})
