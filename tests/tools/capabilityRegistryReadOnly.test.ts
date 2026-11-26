import { afterEach, describe, expect, it, vi } from "vitest";
import { CapabilityRegistry } from "../../src/tools/capability-registry/index-loader.js";
import { addCapabilityRegistryTools } from "../../src/tools/capability-registry/register.js";
import { readAnswer } from "../../src/tools/capability-registry/answer.js";
import { searchCapabilities } from "../../src/tools/capability-registry/search.js";

const index = {
  schema_version: 1,
  build_id: "test",
  products: {
    p: {
      summary: "s",
      base_url: "https://p.example",
      capabilities: [
        {
          name: "get_case",
          method: "GET",
          path: "/cases/{id}",
          mode: "read",
          entity: "case",
          intent: "Get a test case.",
          path_params: [{ name: "id", type: "string", required: true }],
        },
        {
          name: "create_case",
          method: "POST",
          path: "/cases/{id}",
          mode: "write",
          entity: "case",
          intent: "Create a test case.",
          path_params: [{ name: "id", type: "string", required: true }],
        },
        {
          name: "delete_case",
          method: "DELETE",
          path: "/cases/{id}",
          mode: "destructive",
          entity: "case",
          intent: "Delete a test case.",
          path_params: [{ name: "id", type: "string", required: true }],
        },
      ],
      entities: {
        case: {
          description: "A test case",
          capabilities: ["get_case", "create_case", "delete_case"],
        },
      },
    },
  },
};

function harness(status: number) {
  const sent: string[] = [];
  const tools: Record<string, any> = {};
  const registry = new CapabilityRegistry(index as never);
  addCapabilityRegistryTools(
    {
      tool: (...args: any[]) => {
        tools[args[0]] = {
          description: args[1],
          shape: args[2],
          annotations: args[3],
          handler: args.find((a) => typeof a === "function"),
        };
        return { name: args[0] };
      },
    } as never,
    {
      registry,
      baseUrlFor: async () => "https://p.example",
      credentialsFor: () => ({ username: "u", accessKey: "k" }) as never,
      transport: async (method: string, url: string) => {
        sent.push(`${method} ${url}`);
        return { status, body: {} } as never;
      },
    } as never,
  );
  const invoke = async (name: string) =>
    readAnswer(
      await tools.invokeCapability.handler(
        {
          name,
          product: "p",
          path_params: { id: "1" },
          user_permission: "granted",
          change_summary: "x",
        },
        {},
      ),
    );
  return { registry, tools, sent, invoke };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("CAPABILITY_REGISTRY_READ_ONLY", () => {
  it("leaves writes available and the tool writable when unset", async () => {
    const { registry, tools, sent, invoke } = harness(200);

    expect(registry.byNameLookup("create_case", "p").capability.mode).toBe(
      "write",
    );
    expect(tools.invokeCapability.annotations.readOnlyHint).toBe(false);
    expect(tools.invokeCapability.shape).toHaveProperty("user_permission");

    await invoke("create_case");
    expect(sent).toEqual(["POST https://p.example/cases/1"]);
  });

  describe("when true", () => {
    it("marks invokeCapability read-only and drops the write fields", () => {
      vi.stubEnv("CAPABILITY_REGISTRY_READ_ONLY", "true");
      const { tools } = harness(200);

      expect(tools.invokeCapability.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
      });
      expect(tools.invokeCapability.shape).not.toHaveProperty(
        "user_permission",
      );
      expect(tools.invokeCapability.shape).not.toHaveProperty(
        "change_summary",
      );
      expect(tools.invokeCapability.description).not.toContain(
        "user_permission",
      );
    });

    it("hides writes and deletes from search", () => {
      vi.stubEnv("CAPABILITY_REGISTRY_READ_ONLY", "true");
      const { registry } = harness(200);

      const { hits } = searchCapabilities(registry.index.products, "*", {
        product: "p",
      });
      expect(hits.map((h) => h.capability.name)).toEqual(["get_case"]);
      expect(registry.index.products.p.entities.case.capabilities).toEqual([
        "get_case",
      ]);
    });

    it("refuses to invoke a write without calling the API", async () => {
      vi.stubEnv("CAPABILITY_REGISTRY_READ_ONLY", "true");
      const { sent, invoke } = harness(200);

      const answer = await invoke("create_case");
      expect(answer.ok).toBe(false);
      expect(sent).toEqual([]);
    });

    it("still runs reads", async () => {
      vi.stubEnv("CAPABILITY_REGISTRY_READ_ONLY", "true");
      const { sent, invoke } = harness(200);

      const answer = await invoke("get_case");
      expect(answer.ok).toBe(true);
      expect(sent).toEqual(["GET https://p.example/cases/1"]);
    });
  });
});
