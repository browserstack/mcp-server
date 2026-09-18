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

# Envelope keys are structural, not payload fields; `returns` never lists them.
ENVELOPE = {'success', 'data', 'info', 'message', 'error', 'errors', 'async', 'unique_id'}

def main(path, quiet=False):
    d, tm = load(path)
    rows = []
    for c in tm['capabilities']:
        ret = c.get('returns') or []
        r = (c.get('responses') or {})
        node = r.get('200') or r.get('201') or r.get('202')
        if not ret or not node:
            continue
        pairs = resolve(tm, node)
        if not pairs:
            continue
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
    return 1 if rows else 0

if __name__ == '__main__':
    sys.exit(main(sys.argv[1], '--quiet' in sys.argv))
