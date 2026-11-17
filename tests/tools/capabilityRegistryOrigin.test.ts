import { beforeEach, describe, expect, it } from "vitest";
import {
  CapabilityRegistry,
  IndexError,
} from "../../src/tools/capability-registry/index-loader.js";
import { addCapabilityRegistryTools } from "../../src/tools/capability-registry/register.js";
import { readAnswer } from "../../src/tools/capability-registry/answer.js";
import { clearOrigins } from "../../src/tools/capability-registry/origin.js";

// An App Live session is driven at an origin that exists per session. The caller gets it
// from the endpoint capability and passes hostname, port and path — ordinary query
// parameters flagged base_url_builder — into every session command. These pin the
// wiring: the origin is rendered from them and never reaches the query string, no
// credentials go to it, a host outside the allowlist is refused, and the first read on a
// fresh origin is re-sent while the device starts.

const SESSION = "0123456789abcdef0123456789abcdef01234567";
const ENDPOINT = {
  hostname: "proxy.example.com",
  port: 443,
  path: `/wd/device.example.com/${SESSION}/hub/`,
};
const READY = { timeout_seconds: 120, probe_seconds: 20 };

const BUILDERS = [
  { name: "hostname", type: "string", required: true, base_url_builder: true },
  { name: "port", type: "integer", required: true, base_url_builder: true },
  { name: "path", type: "string", required: true, base_url_builder: true },
];

function session(name: string, extra: Record<string, unknown>) {
  return {
    name,
    method: "POST",
    path: `/session/{session_id}/${name}`,
    entity: "session",
    intent: name,
    path_params: [{ name: "session_id", type: "string", required: true }],
    query: BUILDERS,
    origin: {
      url: "https://{hostname}:{port}{path}",
      hosts: ["*.example.com"],
      from: "get_endpoint",
    },
    ...extra,
  };
}

function index(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    build_id: "test",
    products: {
      p: {
        summary: "s",
        base_url: "https://p.example",
        auth: { type: "http", scheme: "basic" },
        capabilities: [
          {
            name: "get_endpoint",
            method: "GET",
            path: "/sessions/{session_id}/appium",
            mode: "read",
            entity: "session",
            intent: "Where the session is driven.",
            path_params: [
              { name: "session_id", type: "string", required: true },
            ],
          },
          session("find_element", {
            mode: "read",
            body: [
              { name: "using", type: "string", required: true },
              { name: "value", type: "string", required: true },
            ],
            ...overrides,
          }),
          session("tap", {
            mode: "write",
            origin: {
              url: "https://{hostname}:{port}{path}",
              hosts: ["*.example.com"],
              ready: READY,
            },
          }),
          session("tap_probed", {
            mode: "write",
            origin: {
              url: "https://{hostname}:{port}{path}",
              hosts: ["*.example.com"],
              ready: { ...READY, probe_seconds: 0.01, probe_path: "/sessions" },
            },
          }),
        ],
        entities: {
          session: {
            description: "A session",
            capabilities: ["get_endpoint", "find_element", "tap", "tap_probed"],
          },
        },
      },
    },
  };
}

interface Sent {
  url: string;
  headers: Record<string, string>;
  query: Record<string, unknown>;
  timeoutMs?: number;
}

/**
 * A transport answering from a queue: a status, 0 for "no answer within the timeout",
 * -1 for "could not be reached".
 */
function harness(
  statuses: number[],
  overrides: Record<string, unknown> = {},
  probeAnswers: unknown[] = [],
) {
  const sent: Sent[] = [];
  const queue = [...statuses];
  const probes = [...probeAnswers];
  const handlers: Record<string, any> = {};
  addCapabilityRegistryTools(
    {
      tool: (...args: unknown[]) => {
        handlers[args[0] as string] = args.find((a) => typeof a === "function");
        return { name: args[0] };
      },
    } as never,
    {
      registry: new CapabilityRegistry(index(overrides) as never),
      baseUrlFor: async () => "https://p.example",
      credentialsFor: () => ({ username: "u", accessKey: "k" }) as never,
      transport: async (
        _m: string,
        url: string,
        headers: Record<string, string>,
        query: Record<string, unknown>,
        _b: unknown,
        options?: { timeoutMs?: number },
      ) => {
        sent.push({ url, headers, query, timeoutMs: options?.timeoutMs });
        if (url.endsWith("/hub/sessions")) {
          // probe answers: a body (listed sessions), 404 for "Session not found.",
          // 0 for a held request
          const next = probes.length > 1 ? probes.shift() : probes[0];
          if (next === 404)
            return { status: 404, body: "Session not found." } as never;
          if (next === 0)
            return {
              status: 0,
              body: null,
              error: "no answer within 20s. The request was sent.",
            } as never;
          return { status: 200, body: next ?? { value: [] } } as never;
        }
        const status = queue.shift() ?? 599;
        if (status === 0)
          return {
            status: 0,
            body: null,
            error:
              "no answer within 20s. The request was sent, so it may have taken effect.",
          } as never;
        if (status === -1)
          return {
            status: 0,
            body: null,
            error: "the product could not be reached",
          } as never;
        if (status === 404)
          return { status: 404, body: "Session not found." } as never;
        return {
          status,
          body:
            status < 300
              ? { value: { "element-6066-11e4-a52e-4f735466cecf": "el-1" } }
              : { value: { error: "invalid session id" } },
        } as never;
      },
    } as never,
  );
  const call = async (name: string, input: Record<string, unknown> = {}) =>
    readAnswer(
      await handlers.invokeCapability(
        {
          name,
          product: "p",
          path_params: { session_id: SESSION },
          query: { ...ENDPOINT },
          ...(name.startsWith("tap")
            ? { user_permission: "granted", change_summary: "tap" }
            : { body: { using: "xpath", value: "//*" } }),
          ...input,
        },
        {} as never,
      ),
    );
  return { sent, call, handlers };
}

describe("a capability driven at an origin the caller supplies", () => {
  beforeEach(() => clearOrigins());

  it("renders the origin from the builder parameters and appends its own path", async () => {
    const { sent, call } = harness([200]);
    const out = await call("find_element");
    expect(out.ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe(
      `https://proxy.example.com:443/wd/device.example.com/${SESSION}/hub/session/${SESSION}/find_element`,
    );
  });

  it("keeps the builder parameters out of the query string", async () => {
    const { sent, call } = harness([200]);
    await call("find_element");
    expect(sent[0].query).toEqual({});
  });

  it("sends no credentials there, only attribution", async () => {
    const { sent, call } = harness([200]);
    await call("find_element");
    expect(sent[0].headers.Authorization).toBeUndefined();
    expect(sent[0].headers["request-source"]).toBe("ai-chatbot");
  });

  it("refuses a host outside the allowlist before sending anything", async () => {
    const { sent, call } = harness([200]);
    const out = await call("find_element", {
      query: { ...ENDPOINT, hostname: "internal.corp" },
    });
    expect(out.ok).toBe(false);
    expect(JSON.stringify(out)).toMatch(
      /not a host this capability may be driven at/,
    );
    expect(sent).toHaveLength(0);
  });

  it("refuses a path that would rewrite the route", async () => {
    const { sent, call } = harness([200]);
    for (const path of ["/wd/x/../../hub/", "/wd/x/hub/?a=1", "/wd/x/hub/#f"]) {
      const out = await call("find_element", { query: { ...ENDPOINT, path } });
      expect(out.ok).toBe(false);
    }
    expect(sent).toHaveLength(0);
  });

  it("refuses when a builder parameter is missing, naming where it comes from", async () => {
    const { sent, call } = harness([200]);
    const out = await call("find_element", {
      query: { hostname: ENDPOINT.hostname, port: 443 },
    });
    expect(out.ok).toBe(false);
    expect(JSON.stringify(out)).toMatch(/needs 'path' in query/);
    expect(JSON.stringify(out)).toMatch(/get_endpoint/);
    expect(sent).toHaveLength(0);
  });

  it("lets the operator add hosts for another environment", async () => {
    process.env.CAPABILITY_REGISTRY_ORIGIN_HOSTS_P = "*.other.test, lab.local";
    try {
      const { sent, call } = harness([200]);
      const out = await call("find_element", {
        query: { ...ENDPOINT, hostname: "proxy.other.test" },
      });
      expect(out.ok).toBe(true);
      expect(sent[0].url).toMatch(/^https:\/\/proxy\.other\.test:443\//);
    } finally {
      delete process.env.CAPABILITY_REGISTRY_ORIGIN_HOSTS_P;
    }
  });

  it("hides origin from the contract but shows the builder parameters where they are passed", async () => {
    const { handlers } = harness([]);
    const contract = readAnswer(
      await handlers.describeCapability(
        { name: "find_element", product: "p" },
        {} as never,
      ),
    );
    expect(contract.origin).toBeUndefined();
    expect(contract.query.map((q: any) => q.name)).toEqual([
      "hostname",
      "port",
      "path",
    ]);
    expect(contract.query[0].base_url_builder).toBe(true);
  });
});

describe("the first read on a fresh origin, while the device starts", () => {
  beforeEach(() => clearOrigins());
  const withReady = {
    origin: {
      url: "https://{hostname}:{port}{path}",
      hosts: ["*.example.com"],
      ready: READY,
    },
  };

  it("is re-sent while it times out, and the caller is told how many times", async () => {
    const { sent, call } = harness([0, 0, 200], withReady);
    const out = await call("find_element");
    expect(out.ok).toBe(true);
    expect(sent).toHaveLength(3);
    expect(out.readiness).toMatchObject({ attempts: 3 });
  });

  it("caps each attempt at the probe length until the origin answers, then uses the capability's own", async () => {
    const { sent, call } = harness([0, 200, 200], withReady);
    await call("find_element");
    await call("find_element");
    expect(sent.map((s) => s.timeoutMs)).toEqual([20_000, 20_000, undefined]);
  });

  it("is also re-sent while the proxy answers a plain 404 'Session not found.'", async () => {
    const { sent, call } = harness([404, 404, 200], {
      origin: {
        url: "https://{hostname}:{port}{path}",
        hosts: ["*.example.com"],
        ready: { timeout_seconds: 120, probe_seconds: 0.01 },
      },
    });
    const out = await call("find_element");
    expect(out.ok).toBe(true);
    expect(sent).toHaveLength(3);
    expect(out.readiness).toMatchObject({ attempts: 3 });
  });

  it("treats that 404 as the session being gone once the origin has answered", async () => {
    const { sent, call } = harness([200, 404], withReady);
    await call("find_element");
    const out = await call("find_element");
    expect(out.ok).toBe(false);
    expect(out.http_response.status).toBe(404);
    expect(sent).toHaveLength(2);
  });

  it("never re-sends a write: a held tap may still land once", async () => {
    const { sent, call } = harness([0]);
    const out = await call("tap");
    expect(out.ok).toBe(false);
    expect(sent).toHaveLength(1);
    expect(out.readiness).toBeUndefined();
  });

  it("treats a timeout as a fault once the origin has answered", async () => {
    const { sent, call } = harness([200, 0], withReady);
    await call("find_element");
    const out = await call("find_element");
    expect(out.ok).toBe(false);
    expect(sent).toHaveLength(2);
    expect(out.readiness).toBeUndefined();
  });

  it("does not retry a connection that was refused: that is not a device starting", async () => {
    const { sent, call } = harness([-1], withReady);
    const out = await call("find_element");
    expect(out.ok).toBe(false);
    expect(sent).toHaveLength(1);
  });

  it("does nothing of the sort for a capability that declares no readiness window", async () => {
    const { sent, call } = harness([0]);
    const out = await call("find_element");
    expect(out.ok).toBe(false);
    expect(sent).toHaveLength(1);
  });
});

describe("a readiness probe, when the origin declares one", () => {
  beforeEach(() => clearOrigins());
  const LISTED = { value: [{ sessionId: SESSION }] };
  const probed = (extra: Record<string, unknown> = {}) => ({
    origin: {
      url: "https://{hostname}:{port}{path}",
      hosts: ["*.example.com"],
      ready: {
        timeout_seconds: 120,
        probe_seconds: 0.01,
        probe_path: "/sessions",
        ...extra,
      },
    },
  });
  const probeCalls = (sent: Sent[]) =>
    sent.filter((s) => s.url.endsWith("/hub/sessions"));
  const commands = (sent: Sent[]) =>
    sent.filter((s) => !s.url.endsWith("/hub/sessions"));

  it("GETs the probe path on the origin first, then sends the command once", async () => {
    const { sent, call } = harness([200], probed(), [LISTED]);
    const out = await call("find_element");
    expect(out.ok).toBe(true);
    expect(probeCalls(sent)).toHaveLength(1);
    expect(probeCalls(sent)[0].url).toBe(
      `https://proxy.example.com:443/wd/device.example.com/${SESSION}/hub/sessions`,
    );
    expect(commands(sent)).toHaveLength(1);
    expect(probeCalls(sent)[0].headers.Authorization).toBeUndefined();
  });

  it("keeps probing while the proxy says not found, lists nothing, or holds", async () => {
    const { sent, call } = harness([200], probed(), [
      404,
      { value: [] },
      0,
      LISTED,
    ]);
    const out = await call("find_element");
    expect(out.ok).toBe(true);
    expect(probeCalls(sent)).toHaveLength(4);
    expect(commands(sent)).toHaveLength(1);
    expect(out.readiness).toMatchObject({ attempts: 4 });
  });

  it("does not probe again once the origin has answered", async () => {
    const { sent, call } = harness([200, 200], probed(), [LISTED]);
    await call("find_element");
    await call("find_element");
    expect(probeCalls(sent)).toHaveLength(1);
    expect(commands(sent)).toHaveLength(2);
  });

  it("brings the origin up for a write too, since the probe is the read, and sends the write once", async () => {
    const { sent, call } = harness([200], {}, [404, LISTED]);
    const out = await call("tap_probed");
    expect(out.ok).toBe(true);
    expect(probeCalls(sent)).toHaveLength(2);
    expect(commands(sent)).toHaveLength(1);
  });

  it("gives up at the window and still sends the command once, so the real answer comes back", async () => {
    const { sent, call } = harness(
      [404],
      probed({ timeout_seconds: 0.02, probe_seconds: 0.01 }),
      [404],
    );
    const out = await call("find_element");
    expect(out.ok).toBe(false);
    expect(out.http_response.status).toBe(404);
    expect(commands(sent)).toHaveLength(1);
    expect(probeCalls(sent).length).toBeGreaterThanOrEqual(1);
  });

  it("refuses a probe path that is not a path", () => {
    expect(
      () =>
        new CapabilityRegistry(
          index(probed({ probe_path: "sessions" })) as never,
        ),
    ).toThrow(/must be a path/);
  });
});

describe("the index refuses an origin it could not honour", () => {
  const load = (overrides: Record<string, unknown>) => () =>
    new CapabilityRegistry(index(overrides) as never);
  const origin = (extra: Record<string, unknown>) => ({
    origin: {
      url: "https://{hostname}:{port}{path}",
      hosts: ["*.example.com"],
      ...extra,
    },
  });

  it("with a template that is not https", () => {
    expect(load(origin({ url: "http://{hostname}:{port}{path}" }))).toThrow(
      /https/,
    );
  });

  it("with a template naming a field no builder parameter supplies", () => {
    expect(load(origin({ url: "https://{hostname}:{port}{prefix}" }))).toThrow(
      /no base_url_builder parameter supplies/,
    );
  });

  it("with a builder parameter the template never reads", () => {
    expect(load(origin({ url: "https://{hostname}:{port}/" }))).toThrow(
      /never reads it/,
    );
  });

  it("with an empty host allowlist", () => {
    expect(load(origin({ hosts: [] }))).toThrow(/at least one host/);
  });

  it("with a builder parameter that is not required", () => {
    expect(
      load({
        query: BUILDERS.map((b) =>
          b.name === "path" ? { ...b, required: undefined } : b,
        ),
      }),
    ).toThrow(/must be required/);
  });

  it("flagging a builder parameter without any origin", () => {
    expect(load({ origin: undefined })).toThrow(/declares no origin/);
  });

  it("alongside a fixed host", () => {
    expect(load({ host: "api" })).toThrow(/fixed or supplied/);
  });

  it("whose readiness probe is longer than its window", () => {
    expect(
      load(origin({ ready: { timeout_seconds: 10, probe_seconds: 30 } })),
    ).toThrow(IndexError);
  });
});
