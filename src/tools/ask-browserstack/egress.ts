/**
 * The pieces of the outbound `POST /agent` that are not the transport itself.
 *
 * The transport moved to `stream.ts` when A2 was removed: `/agent` is read as an event
 * stream now, so a one-request-one-response `AgentTransport` has nothing left to describe.
 * What stays here is what both halves always shared — the header set, the credential pair,
 * and the response shape `relay.ts` reads to tell a refusal from an unreachable service
 * apart, which the stream's JSON-degrade path still produces.
 *
 * AUTH HERE IS NOT THE PRODUCT-API AUTH. `/agent` accepts exactly two credentials, both in
 * `Authorization`: the shared delegation token or a BrowserStack central JWT. There is no
 * `Api-Token` path on this route (CONTRACT v1.2 §I), so sending one would not merely be
 * useless — it would push the user's `access_key` across a trust boundary to an endpoint
 * that has no use for it, and into every request log on the way. The capability registry's
 * `authHeaders` remains right for PRODUCT calls; it is simply not the header set for this
 * one, and is deliberately not imported here.
 */

export interface Credentials {
  username: string;
  accessKey: string;
}

/**
 * The complete header set for `POST /agent` (CONTRACT v1.2 §4). Three headers, no more.
 *
 * The token is a secret and appears nowhere else: not in a log line, not in a result, not in
 * an error message.
 */
export function agentHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    // Attribution, so the downstream service can see the call came from an agent.
    "request-source": "ai-chatbot",
  };
}

export interface AgentResponse {
  status: number;
  body: unknown;
  /** Only when there was no response at all to speak for itself. */
  error?: string;
}
