# A synthetic second product, for the cross-product tests only

`secondproduct.capability-index.json` is **made up**. It describes a widget catalogue that
does not exist, with dummy capabilities (`list_widgets`, `get_sprocket`, …) that are not
real endpoints and are never called. **Nothing here ships** — `package.json` publishes
`dist` and `capability/`, and `capability/` holds tm alone.

## Why it exists

`capabilityRegistryRouting` and the disambiguation tests in `capabilityRegistryE2E` are
about telling two products apart: the shared-term gate, per-product scoping, `vocabularyOf`
and the "Which product?" clarify question. With one index loaded there is no ambiguity to
detect and the gate is correct to stay silent, so a single-product repository cannot
exercise any of it. That machinery is shipped code in `src/`, so deleting its only tests
along with the second index would have left a live feature untested rather than unused.

A real second product was used here at first. It was replaced because carrying another
team's artifact as test data invites two problems: it drifts from their real one, and it
implies this repository ships it.

## What the tests depend on

Change these and the tests will tell you, but the reasoning is worth keeping:

- **It shares exactly four terms with tm, all on purpose:** `project`, `run`, `report` and
  `reports`. Those collisions are what the clarify gate fires on, and `report`/`reports` as
  two separate aliases is what makes plural-folding matter on the VOCABULARY side as well
  as the query side. Every other entity and alias — widget, gadget, sprocket, blueprint,
  pipeline, channel, quota, token — is deliberately absent from tm's 196-term vocabulary,
  so the routing assertions measure routing rather than an accident of overlap.
- **It authors no entity `description`s.** One test asserts they are *absent* rather than
  empty, which is the case of a product onboarded before its vocabulary is written.
- **`catalogue` appears in most of its intents.** A term common inside a small product but
  rare across both is what makes the same query score differently per scope, which is the
  point of the corpus-relative weakness tests. A term used by only a few capabilities does
  not reproduce it.
