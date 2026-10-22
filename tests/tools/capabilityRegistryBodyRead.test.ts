import { describe, expect, it, vi } from "vitest";
import { fetchTransport } from "../../src/tools/capability-registry/egress.js";

// `fetch` resolves as soon as the response headers arrive, so a slow body can still be
// streaming when the abort timer fires. That failure used to be swallowed and reported as a
// 200 with no payload — which, for a session create that really did allocate a device, reads
// as "started successfully, but there is no session id", leaving a session nobody can release.

const headers = {
  get: (k: string) => (k === "content-type" ? "application/json" : null),
};

describe("a response whose body cannot be read", () => {
  it("is reported as a failed call, not as an empty 200", async () => {
    vi.stubGlobal("fetch", async () => ({
      status: 200,
      headers,
      text: async () => {
        throw Object.assign(new Error("The operation was aborted."), {
          name: "AbortError",
        });
      },
    }));
    const result = await fetchTransport()(
      "POST",
      "https://hub.example/session",
      {},
    );
    expect(result.status).toBe(0);
    expect(result.body).toBeNull();
    expect(result.error).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it("still treats a genuinely empty body as an empty body", async () => {
    // A 204, or any endpoint that answers with nothing, must keep working.
    vi.stubGlobal("fetch", async () => ({
      status: 204,
      headers,
      text: async () => "",
    }));
    const result = await fetchTransport()(
      "DELETE",
      "https://hub.example/session/x",
      {},
    );
    expect(result.status).toBe(204);
    expect(result.body).toBeNull();
    expect(result.error).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it("passes a normal JSON body through unchanged", async () => {
    vi.stubGlobal("fetch", async () => ({
      status: 200,
      headers,
      text: async () => '{"value":{"sessionId":"abc"}}',
    }));
    const result = await fetchTransport()(
      "POST",
      "https://hub.example/session",
      {},
    );
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ value: { sessionId: "abc" } });
    vi.unstubAllGlobals();
  });
});
