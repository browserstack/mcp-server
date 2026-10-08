/**
 * Atlas's view of the central-OAuth mint.
 *
 * The MECHANISM — the form, the transport, the classification, the cache — moved to
 * `src/lib/central-oauth.ts` when the capability registry needed the same exchange for
 * products whose APIs take a Bearer JWT rather than `Api-Token`. Two minters would have
 * drifted, and the one that drifted would have been the one with fewer tests.
 *
 * What stays here is everything ATLAS-SPECIFIC and nothing else: the scope pair, the skew
 * that exists because Atlas holds the token for a whole run, and the messages — which say
 * "nothing reached the agent" and name `ai_agent_notify`, and would be actively wrong in
 * front of a capability-registry user.
 *
 * This replaces a shared delegation token, and the upgrade is not cosmetic.
 * `validate_delegation_token` refuses any token without `user.user_id`/`user.group_id`, so
 * what we mint here is USER-ATTESTED: Atlas sets `principal_verified=True`, takes the acting
 * user from signed claims rather than from anything we put in the request body, and reuses
 * this same JWT as its `egress_token` — so the product call a human approves runs as that
 * human, not as a shared service account.
 */

import {
  CentralAuthError,
  Credentials,
  mintCentralToken as mintShared,
  mintForm as mintFormShared,
  REQUESTED_EXPIRES_IN,
} from "../../lib/central-oauth.js";
import appConfig from "../../config.js";
import logger from "../../logger.js";
import { AGENT_TIMEOUT_MS, AskError } from "./config.js";

export {
  fetchTokenTransport,
  refusalIsAboutScope,
  REQUESTED_EXPIRES_IN,
  resetTokenCache,
  TOKEN_TIMEOUT_MS,
  type TokenResponse,
  type TokenTransport,
} from "../../lib/central-oauth.js";

/**
 * BOTH PARTS ARE REQUIRED, AND THERE IS NO FALLBACK TO ANOTHER SCOPE.
 *
 * `oauth_user_profile` stays because it is what makes the pair obtainable through the
 * username+access_key flow at all — measured, not assumed: the paired scope mints, and the
 * other half alone comes back `400 invalid_request`. `ai_agent_notify` is what Atlas matches
 * on (`delegation.required_scope`, checked as exact membership of the token's `scopes` claim
 * in `web/oauth.py`); both halves move together with Atlas.
 *
 * THIS SCOPE MAY SIMPLY NOT BE ISSUABLE TO US, and the reasons are worth stating rather than
 * discovering. From the merged `browserstack/railsApp#175367` (2026-08-24):
 *
 *   - `ai_agent_notify` is documented there as CLIENT_ID/SECRET auth, and
 *     `USERNAME_ACCESS_KEY_ONLY_SCOPES` remains only `user_management, oauth_user_profile`.
 *     We are on the username+access_key flow, which those restrictions are not written for.
 *   - It is additionally covered by a new
 *     `APP_REGISTERED_SCOPE_REQUIRED = %w[ai_agent ai_agent_notify]` gate, requiring the
 *     calling APPLICATION to be registered for it — though that gate sits in the
 *     `client_id + client_secret` path, not ours.
 *   - railsApp defines it as the PRODUCT -> AGENT direction: "a product reporting progress
 *     back to an AI agent for work the agent dispatched." We use it in the opposite
 *     direction, as an agent -> Atlas inbound credential.
 *   - `central_ai_s2s`, which this replaces, was deliberately EXCLUDED from that new gate.
 *
 * So this is strictly more restricted than what it replaces. If the endpoint refuses it, that
 * is a PROVISIONING problem — the scope is not available to this credential type or this
 * application — and it is reported as one, naming the scope. It is never retried with a
 * different scope: a silent downgrade to a different authorization is exactly the kind of
 * thing nobody notices until it matters.
 *
 * Named here rather than taken from the shared default, so that changing the registry's
 * scopes can never silently change what Atlas is authorised for.
 */
export const CENTRAL_SCOPE = "oauth_user_profile ai_agent_notify";

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

/**
 * The ways authentication can fail, kept apart because a user cannot act on them otherwise.
 *
 * `scope refused` is a provisioning problem; `rejected` is "your credentials are wrong";
 * `unreachable` is "auth is down". A fourth — Atlas refusing a token we minted successfully —
 * is a server misconfiguration and lives in `relay.ts`, because it is discovered from
 * `/agent`. Four different fixes, so four different sentences.
 */
export const AUTH_SCOPE_REFUSED_DETAIL = (status: number): string =>
  `BrowserStack auth would not issue a token for the scope "${CENTRAL_SCOPE}" (HTTP ${status}). ` +
  `YOUR CREDENTIALS ARE NOT THE PROBLEM — this is a provisioning problem: \`ai_agent_notify\` ` +
  `is documented as a client_id/secret scope, it is not in the username+access_key allow ` +
  `list, and it carries an application-registration requirement. It has to be enabled for ` +
  `this account or application; a different password will not help, and this server will ` +
  `NOT quietly retry with a weaker scope. NOTHING REACHED THE AGENT — no request was made, ` +
  `no prompt appeared and nothing was changed.`;

export const AUTH_REJECTED_DETAIL = (status: number): string =>
  `Your BrowserStack credentials were rejected by BrowserStack auth (HTTP ${status}). ` +
  `NOTHING REACHED THE AGENT — no request was made, no prompt appeared and nothing was ` +
  `changed. Check BROWSERSTACK_USERNAME and BROWSERSTACK_ACCESS_KEY.`;

export const AUTH_UNREACHABLE_DETAIL =
  "Could not reach BrowserStack auth to sign in. NOTHING REACHED THE AGENT — no request " +
  "was made, no prompt appeared and nothing was changed. This is a connectivity or " +
  "auth-server problem, not a problem with your credentials.";

/**
 * A 5xx from auth: their service is down, not your password.
 *
 * Split out because routing 5xx to `AUTH_REJECTED_DETAIL` actively misdirects the reader,
 * and did: a preprod outage returned 503 and the tool answered "Your BrowserStack
 * credentials were rejected … Check BROWSERSTACK_USERNAME and BROWSERSTACK_ACCESS_KEY",
 * sending someone to audit env vars that had worked minutes earlier. The status alone
 * settles it — OAuth2 says a bad client is 401/403 and a bad request is 400, so nothing in
 * the 5xx range is ever a statement about the caller.
 */
export const AUTH_SERVER_ERROR_DETAIL = (status: number): string =>
  `BrowserStack auth is unavailable (HTTP ${status}). YOUR CREDENTIALS ARE NOT THE ` +
  `PROBLEM — a 5xx is the auth service failing, not a rejection, so there is nothing to ` +
  `change on your side and nothing to retry differently. NOTHING REACHED THE AGENT — no ` +
  `request was made, no prompt appeared and nothing was changed. Try again once ` +
  `BrowserStack auth is back.`;

export const AUTH_UNUSABLE_DETAIL = (status: number): string =>
  `BrowserStack auth answered HTTP ${status} without issuing a token. NOTHING REACHED THE ` +
  `AGENT — no request was made, no prompt appeared and nothing was changed.`;

/** The exact form body of the `client_credentials` grant, at Atlas's scope. */
export function mintForm(credentials: Credentials): Record<string, string> {
  return mintFormShared(credentials, CENTRAL_SCOPE, REQUESTED_EXPIRES_IN);
}

/** Every failure kind gets Atlas's own sentence; none of them carries the response body. */
function toAskError(error: unknown): unknown {
  if (!(error instanceof CentralAuthError)) return error;
  switch (error.kind) {
    case "no_credentials":
      return new AskError(
        "BrowserStack AI is not authenticated: BROWSERSTACK_USERNAME and " +
          "BROWSERSTACK_ACCESS_KEY are required to sign in",
      );
    case "unreachable":
      return new AskError(AUTH_UNREACHABLE_DETAIL);
    case "server_error":
      return new AskError(AUTH_SERVER_ERROR_DETAIL(error.status));
    case "refused_scope":
      return new AskError(AUTH_SCOPE_REFUSED_DETAIL(error.status));
    case "refused_credentials":
      return new AskError(AUTH_REJECTED_DETAIL(error.status));
    default:
      return new AskError(AUTH_UNUSABLE_DETAIL(error.status));
  }
}

/**
 * Return a valid token, minting one only when the cache has nothing fresh.
 *
 * NOT CACHED IN HOSTED MODE. These tokens are per-user, attested credentials, and the
 * process is shared by every tenant — `rules/multi-tenant-safety.md` forbids holding user
 * data in module-level state there, so remote mode mints per call.
 */
export async function mintCentralToken(
  url: string,
  credentials: Credentials,
  transport: Parameters<typeof mintShared>[0]["transport"],
  now: number = Date.now(),
): Promise<string> {
  try {
    return await mintShared({
      url,
      scope: CENTRAL_SCOPE,
      credentials,
      transport,
      refreshSkewMs: REFRESH_SKEW_MS,
      cacheEnabled: !appConfig.REMOTE_MCP,
      now,
      onMinted: (lifetimeMs) =>
        logger.info(
          "askBrowserStackAI: signed in as %s (lifetime %ss)",
          credentials.username,
          Math.round(lifetimeMs / 1000),
        ),
    });
  } catch (error) {
    throw toAskError(error);
  }
}
