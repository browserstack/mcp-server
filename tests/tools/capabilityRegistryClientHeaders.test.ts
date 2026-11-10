import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

import { resetTokenCache } from "../../src/lib/central-oauth.js";
import {
  authHeaders,
  clientHeaders,
  fetchTransport,
} from "../../src/tools/capability-registry/egress.js";
import { CapabilityRegistry } from "../../src/tools/capability-registry/index-loader.js";
import { addCapabilityRegistryTools } from "../../src/tools/capability-registry/register.js";
import { invoke } from "../../src/tools/capability-registry/resolve.js";

// Which MCP client, on which build of this server, made a registry call. The product reads
// these to attribute calls (the backend records them as mcp_client / mcp_version), and to see
// callers on builds too old to honour a newer index flag. Neither may ever cost the call.

const VERSION: string = createRequire(import.meta.url)("../../package.json")
  .version;
const USER = { username: "u", accessKey: "k" };
const CAP = {
  name: "get_thing",
  method: "GET",
  path: "/thing",
  mode: "read" as const,
  entity: "thing",
};

/** A transport that records the headers of every request it is handed. */
function recorder() {
  const seen: Record<string, string>[] = [];
  const transport = vi.fn(async (_m: string, _u: string, headers: any) => {
    seen.push(headers);
    return { status: 200, body: {} };
  });
  return { transport, seen };
}

beforeEach(() => resetTokenCache());
afterEach(() => vi.unstubAllGlobals());

describe("x-mcp-version", () => {
  it("is this package's version, for the default scheme", async () => {
    const headers = await authHeaders(USER);
    expect(headers["x-mcp-version"]).toBe(VERSION);
  });

  it("is this package's version, for a minted bearer token", async () => {
    const tokens = async () => ({
      status: 200,
      body: { access_token: "jwt", expires_in: 3600 },
    });
    const headers = await authHeaders(
      USER,
      { type: "oauth2" },
      "bug_capture",
      tokens,
    );
    expect(headers.Authorization).toBe("Bearer jwt");
    expect(headers["x-mcp-version"]).toBe(VERSION);
  });
});

describe("clientHeaders", () => {
  it("names the client", () => {
    expect(clientHeaders("Claude Code")).toEqual({
      "x-mcp-client": "Claude Code",
    });
  });

  it.each([undefined, "", "   "])("sends nothing for %j", (name) => {
    expect(clientHeaders(name)).toEqual({});
  });

  // fetch throws on a header value outside Latin-1, and the transport then reports the
  // product as unreachable — so a client named with an emoji would fail every call.
  it("keeps only printable ASCII", () => {
    expect(clientHeaders("Cursor ✨")).toEqual({ "x-mcp-client": "Cursor" });
  });

  it("cannot be used to inject a header", () => {
    const value = clientHeaders("a\r\nX-Evil: 1")["x-mcp-client"];
    expect(value).not.toMatch(/[\r\n]/);
  });

  it("caps a long name", () => {
    expect(clientHeaders("x".repeat(500))["x-mcp-client"].length).toBe(100);
  });
});

describe("invoke", () => {
  it("forwards the client name it is given", async () => {
    const { transport, seen } = recorder();
    await invoke(
      CAP,
      {},
      "https://p.example",
      USER,
      transport,
      undefined,
      "p",
      "cursor",
    );
    expect(seen[0]["x-mcp-client"]).toBe("cursor");
    expect(seen[0]["x-mcp-version"]).toBe(VERSION);
  });

  it("omits it when there is none", async () => {
    const { transport, seen } = recorder();
    await invoke(CAP, {}, "https://p.example", USER, transport);
    expect(seen[0]).not.toHaveProperty("x-mcp-client");
  });

  it("still reaches the product when the client's name is not a valid header value", async () => {
    let sent: string | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        // What the real fetch does first, and where an unsanitised value throws.
        sent = new Headers(init.headers).get("x-mcp-client");
        return new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    const result = await invoke(
      CAP,
      {},
      "https://p.example",
      USER,
      fetchTransport(),
      undefined,
      "p",
      "Cursor ✨",
    );
    expect(result.http_response.status).toBe(200);
    expect(sent).toBe("Cursor");
  });
});

describe("through invokeCapability", () => {
  function tools(server: Record<string, unknown>) {
    const index = {
      schema_version: 1,
      build_id: "test",
      products: {
        p: {
          summary: "s",
          base_url: "https://p.example",
          capabilities: [CAP],
          entities: {
            thing: { description: "A thing", capabilities: ["get_thing"] },
          },
        },
      },
    };
    const handlers: Record<string, any> = {};
    const { transport, seen } = recorder();
    addCapabilityRegistryTools(
      {
        ...server,
        tool: (...args: unknown[]) => {
          handlers[args[0] as string] = args.find(
            (a) => typeof a === "function",
          );
          return { name: args[0] };
        },
      } as never,
      {
        registry: new CapabilityRegistry(index as never),
        baseUrlFor: async () => "https://p.example",
        credentialsFor: () => USER,
        transport,
      } as never,
    );
    const call = async () =>
      JSON.parse(
        (
          await handlers.invokeCapability(
            { name: "get_thing", product: "p" },
            {} as never,
          )
        ).content[0].text,
      );
    return { call, seen };
  }

  it("sends the connected client's name", async () => {
    const { call, seen } = tools({
      server: { getClientVersion: () => ({ name: "cursor", version: "1" }) },
    });
    expect((await call()).ok).toBe(true);
    expect(seen[0]["x-mcp-client"]).toBe("cursor");
    expect(seen[0]["x-mcp-version"]).toBe(VERSION);
  });

  it("still calls the product when no client info is available", async () => {
    const { call, seen } = tools({});
    expect((await call()).ok).toBe(true);
    expect(seen[0]).not.toHaveProperty("x-mcp-client");
  });
});
