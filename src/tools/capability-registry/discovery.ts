/**
 * Which regional host does THIS account live on?
 *
 * Generalised from `lib/tm-base-url.ts`, which asks the question for Test Management by
 * walking test-management{,-eu,-in}.browserstack.com and keeping the one that authenticates.
 * The mechanism is not tm-specific — any product sharded by region answers the same way —
 * so the candidate hosts move into the product's own index (`base_urls`) and this module
 * performs the walk for all of them.
 *
 * A PROBE, NOT A LOOKUP. An account's data lives in exactly one region and the other regions
 * reject its credentials, so the right host identifies itself. There is no mapping table to
 * keep in sync, which is the point: a table would go stale silently.
 */

import appConfig from "../../config.js";
import logger from "../../logger.js";
import { authHeaders, Credentials, Transport } from "./egress.js";
import { InvocationError } from "./index-loader.js";
import { Capability, ProductIndex } from "./types.js";

/** What the resolver needs from a product's index to find its host. */
export type HostSource = Pick<
  ProductIndex,
  "base_url" | "base_urls" | "probe_path" | "auth"
> & {
  capabilities?: Capability[];
};

/**
 * Cached per product AND per user, so the answer cannot cross accounts.
 *
 * `lib/tm-base-url.ts` disables its cache entirely under REMOTE_MCP because a process-wide
 * single slot would serve the first user's region to everyone after them. Keying by user
 * fixes that by construction, so the cache stays useful in remote mode too.
 */
const cache = new Map<string, string>();

/** Exposed for tests; a long-lived process must not pin a stale region forever. */
export function clearDiscoveryCache(): void {
  cache.clear();
}

/**
 * Pick the endpoint to probe with.
 *
 * An explicit `probe_path` in the index wins. Otherwise derive one, and derive it
 * CONSERVATIVELY — the probe reads a 2xx as "this is the account's region", so an endpoint
 * that can fail for a reason unrelated to region would walk straight past the right host:
 *
 *  * reads only, and never with a path placeholder — there is no id to supply yet;
 *  * no required query parameters, for the same reason;
 *  * paginated, because a paged listing is a primary collection by construction;
 *  * nothing under /admin, which 403s for an ordinary user;
 *  * shortest path, to prefer the root collection over its variants.
 *
 * For tm this lands on `/api/v1/projects`, the same family as the hand-written probe.
 */
export function probePath(source: HostSource): string | undefined {
  if (source.probe_path) return source.probe_path;
  const usable = (source.capabilities || []).filter(
    (capability) =>
      capability.mode === "read" &&
      capability.paginated &&
      !capability.path.includes("{") &&
      !capability.path.includes("/admin") &&
      !(capability.query || []).some((param) => param.required),
  );
  usable.sort(
    (a, b) => a.path.length - b.path.length || a.path.localeCompare(b.path),
  );
  return usable[0]?.path;
}

/**
 * Return the first candidate host that accepts the caller's credentials.
 *
 * Probed with the SAME auth the real calls use (`Api-Token`), not a second scheme, so a
 * host that answers here is one that will answer for the invocation that follows.
 */
export async function discoverBaseUrl(
  product: string,
  source: HostSource,
  credentials: Credentials,
  transport: Transport,
): Promise<string> {
  const candidates = (source.base_urls || []).map((url) =>
    url.replace(/\/$/, ""),
  );
  if (candidates.length === 0) {
    throw new InvocationError(
      `product '${product}' declares no base_urls to probe`,
    );
  }
  // One candidate is not a region question; skip the round trip.
  if (candidates.length === 1) return candidates[0];

  const key = `${product}\n${credentials.username}`;
  const cached = cache.get(key);
  if (cached) {
    logger.debug("using cached %s host for this account: %s", product, cached);
    return cached;
  }

  const path = probePath(source);
  if (!path) {
    throw new InvocationError(
      `product '${product}' declares several base_urls but no endpoint to probe them with; ` +
        `set probe_path in its index`,
    );
  }

  // The same scheme the invocation will use, so a host that answers here answers there.
  const headers = authHeaders(credentials, source.auth);
  const failures: string[] = [];
  for (const candidate of candidates) {
    const response = await transport("GET", `${candidate}${path}`, headers, {});
    if (response.status >= 200 && response.status < 300) {
      // Under REMOTE_MCP the key already carries the user, so this is safe to keep.
      if (!appConfig.REMOTE_MCP || credentials.username)
        cache.set(key, candidate);
      logger.info("resolved %s to %s for this account", product, candidate);
      return candidate;
    }
    failures.push(`${candidate}: HTTP ${response.status || "unreachable"}`);
  }

  // Every region refused. Saying which, and with what, is the difference between a
  // debuggable report and "it did not work".
  throw new InvocationError(
    `could not determine which region this account's ${product} lives on. Probed ${path} ` +
      `on each host — ${failures.join("; ")}`,
  );
}
