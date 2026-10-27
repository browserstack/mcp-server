import { describe, expect, it } from "vitest";
import { CapabilityRegistry } from "../../src/tools/capability-registry/index-loader.js";
import { addCapabilityRegistryTools } from "../../src/tools/capability-registry/register.js";

// A capability may declare `fallbacks`: when its own call answers a named status, a sibling
// is called with an authored body, and the chain stops at the first 2xx. hide_keyboard on an
// iPhone is the case: the plain call is refused because the keyboard has no dismiss key, so
// the index says to press Done-type keys, then Return. These pin the wiring — what is sent,
// in what order, what stops it, and that the caller is told every step.

const SESSION = "0123456789abcdef0123456789abcdef01234567";
const DONE = { keys: ["Done", "done", "Hide keyboard", "Dismiss"] };
const RETURN = { keys: ["Return", "return"] };

function index(fallbacks?: unknown[], extra: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    build_id: "test",
    products: {
      p: {
        summary: "s",
        base_url: "https://p.example",
        capabilities: [
          {
            name: "hide_keyboard",
            method: "POST",
            path: "/session/{session_id}/hide",
            mode: "write",
            entity: "app_session",
            intent: "Close the keyboard.",
            path_params: [
              { name: "session_id", type: "string", required: true },
            ],
            ...(fallbacks ? { fallbacks } : {}),
            ...extra,
          },
          {
            name: "dismiss_keyboard_key",
            method: "POST",
            path: "/session/{session_id}/execute",
            mode: "write",
            entity: "app_session",
            intent: "Press one of the keyboard's own keys.",
            path_params: [
              { name: "session_id", type: "string", required: true },
            ],
            body: [
              {
                name: "script",
                type: "string",
                required: true,
                values: ["mobile: hideKeyboard"],
              },
              { name: "args", type: "array", required: true },
            ],
          },
          {
            name: "delete_everything",
            method: "DELETE",
            path: "/session/{session_id}",
            mode: "destructive",
            entity: "app_session",
            intent: "Gone.",
            path_params: [
              { name: "session_id", type: "string", required: true },
            ],
          },
        ],
        entities: {
          app_session: {
            description: "A session",
            capabilities: [
              "hide_keyboard",
              "dismiss_keyboard_key",
              "delete_everything",
            ],
          },
        },
      },
    },
  };
}

const CHAIN = [
  {
    when: { status: 400 },
    capability: "dismiss_keyboard_key",
    body: { script: "mobile: hideKeyboard", args: [DONE] },
  },
  {
    when: { status: 400 },
    capability: "dismiss_keyboard_key",
    body: { script: "mobile: hideKeyboard", args: [RETURN] },
  },
];

/** A transport that answers each call from a queue and records what it was sent. */
function harness(statuses: number[], fallbacks?: unknown[]) {
  const sent: { url: string; body: unknown }[] = [];
  const queue = [...statuses];
  const handlers: Record<string, any> = {};
  addCapabilityRegistryTools(
    {
      tool: (...args: unknown[]) => {
        handlers[args[0] as string] = args.find((a) => typeof a === "function");
        return { name: args[0] };
      },
    } as never,
    {
      registry: new CapabilityRegistry(index(fallbacks) as never),
      baseUrlFor: async () => "https://p.example",
      credentialsFor: () => ({ username: "u", accessKey: "k" }) as never,
      transport: async (
        _m: string,
        url: string,
        _h: unknown,
        _q: unknown,
        body: unknown,
      ) => {
        sent.push({ url, body });
        const status = queue.shift() ?? 599;
        return {
          status,
          body:
            status < 300
              ? { value: null }
              : { value: { error: "invalid element state" } },
        } as never;
      },
    } as never,
  );
  const call = async (input: Record<string, unknown>) =>
    JSON.parse(
      (
        await handlers.invokeCapability(
          {
            name: "hide_keyboard",
            product: "p",
            path_params: { session_id: SESSION },
            user_permission: "granted",
            change_summary: "close the keyboard",
            ...input,
          },
          {} as never,
        )
      ).content[0].text,
    );
  return { sent, call, handlers };
}

describe("a capability with fallbacks", () => {
  it("runs the chain when its own call is refused, and stops at the first success", async () => {
    const { sent, call } = harness([400, 400, 200], CHAIN);
    const out = await call({});
    expect(out.ok).toBe(true);
    expect(out.http_response.status).toBe(200);
    expect(sent.map((s) => s.url)).toEqual([
      `https://p.example/session/${SESSION}/hide`,
      `https://p.example/session/${SESSION}/execute`,
      `https://p.example/session/${SESSION}/execute`,
    ]);
    // the step's body is the index's, carrying the original path parameter only
    expect(sent[1].body).toEqual({
      script: "mobile: hideKeyboard",
      args: [DONE],
    });
    expect(sent[2].body).toEqual({
      script: "mobile: hideKeyboard",
      args: [RETURN],
    });
  });

  it("tells the caller every attempt, in order, with what each sent", async () => {
    const { call } = harness([400, 400, 200], CHAIN);
    const out = await call({});
    expect(out.fallback.attempts).toEqual([
      { capability: "hide_keyboard", status: 400 },
      {
        capability: "dismiss_keyboard_key",
        status: 400,
        body: { script: "mobile: hideKeyboard", args: [DONE] },
      },
      {
        capability: "dismiss_keyboard_key",
        status: 200,
        body: { script: "mobile: hideKeyboard", args: [RETURN] },
      },
    ]);
  });

  it("stops early when a step succeeds, sending nothing more", async () => {
    const { sent, call } = harness([400, 200], CHAIN);
    const out = await call({});
    expect(out.ok).toBe(true);
    expect(sent).toHaveLength(2);
    expect(out.fallback.attempts).toHaveLength(2);
  });

  it("hands back the last refusal when every step fails, with the whole chain listed", async () => {
    const { sent, call } = harness([400, 400, 400], CHAIN);
    const out = await call({});
    expect(out.ok).toBe(false);
    expect(out.http_response.status).toBe(400);
    expect(sent).toHaveLength(3);
    expect(out.fallback.attempts.map((a: any) => a.status)).toEqual([
      400, 400, 400,
    ]);
  });

  it("does not run on a status the chain does not name", async () => {
    // A 500 is not "the keyboard has no dismiss key"; pressing keys at it would be a guess.
    const { sent, call } = harness([500], CHAIN);
    const out = await call({});
    expect(out.ok).toBe(false);
    expect(sent).toHaveLength(1);
    expect(out.fallback).toBeUndefined();
  });

  it("ends the chain when a step answers something the next step does not name", async () => {
    const { sent, call } = harness([400, 500], CHAIN);
    const out = await call({});
    expect(out.http_response.status).toBe(500);
    expect(sent).toHaveLength(2);
  });

  it("says nothing about fallbacks when the first call succeeds", async () => {
    const { sent, call } = harness([200], CHAIN);
    const out = await call({});
    expect(out.ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(out.fallback).toBeUndefined();
  });

  it("still makes exactly one request for a capability that declares none", async () => {
    const { sent, call } = harness([400]);
    const out = await call({});
    expect(out.ok).toBe(false);
    expect(sent).toHaveLength(1);
    expect(out.fallback).toBeUndefined();
  });

  it("refuses, at load, a step that names a destructive capability", () => {
    // The loader checks every chain before a request can go out; the runtime guard in
    // invokeWithFallbacks stays as the backstop behind it.
    expect(() =>
      harness(
        [400, 200],
        [{ when: { status: 400 }, capability: "delete_everything" }],
      ),
    ).toThrow(/delete_everything.*destructive/);
  });

  it("refuses, at load, a step that names a capability the index does not define", () => {
    expect(() =>
      harness(
        [400, 200],
        [{ when: { status: 400 }, capability: "no_such_thing" }],
      ),
    ).toThrow(/no_such_thing.*does not define/);
  });
});

describe("the contract shows the chain", () => {
  it("describeCapability publishes `fallbacks`, so a caller knows what may be pressed", async () => {
    const { handlers } = harness([], CHAIN);
    const doc = JSON.parse(
      (
        await handlers.describeCapability(
          { name: "hide_keyboard", product: "p" },
          {} as never,
        )
      ).content[0].text,
    );
    expect(doc.fallbacks).toHaveLength(2);
    expect(doc.fallbacks[1].body.args[0].keys).toContain("Return");
  });
});
