/**
 * Bearer-JWT auth for products whose API does not accept `Api-Token`.
 *
 * The registry was built on "the caller's credentials, forwarded — never a token this server
 * mints", and this is the first product that cannot work that way. The security property is
 * unchanged: the exchange uses the caller's own username and access key, the JWT carries
 * their `user_id`/`group_id` as signed claims, and the scopes narrow it BELOW what the raw
 * credential could do. What changes is that a token is now minted rather than formatted, so
 * the sentence to hold onto is "the server grants nothing beyond the caller's own identity",
 * not "the server mints nothing".
 *
 * The mint itself lives in `lib/central-oauth.ts` and is shared with `askBrowserStackAI`.
 * This module is only the part that is the registry's: where the endpoint and scopes come
 * from, what a product is allowed to ask for, and how a failure is worded.
 */

import appConfig from "../../config.js";
import logger from "../../logger.js";
import {
  CentralAuthError,
  Credentials,
  mintCentralToken,
  normaliseScopes,
  TokenTransport,
} from "../../lib/central-oauth.js";
import { InvocationError } from "./index-loader.js";
import { AuthScheme } from "./types.js";

/**
 * Where a central-OAuth JWT is minted, when a product does not name its own.
 *
 * Staging, for anyone setting the override:
 *   CAPABILITY_REGISTRY_AUTH_TOKEN_URL = https://auth-preprod.bsstag.com/oauth2/v2/token
 */
export const DEFAULT_AUTH_TOKEN_URL =
  "https://auth.browserstack.com/oauth2/v2/token";

/**
 * The default scope set, and why it is a PAIR.
 *
 * `ai_agent` is the scope a product's gate matches on. `oauth_user_profile` is not extra
 * authority — it is what makes the scope obtainable through the username+access_key flow at
 * all, and this is measured rather than assumed: `ai_agent` alone comes back
 * `400 invalid_request`, the pair mints, and the granted token's `scopes` claim carries both.
 *
 * Deliberately NOT `ask-browserstack`'s `CENTRAL_SCOPE`, which pairs `ai_agent_notify`
 * instead — Atlas names its own so that changing this one cannot silently change what Atlas
 * is authorised for.
 */
export const DEFAULT_SCOPES = ["ai_agent", "oauth_user_profile"] as const;

/**
 * Small, because the registry uses the token for ONE HTTP call.
 *
 * Nothing here holds it for the length of a run the way Atlas does, so this only has to
 * cover clock skew and the flight time of the request it opens.
 */
export const REFRESH_SKEW_MS = 60_000;

/**
 * Hosts a PRODUCT INDEX may name as its token endpoint.
 *
 * The index is a data file that ships to public npm and is read at startup. Letting it name
 * an arbitrary `token_url` would let a file decide where the caller's username and access key
 * get POSTed — so the file declares intent and this list bounds it. An operator setting the
 * environment variable is a deliberate act and is trusted; shipping an index is not.
 */
const ALLOWED_TOKEN_HOSTS = [
  "auth.browserstack.com",
  "auth-preprod.bsstag.com",
];

/** Announced once per distinct resolution, so a wrong endpoint is a log line, not a deduction. */
const announced = new Set<string>();

/** For tests, and for anything that legitimately re-resolves. */
export function resetOAuthAnnouncements(): void {
  announced.clear();
}

function announce(product: string, url: string, source: string): void {
  const line = `${product}|${url}|${source}`;
  if (announced.has(line)) return;
  announced.add(line);
  logger.info(
    "capability registry: %s mints its token at %s (source: %s)",
    product,
    url,
    source,
  );
}

function assertMintable(url: string, product: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new InvocationError(
      `product '${product}' declares a token_url that is not a URL: ${JSON.stringify(url)}`,
    );
  }
  // Same rule as the product call itself: credentials are never attached over plaintext.
  if (parsed.protocol !== "https:") {
    throw new InvocationError(
      `product '${product}' declares a token_url that is not https. The caller's ` +
        `credentials are sent to it, so plaintext is refused.`,
    );
  }
  if (!ALLOWED_TOKEN_HOSTS.includes(parsed.hostname)) {
    throw new InvocationError(
      `product '${product}' declares a token_url on an unrecognised host ` +
        `'${parsed.hostname}'. An index may only mint against ${ALLOWED_TOKEN_HOSTS.join(" or ")}; ` +
        `set CAPABILITY_REGISTRY_AUTH_TOKEN_URL if this deployment really does mint elsewhere.`,
    );
  }
  return url.replace(/\/+$/, "");
}

/**
 * Three rungs: the operator's override, then the product's declaration, then the built-in.
 *
 * Matching `base_url`, where config is explicitly "a default, not the last word" — a
 * deployment pointed at staging must not be overruled by whatever an index happens to carry.
 */
export function resolveTokenUrl(product: string, auth?: AuthScheme): string {
  const explicit = process.env.CAPABILITY_REGISTRY_AUTH_TOKEN_URL;
  if (explicit && explicit.trim()) {
    const url = explicit.trim().replace(/\/+$/, "");
    announce(product, url, "env");
    return url;
  }
  if (auth?.token_url && auth.token_url.trim()) {
    const url = assertMintable(auth.token_url.trim(), product);
    announce(product, url, "index");
    return url;
  }
  announce(product, DEFAULT_AUTH_TOKEN_URL, "default");
  return DEFAULT_AUTH_TOKEN_URL;
}

/** Two rungs. A scope does not vary by deployment the way a host does, so there is no env one. */
export function resolveScope(auth?: AuthScheme): string {
  const declared = auth?.scopes;
  if (Array.isArray(declared) && declared.length > 0)
    return normaliseScopes(declared);
  return normaliseScopes([...DEFAULT_SCOPES]);
}

/**
 * A failure to mint is not a failure of the product, and must not read like one.
 *
 * Nothing from the token endpoint's body reaches these messages — it can echo the access key
 * straight back. Only the classification and the status do.
 */
function toInvocationError(
  error: unknown,
  product: string,
): InvocationError | unknown {
  if (!(error instanceof CentralAuthError)) return error;
  const prefix = `token_mint_failed: could not sign in to '${product}'`;
  switch (error.kind) {
    case "no_credentials":
      return new InvocationError(
        `${prefix}: BrowserStack username and access key are required`,
      );
    case "unreachable":
      return new InvocationError(
        `${prefix}: BrowserStack auth could not be reached. This is a connectivity or ` +
          `auth-server problem, not a problem with your credentials. Nothing was sent to ` +
          `'${product}'.`,
      );
    case "server_error":
      return new InvocationError(
        `${prefix}: BrowserStack auth is unavailable (HTTP ${error.status}). YOUR ` +
          `CREDENTIALS ARE NOT THE PROBLEM — a 5xx is the auth service failing, not a ` +
          `rejection. Nothing was sent to '${product}'.`,
      );
    case "refused_scope":
      return new InvocationError(
        `${prefix}: BrowserStack auth would not issue a token for the scope ` +
          `"${error.scope}" (HTTP ${error.status}). YOUR CREDENTIALS ARE NOT THE PROBLEM — ` +
          `this is a provisioning problem and the scope has to be enabled for this account ` +
          `or application. This server will NOT retry with a weaker scope. Nothing was ` +
          `sent to '${product}'.`,
      );
    case "refused_credentials":
      return new InvocationError(
        `${prefix}: your BrowserStack credentials were rejected by BrowserStack auth ` +
          `(HTTP ${error.status}). Nothing was sent to '${product}'.`,
      );
    default:
      return new InvocationError(
        `${prefix}: BrowserStack auth answered HTTP ${error.status} without issuing a ` +
          `token. Nothing was sent to '${product}'.`,
      );
  }
}

/**
 * The Bearer value for one invocation.
 *
 * Cached per user for the life of the token when this process serves one caller, and not at
 * all when it serves many — `mintCentralToken` is handed `cacheEnabled` rather than deciding
 * for itself, because the rule is about THIS deployment, not about the mint.
 */
export async function bearerToken(
  product: string,
  auth: AuthScheme | undefined,
  credentials: Credentials,
  transport: TokenTransport,
): Promise<string> {
  try {
    return await mintCentralToken({
      url: resolveTokenUrl(product, auth),
      scope: resolveScope(auth),
      credentials,
      transport,
      refreshSkewMs: REFRESH_SKEW_MS,
      cacheEnabled: !appConfig.REMOTE_MCP,
    });
  } catch (error) {
    throw toInvocationError(error, product);
  }
}
