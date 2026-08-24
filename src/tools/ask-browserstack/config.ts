/**
 * Where Atlas lives, and the timeout ladder.
 *
 * No host is compiled in. A guessed host fails as a DNS error or a 404 that reads like the
 * caller's problem when it is our missing configuration, and a hardcoded default would send
 * a preprod deployment at production — the same reasoning as the capability registry's
 * `resolveBaseUrl`, and the same precedence rungs.
 */

/**
 * CONTRACT §4 — the timeout ladder, outermost first. EACH LAYER MUST EXCEED THE ONE INSIDE
 * IT, or a layer dies before the layer it is waiting on can answer:
 *
 *   MCP client -> tool call        longest, client-side, not ours
 *   POST /agent HTTP request       330s   <- here
 *   Atlas gate -> callback POST    300s   Atlas's `permission_relay_timeout`
 *   elicitInput                    270s   <- here
 *
 * 300s is the browser path's existing PERMISSION_TIMEOUT, which also auto-rejects.
 */
export const AGENT_TIMEOUT_MS = 330_000;
export const ELICITATION_TIMEOUT_MS = 270_000;

/** Thrown for anything this tool refuses to attempt. Never carries a credential. */
export class AskError extends Error {}

/** Off by default is wrong for a shipped feature, but a kill switch is not. */
export function isEnabled(): boolean {
  return (process.env.ASK_BROWSERSTACK_DISABLED || "").toLowerCase() !== "true";
}

/**
 * The environment this DEPLOYMENT points at, e.g. "preprod".
 *
 * `CAPABILITY_REGISTRY_ENV` is honoured as a fallback on purpose: it is the same deployment
 * pointing at the same environment, and making an operator state that fact twice is how the
 * two drift.
 */
export function selectedEnvironment(): string {
  return (
    process.env.ASK_BROWSERSTACK_ENV ||
    process.env.CAPABILITY_REGISTRY_ENV ||
    ""
  ).trim();
}

/**
 * Resolve Atlas's base URL:
 *
 *   1. ASK_BROWSERSTACK_ATLAS_URL          explicit, environment-agnostic
 *   2. ASK_BROWSERSTACK_ATLAS_URL_<ENV>    this environment's host
 *   3. refuse, by name
 *
 * Refusing rather than guessing is the point of rung 3.
 */
export function atlasBaseUrl(): string {
  const explicit = process.env.ASK_BROWSERSTACK_ATLAS_URL;
  if (explicit && explicit.trim()) return explicit.trim().replace(/\/$/, "");

  const environment = selectedEnvironment();
  if (environment) {
    const suffixed =
      process.env[`ASK_BROWSERSTACK_ATLAS_URL_${environment.toUpperCase()}`];
    if (suffixed && suffixed.trim()) return suffixed.trim().replace(/\/$/, "");
  }

  throw new AskError(
    "no host is configured for BrowserStack AI: set ASK_BROWSERSTACK_ATLAS_URL" +
      (environment
        ? ` or ASK_BROWSERSTACK_ATLAS_URL_${environment.toUpperCase()}`
        : ""),
  );
}

/** Resolved per call, never captured at construction. */
export function agentUrl(): string {
  return `${atlasBaseUrl()}/agent`;
}

/**
 * The shared delegation token `POST /agent` authenticates with (CONTRACT v1.2 §I).
 *
 * `/agent` accepts exactly two credentials, both in `Authorization`: this shared token, which
 * authenticates the CALLER only, or a BrowserStack central JWT, which also attests the acting
 * user. There is no `Api-Token` path on this route. The shared token is what
 * `authenticate()`'s own docstring describes for a backend caller like an MCP server, and the
 * JWT path would mean minting a credential, which this work does not do.
 *
 * Same precedence rungs as the host, for the same reason: a deployment pointing at preprod
 * must not be able to fall back to a token meant for somewhere else.
 *
 * THIS VALUE IS A SECRET. It is never logged, never returned in a result, and never named in
 * an error message — only the env var that should hold it is.
 */
export function atlasToken(): string {
  const explicit = process.env.ASK_BROWSERSTACK_ATLAS_TOKEN;
  if (explicit && explicit.trim()) return explicit.trim();

  const environment = selectedEnvironment();
  if (environment) {
    const suffixed =
      process.env[`ASK_BROWSERSTACK_ATLAS_TOKEN_${environment.toUpperCase()}`];
    if (suffixed && suffixed.trim()) return suffixed.trim();
  }

  throw new AskError(
    "BrowserStack AI is not authenticated: set ASK_BROWSERSTACK_ATLAS_TOKEN" +
      (environment
        ? ` or ASK_BROWSERSTACK_ATLAS_TOKEN_${environment.toUpperCase()}`
        : "") +
      " to the shared delegation token",
  );
}
