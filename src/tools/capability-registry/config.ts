/**
 * Where the index comes from, and where each product lives.
 *
 * A product may DECLARE its host in its own index file (`<product>.base_url`, authored in
 * the harness's product.yaml and carried through by the export). That is the default, not
 * the last word: config overrides it, and for a region-sharded product account discovery
 * outranks it — see `resolveBaseUrl`. The same artifact therefore still ships to every
 * environment, because anything environment- or account-specific is resolved here.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import logger from "../../logger.js";
import { BrowserStackConfig } from "../../lib/types.js";
import { getTMBaseURL } from "../../lib/tm-base-url.js";
import { discoverBaseUrl, HostSource } from "./discovery.js";
import { Credentials, Transport, fetchTransport } from "./egress.js";
import { FLAT_SUFFIX, INDEX_FILE, InvocationError } from "./index-loader.js";

/**
 * The environment this DEPLOYMENT points at, e.g. "preprod".
 *
 * Process-level on purpose, and the distinction from region matters: an environment is a
 * property of the deployment (this instance talks to preprod), whereas a REGION is a
 * property of the account (this user's data lives in EU). That is why region discovery is
 * per request and never cached under REMOTE_MCP, while the environment is read once here.
 */
export function selectedEnvironment(): string {
  return (process.env.CAPABILITY_REGISTRY_ENV || "").trim();
}

/** product -> env -> host, the analogue of Atlas's `harness.extra_environments`. */
function environmentMap(): Record<string, Record<string, string>> {
  const raw = process.env.CAPABILITY_REGISTRY_BASE_URLS;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    // A malformed map must not silently mean "no override" — that would send a preprod
    // deployment at production.
    throw new InvocationError(
      "CAPABILITY_REGISTRY_BASE_URLS is not valid JSON; expected {product: {env: url}}",
    );
  }
}

/**
 * Built-in host discovery, for a product whose regional hosts are not in its index yet.
 *
 * The general mechanism lives in `discovery.ts` and is driven by the index's `base_urls`.
 * This map is the bridge for products that predate that: tm's hosts are still hardcoded in
 * `lib/tm-base-url.ts` and shared with the hand-written Test Management tools. Once tm's
 * product.yaml declares `base_urls`, this entry can go and nothing else changes.
 */
const BUILTIN_DISCOVERY: Record<
  string,
  (config: BrowserStackConfig) => Promise<string>
> = {
  tm: getTMBaseURL,
};

/** True when this product's host is account-specific and must be discovered per call. */
export function isRegionSharded(product: string, source?: HostSource): boolean {
  return (source?.base_urls?.length ?? 0) > 1 || product in BUILTIN_DISCOVERY;
}

function credentialsFrom(config: BrowserStackConfig): Credentials {
  return {
    username: config["browserstack-username"],
    accessKey: config["browserstack-access-key"],
  };
}

/**
 * Resolve a product's host.
 *
 * Atlas resolves: an explicit per-session override, then the host for the session's
 * environment (`harness.extra_environments[env][product]`), then the profile's own
 * `base_url`. The same rungs, in the same order, with one addition:
 *
 *   1. CAPABILITY_REGISTRY_BASE_URL_<PRODUCT>            explicit, environment-agnostic
 *   2. CAPABILITY_REGISTRY_BASE_URL_<PRODUCT>_<ENV>      this environment's host
 *   3. CAPABILITY_REGISTRY_BASE_URLS {product:{env:url}} the same, as one map
 *   4. account discovery — the index's `base_urls`, probed
 *   5. the single host declared in the index, `base_url`
 *   6. refuse, by name
 *
 * DISCOVERY OUTRANKS THE DECLARED HOST, which is where this departs from Atlas. A declared
 * host is one fixed origin, so for a region-sharded product it would send every account
 * outside the default region to the wrong host — a failure that only shows up on those
 * accounts, and so passes any test run from inside the default one. Discovery answers with
 * the region the account is actually on; `base_url` is the fallback for when the probe
 * cannot answer at all.
 *
 * Refusing rather than guessing is deliberate: a guessed host fails as a DNS error or a 404
 * that reads like the caller's problem, when it is our missing configuration.
 */
export async function resolveBaseUrl(
  product: string,
  config: BrowserStackConfig,
  source?: HostSource,
  transport?: Transport,
): Promise<string> {
  const key = product.toUpperCase();
  const environment = selectedEnvironment();
  const trim = (url: string) => url.replace(/\/$/, "");

  const explicit = process.env[`CAPABILITY_REGISTRY_BASE_URL_${key}`];
  if (explicit) return trim(explicit);

  if (environment) {
    const suffixed =
      process.env[
        `CAPABILITY_REGISTRY_BASE_URL_${key}_${environment.toUpperCase()}`
      ];
    if (suffixed) return trim(suffixed);
    const mapped = environmentMap()[product]?.[environment];
    if (mapped) return trim(String(mapped));
    // An environment was named and nothing defines its host. Falling back to discovery or
    // to the declared production host here would send a preprod deployment at production,
    // silently.
    throw new InvocationError(
      `environment '${environment}' has no host for product '${product}'. Set ` +
        `CAPABILITY_REGISTRY_BASE_URL_${key}_${environment.toUpperCase()} or add it to ` +
        `CAPABILITY_REGISTRY_BASE_URLS.`,
    );
  }

  /** A declared host is a better answer than none — but only after discovery has tried. */
  const fallback = (error: unknown): string => {
    if (!source?.base_url) throw error;
    logger.warn(
      "host discovery failed for product %s (%s); falling back to the declared host %s",
      product,
      error instanceof Error ? error.message : String(error),
      source.base_url,
    );
    return trim(source.base_url);
  };

  if ((source?.base_urls?.length ?? 0) > 0) {
    try {
      return await discoverBaseUrl(
        product,
        source!,
        credentialsFrom(config),
        transport || fetchTransport(),
      );
    } catch (error) {
      return fallback(error);
    }
  }

  const builtin = BUILTIN_DISCOVERY[product];
  if (builtin) {
    try {
      return trim(await builtin(config));
    } catch (error) {
      return fallback(error);
    }
  }

  if (source?.base_url) return trim(source.base_url);

  throw new InvocationError(
    `no host is configured for product '${product}': its index declares none and there ` +
      `is no override. Set CAPABILITY_REGISTRY_BASE_URL_${key}.`,
  );
}

/** The directory holding one subdirectory per product. */
const INDEX_ROOT = "capability";

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Every product index under one directory, sorted so load order is stable.
 *
 * `<product>.capability-index.json` is the stored layout — the export publishes that exact
 * filename, so an artifact drops in unrenamed. `<product>/index.json` is also accepted, so
 * a checkout using the earlier nested layout keeps working.
 */
function filesIn(directory: string): string[] {
  if (!isDirectory(directory)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(directory).sort()) {
    const path = join(directory, entry);
    if (entry.endsWith(FLAT_SUFFIX)) {
      found.push(path);
    } else if (isDirectory(path) && existsSync(join(path, INDEX_FILE))) {
      found.push(join(path, INDEX_FILE));
    }
  }
  return found;
}

/**
 * Locate the artifact(s).
 *
 * ONE FILE PER PRODUCT, so this returns a list. Explicit env wins; otherwise look for a
 * `capability/` directory beside the compiled module and at the package root, then fall
 * back to a single `capability-index.json` for the pre-release layout. The package-root
 * candidates exist because `tsc` compiles TS and does not copy JSON into `dist`.
 *
 * Returns an empty list when nothing is found — the caller logs that and registers no
 * tools, rather than throwing.
 */
export function indexPaths(): string[] {
  const configuredFile = process.env.CAPABILITY_REGISTRY_INDEX;
  if (configuredFile) {
    return existsSync(configuredFile) ? [resolve(configuredFile)] : [];
  }
  const configuredDir = process.env.CAPABILITY_REGISTRY_INDEX_DIR;
  if (configuredDir) return filesIn(resolve(configuredDir));

  const here = dirname(fileURLToPath(import.meta.url));
  const roots = [
    here,
    join(here, "..", "..", ".."), // dist/ or src/ -> package root
    join(here, "..", "..", "..", ".."),
  ];
  for (const root of roots) {
    // `capabilities` (plural) is the layout this shipped with before the move to
    // `capability/<product>/index.json`; still read so an existing checkout keeps working.
    for (const name of [INDEX_ROOT, "capabilities"]) {
      const found = filesIn(join(root, name));
      if (found.length > 0) return found;
    }
    const loose = filesIn(root);
    if (loose.length > 0) return loose;
  }
  for (const root of roots) {
    const legacy = join(root, "capability-index.json");
    if (existsSync(legacy)) return [legacy];
  }
  return [];
}

/** Off by default is wrong for a shipped feature, but a kill switch is not. */
export function isEnabled(): boolean {
  return (
    (process.env.CAPABILITY_REGISTRY_DISABLED || "").toLowerCase() !== "true"
  );
}
