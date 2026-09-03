/**
 * The outbound call: auth, attribution, and one HTTP request.
 *
 * AUTH IS THE CALLER'S OWN CREDENTIALS, FORWARDED — never a token this server mints. How
 * they are presented is the PRODUCT's to declare, in the OpenAPI `securityScheme` terms its
 * own spec already uses. Absent a declaration the default is tm's: `Api-Token:
 * <username>:<access_key>`, accepted by every /api/v1 route and validated against IAAM
 * OAuth2 v2 — the same identity resolution a minted bearer token produces, one hop earlier.
 * Verified in browserstack/teststack: the 59 v1 controllers inheriting
 * ApplicationApiController resolve it in `current_user`, the 5 inheriting
 * Api::V1::ApiController in `authenticate_token`.
 *
 * That default is right for tm and wrong to assume of everyone. Load Testing's
 * /api/v1/agent/* surface is reported to take HTTP Basic, and before this there was nowhere
 * to say so: the requirement lived in a pull request description while the server sent
 * Api-Token regardless, and the mismatch surfaced as a 401 that reads like the user's
 * credentials are wrong.
 */

import { InvocationError } from "./index-loader.js";
import { AuthScheme } from "./types.js";

export interface Credentials {
  username: string;
  accessKey: string;
}

export interface HttpResponse {
  status: number;
  body: unknown;
  error?: string;
}

export type Transport = (
  method: string,
  url: string,
  headers: Record<string, string>,
  query: Record<string, unknown>,
  body?: unknown,
) => Promise<HttpResponse>;

/** What this server can put into a credential template. Nothing else is fillable. */
const PLACEHOLDERS = ["username", "access_key"] as const;

/** The historical default, and what an index without an `auth` block still gets. */
export const DEFAULT_AUTH: AuthScheme = {
  type: "apiKey",
  in: "header",
  name: "Api-Token",
  template: "{username}:{access_key}",
};

/**
 * Fill a credential template.
 *
 * An unknown placeholder is REFUSED, never passed through. Emitting `{user_id}` literally
 * would send a header that looks well-formed and comes back 401 — indistinguishable from
 * bad credentials, which is the failure this whole mechanism exists to remove. The harness
 * really does carry templates this server cannot fill (`{user_id}_{group_id}`), so this is
 * the common case, not a hypothetical.
 */
export function renderTemplate(
  template: string,
  credentials: Credentials,
): string {
  const unknown = [...template.matchAll(/\{([a-z_]+)\}/g)]
    .map((match) => match[1])
    .filter(
      (nameed) =>
        !PLACEHOLDERS.includes(nameed as (typeof PLACEHOLDERS)[number]),
    );
  if (unknown.length > 0) {
    throw new InvocationError(
      `auth template uses placeholder(s) this server cannot fill: ` +
        `${[...new Set(unknown)].sort().join(", ")}. Available: ` +
        `${PLACEHOLDERS.map((placeholder) => `{${placeholder}}`).join(", ")}`,
    );
  }
  return template
    .replaceAll("{username}", credentials.username)
    .replaceAll("{access_key}", credentials.accessKey);
}

export function authHeaders(
  credentials: Credentials,
  auth: AuthScheme = DEFAULT_AUTH,
): Record<string, string> {
  if (!credentials?.username || !credentials?.accessKey) {
    // Refusing here beats sending unauthenticated and surfacing the product's 401, which
    // reads like the user's problem when it is our missing configuration.
    throw new InvocationError(
      "this request is not authenticated: BrowserStack username and access key are required",
    );
  }

  const common = {
    // Attribution, so the downstream service can see the call came from an agent.
    "request-source": "ai-chatbot",
    "Content-Type": "application/json",
  };
  const value = renderTemplate(
    auth.template || DEFAULT_AUTH.template!,
    credentials,
  );

  if (auth.type === "apiKey") {
    // Header only. `cookie` needs a session this server does not have, and `query` would
    // put the credential in a URL, where access logs and proxies keep it.
    if (auth.in && auth.in !== "header") {
      throw new InvocationError(
        `unsupported auth location '${auth.in}': this server can only send credentials ` +
          `in a header`,
      );
    }
    if (!auth.name) {
      throw new InvocationError("apiKey auth declares no header name");
    }
    return { [auth.name]: value, ...common };
  }

  if (auth.type === "http" && (auth.scheme || "").toLowerCase() === "basic") {
    return {
      Authorization: `Basic ${Buffer.from(value).toString("base64")}`,
      ...common,
    };
  }

  // By name, and refusing: sending nothing would be a 401 the caller reads as their own
  // fault, and guessing a scheme is how credentials end up somewhere they should not be.
  throw new InvocationError(
    `unsupported auth scheme for this product: ` +
      `${JSON.stringify({ type: auth.type, scheme: auth.scheme })}`,
  );
}

/** A fetch-based transport. Redirects are NOT followed. */
export function fetchTransport(timeoutMs = 45_000): Transport {
  return async (method, url, headers, query, body) => {
    const target = new URL(url);
    for (const [key, value] of Object.entries(query || {})) {
      if (value !== undefined && value !== null)
        target.searchParams.set(key, String(value));
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(target.toString(), {
        method,
        headers,
        // Only send a body when there IS one: a literal `null` payload with a JSON
        // content-type is rejected by several endpoints.
        body: body === undefined ? undefined : JSON.stringify(body),
        // A redirect from an authenticated API is usually a login bounce, and following it
        // turns a clear 401/302 into a 200 carrying an HTML sign-in page — which the
        // resolver would then read as an empty result set rather than a failure.
        redirect: "manual",
        signal: controller.signal,
      });
      let parsed: unknown = null;
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("json")) {
        parsed = await response.json().catch(() => null);
      }
      return { status: response.status, body: parsed };
    } catch {
      // Upstream detail stays out of the reply; the resolver treats status 0 as a failed call.
      return {
        status: 0,
        body: null,
        error: "the product could not be reached",
      };
    } finally {
      clearTimeout(timer);
    }
  };
}
