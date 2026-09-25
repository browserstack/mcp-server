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
  },
})
