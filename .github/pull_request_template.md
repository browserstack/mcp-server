## Summary

<!-- What changed and why. -->

## Test plan

- [ ] `npm run lint` and `npx tsc --noEmit` pass
- [ ] `npm run test:coverage` passes (coverage floors in `vite.config.ts`)
- [ ] Mutation-tested the changed files: `/stack:unit-test-quality` (harness skill), or `npx stryker run --mutate <file1>,<file2>`. Survived mutants have a stronger test, or are explained here:

- [ ] Changed a capability index: each new capability has a search-eval case (`tests/fixtures/search-eval/<product>.json`), and `npm run check:contract` passes. If a case got worse, `npx tsx scripts/eval-index.mts --product <p> --against main` shows which new entries pushed it down. Fix the description, not the case.

<!-- Mutation score and any survived mutants left as they are, with the reason. -->

Comment `RUN_MCP_CHECKS` to run the "MCP Server PR Checks" status. A new push needs a new comment.
