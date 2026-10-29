import logger from "../logger.js";
import { GRR_REGIONS, GrrRegion } from "../config.js";
import { BrowserStackConfig } from "./types.js";
import { fetchTokenTransport, mintCentralToken } from "./central-oauth.js";
import { AccountRegion } from "./region-context.js";

const AUTH_TOKEN_URL = "https://auth.browserstack.com/oauth2/v2/token";
const SCOPE = "oauth_user_profile";
const LOOKUP_TIMEOUT_MS = 5_000;

interface Lookup {
  settled?: AccountRegion;
  pending: Promise<AccountRegion>;
}

// Keyed on the config object a server was built with, so an entry belongs to that one
// server and is collected with it; nothing is shared between servers or accounts.
const lookups = new WeakMap<object, Lookup>();

/** Reads `user.grr.region` from the token; an account with no region is a US account. */
export function regionFromToken(token: string): AccountRegion {
  const payload = JSON.parse(
    Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"),
  );
  const region = payload?.user?.grr?.region;
  if (region === undefined || region === null || region === "") return "us";
  return (GRR_REGIONS as readonly string[]).includes(region)
    ? (region as GrrRegion)
    : "unknown";
}

async function lookUp(config: BrowserStackConfig): Promise<AccountRegion> {
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
    return "unknown";
  }
}

/**
 * The account's region, looked up once per config. Returned directly once known so
 * callers that cannot wait (telemetry) stay synchronous; undefined without credentials.
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
  let lookup = lookups.get(config);
  if (!lookup) {
    const entry: Lookup = {
      pending: lookUp(config).then((region) => (entry.settled = region)),
    };
    lookup = entry;
    lookups.set(config, entry);
  }
  return lookup.settled ?? lookup.pending;
}
