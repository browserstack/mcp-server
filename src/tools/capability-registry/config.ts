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
 * Resolve a product's host, mirroring Atlas's precedence.
 *
 * Atlas resolves: an explicit per-session override, then the host for the session's
 * environment (`harness.extra_environments[env][product]`), then the profile's own
 * `base_url`. The same rungs, in the same order:
 *
 *   1. CAPABILITY_REGISTRY_BASE_URL_<PRODUCT>            explicit, environment-agnostic
 *   2. CAPABILITY_REGISTRY_BASE_URL_<PRODUCT>_<ENV>      this environment's host
 *   3. CAPABILITY_REGISTRY_BASE_URLS {product:{env:url}} the same, as one map
 *   4. the harness-declared host, carried in the artifact
 *   5. product-specific discovery (tm is region-sharded)
 *   6. refuse, by name
 *
 * Refusing rather than guessing is deliberate: a guessed host fails as a DNS error or a 404
 * that reads like the caller's problem, when it is our missing configuration.
 */
export async function resolveBaseUrl(
  product: string,
  config: BrowserStackConfig,
  harnessBaseUrl?: string,
): Promise<string> {
  const key = product.toUpperCase();
  const environment = selectedEnvironment();

  const explicit = process.env[`CAPABILITY_REGISTRY_BASE_URL_${key}`];
  if (explicit) return explicit.replace(/\/$/, "");

  if (environment) {
    const suffixed = process.env[
      `CAPABILITY_REGISTRY_BASE_URL_${key}_${environment.toUpperCase()}`
    ];
    if (suffixed) return suffixed.replace(/\/$/, "");
    const mapped = environmentMap()[product]?.[environment];
    if (mapped) return String(mapped).replace(/\/$/, "");
    // An environment was named and nothing defines its host. Falling back to the harness
    // default here would send a preprod deployment at production, silently.
    if (harnessBaseUrl || product === "tm") {
      throw new InvocationError(
        `environment '${environment}' has no host for product '${product}'. Set ` +
          `CAPABILITY_REGISTRY_BASE_URL_${key}_${environment.toUpperCase()} or add it to ` +
          `CAPABILITY_REGISTRY_BASE_URLS.`,
      );
    }
  }

  // NOTE the sharp edge: a harness-declared host is one fixed origin, so declaring one for a
  // region-sharded product would send EU and IN accounts to the wrong region. tm declares
  // none for exactly that reason and falls through to discovery.
  if (harnessBaseUrl) return harnessBaseUrl.replace(/\/$/, "");

  if (product === "tm") return (await getTMBaseURL(config)).replace(/\/$/, "");

  throw new InvocationError(
    `no host is configured for product '${product}': the harness declares none and there ` +
      `is no override. Set CAPABILITY_REGISTRY_BASE_URL_${key}.`,
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
