/**
 * Where the index comes from, and where each product lives.
 *
 * `base_url` is deliberately NOT in the artifact — it is environment- AND account-specific,
 * so the same artifact ships everywhere and the host is resolved here.
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import { BrowserStackConfig } from "../../lib/types.js";
import { getTMBaseURL } from "../../lib/tm-base-url.js";
import { InvocationError } from "./index-loader.js";

/**
 * Resolve a product's host.
 *
 * tm is REGION-SPECIFIC and the package already discovers it: `getTMBaseURL` probes
 * test-management{,-eu,-in}.browserstack.com with the caller's credentials and returns the
 * one their account lives on. Hardcoding the default host instead would fail every EU and
 * IN account on every call, which is what an earlier version of this file did.
 *
 * An explicit override still wins, because that is how a non-production environment is
 * reached — no preprod host is or should be compiled in.
 *
 * Other products are NOT guessed. A wrong host fails as a DNS error or a 404 that reads
 * like the caller's problem; refusing names the real cause. Add one here only once its host
 * is known rather than inferred from a naming pattern.
 */
export async function resolveBaseUrl(
  product: string,
  config: BrowserStackConfig,
  harnessBaseUrl?: string,
): Promise<string> {
  // 1. CONFIG WINS, the same precedence Atlas uses. This is how a non-production
  //    environment is reached; no preprod host is or should be compiled in.
  const override = process.env[`CAPABILITY_REGISTRY_BASE_URL_${product.toUpperCase()}`];
  if (override) return override.replace(/\/$/, "");

  // 2. Then whatever the HARNESS declared, carried through in the artifact.
  //    NOTE the sharp edge: a harness-declared host is one fixed origin, so declaring one
  //    for a region-sharded product would send EU and IN accounts to the wrong region.
  //    tm therefore declares none on purpose and falls through to discovery below.
  if (harnessBaseUrl) return harnessBaseUrl.replace(/\/$/, "");

  // 3. Product-specific discovery. tm is region-sharded and the package already probes
  //    test-management{,-eu,-in} with the caller's credentials to find their account's.
  if (product === "tm") return (await getTMBaseURL(config)).replace(/\/$/, "");

  // 4. Refuse rather than guess. A guessed host fails as a DNS error or a 404 that reads
  //    like the caller's problem, when it is our missing configuration.
  throw new InvocationError(
    `no host is configured for product '${product}': the harness declares none and there ` +
      `is no override. Set CAPABILITY_REGISTRY_BASE_URL_${product.toUpperCase()}.`,
  );
}

/**
 * Locate the artifact. Explicit env wins; otherwise look beside the compiled module and
 * then at the package root, because `tsc` compiles TS and does not copy JSON into `dist`.
 */
export function indexPath(): string | undefined {
  const configured = process.env.CAPABILITY_REGISTRY_INDEX;
  if (configured) return existsSync(configured) ? resolve(configured) : undefined;

  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "registry-index.json"),
    join(here, "..", "..", "..", "capability-index.json"),      // dist/ or src/ -> package root
    join(here, "..", "..", "..", "..", "capability-index.json"),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

/** Off by default is wrong for a shipped feature, but a kill switch is not. */
export function isEnabled(): boolean {
  return (process.env.CAPABILITY_REGISTRY_DISABLED || "").toLowerCase() !== "true";
}
