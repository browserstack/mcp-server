/**
 * The outbound call: auth, attribution, and one HTTP request.
 *
 * AUTH IS THE CALLER'S OWN CREDENTIALS, FORWARDED. Every /api/v1 route accepts
 * `Api-Token: <username>:<access_key>` and validates it against IAAM OAuth2 v2 — the same
 * identity resolution a minted bearer token produces, one hop earlier. Verified in
 * browserstack/teststack: the 59 v1 controllers inheriting ApplicationApiController resolve
 * it in `current_user`, the 5 inheriting Api::V1::ApiController in `authenticate_token`.
 *
 * Note HTTP Basic is NOT usable on /api/v1 — `authenticate_with_authorization_header` never
 * reaches the Basic path, so only those 5 controllers accept it. Api-Token is the one that
 * works for the whole surface.
 */

import { InvocationError } from "./index-loader.js";

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

export function authHeaders(credentials: Credentials): Record<string, string> {
  if (!credentials?.username || !credentials?.accessKey) {
    // Refusing here beats sending unauthenticated and surfacing the product's 401, which
    // reads like the user's problem when it is our missing configuration.
    throw new InvocationError(
      "this request is not authenticated: BrowserStack username and access key are required",
    );
  }
  return {
    "Api-Token": `${credentials.username}:${credentials.accessKey}`,
    // Attribution, so the downstream service can see the call came from an agent.
    "request-source": "ai-chatbot",
    "Content-Type": "application/json",
  };
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
