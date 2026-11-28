import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// A hosted deployment builds a server for every request. The index those servers read is
// static package data, so it is loaded once per process and shared between them. These pin
// the three things that has to mean: it really is read once, sharing it shares nothing
// about the caller, and it is read again when what it was built from changes.

const FIXTURE = fileURLToPath(
  new URL("../fixtures/capability/tm.capability-index.json", import.meta.url),
);

const ALICE = {
  "browserstack-username": "alice",
  "browserstack-access-key": "KEY_A",
} as any;
const BOB = {
  "browserstack-username": "bob",
  "browserstack-access-key": "KEY_B",
} as any;

vi.mock("../../src/lib/apiClient.js", () => ({
  apiClient: { post: vi.fn().mockResolvedValue({ status: 200, data: {} }) },
}));

/** The headers the egress layer builds for these credentials, whatever the scheme. */
async function headersFor(config: any): Promise<Record<string, string>> {
  const { authHeaders } =
    await import("../../src/tools/capability-registry/egress.js");
  return authHeaders({
    username: config["browserstack-username"],
    accessKey: config["browserstack-access-key"],
  });
}

const call = (server: any, tool: string, args: unknown) =>
  server.getTools()[tool].handler(args, {});

/** A one-capability index for a product named after its file, as the loader requires. */
function index(capability: Record<string, unknown>): string {
  return JSON.stringify({
    schema_version: 1,
    build_id: "test",
    demo: { summary: "demo", capabilities: [capability], entities: {} },
  });
}

const THING = {
  name: "list_things",
  method: "GET",
  path: "/things",
  mode: "read",
  entity: "thing",
};

describe("the capability index is shared across servers", () => {
  beforeEach(() => {
    process.env.CAPABILITY_REGISTRY_INDEX = FIXTURE;
    process.env.CAPABILITY_REGISTRY_BASE_URL_TM = "https://tm.example.com";
    delete process.env.CAPABILITY_REGISTRY_DISABLED;
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.CAPABILITY_REGISTRY_INDEX;
    delete process.env.CAPABILITY_REGISTRY_BASE_URL_TM;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reads the index once, however many servers are built", async () => {
    const { CapabilityRegistry } =
      await import("../../src/tools/capability-registry/index-loader.js");
    const fromFiles = vi.spyOn(CapabilityRegistry, "fromFiles");
    const { BrowserStackMcpServer } =
      await import("../../src/server-factory.js");

    const servers = [ALICE, BOB, ALICE, BOB, ALICE].map(
      (config) => new BrowserStackMcpServer(config),
    );

    expect(fromFiles).toHaveBeenCalledTimes(1);
    // Every one of them still has the registry's tools; sharing did not cost any server them.
    for (const server of servers) {
      expect(Object.keys(server.getTools())).toEqual(
        expect.arrayContaining(["listProducts", "invokeCapability"]),
      );
    }
  });

  it("announces the load once, not once per server", async () => {
    const { setLogger } = await import("../../src/logger.js");
    const info = vi.fn();
    setLogger({ info, warn: vi.fn(), error: vi.fn(), debug: vi.fn() });
    const { BrowserStackMcpServer } =
      await import("../../src/server-factory.js");

    for (const config of [ALICE, BOB, ALICE]) new BrowserStackMcpServer(config);

    const announced = info.mock.calls.filter(([message]) =>
      String(message).startsWith("capability registry loaded"),
    );
    expect(announced).toHaveLength(1);
  });

  it("sends each server's own credentials, though they share one index", async () => {
    // The failure sharing could introduce: one caller's request leaving with another's key.
    const fetch = vi.fn().mockResolvedValue({
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      text: async () => JSON.stringify({ success: true, test_cases: [] }),
    });
    vi.stubGlobal("fetch", fetch);
    const { BrowserStackMcpServer } =
      await import("../../src/server-factory.js");
    const alice = new BrowserStackMcpServer(ALICE);
    const bob = new BrowserStackMcpServer(BOB);
    const args = {
      name: "list_archived_test_cases",
      product: "tm",
      path_params: { project_id: 1 },
    };

    // Interleaved, so a credential captured from whichever server was built last would show.
    await call(bob, "invokeCapability", args);
    await call(alice, "invokeCapability", args);
    await call(bob, "invokeCapability", args);

    const sent = fetch.mock.calls
      .filter(([url]) => String(url).startsWith("https://tm.example.com/"))
      .map(([, init]) => init.headers);
    const asAlice = await headersFor(ALICE);
    const asBob = await headersFor(BOB);
    expect(asAlice).not.toEqual(asBob);
    expect(sent).toHaveLength(3);
    expect(sent[0]).toMatchObject(asBob);
    expect(sent[1]).toMatchObject(asAlice);
    expect(sent[2]).toMatchObject(asBob);
  });
});

describe("sharedRegistry", () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    vi.resetModules();
    dir = mkdtempSync(join(tmpdir(), "shared-registry-"));
    // The file name states the product, and the loader checks it against the key inside.
    file = join(dir, "demo.capability-index.json");
  });

  afterEach(() => {
    vi.doUnmock("../../src/config.js");
    rmSync(dir, { recursive: true, force: true });
  });

  const load = async () =>
    (await import("../../src/tools/capability-registry/shared-registry.js"))
      .sharedRegistry;

  it("returns the same registry until the files change", async () => {
    writeFileSync(file, index(THING));
    const sharedRegistry = await load();

    const first = sharedRegistry([file]);
    const second = sharedRegistry([file]);

    expect(first.loaded).toBe(true);
    expect(second.loaded).toBe(false);
    expect(second.registry).toBe(first.registry);
  });

  it("reloads when an artifact's contents change", async () => {
    writeFileSync(file, index(THING));
    const sharedRegistry = await load();
    const before = sharedRegistry([file]);

    writeFileSync(file, index({ ...THING, name: "list_every_single_thing" }));
    const after = sharedRegistry([file]);

    expect(after.loaded).toBe(true);
    expect(after.registry).not.toBe(before.registry);
    expect(
      after.registry.byNameLookup("list_every_single_thing").capability.path,
    ).toBe("/things");
  });

  it("reloads when an artifact is rewritten at the same size", async () => {
    // Size alone would miss a same-length edit, which is why mtime is in the key too.
    writeFileSync(file, index(THING));
    const sharedRegistry = await load();
    const before = sharedRegistry([file]);

    const { atime, mtime } = statSync(file);
    utimesSync(file, atime, new Date(mtime.getTime() + 5000));

    expect(sharedRegistry([file]).loaded).toBe(true);
    expect(sharedRegistry([file]).registry).not.toBe(before.registry);
  });

  it("reloads when the surface changes, because local_only is decided at load", async () => {
    const surface = { REMOTE_MCP: false };
    vi.doMock("../../src/config.js", () => ({ default: surface }));
    writeFileSync(file, index({ ...THING, local_only: true }));
    const sharedRegistry = await load();

    const local = sharedRegistry([file]);
    surface.REMOTE_MCP = true;
    const remote = sharedRegistry([file]);

    expect(remote.loaded).toBe(true);
    expect(
      local.registry.byNameLookup("list_things").capability.invocable,
    ).toBeUndefined();
    // Published for reference on a remote surface, and not callable there.
    expect(
      remote.registry.byNameLookup("list_things").capability.invocable,
    ).toBe(false);
  });

  it("reloads when read-only mode changes", async () => {
    writeFileSync(file, index(THING));
    const sharedRegistry = await load();
    const before = sharedRegistry([file]);

    vi.stubEnv("CAPABILITY_REGISTRY_READ_ONLY", "true");
    try {
      const after = sharedRegistry([file]);
      expect(after.loaded).toBe(true);
      expect(after.registry).not.toBe(before.registry);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("does not remember a failed load", async () => {
    writeFileSync(file, "{ not json");
    const sharedRegistry = await load();
    expect(() => sharedRegistry([file])).toThrow(/could not be read as JSON/);

    writeFileSync(file, index(THING));

    expect(sharedRegistry([file]).loaded).toBe(true);
  });

  it("reports a missing artifact instead of serving an earlier load", async () => {
    writeFileSync(file, index(THING));
    const sharedRegistry = await load();
    sharedRegistry([file]);

    rmSync(file);

    expect(() => sharedRegistry([file])).toThrow(/could not be read as JSON/);
  });

  it("freezes the index, so a write cannot reach another caller", async () => {
    // Each server used to own a private copy, where a stray write was contained. Shared,
    // it would change every caller's answers — so it throws instead.
    const sharedRegistry = await load();
    const { registry } = sharedRegistry([FIXTURE]);
    const product = registry.index.products.tm;
    const capability = product.capabilities[0];

    expect(() => {
      (capability as any).name = "renamed";
    }).toThrow(TypeError);
    expect(() => {
      product.capabilities.push(capability);
    }).toThrow(TypeError);
    expect(() => {
      (product.entities as any).injected = {};
    }).toThrow(TypeError);
  });
});
