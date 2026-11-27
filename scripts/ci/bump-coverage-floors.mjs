#!/usr/bin/env node
// Raise the Vitest coverage floors in vite.config.ts to "measured - 1 pt", rounded down.
// A floor never goes down. The CI PR-checks job runs it on a build of main/master
// and opens a PR when something changed. Lower a floor by hand, with QA approval.
//
// Usage: node bump-coverage-floors.mjs <vite.config.ts> <coverage-summary.json> <out.json>
// Run from the repo root (coverage-summary.json keys are absolute paths).
//
// Expected format inside `thresholds: { ... }` (one entry per line):
//   lines: 77,
//   'src/lib/**': { lines: 83, branches: 82 },
// A scope must be a directory glob '<dir>/**'. Any other line or scope stops the
// script (exit 2), so a format change is seen and a floor is never set too high.
import fs from 'node:fs';
import path from 'node:path';

const [cfgPath, summaryPath, outPath] = process.argv.slice(2);
if (!cfgPath || !summaryPath || !outPath) {
  console.error('usage: bump-coverage-floors.mjs <vite.config.ts> <coverage-summary.json> <out.json>');
  process.exit(2);
}

const METRICS = ['lines', 'branches', 'functions', 'statements'];
const cfg = fs.readFileSync(cfgPath, 'utf8');
const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
const root = process.cwd() + path.sep;

// '<dir>/**' -> '<dir>/'. Other patterns ('src/a.ts', 'src/*.ts', '**/x/**') are not
// a plain prefix, so they stop the script instead of matching the wrong files.
function dirPrefix(glob) {
  const m = glob.match(/^([^*?[\]{}!]+\/)\*\*$/);
  if (!m) {
    console.error(`unsupported threshold scope '${glob}': use a directory glob '<dir>/**'`);
    process.exit(2);
  }
  return m[1];
}

// Measured % for the whole run (glob = null) or for the files under a '<dir>/**' glob.
function measured(glob, metric) {
  if (!glob) {
    const t = summary.total[metric];
    return t.total ? (100 * t.covered) / t.total : null;
  }
  const prefix = dirPrefix(glob);
  let covered = 0;
  let total = 0;
  for (const [file, v] of Object.entries(summary)) {
    if (file === 'total') continue;
    const rel = file.startsWith(root) ? file.slice(root.length) : file;
    if (!rel.startsWith(prefix)) continue;
    covered += v[metric].covered;
    total += v[metric].total;
  }
  return total ? (100 * covered) / total : null;
}

const rows = [];
function next(scope, glob, metric, current) {
  const m = measured(glob, metric);
  if (m === null) return current;
  const target = Math.floor(m - 1);
  if (target > current) rows.push({ scope, metric, from: current, to: target, measured: Number(m.toFixed(2)) });
  return Math.max(current, target);
}

const start = cfg.indexOf('thresholds: {');
if (start < 0) {
  console.error(`no "thresholds: {" in ${cfgPath}`);
  process.exit(2);
}
let depth = 0;
let end = -1;
for (let i = start + 'thresholds: '.length; i < cfg.length; i++) {
  if (cfg[i] === '{') depth++;
  if (cfg[i] === '}' && --depth === 0) { end = i; break; }
}
if (end < 0) {
  console.error('unbalanced thresholds block');
  process.exit(2);
}

const head = cfg.slice(0, start);
const blockLines = cfg.slice(start, end + 1).split('\n');
const globalRe = /^(\s*)(lines|branches|functions|statements):\s*(\d+)(,?)\s*$/;
const globRe = /^(\s*)'([^']+)':\s*\{([^}]*)\}(,?)\s*$/;

const out = blockLines.map((line, i) => {
  if (i === 0 || i === blockLines.length - 1 || line.trim() === '') return line;
  let m = line.match(globalRe);
  if (m) {
    const [, ind, metric, cur, comma] = m;
    return `${ind}${metric}: ${next('all code', null, metric, Number(cur))}${comma}`;
  }
  m = line.match(globRe);
  if (m) {
    const [, ind, glob, inner, comma] = m;
    const pairs = inner.split(',').map((p) => p.trim()).filter(Boolean).map((p) => {
      const pm = p.match(/^(\w+):\s*(\d+)$/);
      if (!pm || !METRICS.includes(pm[1])) {
        console.error(`cannot parse "${p}" in: ${line.trim()}`);
        process.exit(2);
      }
      return `${pm[1]}: ${next(glob, glob, pm[1], Number(pm[2]))}`;
    });
    return `${ind}'${glob}': { ${pairs.join(', ')} }${comma}`;
  }
  console.error(`unexpected line in thresholds block: ${line.trim()}`);
  process.exit(2);
});

const changed = rows.length > 0;
if (changed) {
  const today = new Date().toISOString().slice(0, 10);
  const newHead = head.replace(/(Floors = main measured on )\d{4}-\d{2}-\d{2}/, `$1${today}`);
  fs.writeFileSync(cfgPath, newHead + out.join('\n') + cfg.slice(end + 1));
}
fs.writeFileSync(outPath, JSON.stringify({ changed, rows }, null, 2) + '\n');
console.log(changed
  ? rows.map((r) => `${r.scope} ${r.metric}: ${r.from} -> ${r.to} (measured ${r.measured})`).join('\n')
  : 'Floors are current. Nothing to bump.');
