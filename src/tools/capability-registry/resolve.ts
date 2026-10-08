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

import { invalidateToken } from "../../lib/central-oauth.js";
import { bind, GroupedArguments } from "./bind.js";
import { authHeaders, Credentials, Transport } from "./egress.js";
import { resolveScope, resolveTokenUrl } from "./oauth.js";
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

/**
 * Refuse to send credentials anywhere but over TLS.
 *
 * The very next thing `invoke` does is attach the caller's long-lived
 * `username:access_key` to the request, and the host it attaches them to comes from an
 * environment variable, account discovery or the index's own `base_url` — none of which
 * was checked for a scheme. An operator typo of `http://` put those credentials on the
 * wire in clear text, and nothing anywhere said no.
 *
 * Not attacker-controlled today: the index ships inside the package and the environment
 * variables are operator-set. This is the cheap guard on the one path that forwards a
 * credential, not a response to a known attack. `egress.authHeaders` already refuses
 * `auth.in: "query"` so credentials never land in a URL; this is the same concern one
 * layer up.
 *
 * `localhost` and `127.0.0.1` are exempt so a local product server can still be driven
 * without a certificate.
 */
function assertTransportSafe(baseUrl: string): void {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new InvocationError(
      `the configured base URL is not a valid URL: ${JSON.stringify(baseUrl)}`,
    );
  }
  if (url.protocol === "https:") return;
  const local =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]";
  if (url.protocol === "http:" && local) return;
  throw new InvocationError(
    `refusing to send credentials over ${url.protocol}//${url.host}: this request ` +
      `carries your BrowserStack access key, so the base URL must be https (or a local ` +
      `host for development). Check CAPABILITY_REGISTRY_BASE_URL_* for a typo.`,
  );
}

export async function invoke(
  capability: Capability,
  args: GroupedArguments,
  baseUrl: string,
  credentials: Credentials,
  transport: Transport,
  auth?: AuthScheme,
  product?: string,
): Promise<InvokeResult> {
  if (!baseUrl)
    throw new InvocationError("no base URL is configured for that product");
  assertTransportSafe(baseUrl);
  const bound = bind(capability, args);
  // Before binding would be wrong and after sending is too late: a scheme that mints a
  // token must not spend a round trip on a call that `bind` was going to reject anyway.
  const url = `${baseUrl.replace(/\/$/, "")}${bound.path}`;
  const send = async () =>
    transport(
      capability.method,
      url,
      await authHeaders(credentials, auth, product),
      bound.query,
      bound.body,
    );

  let response = await send();

  /**
   * One replay, for a minted token the product rejected.
   *
   * The expiry skirt covers clock skew; it does not cover a token revoked mid-life, and a
   * cached one can outlive its welcome by up to its whole lifetime. Discarding it and
   * retrying once turns that from a failed call into a slow one.
   *
   * SAFE TO REPLAY EVEN FOR A WRITE: a 401 means the request was never authorised, so
   * nothing was changed. Once only — with genuinely bad credentials the second attempt
   * fails identically, and a loop here would hammer the token endpoint on every wrong
   * password.
   */
  if (response.status === 401 && auth?.type === "oauth2") {
    invalidateToken(
      resolveTokenUrl(product ?? "this product", auth),
      resolveScope(auth),
      credentials,
    );
    response = await send();
  }

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
