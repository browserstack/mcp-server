import { createHash } from "node:crypto";
import logger from "../logger.js";
import { BrowserStackConfig } from "./types.js";
import { fetchTokenTransport, mintCentralToken } from "./central-oauth.js";
import { AccountRegion, GRR_REGIONS, GrrRegion } from "./region-context.js";

const AUTH_TOKEN_URL = "https://auth.browserstack.com/oauth2/v2/token";
const SCOPE = "oauth_user_profile";
const LOOKUP_TIMEOUT_MS = 5_000;
/** How long a failed lookup answers "unknown" before the next call tries again. */
export const RETRY_AFTER_MS = 5_000;
/** How long a looked-up region is reused before it is looked up again. */
export const REGION_TTL_MS = 60 * 60_000;
const MAX_ENTRIES = 1_000;

interface Lookup {
  settled?: AccountRegion;
  settledAt?: number;
  pending?: Promise<AccountRegion>;
  failedAt?: number;
}

// Keyed on a hash of the credentials, so servers built per request for the same account
// share one lookup. Holds only the region; bounded, oldest entry evicted first.
const lookups = new Map<string, Lookup>();

function keyFor(config: BrowserStackConfig): string {
  return createHash("sha256")
    .update(
      `${config["browserstack-username"]}\0${config["browserstack-access-key"]}`,
    )
    .digest("hex");
}

function remember(key: string, entry: Lookup): void {
  lookups.delete(key);
  lookups.set(key, entry);
  if (lookups.size > MAX_ENTRIES) {
    lookups.delete(lookups.keys().next().value!);
  }
}

/** Reads `user.grr.region` from the token; an account with no region is a US account. */
export function regionFromToken(token: string): AccountRegion {
  const payload = JSON.parse(
    Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"),
  );
  const raw = payload?.user?.grr?.region;
  if (raw === undefined || raw === null || raw === "") return "us";
  const region = String(raw).toLowerCase();
  return (GRR_REGIONS as readonly string[]).includes(region)
    ? (region as GrrRegion)
    : "unknown";
}

/** The account's region, or null when BrowserStack auth could not answer. */
async function lookUp(
  config: BrowserStackConfig,
): Promise<AccountRegion | null> {
  try {
    const token = await mintCentralToken({
      url: AUTH_TOKEN_URL,
      scope: SCOPE,
      credentials: {
        username: config["browserstack-username"],
        accessKey: config["browserstack-access-key"],
      },
      transport: fetchTokenTransport(LOOKUP_TIMEOUT_MS),
      refreshSkewMs: 0,
      cacheEnabled: false,
    });
    return regionFromToken(token);
  } catch (error) {
    logger.warn(
      `Could not look up the account's region: ${(error as Error)?.message}`,
    );
    return null;
  }
}

/**
 * The account's region, looked up once per account and refreshed after REGION_TTL_MS.
 * Returned directly once known so callers that cannot wait (telemetry) stay synchronous;
 * undefined without credentials. A refresh keeps answering the last known region, and
 * keeps it if the refresh fails. With no region known, a failure answers "unknown" for
 * RETRY_AFTER_MS, and the next call after that looks up again.
 */
export function accountRegion(
  config: BrowserStackConfig | undefined,
): AccountRegion | undefined | Promise<AccountRegion> {
  if (
    !config?.["browserstack-username"] ||
    !config?.["browserstack-access-key"]
  ) {
    return undefined;
  }
  const now = Date.now();
  const key = keyFor(config);
  const lookup = lookups.get(key);
  if (lookup?.settled && now - lookup.settledAt! < REGION_TTL_MS) {
    return lookup.settled;
  }
  if (lookup?.pending) return lookup.settled ?? lookup.pending;
  if (
    lookup?.failedAt !== undefined &&
    now - lookup.failedAt < RETRY_AFTER_MS
  ) {
    return lookup.settled ?? "unknown";
  }

  const entry: Lookup = {
    settled: lookup?.settled,
    settledAt: lookup?.settledAt,
  };
  entry.pending = lookUp(config).then((region) => {
    entry.pending = undefined;
    if (region === null) {
      entry.failedAt = Date.now();
      return entry.settled ?? "unknown";
    }
    entry.settled = region;
    entry.settledAt = Date.now();
    entry.failedAt = undefined;
    return region;
  });
  remember(key, entry);
  return entry.settled ?? entry.pending;
}
