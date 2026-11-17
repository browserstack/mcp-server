/**
 * An origin the CALLER supplies, for a capability served from a per-session endpoint.
 *
 * An App Live session is driven at a proxy that exists per session: the product hands
 * back a hostname, port and path for one session id, and the agent carries those into
 * every command as ordinary parameters flagged `base_url_builder`. The capability's
 * `origin` holds the URL template they fill and the hosts the result may land on.
 * Nothing is looked up or remembered on the server's behalf — the caller holds the
 * endpoint, as it holds the session id.
 *
 * THE HOST ALLOWLIST IS THE WHOLE POINT OF THIS FILE. These requests carry no credentials
 * and their destination is typed by an agent, so without a list a hosted server would be
 * an open proxy into whatever network it sits in. A rendered origin outside the list is
 * refused before anything is sent, by name, so a typo and an attempt read the same way.
 */

import { GroupedArguments } from "./bind.js";
import { InvocationError } from "./index-loader.js";
import { InvokeResult } from "./resolve.js";
import { Capability, WireParam } from "./types.js";

/** `{name}` placeholders, as the index writes them. */
const PLACEHOLDER = /\{([A-Za-z0-9_]+)\}/g;

export function templateFields(url: string): string[] {
  return [...url.matchAll(PLACEHOLDER)].map((m) => m[1]);
}

function handle(capability: Capability): string {
  return capability.name || `${capability.method} ${capability.path}`;
}

/**
 * Operator-added hosts for one product, so a lower environment whose proxy sits on a
 * different domain can be driven without editing the shipped index. Comma-separated
 * patterns in CAPABILITY_REGISTRY_ORIGIN_HOSTS_<PRODUCT>.
 */
export function extraOriginHosts(product: string): string[] {
  const key = `CAPABILITY_REGISTRY_ORIGIN_HOSTS_${product.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
  return (process.env[key] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** `*.example.com` matches any subdomain of example.com; a bare name matches itself. */
export function hostAllowed(host: string, patterns: string[]): boolean {
  const name = host.toLowerCase();
  return patterns.some((pattern) => {
    const p = pattern.toLowerCase();
    if (p.startsWith("*.")) {
      const suffix = p.slice(1);
      return name.endsWith(suffix) && name.length > suffix.length;
    }
    return name === p;
  });
}

export interface RenderedOrigin {
  /** The https base the capability's own path is appended to. */
  base: string;
  /** The caller's arguments with the builder parameters taken out, for `bind`. */
  rest: GroupedArguments;
}

type Group = "path_params" | "query" | "body";
const GROUPS: Group[] = ["path_params", "query", "body"];

/** The parameters flagged as building the origin, with the group each is declared in. */
export function builderParams(
  capability: Capability,
): { group: Group; param: WireParam }[] {
  return GROUPS.flatMap((group) =>
    (capability[group] ?? [])
      .filter((param) => param.base_url_builder)
      .map((param) => ({ group, param })),
  );
}

/**
 * Render the origin from the caller's builder parameters and take those out of what
 * `bind` will see, so the route template and the query string are built from the rest.
 */
export function renderOrigin(
  product: string,
  capability: Capability,
  args: GroupedArguments,
): RenderedOrigin {
  const spec = capability.origin;
  if (!spec) throw new Error(`${handle(capability)} declares no origin`);
  const rest: GroupedArguments = {
    ...args,
    path_params: { ...(args.path_params ?? {}) },
    query: { ...(args.query ?? {}) },
    body: { ...(args.body ?? {}) },
  };
  const values: Record<string, string> = {};
  for (const { group, param } of builderParams(capability)) {
    const value = rest[group]?.[param.name];
    delete rest[group]?.[param.name];
    if (value === undefined || value === null || value === "")
      throw new InvocationError(
        `${handle(capability)} needs '${param.name}' in ${group}: it is where the ` +
          `session is driven, from ${spec.from ?? "the endpoint capability"}`,
      );
    values[param.name] = String(value);
  }
  for (const group of GROUPS)
    if (
      args[group] === undefined &&
      Object.keys(rest[group] ?? {}).length === 0
    )
      delete rest[group];
  const url = spec.url.replace(PLACEHOLDER, (_m, name: string) => {
    const value = values[name];
    if (value === undefined)
      throw new InvocationError(
        `${handle(capability)}: origin template names '${name}', which is not one of its parameters`,
      );
    return value;
  });
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new InvocationError(
      `${handle(capability)}: the endpoint parameters do not form a valid URL`,
    );
  }
  if (parsed.protocol !== "https:")
    throw new InvocationError(
      `${handle(capability)}: the endpoint must be https, not ${parsed.protocol.replace(":", "")}`,
    );
  // The path parameter is a prefix the capability's route is appended to: a query, a
  // fragment or a parent reference inside it would rewrite the route, so none may appear.
  // Checked on the rendered text, because `new URL()` resolves `..` away silently.
  const afterHost = url.slice(url.indexOf("/", "https://".length));
  if (/[?#]/.test(afterHost) || /(^|\/)\.\.(\/|$)/.test(afterHost))
    throw new InvocationError(
      `${handle(capability)}: the endpoint path may not carry a query, a fragment or '..'`,
    );
  const allowed = [...spec.hosts, ...extraOriginHosts(product)];
  if (!hostAllowed(parsed.hostname, allowed))
    throw new InvocationError(
      `${handle(capability)}: '${parsed.hostname}' is not a host this capability may be driven at ` +
        `(allowed: ${spec.hosts.join(", ")})`,
    );
  return { base: url, rest };
}

/** Did this call fail for want of an answer, as opposed to being refused or cut off? */
export function timedOut(result: InvokeResult): boolean {
  return (
    result.http_response.status === 0 &&
    /^no answer within/.test(result.http_response.error ?? "")
  );
}

/**
 * Is this answer the origin saying "not yet"? Two shapes, both seen on a session a few
 * seconds old: no answer at all (the proxy holds the request until the device's Appium
 * session exists), or a plain-text 404 "Session not found." (the proxy has not learned
 * of the session yet). Once the origin has answered anything else, neither is "not yet".
 */
export function notReady(result: InvokeResult): boolean {
  if (timedOut(result)) return true;
  const body = result.http_response.body;
  return (
    result.http_response.status === 404 &&
    typeof body === "string" &&
    /session not found/i.test(body)
  );
}

/** Does a probe answer say the origin is up: 2xx, and a non-empty `value` list if it carries one? */
export function probeSatisfied(status: number, body: unknown): boolean {
  if (status < 200 || status >= 300) return false;
  if (typeof body === "object" && body !== null && "value" in body) {
    const value = (body as { value: unknown }).value;
    return Array.isArray(value) ? value.length > 0 : value !== null;
  }
  return true;
}

/**
 * Origins that have answered at least once, per caller. Until then a timeout may mean
 * the device is still starting (see `origin.ready`); afterwards it is a fault. Bookkeeping
 * only: nothing about where to send a request is kept here.
 */
const answered = new Set<string>();

const readinessKey = (caller: string, base: string) => `${caller}\u0000${base}`;

export function originAnswered(caller: string, base: string): boolean {
  return answered.has(readinessKey(caller, base));
}

export function markOriginAnswered(caller: string, base: string): void {
  answered.add(readinessKey(caller, base));
}

export function forgetOrigin(caller: string, base: string): void {
  answered.delete(readinessKey(caller, base));
}

/** Tests only. */
export function clearOrigins(): void {
  answered.clear();
}
