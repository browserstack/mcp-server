import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchTransport } from "../../src/tools/capability-registry/egress.js";

/**
 * What the transport does with a response body.
 *
 * These exist because of a real miss. The transport used to parse the body only when the
 * content-type said JSON and return `null` otherwise, so an unhandled server error — which
 * renders `text/html` — reached the caller as `{status: 500, body: null}`. A live probe of
 * `test_case_results_v1` then could not tell whether the product had sent no message or
 * whether we had discarded it, and had to leave that open in its findings. Discarding a
 * body is the one thing this layer must never do quietly.
 */

const call = (body: BodyInit | null, init: ResponseInit) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(body, init)),
  );
  return fetchTransport()("GET", "https://example.com/x", {}, {});
};

afterEach(() => vi.unstubAllGlobals());

describe("the transport never silently drops a response body", () => {
  it("parses JSON, as it always did", async () => {
    const res = await call(JSON.stringify({ success: true, id: 7 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, id: 7 });
  });

  it("keeps an HTML error page instead of nulling it", async () => {
    // The case that motivated this: a 500 from a Rails app.
    const res = await call(
      "<html><body><h1>Internal Server Error</h1><p>NoMethodError</p></body></html>",
      { status: 500, headers: { "content-type": "text/html; charset=utf-8" } },
    );
    expect(res.status).toBe(500);
    expect(res.body).toContain("NoMethodError");
  });

  it("keeps the raw text when a body claims JSON but is not", async () => {
    // A body that fails to parse IS the diagnosis; turning it into null destroys it.
    const res = await call("<!DOCTYPE html><h1>502 Bad Gateway</h1>", {
      status: 502,
      headers: { "content-type": "application/json" },
    });
    expect(res.body).toContain("502 Bad Gateway");
  });

  it("describes a binary response rather than decoding it", async () => {
    // Knowing a PDF arrived is useful; putting its bytes in an agent's context is not.
    const res = await call("%PDF-1.7 binary-ish", {
      status: 200,
      headers: { "content-type": "application/pdf", "content-length": "20481" },
    });
    expect(res.body).toBe("<non-text response: application/pdf, 20481 bytes>");
  });

  it("truncates a long body and says that it did", async () => {
    const res = await call("x".repeat(5000), {
      status: 500,
      headers: { "content-type": "text/plain" },
    });
    const body = res.body as string;
    expect(body.length).toBeLessThan(5000);
    expect(body).toContain("truncated, 5000 chars total");
  });

  it("still reports an empty body as null", async () => {
    // A 204 has nothing to say, and "" would read as content where there is none.
    const res = await call("", {
      status: 204,
      headers: { "content-type": "text/plain" },
    });
    expect(res.body).toBeNull();
  });

  it("reports an unreachable product as status 0, not as an empty success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    const res = await fetchTransport()("GET", "https://example.com/x", {}, {});
    expect(res.status).toBe(0);
    expect(res.error).toBeTruthy();
  });
});

describe("a caller who hand-builds the wrapper is told what happened", () => {
  // The registry assembles the Rails-style body wrapper itself from each field's
  // json_path, so a caller sends fields flat. When one nests them by hand — which the
  // published guidance was telling 25 tm capabilities' callers to do — the key is never a
  // declared param, and the bare "unknown body" message reads as "no such field" when the
  // truth is the reverse: the field exists and building it is this layer's job.
  const capability = {
    name: "update_thing",
    method: "PATCH",
    path: "/api/v2/things/{id}",
    mode: "write",
    entity: "thing",
    intent: "x",
    path_params: [{ name: "id", type: "string", required: true }],
    body: [
      { name: "name", type: "string", json_path: "/thing/name" },
      { name: "priority", type: "string", json_path: "/thing/priority" },
    ],
  } as any;

  it("names the wrapper and says to send the fields directly", async () => {
    const { bind } = await import("../../src/tools/capability-registry/bind.js");
    expect(() =>
      bind(capability, { path_params: { id: "1" }, body: { thing: { name: "x" } } }),
    ).toThrow(/wrapper this surface builds for you|builds for you from each field/);
  });

  it("still reports an ordinary typo as an ordinary unknown field", async () => {
    const { bind } = await import("../../src/tools/capability-registry/bind.js");
    // `nmae` is not a wrapper — the hint must not fire and mislead.
    expect(() =>
      bind(capability, { path_params: { id: "1" }, body: { nmae: "x" } }),
    ).toThrow(/unknown body: nmae\. accepted: name, priority$/);
  });

  it("accepts the flat body it asked for", async () => {
    const { bind } = await import("../../src/tools/capability-registry/bind.js");
    const bound = bind(capability, { path_params: { id: "1" }, body: { name: "x" } });
    expect(bound.body).toEqual({ thing: { name: "x" } });
  });
});
