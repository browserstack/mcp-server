import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A `local_only` capability is not hidden on a remote server. The query that should find it
// still finds it, because an agent asked to upload a file from the user's machine needs to
// learn the route exists and what replaces it here. What it loses is the means to call it:
// the parameters and response shapes are stripped, and invocation is refused.
//
// This is the one place describe and invoke diverge. Everywhere else a name that describes
// is a name that invokes; a reference-only capability exists precisely to be read, not
// called.

const LOCAL_ONLY = {
  name: "upload_from_file",
  method: "POST",
  path: "/upload",
  mode: "write",
  entity: "build",
  encoding: "multipart",
  local_only: true,
  intent: "Upload a build that is on this machine.",
  guidance: {
    shared: ["Only .apk and .ipa are accepted."],
    local: ["The file must sit inside MCP_UPLOAD_BASE_DIR."],
    remote: ["Upload it yourself and pass the returned url."],
  },
  body: [{ name: "file", type: "file", required: true }],
  returns: ["app_url"],
  responses: { "200": { description: "ok" } },
  paginated: false,
};
const ORDINARY = {
  name: "upload_from_url",
  method: "POST",
  path: "/upload-url",
  mode: "write",
  entity: "build",
  body: [{ name: "url", type: "string", required: true }],
};
const OFF = {
  name: "gone",
  method: "GET",
  path: "/gone",
  mode: "read",
  entity: "build",
  disabled: true,
  local_only: true,
};

function product(capabilities: unknown[] = [LOCAL_ONLY, ORDINARY, OFF]) {
  return {
    p: {
      summary: "s",
      base_url: "https://p.example",
      capabilities,
      entities: {
        build: {
          description: "A build",
          capabilities: ["upload_from_file", "upload_from_url", "gone"],
        },
      },
    },
  };
}

async function load(remote: boolean, capabilities?: unknown[]) {
  vi.resetModules();
  vi.doMock("../../src/config.js", () => ({ default: { REMOTE_MCP: remote } }));
  const { CapabilityRegistry } =
    await import("../../src/tools/capability-registry/index-loader.js");
  return new CapabilityRegistry({
    schema_version: 1,
    build_id: "test",
    products: product(capabilities),
  } as never);
}

describe("a local_only capability on a remote server", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.doUnmock("../../src/config.js"));

  it("stays in the product listing, so search can still reach it", async () => {
    const reg = await load(true);
    expect(reg.index.products.p.capabilities.map((c) => c.name)).toContain(
      "upload_from_file",
    );
  });

  it("stays named on its entity", async () => {
    const reg = await load(true);
    expect(reg.index.products.p.entities.build.capabilities).toContain(
      "upload_from_file",
    );
  });

  it("keeps the intent the search matched on", async () => {
    const reg = await load(true);
    const { capability } = reg.byNameLookup("upload_from_file", "p");
    expect(capability.intent).toBe("Upload a build that is on this machine.");
  });

  it("loses everything a caller would need to invoke it", async () => {
    // A model handed a body schema fills it in, so the schema goes.
    const reg = await load(true);
    const { capability } = reg.byNameLookup("upload_from_file", "p");
    expect(capability.body).toBeUndefined();
    expect(capability.responses).toBeUndefined();
    expect(capability.returns).toBeUndefined();
    expect(capability.encoding).toBeUndefined();
    expect(capability.invocable).toBe(false);
  });

  it("gives the remote half, keeps the shared lines, drops the local ones", async () => {
    // The whole point of the split: a fact true on both surfaces is written once and still
    // reaches a remote caller, while advice about the user's own disk — which here would be
    // wrong, not merely useless — does not.
    const reg = await load(true);
    const { capability } = reg.byNameLookup("upload_from_file", "p");
    expect(capability.guidance).toEqual([
      "Only .apk and .ipa are accepted.",
      "Upload it yourself and pass the returned url.",
    ]);
  });

  it("gives the local half on a local server, and never the remote one", async () => {
    const reg = await load(false);
    const { capability } = reg.byNameLookup("upload_from_file", "p");
    expect(capability.guidance).toEqual([
      "Only .apk and .ipa are accepted.",
      "The file must sit inside MCP_UPLOAD_BASE_DIR.",
    ]);
  });

  it("flattens the object away, so no reader downstream meets it", async () => {
    for (const remote of [true, false]) {
      const reg = await load(remote);
      const { capability } = reg.byNameLookup("upload_from_file", "p");
      expect(Array.isArray(capability.guidance), `remote=${remote}`).toBe(true);
    }
  });

  it("says so when nothing at all applies here, rather than saying nothing", async () => {
    // No shared lines and no remote ones: the capability would otherwise be published with
    // no explanation of why it cannot be called.
    const reg = await load(true, [
      {
        ...LOCAL_ONLY,
        guidance: { local: ["The file must sit inside MCP_UPLOAD_BASE_DIR."] },
      },
    ]);
    const { capability } = reg.byNameLookup("upload_from_file", "p");
    expect(capability.guidance?.[0]).toMatch(/cannot be called/);
  });
});

describe("the same capability on a local server", () => {
  afterEach(() => vi.doUnmock("../../src/config.js"));

  it("is invocable, with its parameters intact", async () => {
    const reg = await load(false);
    const { capability } = reg.byNameLookup("upload_from_file", "p");
    expect(capability.invocable).toBeUndefined();
    expect(capability.body).toHaveLength(1);
    expect((capability.guidance as string[]).join(" ")).toMatch(
      /MCP_UPLOAD_BASE_DIR/,
    );
  });
});

describe("the flags do not blur into each other", () => {
  afterEach(() => vi.doUnmock("../../src/config.js"));

  it("`disabled` still hides a capability outright, local_only or not", async () => {
    for (const remote of [false, true]) {
      const reg = await load(remote);
      expect(
        reg.index.products.p.capabilities.map((c) => c.name),
      ).not.toContain("gone");
      expect(() => reg.byNameLookup("gone", "p")).toThrow(/unknown_capability/);
    }
  });

  it("leaves an ordinary capability untouched on both surfaces", async () => {
    for (const remote of [false, true]) {
      const reg = await load(remote);
      const { capability } = reg.byNameLookup("upload_from_url", "p");
      expect(capability.invocable).toBeUndefined();
      expect(capability.body).toHaveLength(1);
    }
  });
});
