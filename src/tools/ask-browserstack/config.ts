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
 * The hosts this tool ships with, so an install needs an ENVIRONMENT NAME and not a URL.
 *
 * Every other tool here bakes its production host into the code and treats env vars as an
 * override — `TM_BASE_URLS`, the instrumentation endpoint — and the capability registry's
 * `resolveBaseUrl` is the richer form of the same idea. This is that, for Atlas.
 *
 * Each pair was established rather than assumed:
 *
 *   - `prod` — `workflows.browserstack.com/api/profiles` answers
 *     `401 {"detail":"authentication required"}`, byte-identical to staging Atlas. `/agent`
 *     404s there only because prod runs an image without the delegation route yet, and `/fe`
 *     404s because prod is API-only by design.
 *   - `stag` / `preprod` — the two ingress hosts in `ai-platform-infra-ops` `stag`
 *     `values-atlas.yaml`, both serving the same `atlas-server` backend.
 *   - `stag` pointing at **auth-preprod is deliberate, not a copy-paste.** Staging's
 *     `oauth.issuer` is `auth-rengg-reg-ai-agent-dev.bsstag.com`, but preprod is configured
 *     as an EXTRA ENVIRONMENT and `_accepted_configs` returns the default PLUS extras, so a
 *     preprod-minted token validates there. Confirmed live: a token minted at `auth-preprod`
 *     was accepted by staging Atlas (`matched=scope`, verified `user_id`).
 */
export const ATLAS_HOSTS: Record<string, { agent: string; auth: string }> = {
  prod: {
    agent: "https://workflows.browserstack.com",
    auth: "https://auth.browserstack.com/oauth2/v2/token",
  },
  preprod: {
    agent: "https://ai-platform-service-preprod.bsstag.com",
    auth: "https://auth-preprod.bsstag.com/oauth2/v2/token",
  },
  stag: {
    agent: "https://ai-platform-service.bsstag.com",
    auth: "https://auth-preprod.bsstag.com/oauth2/v2/token",
  },
};

const KNOWN_ENVIRONMENTS = Object.keys(ATLAS_HOSTS).join(", ");

/** Map entries are literals and an operator's override may not be; normalise both. */
function trimUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

/**
 * Why an unset environment REFUSES rather than defaulting to production.
 *
 * The capability registry refuses when an environment is named but has no host, because
 * *"falling back to the harness default here would send a preprod deployment at production,
 * silently."* The same reasoning applies harder to an environment that was never named at
 * all, and hardest of all to this tool, because this one WRITES.
 *
 * The cost of refusing is one documented environment name at install time, reported by name
 * the first time the tool is used. The cost of defaulting is an unconfigured install quietly
 * changing production data. Those are not comparable, and a selector that is wrong refuses
 * by name where a URL that is wrong talks to the wrong place in silence.
 */
function noEnvironment(explicitVar: string): AskError {
  return new AskError(
    `no BrowserStack AI environment is selected. Set ASK_BROWSERSTACK_ENV to one of ` +
      `${KNOWN_ENVIRONMENTS} — or set ${explicitVar} to a host directly. Nothing is ` +
      `assumed here on purpose: this tool can change data, so it will not guess at ` +
      `production.`,
  );
}

function unknownEnvironment(environment: string, suffixedVar: string): AskError {
  return new AskError(
    `environment '${environment}' has no built-in BrowserStack AI host. Known ` +
      `environments: ${KNOWN_ENVIRONMENTS}. Set ${suffixedVar} to add one.`,
  );
}

/**
 * Resolve Atlas's base URL:
 *
 *   1. ASK_BROWSERSTACK_ATLAS_URL          explicit, environment-agnostic
 *   2. ASK_BROWSERSTACK_ATLAS_URL_<ENV>    this environment's host
 *   3. the built-in map for <ENV>
 *   4. refuse, by name
 *
 * The overrides stay ahead of the map so nothing that works today stops working.
 */
export function atlasBaseUrl(): string {
  const explicit = process.env.ASK_BROWSERSTACK_ATLAS_URL;
  if (explicit && explicit.trim()) return trimUrl(explicit);

  const environment = selectedEnvironment();
  if (!environment) {
    throw noEnvironment("ASK_BROWSERSTACK_ATLAS_URL");
  }

  const suffixedVar = `ASK_BROWSERSTACK_ATLAS_URL_${environment.toUpperCase()}`;
  const suffixed = process.env[suffixedVar];
  if (suffixed && suffixed.trim()) return trimUrl(suffixed);

  const builtIn = ATLAS_HOSTS[environment.toLowerCase()];
  if (builtIn) return trimUrl(builtIn.agent);

  throw unknownEnvironment(environment, suffixedVar);
}

/** Resolved per call, never captured at construction. */
export function agentUrl(): string {
  return `${atlasBaseUrl()}/agent`;
}

/**
 * Where a central-OAuth JWT is minted (CONTRACT v1.2 §I, as amended by task 7).
 *
 * The shared `delegation.token` path is gone from Atlas, so a user-attested central JWT is
 * now the only way in. This is the endpoint that issues one from a username and access key.
 *
 * Same four rungs as the host, and refusing rather than guessing for the same reason: a
 * deployment pointing at preprod must not sign in against production's auth server.
 */
export function authTokenUrl(): string {
  const explicit = process.env.ASK_BROWSERSTACK_AUTH_TOKEN_URL;
  if (explicit && explicit.trim()) return trimUrl(explicit);

  const environment = selectedEnvironment();
  if (!environment) {
    throw noEnvironment("ASK_BROWSERSTACK_AUTH_TOKEN_URL");
  }

  const suffixedVar = `ASK_BROWSERSTACK_AUTH_TOKEN_URL_${environment.toUpperCase()}`;
  const suffixed = process.env[suffixedVar];
  if (suffixed && suffixed.trim()) return trimUrl(suffixed);

  const builtIn = ATLAS_HOSTS[environment.toLowerCase()];
  if (builtIn) return trimUrl(builtIn.auth);

  throw unknownEnvironment(environment, suffixedVar);
}
