#!/usr/bin/env python3
"""
Static contract check: does a capability's `returns` agree with its resolved 2xx schema?

Why this one invariant. Three contract corrections have landed as half-fixes — `returns`
moved, the response schema left behind — and in each case the person editing fixed the
field they were looking at. For the registry side it is worse than an oversight: overrides
carry guidance, intent, returns and bind, and NOT response schemas, so a correction from
there is a half-fix by construction. This check is the one invariant that being unable to
edit schemas makes them structurally incapable of maintaining.

No fixture, no live call, no agents.

  check-contract.py <index.json> [--quiet]
  check-contract.py <index.json> --baseline <baseline.json> [--quiet]   # gate on the delta
  check-contract.py <index.json> --write-baseline <baseline.json>       # re-record

WHY THE GATE IS ON THE DELTA AND NOT ON ZERO

The tm index carries 362 unbacked fields today and loadtesting 73. Most are unvalidated
and some will turn out legitimate — a `returns` entry can name a field of a nested object
that the schema describes loosely. Gating on zero would mean the check never runs in CI
at all, which is how it has sat unwired since it was written. Gating on "no NEW unbacked
field relative to the recorded baseline" is enforceable today and would have caught all
three half-fixes on the day each landed. Zero is a project; this is a gate.

The baseline is a ratchet. It is committed, it only ever shrinks, and shrinking it is the
work — `--write-baseline` after a real fix, never to make a red build green.
"""
import json, sys

def load(p):
    d = json.load(open(p))
    return d, d[list(k for k in d if k not in ('schema_version','version','build_id'))[0]]

def resolve(tm, node, seen=None, path=''):
    """Every leaf-ish property name reachable from a response node, with its dotted path."""
    seen = seen or frozenset()
    out = []
    if not isinstance(node, dict):
        return out
    if '$response' in node:
        k = node['$response']
        return [] if k in seen else resolve(tm, tm['responses'].get(k, {}), seen | {k}, path)
    if '$schema' in node:
        k = node['$schema']
        return [] if k in seen else resolve(tm, tm['schemas'].get(k, {}), seen | {k}, path)
    for name, sub in (node.get('properties') or {}).items():
        p = f"{path}.{name}" if path else name
        out.append((p, name))
        out += resolve(tm, sub, seen, p)
    for key in ('items', 'schema'):
        if key in node:
            out += resolve(tm, node[key], seen, path)
    for a in (node.get('allOf') or []):
        out += resolve(tm, a, seen, path)
    return out

# Nothing is suppressed. `success`, `data`, `info` and friends were filtered here as
# "structural", which was a convenience and not a principle: if a schema fails to declare
# `success`, a caller trips over it exactly like any other field. The suppression also hid
# part of a disagreement with an independent implementation and made it look like a
# resolver difference rather than a definitional one.
ENVELOPE = frozenset()


def scan(path):
    """The findings, as data. Printing and gating are both built on this."""
    d, tm = load(path)
    rows, no2xx, empty = [], [], []
    for c in tm['capabilities']:
        ret = c.get('returns') or []
        r = (c.get('responses') or {})
        node = r.get('200') or r.get('201') or r.get('202')
        # Two classes this check was blind to until a live probe found them. A capability
        # can declare only a 400 or a 404 — one had an accurate response envelope sitting
        # orphaned in the index that nothing referenced — or declare a 200 whose schema is
        # the empty literal {"type": "object"}. Both describe nothing and neither has a
        # `returns` entry to disagree with, so skipping them hid the worst cases.
        if not any(k in r for k in ('200', '201', '202', '204')):
            no2xx.append(c['name'])
            continue
        if isinstance(node, dict) and node.get('schema') == {'type': 'object'}:
            empty.append(c['name'])
            continue
        if not ret or not node:
            continue
        pairs = resolve(tm, node)
        # A schema that resolves to NOTHING is the strongest finding here, not an absent
        # one: the capability declares fields and its 2xx describes no payload at all, so
        # every entry is unbacked. Skipping these hid 12 capabilities and ~120 fields.
        names = {n for _, n in pairs}
        missing = [f for f in ret if f.split('.')[-1] not in names and f.split('.')[-1] not in ENVELOPE]
        if missing:
            rows.append((c['name'], missing, sorted({n for _, n in pairs if n not in ENVELOPE})))
    rows.sort(key=lambda r: -len(r[1]))
    return d, tm, rows, no2xx, empty


def report(d, tm, rows, no2xx, empty, quiet):
    print(f"index v{d.get('version')}   capabilities {len(tm['capabilities'])}\n")
    print(f"`returns` names a field the resolved 2xx schema has no property for, at any depth:")
    print(f"  {len(rows)} capabilities, {sum(len(m) for _, m, _ in rows)} fields\n")
    if not quiet:
        for name, missing, decl in rows:
            print(f"  {name}  ({len(missing)})")
            print(f"      unbacked : {', '.join(missing[:12])}{' …' if len(missing) > 12 else ''}")
            print(f"      declared : {', '.join(decl[:12])}{' …' if len(decl) > 12 else ''}")
    if no2xx:
        print(f"\nno 2xx response declared at all: {len(no2xx)}")
        for n in no2xx: print(f"    {n}")
    if empty:
        print(f"\n2xx schema is the empty literal {{'type': 'object'}}: {len(empty)}")
        for n in empty: print(f"    {n}")


def as_baseline(index_path, rows, no2xx, empty):
    return {
        'index': index_path,
        'unbacked': {name: sorted(missing) for name, missing, _ in rows},
        'no_2xx': sorted(no2xx),
        'empty_2xx': sorted(empty),
    }


def gate(index_path, baseline_path, rows, no2xx, empty):
    """Fail only on findings the baseline does not already carry."""
    try:
        base = json.load(open(baseline_path))
    except FileNotFoundError:
        print(f"no baseline at {baseline_path} — write one with --write-baseline", file=sys.stderr)
        return 2

    base_unbacked = {k: set(v) for k, v in (base.get('unbacked') or {}).items()}
    now_unbacked = {name: set(missing) for name, missing, _ in rows}

    new_fields = {
        name: sorted(fields - base_unbacked.get(name, set()))
        for name, fields in now_unbacked.items()
        if fields - base_unbacked.get(name, set())
    }
    new_no2xx = sorted(set(no2xx) - set(base.get('no_2xx') or []))
    new_empty = sorted(set(empty) - set(base.get('empty_2xx') or []))

    # The other direction is not a failure, but it is the only thing that should ever move
    # the baseline, so say it plainly and name the command.
    fixed_fields = sum(
        len(fields - now_unbacked.get(name, set()))
        for name, fields in base_unbacked.items()
    )

    if not (new_fields or new_no2xx or new_empty):
        line = f"contract gate OK — no new unbacked field in {index_path}"
        if fixed_fields:
            line += f"; {fixed_fields} fewer than the baseline, re-record with --write-baseline"
        print(line)
        return 0

    print(f"\ncontract gate FAILED for {index_path}\n", file=sys.stderr)
    print("A capability declares a field in `returns` that its resolved 2xx schema has no", file=sys.stderr)
    print("property for. describeCapability will publish the field; a caller reading the", file=sys.stderr)
    print("schema will not find it. Fix BOTH halves — moving `returns` alone is what this", file=sys.stderr)
    print("check exists to catch.\n", file=sys.stderr)
    for name, fields in sorted(new_fields.items()):
        print(f"  {name}", file=sys.stderr)
        print(f"      new unbacked : {', '.join(fields)}", file=sys.stderr)
    for n in new_no2xx:
        print(f"  {n}\n      newly declares no 2xx response at all", file=sys.stderr)
    for n in new_empty:
        print(f"  {n}\n      2xx schema is newly the empty literal {{'type': 'object'}}", file=sys.stderr)
    total = sum(len(f) for f in new_fields.values()) + len(new_no2xx) + len(new_empty)
    print(f"\n{total} new finding(s). The baseline is a ratchet: it moves down after a real", file=sys.stderr)
    print("fix, never up to make this green.", file=sys.stderr)
    return 1


def arg(flag):
    return sys.argv[sys.argv.index(flag) + 1] if flag in sys.argv else None


def main():
    index_path = sys.argv[1]
    quiet = '--quiet' in sys.argv
    d, tm, rows, no2xx, empty = scan(index_path)

    write_to = arg('--write-baseline')
    if write_to:
        with open(write_to, 'w') as f:
            json.dump(as_baseline(index_path, rows, no2xx, empty), f, indent=2, sort_keys=True)
            f.write('\n')
        n = sum(len(m) for _, m, _ in rows)
        print(f"baseline written to {write_to}: {len(rows)} capabilities, {n} fields, "
              f"{len(no2xx)} without a 2xx, {len(empty)} empty")
        return 0

    baseline_path = arg('--baseline')
    if baseline_path:
        if not quiet:
            report(d, tm, rows, no2xx, empty, quiet=True)
        return gate(index_path, baseline_path, rows, no2xx, empty)

    report(d, tm, rows, no2xx, empty, quiet)
    return 1 if (rows or no2xx or empty) else 0


if __name__ == '__main__':
    sys.exit(main())
