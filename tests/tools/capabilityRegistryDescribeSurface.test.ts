import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// What describeCapability is allowed to say about a capability.
//
// The contract an agent reads has to be about the call it is going to make. Fields that
// describe how THIS server reaches the product — which origin serves the route, how the
// body is framed, which surface publishes it — are not the caller's to reason about, and
// `host: "api"` reached a shipped describe response before anyone noticed. The handler
// spreads the capability, so every field added to the type lands on that surface by
// default: this file is the test that makes adding one a deliberate act.
//
// The existing reference-only tests read the REGISTRY, so they could not have caught it.
// These go through the registered handler, which is what a caller actually sees.

/** Everything the handler must strip before answering. */
const WIRE = [
  "host",
  "encoding",
  "send_empty_body",
  "local_only",
  "disabled",
  "method",
  "path",
] as const;

const CAPABILITIES = [
  {
    name: "list_devices",
    method: "GET",
    path: "/devices.json",
    host: "api",
    mode: "read",
    entity: "device",
    intent: "List the devices this account can use.",
    returns: ["device", "os"],
    responses: { "200": { description: "ok" } },
  },
  {
    name: "start_session",
    method: "POST",
    path: "/session",
    mode: "write",
    entity: "session",
    send_empty_body: true,
    intent: "Start a session.",
  },
  {
    name: "upload_from_file",
    method: "POST",
    path: "/upload",
    mode: "write",
    entity: "build",
    encoding: "multipart",
    local_only: true,
    unavailable_note: "Upload it yourself and pass the returned url.",
    intent: "Upload a build that is on this machine.",
    body: [{ name: "file", type: "file", required: true }],
  },
];

function index() {
  return {
    schema_version: 1,
    build_id: "test",
    products: {
      p: {
        summary: "s",
        base_url: "https://p.example",
        hosts: { api: "https://api.example" },
        capabilities: CAPABILITIES,
        entities: {
          device: { description: "A device", capabilities: ["list_devices"] },
          session: {
            description: "A session",
            capabilities: ["start_session"],
          },
          build: { description: "A build", capabilities: ["upload_from_file"] },
        },
      },
    },
  };
}

async function describeHandler(remote: boolean) {
  vi.resetModules();
  vi.doMock("../../src/config.js", () => ({ default: { REMOTE_MCP: remote } }));
  const { CapabilityRegistry } =
    await import("../../src/tools/capability-registry/index-loader.js");
  const { addCapabilityRegistryTools } =
    await import("../../src/tools/capability-registry/register.js");
  const handlers: Record<string, any> = {};
  // The registered-tool seam, not a stand-in for it: whatever the real server would be
  // handed is what gets called here.
  const server = {
    tool: (...args: unknown[]) => {
      handlers[args[0] as string] = args.find((a) => typeof a === "function");
      return { name: args[0] };
    },
  };
  addCapabilityRegistryTools(
    server as never,
    {
      registry: new CapabilityRegistry(index() as never),
    } as never,
  );
  return async (name: string) =>
    JSON.parse(
      (await handlers.describeCapability({ name, product: "p" }, {} as never))
        .content[0].text,
    );
}

describe("describeCapability keeps the plumbing off the contract", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.doUnmock("../../src/config.js"));

  it("answers list_devices without naming the origin that serves it", async () => {
    const describe_ = await describeHandler(false);
    const doc = await describe_("list_devices");
    // The capability DOES declare a host — the point is that it does not come back.
    expect(CAPABILITIES[0].host).toBe("api");
    expect(doc.host).toBeUndefined();
    expect(doc.name).toBe("list_devices");
    expect(doc.intent).toBeTruthy();
  });

  it("strips every wire field from every capability it publishes", async () => {
    const describe_ = await describeHandler(false);
    for (const c of CAPABILITIES) {
      const doc = await describe_(c.name);
      for (const field of WIRE)
        expect(doc[field], `${c.name}.${field}`).toBeUndefined();
    }
  });

  it("still says what the caller supplies and reads", async () => {
    const describe_ = await describeHandler(false);
    const doc = await describe_("list_devices");
    expect(doc.returns).toEqual(["device", "os"]);
    expect(doc.responses).toBeDefined();
    expect(doc.mode).toBe("read");
    expect(doc.entity).toBe("device");
  });

  // The one of these fields that is the caller's business. Presence in the index means
  // published; it does not mean callable, and a reference-only entry is published exactly
  // so the search that should find it still does.
  it("keeps invocable:false, which is the one flag a caller acts on", async () => {
    const describe_ = await describeHandler(true);
    const doc = await describe_("upload_from_file");
    expect(doc.invocable).toBe(false);
    expect(doc.guidance).toEqual([
      "Upload it yourself and pass the returned url.",
    ]);
    // and it is still stripped of the means to try
    expect(doc.body).toBeUndefined();
    expect(doc.encoding).toBeUndefined();
  });

  it("leaves invocable off a capability that can be called", async () => {
    const describe_ = await describeHandler(false);
    expect((await describe_("list_devices")).invocable).toBeUndefined();
    expect((await describe_("upload_from_file")).invocable).toBeUndefined();
  });
});
