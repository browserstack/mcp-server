/**
 * L3 schema portability: each tool in tools/list (both profiles) has a schema that the
 * common AI clients accept. The spec calls this "inspector --strict". The MCP Inspector
 * has no strict mode, so the rules are here. They are the limits that make a client drop
 * or reject a tool:
 *
 *   - name matches ^[a-zA-Z0-9_-]{1,64}$ (OpenAI, Anthropic, Gemini)
 *   - the tool has a description
 *   - inputSchema (and outputSchema) root is type "object", with no anyOf/oneOf/allOf/enum
 *   - no $ref, $defs or definitions (a client that does not resolve refs sees no type)
 *   - no oneOf, allOf, not or if/then (Gemini's schema subset rejects them; anyOf is OK)
 *   - every array has "items" (Gemini and OpenAI reject an array with no items)
 *
 * A property with no description is reported only.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/instrumentation.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  trackMCP: vi.fn(),
}));

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { PROFILES, startServer } from "./harness/server.js";

type Schema = Record<string, unknown>;

const NAME = /^[a-zA-Z0-9_-]{1,64}$/;
const BANNED_ANYWHERE = [
  "$ref",
  "$defs",
  "definitions",
  "oneOf",
  "allOf",
  "not",
  "if",
];
const BANNED_AT_ROOT = ["anyOf", "oneOf", "allOf", "enum"];

function walk(
  s: unknown,
  path: string,
  errors: string[],
  notes: string[],
): void {
  if (!s || typeof s !== "object") return;
  const schema = s as Schema;
  for (const key of BANNED_ANYWHERE) {
    if (key in schema) errors.push(`${path}: uses "${key}"`);
  }
  const types = ([] as unknown[]).concat(schema.type ?? []);
  if (types.includes("array") && !("items" in schema)) {
    errors.push(`${path}: array with no "items"`);
  }
  const props = (schema.properties ?? {}) as Record<string, Schema>;
  for (const [name, prop] of Object.entries(props)) {
    if (!prop?.description) notes.push(`${path}.${name}: no description`);
    walk(prop, `${path}.${name}`, errors, notes);
  }
  if (schema.items) walk(schema.items, `${path}[]`, errors, notes);
  if (
    schema.additionalProperties &&
    typeof schema.additionalProperties === "object"
  ) {
    walk(schema.additionalProperties, `${path}{}`, errors, notes);
  }
  for (const [i, alt] of ((schema.anyOf ?? []) as unknown[]).entries()) {
    walk(alt, `${path}|anyOf[${i}]`, errors, notes);
  }
}

export function checkTool(tool: Tool): { errors: string[]; notes: string[] } {
  const errors: string[] = [];
  const notes: string[] = [];
  if (!NAME.test(tool.name)) errors.push(`name does not match ${NAME}`);
  if (!tool.description?.trim()) errors.push("no description");
  for (const [label, root] of [
    ["inputSchema", tool.inputSchema],
    ["outputSchema", tool.outputSchema],
  ] as const) {
    if (!root) continue;
    if (root.type !== "object")
      errors.push(`${label}: root type is not "object"`);
    for (const key of BANNED_AT_ROOT) {
      if (key in root) errors.push(`${label}: "${key}" at the root`);
    }
    walk(root, label, errors, notes);
  }
  return { errors, notes };
}

describe("L3 schema portability", () => {
  for (const profile of PROFILES) {
    it(`every tool schema is portable (${profile})`, async () => {
      const server = await startServer({ profile });
      const { tools } = await server.client.listTools();
      await server.close();

      const errors: string[] = [];
      let notes = 0;
      for (const tool of tools) {
        const r = checkTool(tool);
        errors.push(...r.errors.map((e) => `${tool.name}: ${e}`));
        notes += r.notes.length;
      }
      if (notes)
        console.log(
          `${profile}: ${notes} properties have no description (report only)`,
        );
      expect(errors).toEqual([]);
    });
  }

  it("the rules catch a bad schema", () => {
    const bad = {
      name: "bad tool!",
      description: "",
      inputSchema: {
        type: "object",
        oneOf: [],
        properties: { list: { type: "array" }, ref: { $ref: "#/$defs/x" } },
      },
    } as unknown as Tool;
    expect(checkTool(bad).errors).toEqual([
      expect.stringContaining("name does not match"),
      "no description",
      'inputSchema: "oneOf" at the root',
      'inputSchema: uses "oneOf"',
      'inputSchema.list: array with no "items"',
      'inputSchema.ref: uses "$ref"',
    ]);
  });
});
