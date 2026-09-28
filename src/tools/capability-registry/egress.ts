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

/** Longest response text kept when it is not JSON. Enough for an error, not a whole page. */
const TEXT_BODY_LIMIT = 2000;

/**
 * Read the response, and NEVER silently discard it.
 *
 * This used to parse the body only when the content-type said JSON and return `null`
 * otherwise, which meant an error could arrive as `{status: 500, body: null}` — a status
 * code and nothing else. That is worse than it sounds: an unhandled exception in a Rails
 * app renders `text/html`, so the one case where you most need the message is exactly the
 * case where the content-type is not JSON. It also made two very different situations
 * indistinguishable — "the product sent no message" and "we threw the message away" — and
 * a live probe of `get_test_case_linked_issues` had to leave that ambiguity open in its findings
 * because nothing downstream could tell which had happened.
 *
 * So: JSON is parsed as before. Anything textual is kept as a truncated string. Malformed
 * JSON keeps its raw text rather than becoming `null`, because a body that fails to parse
 * is itself the diagnosis. Binary is described rather than decoded — dumping PDF bytes
 * into an agent's context helps nobody, but knowing a PDF arrived does.
 */
async function readBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") || "";

  // Anything that is not plausibly text: report what came back without decoding it.
  const textual =
    !contentType ||
    /^text\//i.test(contentType) ||
    /\b(json|xml|yaml|csv|javascript|x-www-form-urlencoded)\b/i.test(
      contentType,
    );
  if (!textual) {
    const size = response.headers.get("content-length");
    return `<non-text response: ${contentType}${size ? `, ${size} bytes` : ""}>`;
  }

  const raw = await response.text().catch(() => "");
  if (!raw.trim()) return null;

  if (contentType.includes("json")) {
    try {
      return JSON.parse(raw);
    } catch {
      // Declared JSON that is not JSON. The text is the evidence; keep it.
      return truncate(raw);
    }
  }
  return truncate(raw);
}

function truncate(text: string): string {
  return text.length <= TEXT_BODY_LIMIT
    ? text
    : `${text.slice(0, TEXT_BODY_LIMIT)}… [truncated, ${text.length} chars total]`;
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
      return {
        status: response.status,
        body: await readBody(response),
      };
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
