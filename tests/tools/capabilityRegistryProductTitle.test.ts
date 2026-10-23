import { describe, expect, it } from "vitest";
import { CapabilityRegistry } from "../../src/tools/capability-registry/index-loader.js";
import { addCapabilityRegistryTools } from "../../src/tools/capability-registry/register.js";

// The clash question is put to a person, so it names products the way a person would —
// by `title` — while the key stays the handle every other call takes.

function listProducts(withTitles: boolean) {
  const product = (key: string, title: string, entity: string) => ({
    ...(withTitles ? { title } : {}),
    summary: `${title}.`,
    base_url: "https://p.example",
    capabilities: [
      {
        name: `list_${entity}s`,
        method: "GET",
        path: `/${entity}s`,
        mode: "read",
        entity,
        intent: `List ${entity}s.`,
      },
    ],
    entities: {
      [entity]: {
        description: `A ${entity} in ${title}`,
        aliases: ["session"],
        capabilities: [`list_${entity}s`],
      },
    },
  });
  const index = {
    schema_version: 1,
    build_id: "t",
    products: {
      mobiledevicecontrol: product(
        "mobiledevicecontrol",
        "Mobile Device Control",
        "app_session",
      ),
      tm: product("tm", "Test Management", "exploratory_session"),
    },
  };
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
      transport: async () => ({ status: 200, body: {} }) as never,
    } as never,
  );
  return async (query: string) =>
    JSON.parse(
      (await handlers.listProducts({ query }, {} as never)).content[0].text,
    );
}

describe("the routing question names products by title", () => {
  it("asks in the user's words when titles exist, and keeps the key as the handle", async () => {
    const out = await listProducts(true)("end my session");
    expect(out.routing.verdict).toBe("products_clash");
    expect(out.routing.question).toBe(
      "Which product do you mean — Mobile Device Control or Test Management?",
    );
    expect(out.routing.products).toEqual(["mobiledevicecontrol", "tm"]);
    expect(out.routing.senses.map((s: any) => [s.product, s.title])).toEqual([
      ["mobiledevicecontrol", "Mobile Device Control"],
      ["tm", "Test Management"],
    ]);
    expect(out.products.map((p: any) => p.title)).toEqual([
      "Mobile Device Control",
      "Test Management",
    ]);
  });

  it("falls back to the key for a product that declares no title", async () => {
    const out = await listProducts(false)("end my session");
    expect(out.routing.question).toBe(
      "Which product do you mean — mobiledevicecontrol or tm?",
    );
    expect(out.products[0].title).toBeUndefined();
  });
});
