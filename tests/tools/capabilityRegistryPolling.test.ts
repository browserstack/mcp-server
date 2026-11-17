import { describe, expect, it } from "vitest";
import {
  CapabilityRegistry,
  IndexError,
} from "../../src/tools/capability-registry/index-loader.js";
import { addCapabilityRegistryTools } from "../../src/tools/capability-registry/register.js";
import { readAnswer } from "../../src/tools/capability-registry/answer.js";
import {
  invokeWithPolling,
  satisfied,
} from "../../src/tools/capability-registry/poll.js";

// A capability may declare `poll`: an answer that is correct and useless on the first call
// — a session launched a moment ago is listed only once the device has started — is asked
// for again until it says what was waited for has happened. The caller still gets one
// answer, the last, with a record of how many it took and whether the condition was met.

function capability(poll: Record<string, unknown> | undefined) {
  return {
    name: "list_sessions",
    method: "GET",
    path: "/sessions",
    mode: "read",
    entity: "session",
    intent: "Running sessions.",
    query: [{ name: "ref", type: "string" }],
    ...(poll ? { poll } : {}),
  };
}

function index(poll: Record<string, unknown> | undefined) {
  return {
    schema_version: 1,
    build_id: "test",
    products: {
      p: {
        summary: "s",
        base_url: "https://p.example",
        capabilities: [capability(poll)],
        entities: {
          session: {
            description: "A session",
            capabilities: ["list_sessions"],
          },
        },
      },
    },
  };
}

const POLL = {
  interval_seconds: 0.01,
  timeout_seconds: 0.5,
  until: "non_empty",
  when_given: ["ref"],
};

/** A transport that answers each call from a queue of bodies. */
function harness(bodies: unknown[], statuses: number[] = []) {
  const sent: string[] = [];
  const queue = [...bodies];
  const codes = [...statuses];
  const handlers: Record<string, any> = {};
  addCapabilityRegistryTools(
    {
      tool: (...args: unknown[]) => {
        handlers[args[0] as string] = args.find((a) => typeof a === "function");
        return { name: args[0] };
      },
    } as never,
    {
      registry: new CapabilityRegistry(index(POLL) as never),
      baseUrlFor: async () => "https://p.example",
      credentialsFor: () => ({ username: "u", accessKey: "k" }) as never,
      transport: async (_m: string, url: string) => {
        sent.push(url);
        return {
          status: codes.shift() ?? 200,
          body: queue.length > 1 ? queue.shift() : queue[0],
        } as never;
      },
    } as never,
  );
  const list = async (query?: Record<string, unknown>) =>
    readAnswer(
      await handlers.invokeCapability(
        { name: "list_sessions", product: "p", ...(query ? { query } : {}) },
        {} as never,
      ),
    );
  return { sent, list, handlers };
}

describe("a capability that waits", () => {
  it("asks again until the answer fills in, and says how many times it asked", async () => {
    const { sent, list } = harness([[], [], [{ session_id: "s1" }]]);
    const out = await list({ ref: "abcdefgh" });
    expect(out.ok).toBe(true);
    expect(out.http_response.body).toEqual([{ session_id: "s1" }]);
    expect(out.polled).toMatchObject({ attempts: 3, satisfied: true });
    expect(sent).toHaveLength(3);
  });

  it("gives up at the timeout with what it last saw, marked unsatisfied", async () => {
    const { list } = harness([[]]);
    const out = await list({ ref: "abcdefgh" });
    expect(out.ok).toBe(true);
    expect(out.http_response.body).toEqual([]);
    expect(out.polled.satisfied).toBe(false);
    expect(out.polled.attempts).toBeGreaterThan(1);
  });

  it("answers at once when the parameter that means 'wait for one' is absent", async () => {
    const { sent, list } = harness([[]]);
    const out = await list();
    expect(out.ok).toBe(true);
    expect(out.polled).toBeUndefined();
    expect(sent).toHaveLength(1);
  });

  it("does not repeat a refusal: a 404 now is a 404 in a minute", async () => {
    const { sent, list } = harness([{ message: "nope" }], [404]);
    const out = await list({ ref: "abcdefgh" });
    expect(out.ok).toBe(false);
    expect(sent).toHaveLength(1);
    expect(out.polled).toMatchObject({ attempts: 1, satisfied: false });
  });

  it("keeps poll in the contract, because a call that may take minutes is planned around", async () => {
    const { handlers } = harness([[]]);
    const contract = readAnswer(
      await handlers.describeCapability(
        { name: "list_sessions", product: "p" },
        {} as never,
      ),
    );
    expect(contract.poll).toEqual(POLL);
  });
});

describe("what counts as 'happened'", () => {
  const cap = (until: unknown) =>
    capability({ interval_seconds: 1, timeout_seconds: 2, until }) as never;

  it("non_empty: a list with rows, an object with keys, a scalar that is set", () => {
    const c = cap("non_empty");
    expect(satisfied(c, [])).toBe(false);
    expect(satisfied(c, [1])).toBe(true);
    expect(satisfied(c, {})).toBe(false);
    expect(satisfied(c, { a: 1 })).toBe(true);
    expect(satisfied(c, "")).toBe(false);
    expect(satisfied(c, "x")).toBe(true);
    expect(satisfied(c, null)).toBe(false);
  });

  it("field/values: a top-level field taking one of the values", () => {
    const c = cap({ field: "status", values: ["done", "failed"] });
    expect(satisfied(c, { status: "running" })).toBe(false);
    expect(satisfied(c, { status: "done" })).toBe(true);
    expect(satisfied(c, { status: "failed" })).toBe(true);
    expect(satisfied(c, [{ status: "done" }])).toBe(false);
  });

  it("stops before a wait that would overrun the timeout, on a clock that does not tick", async () => {
    let t = 0;
    const calls: number[] = [];
    const out = await invokeWithPolling(
      cap("non_empty"),
      { query: { ref: "x" } },
      async () => {
        calls.push(t);
        return {
          ok: true,
          completed: true,
          http_response: { status: 200, body: [] },
        };
      },
      (r) => r,
      async (ms) => {
        t += ms;
      },
      () => t,
    );
    // interval 1 s, timeout 2 s: calls at 0, 1 and 2; a fourth would land past the deadline
    expect(calls).toEqual([0, 1000, 2000]);
    expect(out.polled).toEqual({
      attempts: 3,
      elapsed_seconds: 2,
      satisfied: false,
    });
  });
});

describe("the index refuses a poll it could misread", () => {
  const load = (poll: Record<string, unknown>) => () =>
    new CapabilityRegistry(index(poll) as never);

  it("whose interval exceeds its timeout", () => {
    expect(
      load({ interval_seconds: 5, timeout_seconds: 1, until: "non_empty" }),
    ).toThrow(IndexError);
  });

  it("whose condition is in no known shape", () => {
    expect(
      load({ interval_seconds: 1, timeout_seconds: 5, until: "someday" }),
    ).toThrow(/poll.until/);
  });

  it("that waits on a parameter the capability does not take", () => {
    expect(
      load({
        interval_seconds: 1,
        timeout_seconds: 5,
        until: "non_empty",
        when_given: ["mcp_ref"],
      }),
    ).toThrow(/does not take/);
  });
});
