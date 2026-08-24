/**
 * The outbound `POST /agent`, behind a seam.
 *
 * The seam is the point: the Atlas half of this feature is being built in parallel and does
 * not exist yet, so every test substitutes this rather than reaching a live service — the
 * same role `RegistryDeps.transport` plays for the capability registry.
 *
 * Auth is the CALLER'S OWN CREDENTIALS, forwarded as `Api-Token: <username>:<access_key>`.
 * Nothing is minted here; `authHeaders` is reused rather than reimplemented so the two
 * surfaces cannot drift on a security-relevant header.
 */

import { authHeaders, Credentials } from "../capability-registry/egress.js";
import { AGENT_TIMEOUT_MS } from "./config.js";
import { AgentRequest } from "./types.js";

export { authHeaders };
export type { Credentials };

export interface AgentResponse {
  status: number;
  body: unknown;
  /** Only when there was no response at all to speak for itself. */
  error?: string;
}

export type AgentTransport = (
  url: string,
  headers: Record<string, string>,
  body: AgentRequest,
) => Promise<AgentResponse>;

/**
 * A fetch-based transport.
 *
 * The 330s budget is the outer rung of CONTRACT §4's ladder: it must outlast Atlas's own
 * 300s gate timeout, which must in turn outlast our 270s elicitation, or a layer dies before
 * the layer it is waiting on can answer.
 */
export function fetchAgentTransport(
  timeoutMs = AGENT_TIMEOUT_MS,
): AgentTransport {
  return async (url, headers, body) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        // A redirect from an authenticated API is usually a login bounce, and following it
        // turns a clear 401/302 into a 200 carrying an HTML sign-in page.
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
      // Upstream detail stays out of the reply; status 0 is read as a failed call.
      return { status: 0, body: null, error: "BrowserStack AI could not be reached" };
    } finally {
      clearTimeout(timer);
    }
  };
}
