import { beforeEach, describe, expect, it } from "vitest";
import {
  CapabilityRegistry,
  IndexError,
} from "../../src/tools/capability-registry/index-loader.js";
import { addCapabilityRegistryTools } from "../../src/tools/capability-registry/register.js";
import { readAnswer } from "../../src/tools/capability-registry/answer.js";
import { clearOrigins } from "../../src/tools/capability-registry/origin.js";

// A capability may be declared as `steps`: siblings called in order, each fed from the
// last, answering with what they took. App Live's get_session is the case: wait for the
// launched session, fetch its endpoint, bring its Appium session up — one call, one
// consent. These pin the wiring: substitution, taking, ordering, how a refusal is
// placed, and what the loader refuses.

const SESSION = "0123456789abcdef0123456789abcdef01234567";
const ROW = { session_id: SESSION, device: "Pixel", mcp_ref: "abcdefgh" };
const ENDPOINT = {
  hostname: "proxy.example.com",
  port: 443,
  path: `/wd/device.example.com/${SESSION}/hub/`,
};

const BUILDERS = [
  { name: "hostname", type: "string", required: true, base_url_builder: true },
  { name: "port", type: "integer", required: true, base_url_builder: true },
  { name: "path", type: "string", required: true, base_url_builder: true },
];

function index(chainOverrides: Record<string, unknown> = {}) {
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
            name: "list_sessions",
            method: "GET",
            path: "/sessions",
            mode: "read",
            entity: "session",
            intent: "Running sessions.",
            query: [{ name: "mcp_ref", type: "string" }],
            poll: {
              interval_seconds: 0.01,
              timeout_seconds: 0.5,
              until: "non_empty",
              when_given: ["mcp_ref"],
            },
          },
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
          {
            name: "list_appium_sessions",
            method: "GET",
            path: "/sessions",
            mode: "read",
            entity: "session",
            intent: "Bring the Appium session up.",
            query: BUILDERS,
            origin: {
              url: "https://{hostname}:{port}{path}",
              hosts: ["*.example.com"],
            },
            poll: {
              interval_seconds: 0.01,
              timeout_seconds: 0.5,
              until: { path: "/value", non_empty: true },
              keep_on: [404],
            },
          },
          {
            name: "stop",
            method: "POST",
            path: "/sessions/{session_id}/stop",
            mode: "write",
            entity: "session",
            intent: "Stop.",
            path_params: [
              { name: "session_id", type: "string", required: true },
            ],
          },
          {
            name: "get_session",
            method: "GET",
            path: "/sessions",
            mode: "read",
            entity: "session",
            intent: "Everything needed to drive a launched session.",
            query: [{ name: "mcp_ref", type: "string", required: true }],
            steps: [
              {
                capability: "list_sessions",
                query: { mcp_ref: "{mcp_ref}" },
                take: { session_id: "/0/session_id", device: "/0/device" },
              },
              {
                capability: "get_endpoint",
                path_params: { session_id: "{session_id}" },
                take: { hostname: "/hostname", port: "/port", path: "/path" },
              },
              {
                capability: "list_appium_sessions",
                query: {
                  hostname: "{hostname}",
                  port: "{port}",
                  path: "{path}",
                },
                take: { appium_session_id: "/value/0/sessionId" },
              },
            ],
            ...chainOverrides,
          },
        ],
        entities: {
          session: {
            description: "A session",
            capabilities: [
              "list_sessions",
              "get_endpoint",
              "list_appium_sessions",
              "stop",
              "get_session",
            ],
          },
        },
      },
    },
  };
}

interface Sent {
  url: string;
  query: Record<string, unknown>;
}

/** A transport answering each route from its own queue; a queue's last entry repeats. */
function harness(
  answers: Record<string, unknown[]>,
  chainOverrides: Record<string, unknown> = {},
) {
  const sent: Sent[] = [];
  const queues = Object.fromEntries(
    Object.entries(answers).map(([k, v]) => [k, [...v]]),
  );
  const handlers: Record<string, any> = {};
  addCapabilityRegistryTools(
    {
      tool: (...args: unknown[]) => {
        handlers[args[0] as string] = args.find((a) => typeof a === "function");
        return { name: args[0] };
      },
    } as never,
    {
      registry: new CapabilityRegistry(index(chainOverrides) as never),
      baseUrlFor: async () => "https://p.example",
      credentialsFor: () => ({ username: "u", accessKey: "k" }) as never,
      transport: async (
        _m: string,
        url: string,
        _h: unknown,
        query: Record<string, unknown>,
      ) => {
        sent.push({ url, query });
        const route = url.includes("/hub/sessions")
          ? "proxy"
          : url.includes("/appium")
            ? "endpoint"
            : "sessions";
        const q = queues[route] ?? [];
        const next = q.length > 1 ? q.shift() : q[0];
        if (next === 404)
          return { status: 404, body: "Session not found." } as never;
        return { status: 200, body: next ?? [] } as never;
      },
    } as never,
  );
  const get = async (input: Record<string, unknown> = {}) =>
    readAnswer(
      await handlers.invokeCapability(
        {
          name: "get_session",
          product: "p",
          query: { mcp_ref: "abcdefgh" },
          ...input,
        },
        {} as never,
      ),
    );
  return { sent, get, handlers };
}

describe("a capability declared as a chain of steps", () => {
  beforeEach(() => clearOrigins());

  it("runs its steps in order, feeding each from the last, and answers with what was taken", async () => {
    const { sent, get } = harness({
      sessions: [[ROW]],
      endpoint: [ENDPOINT],
      proxy: [{ value: [{ sessionId: SESSION }] }],
    });
    const out = await get();
    expect(out.ok).toBe(true);
    expect(out.http_response.body).toEqual({
      session_id: SESSION,
      device: "Pixel",
      ...ENDPOINT,
      appium_session_id: SESSION,
    });
    expect(sent.map((s) => s.url)).toEqual([
      "https://p.example/sessions",
      `https://p.example/sessions/${SESSION}/appium`,
      `https://proxy.example.com:443/wd/device.example.com/${SESSION}/hub/sessions`,
    ]);
    expect(sent[0].query).toEqual({ mcp_ref: "abcdefgh" });
    expect(out.chain.map((s: any) => s.capability)).toEqual([
      "list_sessions",
      "get_endpoint",
      "list_appium_sessions",
    ]);
  });

  it("lets a step wait the way a direct call would, and reports the wait", async () => {
    const { get } = harness({
      sessions: [[], [], [ROW]],
      endpoint: [ENDPOINT],
      proxy: [404, { value: [] }, { value: [{ sessionId: SESSION }] }],
    });
    const out = await get();
    expect(out.ok).toBe(true);
    expect(out.chain[0].polled).toMatchObject({ attempts: 3, satisfied: true });
    expect(out.chain[2].polled).toMatchObject({ attempts: 3, satisfied: true });
  });

  it("stops at the first refusal and says which step it was", async () => {
    const { sent, get } = harness({
      sessions: [[ROW]],
      endpoint: [404],
    });
    const out = await get();
    expect(out.ok).toBe(false);
    expect(out.http_response.status).toBe(404);
    expect(out.chain).toHaveLength(2);
    expect(out.chain[1]).toMatchObject({
      capability: "get_endpoint",
      status: 404,
    });
    expect(sent).toHaveLength(2);
  });

  it("refuses, naming the step and the pointer, when a step answers without what is taken", async () => {
    const { get } = harness({
      sessions: [[ROW]],
      endpoint: [{ hostname: "proxy.example.com" }],
    });
    const out = await get();
    expect(out.ok).toBe(false);
    expect(JSON.stringify(out)).toMatch(
      /get_endpoint answered without '\/port'/,
    );
  });

  it("hands back an unmet wait as the step's own last answer", async () => {
    // list_sessions never fills in: the chain ends there with the empty list, not a guess
    const { get } = harness({ sessions: [[]] });
    const out = await get();
    expect(out.ok).toBe(false);
  });

  it("hides steps from the contract; the caller sees parameters and returns", async () => {
    const { handlers } = harness({});
    const contract = readAnswer(
      await handlers.describeCapability(
        { name: "get_session", product: "p" },
        {} as never,
      ),
    );
    expect(contract.steps).toBeUndefined();
    expect(contract.query[0].name).toBe("mcp_ref");
  });
});

describe("the index refuses a chain it could not run", () => {
  const load = (overrides: Record<string, unknown>) => () =>
    new CapabilityRegistry(index(overrides) as never);

  it("naming a step the index does not define", () => {
    expect(load({ steps: [{ capability: "nope" }] })).toThrow(IndexError);
  });

  it("needing less consent than one of its steps", () => {
    expect(
      load({
        steps: [{ capability: "stop", path_params: { session_id: "x" } }],
      }),
    ).toThrow(/may not need less consent/);
  });

  it("with a placeholder nothing supplies", () => {
    expect(
      load({
        steps: [
          { capability: "get_endpoint", path_params: { session_id: "{sid}" } },
        ],
      }),
    ).toThrow(/names '\{sid\}'/);
  });

  it("with a take that is not a pointer", () => {
    expect(
      load({
        steps: [
          { capability: "list_sessions", take: { session_id: "0.session_id" } },
        ],
      }),
    ).toThrow(/JSON pointer/);
  });

  it("with no steps at all", () => {
    expect(load({ steps: [] })).toThrow(/at least one/);
  });
});
