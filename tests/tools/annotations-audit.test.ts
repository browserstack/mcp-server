/**
 * Annotations audit (L3, spec section 4): every served tool states readOnlyHint or
 * destructiveHint, so a client can decide to ask before it runs the tool.
 * tests/fixtures/annotations-allowlist.json lists the known exceptions. It only shrinks.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/instrumentation", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  trackMCP: vi.fn(),
}));

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { BrowserStackMcpServer } from "../../src/server-factory";

const allowlist: string[] = JSON.parse(
  readFileSync("tests/fixtures/annotations-allowlist.json", "utf8"),
).tools;

async function servedTools() {
  const bs = new BrowserStackMcpServer({
    "browserstack-username": "u",
    "browserstack-access-key": "k",
  });
  const [c, s] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "audit", version: "1.0.0" });
  await Promise.all([client.connect(c), bs.getInstance().connect(s)]);
  const { tools } = await client.listTools();
  await client.close();
  return tools;
}

describe("annotations audit", () => {
  it("every tool has readOnlyHint or destructiveHint, except the allowlist", async () => {
    const unannotated = (await servedTools())
      .filter(
        (t) =>
          t.annotations?.readOnlyHint === undefined &&
          t.annotations?.destructiveHint === undefined,
      )
      .map((t) => t.name);
    expect(unannotated.filter((n) => !allowlist.includes(n))).toEqual([]);
  });

  it("the allowlist only shrinks: each name is still served and still unannotated", async () => {
    const tools = await servedTools();
    const stale = allowlist.filter((name) => {
      const t = tools.find((x) => x.name === name);
      return (
        !t ||
        t.annotations?.readOnlyHint !== undefined ||
        t.annotations?.destructiveHint !== undefined
      );
    });
    expect(stale, "remove these names from annotations-allowlist.json").toEqual(
      [],
    );
  });
});
