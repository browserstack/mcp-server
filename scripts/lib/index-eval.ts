/**
 * L2 index eval: shared code for the Vitest gates and scripts/eval-index.mts.
 *
 * Everything here reads the SHIPPED index files (capability/*.capability-index.json), never
 * a copy. A frozen copy is how the tm ranking test once passed against v1.31 while users
 * got v1.46.
 *
 * Two profiles:
 *   local   all capabilities, as the npm package serves them
 *   remote  as the hosted server serves them (REMOTE_MCP=true): `local_only` capabilities
 *           become reference-only (found, but not callable), and per-surface guidance changes
 *
 * The registry applies the profile when it is BUILT (index-loader reads appConfig.REMOTE_MCP
 * at that time), and search is pure. So one process can build both profiles, one after the
 * other, with no module reload.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import appConfig from "../../src/config.js";
import { CapabilityRegistry } from "../../src/tools/capability-registry/index-loader.js";
import {
  ambiguousProducts,
  searchCapabilities,
  type ProductAmbiguity,
} from "../../src/tools/capability-registry/search.js";
import type {
  Capability,
  ProductIndex,
} from "../../src/tools/capability-registry/types.js";

export type Profile = "local" | "remote";
export const PROFILES: Profile[] = ["local", "remote"];

export const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const INDEX_DIR = join(ROOT, "capability");
export const SEARCH_EVAL_DIR = join(ROOT, "tests/fixtures/search-eval");
export const ALLOWLIST_FILE = join(SEARCH_EVAL_DIR, "allowlist.json");
export const ROUTING_EVAL_FILE = join(
  ROOT,
  "tests/fixtures/product-routing-eval.json",
);
const SUFFIX = ".capability-index.json";

/** The default number of results `searchCapability` returns. */
export const TOP = 8;

/**
 * One search-eval case: a user's words, and the capability that should answer them.
 *
 * The expected capability is named by `name`, or by `method` + `path`. Exactly one of
 * `maxRank` (the worst allowed position in the top 8) and `miss` (a known gap, with the
 * reason) is set.
 */
export interface EvalCase {
  q: string;
  name?: string;
  method?: string;
  path?: string;
  maxRank?: number;
  miss?: string;
  defect?: string;
  why?: string;
  group?: string;
  /**
   * How the hosted server serves this case. Not set: the same as local.
   * `reference`: found, but not callable there (a `local_only` capability).
   * `withheld`: must NOT be found there.
   */
  remote?: "reference" | "withheld";
}

export interface EvalFixture {
  product: string;
  note?: string;
  baseline?: {
    cases: number;
    top1: number;
    top3: number;
    top8: number;
    misses_by_defect?: Record<string, number>;
    measured_on?: string;
  };
  cases: EvalCase[];
  /** Cases taken out, each with the reason. A removed case that is not here fails the guard. */
  retired?: { q: string; why: string }[];
}

export interface RoutingCase {
  q: string;
  /** `settled`: the one product the words point at. `clash`: the products that share them. */
  expect: { settled: string } | { clash: string[] } | { unknown: true };
  why?: string;
}

export interface RoutingFixture {
  note?: string;
  cases: RoutingCase[];
}

/** product -> path of its shipped index, sorted by product. */
export function shippedIndexFiles(dir = INDEX_DIR): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of readdirSync(dir).sort()) {
    if (entry.endsWith(SUFFIX))
      out[entry.slice(0, -SUFFIX.length)] = join(dir, entry);
  }
  return out;
}

/**
 * product -> every capability in its shipped file, disabled ones included.
 *
 * The registry drops disabled capabilities, so a case that names one is not found there.
 * This raw view tells "disabled on purpose" apart from "no such capability" (a typo, or a
 * capability that was removed).
 */
export function rawCapabilities(
  files: Record<string, string> = shippedIndexFiles(),
): Record<string, Capability[]> {
  const out: Record<string, Capability[]> = {};
  for (const [product, file] of Object.entries(files)) {
    const doc = readJson<Record<string, unknown>>(file);
    out[product] =
      (doc[product] as ProductIndex | undefined)?.capabilities ?? [];
  }
  return out;
}

/** The registry as one profile serves it. */
export function loadRegistry(
  profile: Profile,
  files: string[] = Object.values(shippedIndexFiles()),
): CapabilityRegistry {
  const config = appConfig as { REMOTE_MCP: boolean };
  const before = config.REMOTE_MCP;
  config.REMOTE_MCP = profile === "remote";
  try {
    return CapabilityRegistry.fromFiles(files);
  } finally {
    config.REMOTE_MCP = before;
  }
}

export function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

/** product -> its search-eval fixture. Every file in tests/fixtures/search-eval/ except the allowlist. */
export function loadSearchFixtures(
  dir = SEARCH_EVAL_DIR,
): Record<string, EvalFixture> {
  const out: Record<string, EvalFixture> = {};
  for (const entry of readdirSync(dir).sort()) {
    if (!entry.endsWith(".json") || entry === "allowlist.json") continue;
    const fixture = readJson<EvalFixture>(join(dir, entry));
    out[entry.slice(0, -".json".length)] = fixture;
  }
  return out;
}

export function matches(capability: Capability, entry: EvalCase): boolean {
  if (entry.name) return capability.name === entry.name;
  return capability.method === entry.method && capability.path === entry.path;
}

export function describeCase(entry: EvalCase): string {
  return entry.name ?? `${entry.method} ${entry.path}`;
}

export interface Ranked {
  /** 1-based position in the top 8, or 0 when it is not there. */
  rank: number;
  /** The expected capability as found, when found. */
  hit?: Capability;
  /** The top 8, for a failure message. */
  top: Capability[];
}

/** Search one product the way `searchCapability(product, query)` does, and find the expected capability. */
export function rankIn(
  products: Record<string, ProductIndex>,
  product: string,
  entry: EvalCase,
): Ranked {
  const hits = searchCapabilities(products, entry.q, {
    product,
    limit: TOP,
  }).hits.map((h) => h.capability);
  const at = hits.findIndex((c) => matches(c, entry));
  return { rank: at + 1, hit: at >= 0 ? hits[at] : undefined, top: hits };
}

/** The product step, as `listProducts(query)` runs it. */
export function route(
  products: Record<string, ProductIndex>,
  query: string,
): ProductAmbiguity {
  return ambiguousProducts(products, query);
}

/** What a routing case expects, compared with what the code does. Undefined when they agree. */
export function routingMismatch(
  got: ProductAmbiguity,
  expected: RoutingCase["expect"],
): string | undefined {
  const sorted = (xs: string[]) => [...xs].sort().join(", ");
  if ("settled" in expected) {
    if (got.settled === expected.settled) return undefined;
    return `expected settled ${expected.settled}, got ${
      got.settled
        ? `settled ${got.settled}`
        : got.products.length
          ? `clash [${sorted(got.products)}]`
          : "nothing"
    }`;
  }
  if ("clash" in expected) {
    if (!got.settled && sorted(got.products) === sorted(expected.clash))
      return undefined;
    return `expected clash [${sorted(expected.clash)}], got ${
      got.settled ? `settled ${got.settled}` : `clash [${sorted(got.products)}]`
    }`;
  }
  if (got.unknown && !got.settled && got.products.length === 0)
    return undefined;
  return `expected unknown, got ${
    got.settled ? `settled ${got.settled}` : `clash [${sorted(got.products)}]`
  }`;
}

/** Every capability a caller can find: enabled in the local profile, by product. */
export function searchableNames(
  products: Record<string, ProductIndex>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const [product, bundle] of Object.entries(products)) {
    for (const c of bundle.capabilities) {
      if (c.name) out.set(`${product}/${c.name}`, product);
    }
  }
  return out;
}

/** `product/name` of every capability that at least one search-eval case expects. */
export function coveredNames(
  products: Record<string, ProductIndex>,
  fixtures: Record<string, EvalFixture>,
): Set<string> {
  const out = new Set<string>();
  for (const [product, fixture] of Object.entries(fixtures)) {
    const caps = products[product]?.capabilities ?? [];
    for (const entry of fixture.cases) {
      const c = caps.find((cap) => matches(cap, entry));
      if (c?.name) out.add(`${product}/${c.name}`);
    }
  }
  return out;
}

export interface Allowlist {
  note?: string;
  /** `product/name` of each capability that has no search-eval case yet. Shrink-only. */
  names: string[];
}
