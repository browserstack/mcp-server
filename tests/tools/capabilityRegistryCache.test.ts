import { afterEach, describe, expect, it, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { addCapabilityRegistryTools } from "../../src/tools/capability-registry/register.js";
import { CapabilityRegistry } from "../../src/tools/capability-registry/index-loader.js";
import { RegistryIndex } from "../../src/tools/capability-registry/types.js";
import type {
  HttpResponse,
  Transport,
} from "../../src/tools/capability-registry/egress.js";

// A product with one cacheable read (declares `cache`), one read that does not, and one
// write — the three shapes the cache has to tell apart.
const INDEX: RegistryIndex = {
  schema_version: 1,
  build_id: "cache-test",
  products: {
    lt: {
      summary: "Load testing, test double.",
      capabilities: [
        {
          method: "GET",
          path: "/config/{id}",
          mode: "read",
          entity: "test",
          path_params: [{ name: "id", type: "integer", required: true }],
          query: [
            { name: "a", type: "integer" },
            { name: "b", type: "integer" },
          ],
          cache: { ttlSec: 300 },
        },
        {
          method: "GET",
          path: "/status/{id}",
          mode: "read",
          entity: "run",
          path_params: [{ name: "id", type: "integer", required: true }],
        },
        {
          method: "PUT",
          path: "/config/{id}",
          mode: "write",
          entity: "test",
          path_params: [{ name: "id", type: "integer", required: true }],
          body: [{ name: "name", type: "string" }],
        },
      ],
      entities: { test: {}, run: {} },
    },
  },
};

interface Harness {
  invoke: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
  gets: () => number;
  writes: () => number;
  setUser: (username: string) => void;
}

function build(
  respond: (n: number) => HttpResponse = () => ({
    status: 200,
    body: { ok: true },
  }),
): Harness {
  const server = new McpServer({ name: "cache-test", version: "0" });
  let calls = 0;
  let gets = 0;
  let writes = 0;
  let username = "userA";
  const transport: Transport = async (method) => {
    calls += 1;
    if (method === "GET") gets += 1;
    else writes += 1;
    return respond(calls);
  };
  const tools = addCapabilityRegistryTools(server, {
    registry: new CapabilityRegistry(INDEX),
    baseUrlFor: async () => "https://lt.example",
    credentialsFor: () => ({ username, accessKey: "k" }),
    transport,
  });
  return {
    invoke: async (input) => {
      const result = await (
        tools.invokeEndpoint as unknown as {
          handler: (
            i: unknown,
            e: unknown,
          ) => Promise<{ content: { text: string }[] }>;
        }
      ).handler(input, {});
      return JSON.parse(result.content[0].text);
    },
    gets: () => gets,
    writes: () => writes,
    setUser: (u) => {
      username = u;
    },
  };
}

const readConfig = (id: number) => ({
  method: "GET",
  path: "/config/{id}",
  path_params: { id },
});

describe("capability registry read cache", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("serves a repeat of a cacheable read from the cache, flagged, without a second request", async () => {
    const h = build();
    const first = await h.invoke(readConfig(1));
    const second = await h.invoke(readConfig(1));

    expect(h.gets()).toBe(1);
    expect(first.cached).toBeUndefined();
    expect(second.cached).toBe(true);
    // The body the caller sees is the product's, unchanged.
    expect(second.http_response).toEqual(first.http_response);
  });

  it("keys on the arguments, so a different id is a separate request", async () => {
    const h = build();
    await h.invoke(readConfig(1));
    await h.invoke(readConfig(2));
    expect(h.gets()).toBe(2);
  });

  it("ignores argument order when keying", async () => {
    const h = build();
    await h.invoke({
      method: "GET",
      path: "/config/{id}",
      path_params: { id: 1 },
      query: { a: 1, b: 2 },
    });
    await h.invoke({
      method: "GET",
      path: "/config/{id}",
      query: { b: 2, a: 1 },
      path_params: { id: 1 },
    });
    expect(h.gets()).toBe(1);
  });

  it("does not cache a read the capability has not marked cacheable", async () => {
    const h = build();
    await h.invoke({
      method: "GET",
      path: "/status/{id}",
      path_params: { id: 1 },
    });
    await h.invoke({
      method: "GET",
      path: "/status/{id}",
      path_params: { id: 1 },
    });
    expect(h.gets()).toBe(2);
  });

  it("drops the product's cached reads after a successful write", async () => {
    const h = build();
    await h.invoke(readConfig(1)); // miss -> stored
    await h.invoke(readConfig(1)); // hit
    expect(h.gets()).toBe(1);

    await h.invoke({
      method: "PUT",
      path: "/config/{id}",
      path_params: { id: 1 },
      body: { name: "x" },
      user_permission: "granted",
      change_summary: "rename",
    });
    expect(h.writes()).toBe(1);

    await h.invoke(readConfig(1)); // cache was invalidated -> re-fetch
    expect(h.gets()).toBe(2);
  });

  it("scopes the cache to the calling credential", async () => {
    const h = build();
    h.setUser("userA");
    await h.invoke(readConfig(1)); // stored under userA
    h.setUser("userB");
    const other = await h.invoke(readConfig(1)); // must not see userA's entry
    expect(h.gets()).toBe(2);
    expect(other.cached).toBeUndefined();
    h.setUser("userA");
    await h.invoke(readConfig(1)); // userA still hits the cache
    expect(h.gets()).toBe(2);
  });

  it("does not cache a non-2xx read", async () => {
    const h = build((n) => ({ status: 500, body: { error: `boom ${n}` } }));
    await h.invoke(readConfig(1));
    await h.invoke(readConfig(1));
    expect(h.gets()).toBe(2);
  });

  it("re-fetches once the entry is past its ttl", async () => {
    vi.useFakeTimers();
    const h = build();
    await h.invoke(readConfig(1)); // stored, ttl 300s
    await h.invoke(readConfig(1)); // hit
    expect(h.gets()).toBe(1);
    vi.advanceTimersByTime(301_000);
    await h.invoke(readConfig(1)); // expired -> re-fetch
    expect(h.gets()).toBe(2);
  });
});
