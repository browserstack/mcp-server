import logger from "../../logger.js";

/**
 * Where Atlas lives, and the timeout ladder.
 *
 * The host IS compiled in, matching every other tool here — `TM_BASE_URLS`, the
 * instrumentation endpoint — so an install needs no configuration to work. One env var
 * overrides it. See the warning on `DEFAULT_ATLAS_URL`: the compiled-in value is currently
 * STAGING and is a deliberate placeholder.
 */

/**
 * CONTRACT §4 — the timeout ladder, outermost first. EACH LAYER MUST EXCEED THE ONE INSIDE
 * IT, or a layer dies before the layer it is waiting on can answer:
 *
 *   MCP client -> tool call        longest, client-side, not ours
 *   POST /agent HTTP request       330s   <- here
 *   Atlas gate -> stream ask       300s   Atlas's `permission_relay_timeout`
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
 * ============================================================================
 * TEMPORARY STAGING DEFAULT — REPOINT BEFORE PRODUCTION USERS GET THIS TOOL
 * ============================================================================
 *
 * These hosts are STAGING. They are hardcoded on purpose, as an explicit interim step:
 * "for now lets hardcode the base_url to staging only then we will point this to prod url
 * later." This is a placeholder, not the end state.
 *
 * PRODUCTION IS `https://workflows.browserstack.com` — verified, not guessed: its
 * `/api/profiles` answers `401 {"detail":"authentication required"}`, byte-identical to
 * staging Atlas. (`/agent` 404s there today only because prod runs an image without the
 * delegation route yet, and `/fe` 404s because prod is API-only by design.) The production
 * auth endpoint is `https://auth.browserstack.com/oauth2/v2/token`.
 *
 * WHY THIS MATTERS: this package publishes to npm as `@browserstack/mcp-server`, so an
 * install with no environment variables set talks to STAGING. That is the safer direction —
 * it cannot touch production data — but it is still wrong for a production deployment, which
 * would silently read and write the wrong environment's data. The resolved host is therefore
 * logged at info on first use, naming whether it came from the env var or from here, so a
 * deployment pointing at the wrong Atlas is visible in a log line rather than inferred later
 * from confusing data.
 *
 * BEFORE SHIPPING TO PRODUCTION USERS: change these two constants, and change the tests that
 * assert them — they assert the literals precisely so that repointing has to be deliberate
 * rather than something that slips through.
 *
 * grep: TEMPORARY-STAGING-DEFAULT
 */
export const DEFAULT_ATLAS_URL = "https://ai-platform-service.bsstag.com";
export const DEFAULT_AUTH_TOKEN_URL =
  "https://auth-preprod.bsstag.com/oauth2/v2/token";

/** An operator's override may carry a trailing slash; the constants above do not. */
function trimUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

/**
 * Announced ONCE per distinct resolution, not per tool call.
 *
 * The point is that a deployment talking to the wrong Atlas shows up in the log; repeating it
 * on every call would only make it easier to scroll past.
 */
const announced = new Set<string>();

/** For tests, and for anything that legitimately re-resolves. */
export function resetHostAnnouncements(): void {
  announced.clear();
}

function announce(what: string, url: string, source: "env" | "default"): void {
  const line = `${what}|${url}|${source}`;
  if (announced.has(line)) return;
  announced.add(line);
  logger.info("askBrowserstackAI: %s is %s (source: %s)", what, url, source);
}

/**
 * Resolve Atlas's base URL:
 *
 *   1. ASK_BROWSERSTACK_ATLAS_URL   explicit override
 *   2. the built-in staging default (see the warning above)
 *
 * Matching every other tool here, which ships its host in the code and treats the env var as
 * an override — `TM_BASE_URLS`, the instrumentation endpoint. There is no environment map and
 * no selector: one default, one override.
 */
export function atlasBaseUrl(): string {
  const explicit = process.env.ASK_BROWSERSTACK_ATLAS_URL;
  const url =
    explicit && explicit.trim() ? trimUrl(explicit) : DEFAULT_ATLAS_URL;
  announce("Atlas", url, explicit && explicit.trim() ? "env" : "default");
  return url;
}

/** Resolved per call, never captured at construction. */
export function agentUrl(): string {
  return `${atlasBaseUrl()}/agent`;
}

/**
 * Where a central-OAuth JWT is minted (CONTRACT v1.2 §I, as amended by task 7).
 *
 * The shared `delegation.token` path is gone from Atlas, so a user-attested central JWT is
 * the only way in. Same two rungs as the host, and the same staging default.
 */
export function authTokenUrl(): string {
  const explicit = process.env.ASK_BROWSERSTACK_AUTH_TOKEN_URL;
  const url =
    explicit && explicit.trim() ? trimUrl(explicit) : DEFAULT_AUTH_TOKEN_URL;
  announce(
    "auth token endpoint",
    url,
    explicit && explicit.trim() ? "env" : "default",
  );
  return url;
}
