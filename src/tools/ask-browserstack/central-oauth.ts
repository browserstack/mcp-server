/**
 * Mint a BrowserStack central-OAuth JWT from the caller's username and access key.
 *
 * This replaces a shared delegation token, and the upgrade is not cosmetic.
 * `validate_delegation_token` refuses any token without `user.user_id`/`user.group_id`, so
 * what we mint here is USER-ATTESTED: Atlas sets `principal_verified=True`, takes the acting
 * user from signed claims rather than from anything we put in the request body, and reuses
 * this same JWT as its `egress_token` — so the product call a human approves runs as that
 * human, not as a shared service account.
 *
 * SECRET HYGIENE IS THE WHOLE POINT OF THIS MODULE, and Atlas's `central_oauth.py` learned
 * it the hard way: "The body can echo the credential back on some errors, so it is NOT
 * logged or raised — only the status." Neither the access key nor the minted token is ever
 * logged, returned, or put in an error message. Only a status code is.
 */

import { createHash } from "node:crypto";

import logger from "../../logger.js";
import { AGENT_TIMEOUT_MS, AskError } from "./config.js";
import { Credentials } from "./egress.js";

/**
 * BOTH PARTS ARE REQUIRED — do not "tidy" this into one scope.
 *
 * `central_ai_s2s` is what Atlas matches on (`delegation.required_scope`, checked as exact
 * membership of the token's `scopes` claim in `web/oauth.py`). But it is a client_id+secret
 * scope, and asking for it ALONE with a username+access_key is rejected outright. It becomes
 * obtainable only when paired with `oauth_user_profile` — see the note at `web/oauth.py:449`:
 * "today any user can obtain `central_ai_s2s` by pairing it with `oauth_user_profile`,
 * because the railsApp guard uses `none?` where it means `all?`".
 *
 * So the pair is load-bearing in both directions: drop `central_ai_s2s` and Atlas refuses the
 * token; drop `oauth_user_profile` and the endpoint refuses to issue it.
 */
export const CENTRAL_SCOPE = "oauth_user_profile central_ai_s2s";

/** What we ask for. The endpoint clamps to its own maximum, so the response wins. */
export const REQUESTED_EXPIRES_IN = 3600;

/**
 * Treat a token as stale this long before it actually expires.
 *
 * NOT the usual small skew. This token is not merely used to open the request — Atlas holds
 * it for the life of the run and re-uses it for product egress, so it has to outlive the
 * whole call, and our own `/agent` budget is already 330s. Handing out a token with 61
 * seconds left would mean a human approves a write and the egress that follows fails on an
 * expired credential, which is the exact mid-flight expiry this cache exists to prevent.
 */
export const REFRESH_SKEW_MS = AGENT_TIMEOUT_MS + 60_000;

/** The token endpoint gets its own, much shorter budget than `/agent`. */
export const TOKEN_TIMEOUT_MS = 15_000;

export interface TokenResponse {
  status: number;
  body: unknown;
  /** Only when there was no response at all to speak for itself. */
  error?: string;
}

export type TokenTransport = (
  url: string,
  form: Record<string, string>,
) => Promise<TokenResponse>;

/**
 * Two of the three ways authentication can fail, kept apart because a user cannot act on
 * them otherwise. `rejected` is "your credentials are wrong"; `unreachable` is "auth is
 * down". The third — Atlas refusing a token we successfully minted — is a server
 * misconfiguration and lives in `relay.ts`, because it is discovered from `/agent`.
 */
export const AUTH_REJECTED_DETAIL = (status: number): string =>
  `Your BrowserStack credentials were rejected by BrowserStack auth (HTTP ${status}). ` +
  `NOTHING REACHED THE AGENT — no request was made, no prompt appeared and nothing was ` +
  `changed. Check BROWSERSTACK_USERNAME and BROWSERSTACK_ACCESS_KEY.`;

export const AUTH_UNREACHABLE_DETAIL =
  "Could not reach BrowserStack auth to sign in. NOTHING REACHED THE AGENT — no request " +
  "was made, no prompt appeared and nothing was changed. This is a connectivity or " +
  "auth-server problem, not a problem with your credentials.";

export const AUTH_UNUSABLE_DETAIL = (status: number): string =>
  `BrowserStack auth answered HTTP ${status} without issuing a token. NOTHING REACHED THE ` +
  `AGENT — no request was made, no prompt appeared and nothing was changed.`;

interface CacheEntry {
  token: string;
  expiresAt: number;
  /** Shared so N concurrent tool calls mint ONCE rather than N times. */
  inflight?: Promise<string>;
}

const cache = new Map<string, CacheEntry>();

/** Drop every cached token. For tests, and for a credential rotation. */
export function resetTokenCache(): void {
  cache.clear();
}

/**
 * The cache key.
 *
 * Keyed on the access key so that ROTATING it mints immediately rather than leaving a
 * revoked credential working until expiry — but on a SHA-256 of it, never the value, so the
 * secret is not left sitting in a map key for the life of the process.
 */
function cacheKey(url: string, credentials: Credentials): string {
  const digest = createHash("sha256").update(credentials.accessKey).digest("hex");
  return `${url} ${credentials.username} ${CENTRAL_SCOPE} ${digest}`;
}

/** A fetch-based transport for the token endpoint. */
export function fetchTokenTransport(
  timeoutMs = TOKEN_TIMEOUT_MS,
): TokenTransport {
  return async (url, form) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams(form).toString(),
        redirect: "manual",
        signal: controller.signal,
      });
      let parsed: unknown = null;
      try {
        parsed = await response.json();
      } catch {
        // An HTML error page behind any status. The caller only reads the status.
        parsed = null;
      }
      return { status: response.status, body: parsed };
    } catch {
      // DNS, TLS, timeout — all of them mean "no token". The reason is deliberately not
      // carried: it can name the URL and, on some stacks, echo the request body.
      return { status: 0, body: null, error: "auth could not be reached" };
    } finally {
      clearTimeout(timer);
    }
  };
}

/** The exact form body of the `client_credentials` grant. */
export function mintForm(credentials: Credentials): Record<string, string> {
  return {
    grant_type: "client_credentials",
    username: credentials.username,
    access_key: credentials.accessKey,
    scope: CENTRAL_SCOPE,
    expires_in: String(REQUESTED_EXPIRES_IN),
  };
}

async function mintOnce(
  url: string,
  credentials: Credentials,
  transport: TokenTransport,
): Promise<{ token: string; lifetimeMs: number }> {
  const response = await transport(url, mintForm(credentials));

  if (response.status === 0) throw new AskError(AUTH_UNREACHABLE_DETAIL);
  // ONLY THE STATUS. The body of a non-200 can echo the credential straight back.
  if (response.status !== 200) throw new AskError(AUTH_REJECTED_DETAIL(response.status));

  const body =
    typeof response.body === "object" && response.body !== null
      ? (response.body as Record<string, unknown>)
      : {};
  const token = body.access_token;
  if (typeof token !== "string" || !token) {
    throw new AskError(AUTH_UNUSABLE_DETAIL(response.status));
  }

  // Trust the SERVER's lifetime over what we asked for — it clamps to its own maximum, and
  // caching for the requested hour when it granted less would hand out a dead token.
  const granted = Number(body.expires_in);
  const seconds = Number.isFinite(granted) && granted > 0 ? granted : REQUESTED_EXPIRES_IN;
  return { token, lifetimeMs: seconds * 1000 };
}

/**
 * Return a valid token, minting one only when the cache has nothing fresh.
 *
 * Minting per tool call would add a round trip to every request and make the token endpoint
 * a hot dependency of the whole surface.
 */
export async function mintCentralToken(
  url: string,
  credentials: Credentials,
  transport: TokenTransport,
  now: number = Date.now(),
): Promise<string> {
  // Refused before any network call, and by name: these ARE the auth credential now, not
  // merely attribution, so an empty one is our missing configuration rather than the user's
  // rejected password, and must not read like one.
  if (!credentials?.username || !credentials?.accessKey) {
    throw new AskError(
      "BrowserStack AI is not authenticated: BROWSERSTACK_USERNAME and " +
        "BROWSERSTACK_ACCESS_KEY are required to sign in",
    );
  }

  const key = cacheKey(url, credentials);
  const entry = cache.get(key);
  if (entry && entry.token && now < entry.expiresAt - REFRESH_SKEW_MS) {
    return entry.token;
  }
  // Double-checked through a shared promise: concurrent callers await the same mint.
  if (entry?.inflight) return entry.inflight;

  const pending = mintOnce(url, credentials, transport)
    .then(({ token, lifetimeMs }) => {
      cache.set(key, { token, expiresAt: now + lifetimeMs });
      logger.info(
        "askBrowserstackAI: signed in as %s (lifetime %ss)",
        credentials.username,
        Math.round(lifetimeMs / 1000),
      );
      return token;
    })
    .catch((error) => {
      // Never leave a rejected promise cached, or every later call inherits this failure.
      cache.delete(key);
      throw error;
    });

  cache.set(key, { token: "", expiresAt: 0, inflight: pending });
  return pending;
}
