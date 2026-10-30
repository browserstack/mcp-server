import { afterEach, describe, expect, it, vi } from "vitest";
import { CapabilityRegistry } from "../../src/tools/capability-registry/index-loader.js";
import { addCapabilityRegistryTools } from "../../src/tools/capability-registry/register.js";
import { fetchTransport } from "../../src/tools/capability-registry/egress.js";

// The five findings from the review of PR #491, each pinned so it cannot come back.

function product(capabilities: unknown[], extra: Record<string, unknown> = {}) {
  return {
    summary: "s",
    base_url: "https://p.example",
    capabilities,
    entities: {
      thing: {
        description: "A thing",
        capabilities: (capabilities as { name: string }[]).map((c) => c.name),
      },
    },
    ...extra,
  };
}

function harness(index: unknown) {
  const sent: unknown[] = [];
  const handlers: Record<string, any> = {};
  addCapabilityRegistryTools(
    {
      tool: (...args: unknown[]) => {
        handlers[args[0] as string] = args.find((a) => typeof a === "function");
        return { name: args[0] };
      },
    } as never,
    {
      registry: new CapabilityRegistry(index as never),
      baseUrlFor: async () => "https://p.example",
      credentialsFor: () => ({ username: "u", accessKey: "k" }) as never,
      transport: async (...args: unknown[]) => {
        sent.push(args);
        return { status: 200, body: { value: { sessionId: "abc" } } } as never;
      },
    } as never,
  );
  const call = async (tool: string, input: unknown) =>
    JSON.parse((await handlers[tool](input, {} as never)).content[0].text);
  return { sent, call };
}

describe("M1: a bad `select` is refused before anything is sent", () => {
  it("sends nothing for a capability that declares no narrowable", async () => {
    const { sent, call } = harness({
      schema_version: 1,
      build_id: "t",
      products: {
        p: product([
          {
            name: "create_session",
            method: "POST",
            path: "/session",
            mode: "write",
            entity: "thing",
            intent: "Start.",
          },
        ]),
      },
    });
    const out = await call("invokeCapability", {
      name: "create_session",
      product: "p",
      user_permission: "granted",
      change_summary: "start",
      select: { limit: 1 },
    });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/does not support `select`/);
    expect(sent).toHaveLength(0);
  });

  it("sends nothing for a field the contract does not declare", async () => {
    const { sent, call } = harness({
      schema_version: 1,
      build_id: "t",
      products: {
        p: product([
          {
            name: "list_things",
            method: "GET",
            path: "/things",
            mode: "read",
            entity: "thing",
            intent: "List.",
            narrowable: { fields: ["os"] },
          },
        ]),
      },
    });
    const out = await call("invokeCapability", {
      name: "list_things",
      product: "p",
      select: { where: { platform: "x" } },
    });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/'platform'/);
    expect(sent).toHaveLength(0);
  });
});

describe("M2: a capability may ask for longer, and a cut-off is told apart from unreachable", () => {
  it("passes the capability's timeout to the transport", async () => {
    const { sent, call } = harness({
      schema_version: 1,
      build_id: "t",
      products: {
        p: product([
          {
            name: "upload",
            method: "POST",
            path: "/upload",
            mode: "write",
            entity: "thing",
            intent: "Upload.",
            timeout_seconds: 600,
          },
          {
            name: "quick",
            method: "GET",
            path: "/quick",
            mode: "read",
            entity: "thing",
            intent: "Quick.",
          },
        ]),
      },
    });
    await call("invokeCapability", {
      name: "upload",
      product: "p",
      user_permission: "granted",
      change_summary: "up",
    });
    await call("invokeCapability", { name: "quick", product: "p" });
    expect((sent[0] as unknown[])[5]).toEqual({ timeoutMs: 600_000 });
    expect((sent[1] as unknown[])[5]).toEqual({ timeoutMs: undefined });
  });

  it("says the request may have taken effect when the read was cut off", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((_url, init) => {
        return new Promise((_resolve, reject) => {
          (init?.signal as AbortSignal).addEventListener("abort", () => {
            const e = new Error("aborted");
            e.name = "AbortError";
            reject(e);
          });
        });
      });
    try {
      const transport = fetchTransport(10);
      const out = await transport("POST", "https://p.example/x", {}, {}, {});
      expect(out.status).toBe(0);
      expect(out.error).toMatch(/no answer within 0s/);
      expect(out.error).toMatch(/may have taken effect/);
      expect(out.error).not.toMatch(/could not be reached/);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("still says unreachable when the connection itself failed", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new TypeError("fetch failed"));
    try {
      const out = await fetchTransport()("GET", "https://p.example/x", {}, {});
      expect(out.error).toBe("the product could not be reached");
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe("M3: a fallback chain is checked when the index loads", () => {
  const index = (fallbackTo: string, targetMode = "write", mode = "read") => ({
    schema_version: 1,
    build_id: "t",
    products: {
      p: product([
        {
          name: "a",
          method: "POST",
          path: "/a",
          mode,
          entity: "thing",
          intent: "A.",
          fallbacks: [{ when: { status: 400 }, capability: fallbackTo }],
        },
        {
          name: "b",
          method: "POST",
          path: "/b",
          mode: targetMode,
          entity: "thing",
          intent: "B.",
        },
      ]),
    },
  });
  it("refuses a read that would fall back to a write", () => {
    expect(
      () => new CapabilityRegistry(index("b", "write", "read") as never),
    ).toThrow(/may not need more consent/);
  });
  it("refuses a fallback to a destructive capability", () => {
    expect(
      () => new CapabilityRegistry(index("b", "destructive", "write") as never),
    ).toThrow(/destructive/);
  });
  it("refuses a fallback the index does not define", () => {
    expect(() => new CapabilityRegistry(index("nope") as never)).toThrow(
      /does not define/,
    );
  });
  it("accepts write → write, which is the shipped chain", () => {
    expect(
      () => new CapabilityRegistry(index("b", "write", "write") as never),
    ).not.toThrow();
  });
});

describe("M4: the processed product is used even when nothing is disabled", () => {
  it("keeps the surface guidance for a product with no withheld capability", () => {
    const registry = new CapabilityRegistry({
      schema_version: 1,
      build_id: "t",
      products: {
        p: product([
          {
            name: "only",
            method: "GET",
            path: "/only",
            mode: "read",
            entity: "thing",
            intent: "Only.",
            guidance: {
              shared: ["both"],
              local: ["on a laptop"],
              remote: ["on a server"],
            },
          },
        ]),
      },
    } as never);
    const cap = registry.index.products.p.capabilities[0];
    expect(Array.isArray(cap.guidance)).toBe(true);
    expect(cap.guidance).toContain("both");
    // one surface line, never both: this process is local (REMOTE_MCP unset)
    expect(cap.guidance).toContain("on a laptop");
    expect(cap.guidance).not.toContain("on a server");
  });
});

describe("M5: file parameters are refused on the hosted server", () => {
  afterEach(() => {
    vi.doUnmock("../../src/config.js");
    vi.resetModules();
  });
  it("refuses before touching the disk, even without local_only", async () => {
    vi.resetModules();
    vi.doMock("../../src/config.js", () => ({
      default: { REMOTE_MCP: true, UPLOAD_BASE_DIR: "/tmp" },
    }));
    const { bind } =
      await import("../../src/tools/capability-registry/bind.js");
    const capability = {
      name: "upload_from_file",
      method: "POST",
      path: "/upload",
      mode: "write",
      encoding: "multipart",
      body: [{ name: "file", type: "file", required: true }],
    };
    expect(() =>
      bind(capability as never, { body: { file: "/tmp/does-not-matter.apk" } }),
    ).toThrow(/this server cannot read/);
  });
});

describe("titles: products without one in the index still read as a name", () => {
  it("uses the default title for tm", async () => {
    const { call } = harness({
      schema_version: 1,
      build_id: "t",
      products: {
        tm: product([
          {
            name: "list_x",
            method: "GET",
            path: "/x",
            mode: "read",
            entity: "thing",
            intent: "X.",
          },
        ]),
      },
    });
    const out = await call("listProducts", {});
    expect(out.products[0].title).toBe("Test Management");
  });
});
