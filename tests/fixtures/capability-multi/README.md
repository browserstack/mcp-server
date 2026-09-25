# A second product, for the cross-product tests only

This directory exists so `capabilityRegistryRouting` and the disambiguation tests in
`capabilityRegistryE2E` have two products to tell apart. **Nothing here ships.**

`package.json` publishes `dist` and `capability/`, and `capability/` on this branch holds
tm alone. The registry's cross-product machinery — the shared-term gate, per-product
scoping, `vocabularyOf` — is a real feature of the shipped code, so deleting its only
tests along with the second index would have left it untested rather than unused.

The file is the loadtesting index **as published at the branch point**, used verbatim as
test data. It is not maintained here: improvements to it belong to the loadtesting team's
own artifact, not to a fixture.
