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

  check_contract.py <index.json> [--quiet]
"""
import json, sys, collections

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

def main(path, quiet=False):
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
    return 1 if (rows or no2xx or empty) else 0

if __name__ == '__main__':
    sys.exit(main(sys.argv[1], '--quiet' in sys.argv))
