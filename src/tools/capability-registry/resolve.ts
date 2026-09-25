/**
 * Invoke one endpoint and hand back what the product said.
 *
 * NO POST-PROCESSING, BY DECISION. There used to be row extraction by shape, a `returns`
 * allowlist, a scalars-only filter for undeclared schemas, item counting, ordering, trimming,
 * and guards that reported an empty projection as a registration defect. Every one of them
 * was a place where we could be wrong ABOUT a correct answer — and each time we were, the
 * caller saw a confident empty result rather than an error. The product's response is the
 * answer; this module's job is to get it and return it.
 *
 * ONE REQUEST, ONE RESPONSE. Paging is therefore the caller's, which is why `p` and the
 * page-size parameter are published for paginated endpoints (see `project.py::_is_public`).
 * Hiding them made sense only while this module walked the pages itself.
 */

import { bind, GroupedArguments } from "./bind.js";
import { authHeaders, Credentials, Transport } from "./egress.js";
import { AuthScheme } from "./types.js";
import { InvocationError } from "./index-loader.js";
import { Capability } from "./types.js";

export interface InvokeResult {
  /** The product answered 2xx. Nothing else decides this. */
  ok: boolean;
  /**
   * Whether this response is the whole answer.
   *
   * False when the envelope itself says there is another page (`info.next`), so a caller
   * knows to ask for one rather than assuming it has everything. This is a peek at one
   * declared field, not a reshaping of the body.
   */
  completed: boolean;
  /** The product's status, and its body exactly as sent. */
  http_response: {
    status: number;
    body: unknown;
    /** Only when there was no response at all to speak for itself. */
    error?: string;
  };
}

function hasNextPage(body: unknown): boolean {
  if (typeof body !== "object" || body === null || Array.isArray(body))
    return false;
  const info = (body as Record<string, unknown>).info;
  if (typeof info !== "object" || info === null) return false;
  const next = (info as Record<string, unknown>).next;
  return next !== null && next !== undefined && next !== false;
}

export async function invoke(
  capability: Capability,
  args: GroupedArguments,
  baseUrl: string,
  credentials: Credentials,
  transport: Transport,
  auth?: AuthScheme,
): Promise<InvokeResult> {
  if (!baseUrl)
    throw new InvocationError("no base URL is configured for that product");
  const bound = bind(capability, args);
  const headers = authHeaders(credentials, auth);

  const response = await transport(
    capability.method,
    `${baseUrl.replace(/\/$/, "")}${bound.path}`,
    headers,
    bound.query,
    bound.body,
  );

  const ok = response.status >= 200 && response.status < 300;
  return {
    ok,
    completed: ok && !hasNextPage(response.body),
    http_response: {
      status: response.status,
      body: response.body,
      ...(response.status === 0
        ? { error: response.error || "the product could not be reached" }
        : {}),
    },
  };
}
