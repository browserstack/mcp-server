---
name: unit-test-quality
description: Check that the unit tests for this branch's changes would catch a bug, not only run the code. Runs diff coverage and a Stryker mutation run on the changed src/ files only, then explains each surviving mutant and proposes a stronger assertion. Advice only, it never blocks. Use before review, when the PR template asks "Ran /unit-test-quality", or when asked "are my tests good enough", "check test quality", "mutation test my change".
---

# /unit-test-quality

Coverage counts a line that a test runs, even with no assertion. This skill asks a harder question about the lines this branch changed: **if the code were wrong, would a test fail?**

```text
 changed src/ files (vs origin/main)
   │
   ├─ 1. diff coverage   which changed lines does no test run?
   ├─ 2. Stryker         small bugs in the changed files → killed ✓ / survived ✗
   └─ 3. report          each gap → the test to add or the assertion to make stronger
```

Advice only. It never fails the PR. The gates (coverage floors, diff coverage) run in the "MCP Server PR Checks" status.

## Inputs

- Base: `origin/main` unless the user names another base.
- Scope: changed `src/**/*.ts` files, excluding `src/index.ts`. If there are none, say so and stop.

## Steps

1. **Find the changed files.**
   `git fetch origin main` then `git diff --name-only --diff-filter=AM origin/main...HEAD -- 'src/**/*.ts'`. Add staged and unstaged changes (`git diff --name-only HEAD -- src`). Drop `src/index.ts`.

2. **Diff coverage.**
   Run `npm run test:coverage`. Then run diff-cover on the Cobertura report:
   `diff-cover reports/coverage/cobertura-coverage.xml --compare-branch=origin/main`.
   If `diff-cover` is not installed, install it in a throwaway venv (`python3 -m venv /tmp/dc && /tmp/dc/bin/pip install diff-cover==9.2.0`). Do not install it globally.
   List each changed line that no test runs.

3. **Mutation run on the changed files only.**
   `npx stryker run --mutate <file1>,<file2>,...`
   A full run (all of capability-registry + lib) takes a long time. That is the weekly job's work, not this skill's. If the changed files hold more than about 400 mutants (Stryker prints the count at the start), ask before you continue.
   Read `reports/mutation/mutation.json`. Keep the mutants with status `Survived` and `NoCoverage`.

4. **Explain each gap.** For each survived or uncovered mutant:
   - Show the original line and the mutated line.
   - Name the tests that ran it (`coveredBy` in the JSON), or say that none did.
   - Say what a test must assert to kill it. Example: a surviving `a.score - b.score` → `a.score + b.score` means no test checks the order of the result, so assert the order.
   - Mark it **equivalent** when the mutant cannot change behaviour (for example, a log message or a branch that gives the same result). Do not ask for a test for an equivalent mutant.

5. **Report.** Print one table, then the details:

   | File | Mutation score | Killed | Survived | No coverage | Changed lines not run |
   | --- | --- | --- | --- | --- | --- |

   Under it, list the proposed test changes, most important first: public behaviour before internal detail.

6. **Write tests only when the user asks.** Then follow the rules below, run the new tests, and run Stryker on the same files again to show the new score.

## Rules for the tests you propose

- Test what an MCP client sees: the tool result, `isError`, the text and its shape. Do not test private helpers when a public path reaches them.
- One clear assertion of behaviour beats many `toBeDefined()` or `toHaveBeenCalled()` checks.
- Do not assert on a mock only to prove that the mock was called. Assert the result the code built from it.
- Do not read `src/` files as text. If a test must do that, use `itSourceText` (see `tests/tools/capabilityRoutingAnchors.test.ts`). Stryker rewrites `src/` while it runs, so a plain text test fails there.
- Keep tests offline. HTTP goes through mocks, as in the existing tests.

## Output when done

End with one line the developer can paste into the PR:

```text
/unit-test-quality: <n> files, mutation score <x>% (<killed>/<total>), <s> survived (<e> equivalent), <u> changed lines not run.
```

Then they tick "Ran /unit-test-quality" in the PR template.
