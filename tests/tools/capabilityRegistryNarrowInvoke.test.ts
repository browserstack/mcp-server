import { describe, expect, it } from "vitest";
import { CapabilityRegistry } from "../../src/tools/capability-registry/index-loader.js";
import { addCapabilityRegistryTools } from "../../src/tools/capability-registry/register.js";

// `select` reaching the response, through the registered tool rather than the module it
// calls. The unit tests next door pin the narrowing itself; these pin the wiring — that a
// selection arrives, that the answer reports it, and that an error body is left alone.

const ROWS = [
  {
    os: "Windows",
    os_version: "11",
    browser: "chrome",
    browser_version: "131.0",
    device: null,
  },
  {
    os: "Windows",
    os_version: "11",
    browser: "firefox",
    browser_version: "133.0",
    device: null,
  },
  {
    os: "ios",
    os_version: "26",
    browser: "chromium",
    browser_version: null,
    device: "iPhone 17",
  },
];

function tools(body: unknown, status = 200) {
  const index = {
    schema_version: 1,
    build_id: "test",
    products: {
      p: {
        summary: "s",
        base_url: "https://p.example",
        capabilities: [
          {
            name: "list_browsers",
            method: "GET",
            path: "/browsers.json",
            mode: "read",
            entity: "browser",
            intent: "List combinations.",
            narrowable: {
              fields: [
                "os",
                "os_version",
                "browser",
                "browser_version",
                "device",
              ],
            },
          },
          {
            name: "list_plain",
            method: "GET",
            path: "/plain.json",
            mode: "read",
            entity: "browser",
            intent: "List things, unnarrowable.",
          },
        ],
        entities: {
          browser: {
            description: "A combination",
            capabilities: ["list_browsers", "list_plain"],
          },
        },
      },
    },
  };
  const handlers: Record<string, any> = {};
  const server = {
    tool: (...args: unknown[]) => {
      handlers[args[0] as string] = args.find((a) => typeof a === "function");
      return { name: args[0] };
    },
  };
  addCapabilityRegistryTools(
    server as never,
    {
      registry: new CapabilityRegistry(index as never),
      baseUrlFor: async () => "https://p.example",
      credentialsFor: () => ({ username: "u", accessKey: "k" }) as never,
      transport: async () => ({ status, body }) as never,
    } as never,
  );
  return handlers;
}

const call = async (handlers: Record<string, any>, input: unknown) =>
  JSON.parse(
    (await handlers.invokeCapability(input, {} as never)).content[0].text,
  );

describe("invokeCapability applies a selection", () => {
  it("narrows the body and says so", async () => {
    const out = await call(tools(ROWS), {
      name: "list_browsers",
      product: "p",
      select: { where: { os: "windows" }, distinct: ["browser"] },
    });
    expect(out.http_response.body).toEqual([
      { browser: "chrome" },
      { browser: "firefox" },
    ]);
    expect(out.narrowed).toEqual({
      from: 3,
      to: 2,
      by: { where: { os: "windows" }, distinct: ["browser"] },
    });
  });

  it("leaves the body alone, and says nothing, without a selection", async () => {
    const out = await call(tools(ROWS), {
      name: "list_browsers",
      product: "p",
    });
    expect(out.http_response.body).toEqual(ROWS);
    expect(out.narrowed).toBeUndefined();
  });

  it("refuses a selection on a capability that declares none", async () => {
    const out = await call(tools(ROWS), {
      name: "list_plain",
      product: "p",
      select: { limit: 1 },
    });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/does not support `select`/);
  });

  it("refuses a field the capability did not declare, naming the set", async () => {
    const out = await call(tools(ROWS), {
      name: "list_browsers",
      product: "p",
      select: { where: { platform: "Windows" } },
    });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/'platform'/);
    expect(out.error).toMatch(/os, os_version, browser/);
  });

  it("does not narrow an error body, which is the diagnosis", async () => {
    // A selection matching none of a 401's keys would quietly empty it.
    const out = await call(tools({ message: "Unauthorized" }, 401), {
      name: "list_browsers",
      product: "p",
      select: { where: { browser: "chrome" } },
    });
    expect(out.ok).toBe(false);
    expect(out.http_response.body).toEqual({ message: "Unauthorized" });
    expect(out.narrowed).toBeUndefined();
  });

  it("still makes exactly one request", async () => {
    const sent: unknown[] = [];
    const index = new CapabilityRegistry({
      schema_version: 1,
      build_id: "t",
      products: {
        p: {
          summary: "s",
          base_url: "https://p.example",
          capabilities: [
            {
              name: "list_browsers",
              method: "GET",
              path: "/browsers.json",
              mode: "read",
              entity: "browser",
              narrowable: { fields: ["browser"] },
            },
          ],
          entities: {
            browser: { description: "b", capabilities: ["list_browsers"] },
          },
        },
      },
    } as never);
    const handlers: Record<string, any> = {};
    addCapabilityRegistryTools(
      {
        tool: (...args: unknown[]) => {
          handlers[args[0] as string] = args.find(
            (a) => typeof a === "function",
          );
          return { name: args[0] };
        },
      } as never,
      {
        registry: index,
        baseUrlFor: async () => "https://p.example",
        credentialsFor: () => ({ username: "u", accessKey: "k" }) as never,
        transport: async (...args: unknown[]) => {
          sent.push(args);
          return { status: 200, body: ROWS } as never;
        },
      } as never,
    );
    await call(handlers, {
      name: "list_browsers",
      product: "p",
      select: { distinct: ["browser"] },
    });
    expect(sent).toHaveLength(1);
    // and nothing from `select` reached the wire, where it would be ignored anyway
    expect(JSON.stringify(sent[0])).not.toMatch(/distinct/);
  });
});

describe("the contract advertises it", () => {
  it("describeCapability publishes `narrowable`, which is the caller's business", async () => {
    const handlers = tools(ROWS);
    const doc = JSON.parse(
      (
        await handlers.describeCapability(
          { name: "list_browsers", product: "p" },
          {} as never,
        )
      ).content[0].text,
    );
    expect(doc.narrowable.fields).toContain("browser");
    expect(doc.host).toBeUndefined();
  });

  it("says nothing about it on a capability that has none", async () => {
    const handlers = tools(ROWS);
    const doc = JSON.parse(
      (
        await handlers.describeCapability(
          { name: "list_plain", product: "p" },
          {} as never,
        )
      ).content[0].text,
    );
    expect(doc.narrowable).toBeUndefined();
  });
});
