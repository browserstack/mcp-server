/**
 * Mint a BrowserStack central-OAuth JWT from the caller's username and access key.
 *
 * WHAT IS MINTED IS THE CALLER, NOT A SERVICE ACCOUNT. The exchange takes the user's own
 * credentials and returns a JWT whose `user` claim carries their `user_id`/`group_id`, so a
 * product authorises against signed claims rather than against anything we put in a request
 * body. Scopes narrow it further. The property this preserves is the one the whole surface
 * rests on: an agent can never do what the user could not.
 *
 * SECRET HYGIENE IS THE WHOLE POINT OF THIS MODULE, and Atlas's `central_oauth.py` learned
 * it the hard way: "The body can echo the credential back on some errors, so it is NOT
 * logged or raised — only the status." Neither the access key nor the minted token is ever
 * logged, returned in an error, or put in a message. Only a status code is.
 *
 * THIS MODULE IS THE MECHANISM AND NOTHING ELSE. It throws `CentralAuthError` carrying a
 * `kind`, and each caller words its own message from that: `ask-browserstack` tells the
 * reader nothing reached the agent, the capability registry tells them which product could
 * not be reached. Sharing the mechanism is what stops a second, subtly different minter
 * existing; sharing the prose would put Atlas's wording in front of a registry user.
 */

import { createHash } from "node:crypto";

import { apiClient } from "./apiClient.js";

export interface Credentials {
  username: string;
  accessKey: string;
}

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

/** What we ask for. The endpoint clamps to its own maximum, so the response wins. */
export const REQUESTED_EXPIRES_IN = 3600;

/** The token endpoint gets its own, short budget — it is not the call being made. */
export const TOKEN_TIMEOUT_MS = 15_000;

/**
 * How a mint failed, in the terms a reader can act on.
 *
 * `refused_scope` is a provisioning problem, `refused_credentials` is "your password is
 * wrong", `server_error` is "auth is down" and `unreachable` is "we could not get there".
 * Four different fixes, so they must not collapse into one — routing a 503 to "your
 * credentials were rejected" has already sent someone to audit env vars that had worked
 * minutes earlier.
 */
export type AuthFailureKind =
  | "no_credentials"
  | "unreachable"
  | "server_error"
  | "refused_scope"
  | "refused_credentials"
  | "unusable";

/** Carries the classification and the status. NEVER any part of the response body. */
export class CentralAuthError extends Error {
  constructor(
    readonly kind: AuthFailureKind,
    readonly status: number,
    readonly scope: string,
  ) {
    super(`central auth ${kind} (HTTP ${status})`);
    this.name = "CentralAuthError";
  }
}

/**
 * The OAuth2 error codes we are willing to read out of a failure body.
 *
 * `error` is a fixed enum token in the spec, so it cannot carry a credential;
 * `error_description` is free text and demonstrably CAN ("access_key <key> is invalid"),
 * which is why only the code is ever looked at and only when it is one of these. Anything
 * else is ignored entirely and the classification falls back to the status.
 */
const SCOPE_ERROR_CODES = [
  "invalid_scope",
  "unauthorized_client",
  "invalid_request",
];
const CREDENTIAL_ERROR_CODES = [
  "invalid_client",
  "invalid_grant",
  "access_denied",
];

/**
 * Was this refusal about the SCOPE or about the CREDENTIAL?
 *
 * The two need completely different fixes — provisioning versus a password — so collapsing
 * them into one message sends someone to the wrong place entirely. Our form has five fields
 * and four of them are constants, so a refusal of the REQUEST (as opposed to the caller) can
 * only really be about the scope.
 *
 * Nothing from the body is ever surfaced; the code is used to classify and then discarded.
 */
export function refusalIsAboutScope(status: number, body: unknown): boolean {
  const payload =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};
  const code = typeof payload.error === "string" ? payload.error : "";
  if (SCOPE_ERROR_CODES.includes(code)) return true;
  if (CREDENTIAL_ERROR_CODES.includes(code)) return false;
  // No usable code. OAuth2 answers a bad REQUEST with 400 and a bad CLIENT with 401/403, so
  // the status is the next best evidence.
  return status === 400;
}

/**
 * One canonical string for a scope set.
 *
 * `["a","b"]` and `["b","a"]` are the same grant, and without this they are two cache keys
 * and two mints for it. Sorted and deduped so the key is a property of the grant rather
 * than of how someone happened to write it down.
 */
export function normaliseScopes(scopes: readonly string[]): string {
  return [
    ...new Set(scopes.flatMap((scope) => scope.split(/\s+/)).filter(Boolean)),
  ]
    .sort()
    .join(" ");
}

/** The exact form body of the `client_credentials` grant. */
export function mintForm(
  credentials: Credentials,
  scope: string,
  expiresIn: number = REQUESTED_EXPIRES_IN,
): Record<string, string> {
  return {
    grant_type: "client_credentials",
    username: credentials.username,
    access_key: credentials.accessKey,
    scope,
    expires_in: String(expiresIn),
  };
}

/**
 * The token endpoint, through `apiClient` per rules/security.md — no bare `fetch`.
 *
 * `raise_error: false` keeps the status-first contract this transport has always had: the
 * caller distinguishes a 400 scope refusal from a 401 rejection from an unreachable host,
 * so a thrown AxiosError on any non-2xx would destroy the only signal it reads.
 */
export function fetchTokenTransport(
  timeoutMs = TOKEN_TIMEOUT_MS,
): TokenTransport {
  return async (url, form) => {
    try {
      const response = await apiClient.post<unknown>({
        url,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams(form).toString(),
        timeout: timeoutMs,
        raise_error: false,
      });
      return { status: response.status, body: response.data ?? null };
    } catch {
      // DNS, TLS, timeout — all of them mean "no token". The reason is deliberately not
      // carried: it can name the URL and, on some stacks, echo the request body.
      return { status: 0, body: null, error: "auth could not be reached" };
    }
  };
}

interface CacheEntry {
  token: string;
  expiresAt: number;
  /** Shared so N concurrent callers mint ONCE rather than N times. */
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
 * Every part of it is something that changes WHICH token is correct:
 *
 *   url      a different issuer is a different token
 *   scope    a token minted for one scope set must never be served for another
 *   username the identity the JWT attests
 *   digest   so ROTATING the access key mints immediately rather than leaving a revoked
 *            credential working until expiry — hashed, never the value, so the secret is
 *            not left sitting in a map key for the life of the process
 *
 * The PRODUCT is deliberately absent: the token is the caller's identity, not a product's,
 * so two products on the same endpoint and scopes share one mint.
 */
function cacheKey(
  url: string,
  scope: string,
  credentials: Credentials,
): string {
  const digest = createHash("sha256")
    .update(credentials.accessKey)
    .digest("hex");
  return `${url} ${credentials.username} ${scope} ${digest}`;
}

async function mintOnce(
  url: string,
  scope: string,
  credentials: Credentials,
  transport: TokenTransport,
): Promise<{ token: string; lifetimeMs: number }> {
  const response = await transport(url, mintForm(credentials, scope));

  if (response.status === 0)
    throw new CentralAuthError("unreachable", 0, scope);
  // 5xx BEFORE the refusal branch: a server error is not a refusal, and reading it as one
  // is worse than saying nothing — it names the caller's credentials as the fault.
  if (response.status >= 500)
    throw new CentralAuthError("server_error", response.status, scope);
  if (response.status !== 200) {
    // ONLY THE STATUS CROSSES. The body is read solely to tell a provisioning problem from a
    // credential one, and nothing out of it is ever put in the error.
    throw new CentralAuthError(
      refusalIsAboutScope(response.status, response.body)
        ? "refused_scope"
        : "refused_credentials",
      response.status,
      scope,
    );
  }

  const body =
    typeof response.body === "object" && response.body !== null
      ? (response.body as Record<string, unknown>)
      : {};
  const token = body.access_token;
  if (typeof token !== "string" || !token)
    throw new CentralAuthError("unusable", response.status, scope);

  // Trust the SERVER's lifetime over what we asked for — it clamps to its own maximum, and
  // caching for the requested hour when it granted less would hand out a dead token.
  const granted = Number(body.expires_in);
  const seconds =
    Number.isFinite(granted) && granted > 0 ? granted : REQUESTED_EXPIRES_IN;
  return { token, lifetimeMs: seconds * 1000 };
}

export interface MintOptions {
  url: string;
  /** Already normalised — `normaliseScopes` at the edge, not here. */
  scope: string;
  credentials: Credentials;
  transport: TokenTransport;
  /**
   * Treat a token as stale this long before it actually expires.
   *
   * It must cover everything the token has to outlive, not merely clock skew: a caller that
   * holds it for the length of a run needs a skew at least that long, or a human approves a
   * write and the egress that follows fails on an expired credential.
   */
  refreshSkewMs: number;
  /**
   * False in a multi-tenant process. These are per-user attested credentials and the hosted
   * process is shared by every tenant — `rules/multi-tenant-safety.md` forbids holding user
   * data in module-level state there, so hosted mode mints per call. The cache key already
   * means one user can never be SERVED another's token, but containment is not the
   * contract; not holding it at all is.
   */
  cacheEnabled: boolean;
  onMinted?: (lifetimeMs: number) => void;
  now?: number;
}

/**
 * Return a valid token, minting one only when the cache has nothing fresh.
 *
 * Minting per call would add a round trip to every request and make the token endpoint a hot
 * dependency of the whole surface.
 */
export async function mintCentralToken(options: MintOptions): Promise<string> {
  const { url, scope, credentials, transport, cacheEnabled } = options;
  const now = options.now ?? Date.now();

  // Refused before any network call, and by name: these ARE the auth credential now, not
  // merely attribution, so an empty one is our missing configuration rather than the user's
  // rejected password, and must not read like one.
  if (!credentials?.username || !credentials?.accessKey)
    throw new CentralAuthError("no_credentials", 0, scope);

  const finish = ({
    token,
    lifetimeMs,
  }: {
    token: string;
    lifetimeMs: number;
  }) => {
    options.onMinted?.(lifetimeMs);
    return token;
  };

  if (!cacheEnabled)
    return mintOnce(url, scope, credentials, transport).then(finish);

  const key = cacheKey(url, scope, credentials);
  const entry = cache.get(key);
  if (entry && entry.token && now < entry.expiresAt - options.refreshSkewMs)
    return entry.token;
  // Double-checked through a shared promise: concurrent callers await the same mint.
  if (entry?.inflight) return entry.inflight;

  const pending = mintOnce(url, scope, credentials, transport)
    .then(({ token, lifetimeMs }) => {
      cache.set(key, { token, expiresAt: now + lifetimeMs });
      return finish({ token, lifetimeMs });
    })
    .catch((error) => {
      // Never leave a rejected promise cached, or every later call inherits this failure.
      cache.delete(key);
      throw error;
    });

  cache.set(key, { token: "", expiresAt: 0, inflight: pending });
  return pending;
}

/** Drop the cached token for exactly these credentials — used after an upstream 401. */
export function invalidateToken(
  url: string,
  scope: string,
  credentials: Credentials,
): void {
  cache.delete(cacheKey(url, scope, credentials));
}
