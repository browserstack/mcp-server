#!/usr/bin/env node
// Summarise a Stryker mutation.json (mutation-testing-report-schema) for the
// weekly CI mutation job.
//
// Usage: node mutation-summary.mjs <mutation.json> <summary.md>
// Prints one line: "Mutation score <x>% (<detected>/<valid>), <s> survived, <n> no coverage".
//
// Score as Stryker counts it: detected = killed + timeout;
// valid = detected + survived + no coverage (errors and ignored are left out).
import fs from 'node:fs';

const [inPath, outPath] = process.argv.slice(2);
if (!inPath || !outPath) {
  console.error('usage: mutation-summary.mjs <mutation.json> <summary.md>');
  process.exit(2);
}
const report = JSON.parse(fs.readFileSync(inPath, 'utf8'));

const empty = () => ({ killed: 0, timeout: 0, survived: 0, noCoverage: 0 });
const add = (t, status) => {
  if (status === 'Killed') t.killed++;
  else if (status === 'Timeout') t.timeout++;
  else if (status === 'Survived') t.survived++;
  else if (status === 'NoCoverage') t.noCoverage++;
};
const valid = (t) => t.killed + t.timeout + t.survived + t.noCoverage;
const score = (t) => (valid(t) ? (100 * (t.killed + t.timeout)) / valid(t) : null);
const pct = (t) => (score(t) === null ? 'n/a' : `${score(t).toFixed(1)}%`);

const total = empty();
const byFolder = {};
const byFile = [];
for (const [file, data] of Object.entries(report.files)) {
  const t = empty();
  for (const m of data.mutants) add(t, m.status);
  for (const k of Object.keys(t)) total[k] += t[k];
  const folder = file.includes('capability-registry/') ? 'src/tools/capability-registry'
    : file.includes('src/lib/') ? 'src/lib' : 'other';
  byFolder[folder] ??= empty();
  for (const k of Object.keys(t)) byFolder[folder][k] += t[k];
  byFile.push({ file: file.replace(/^.*?(src\/)/, '$1'), t });
}

const row = (name, t) =>
  `| ${name} | ${pct(t)} | ${t.killed + t.timeout} | ${t.survived} | ${t.noCoverage} | ${valid(t)} |`;
const head = '| Scope | Score | Detected | Survived | No coverage | Mutants |\n| --- | --- | --- | --- | --- | --- |';
const worst = byFile
  .filter((f) => f.t.survived + f.t.noCoverage > 0)
  .sort((a, b) => (b.t.survived + b.t.noCoverage) - (a.t.survived + a.t.noCoverage))
  .slice(0, 15);

const md = [
  '# Mutation report: capability-registry + lib',
  '',
  'A survived mutant is a small bug that no unit test caught. No coverage = no test runs that code.',
  '',
  head,
  row('**All**', total),
  ...Object.entries(byFolder).sort().map(([f, t]) => row(f, t)),
  '',
  '## Files with the most gaps (survived + no coverage)',
  '',
  head,
  ...worst.map((f) => row(f.file, f.t)),
  '',
].join('\n');
fs.writeFileSync(outPath, md);
console.log(`Mutation score ${pct(total)} (${total.killed + total.timeout}/${valid(total)}), ${total.survived} survived, ${total.noCoverage} no coverage`);
