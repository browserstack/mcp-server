import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const cfg = vi.hoisted(() => ({ REMOTE_MCP: true }));
vi.mock("../../src/config.js", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    default: new Proxy(actual.default, {
      get: (t, k) => (k === "REMOTE_MCP" ? cfg.REMOTE_MCP : t[k]),
    }),
  };
});

import { addAskBrowserStackAITool } from "../../src/tools/ask-browserstack/register.js";
import { prepareRemoteUploads } from "../../src/tools/ask-browserstack/uploads.js";

const AID = "att_" + "a".repeat(32);
const AID2 = "att_" + "b".repeat(32);
const AGENT = "https://atlas.example.test/agent";
const S3 = "https://bucket.s3.eu-central-1.amazonaws.com/";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function slots(ids: string[]) {
  const calls: { url: string; body: any }[] = [];
  const queue = [...ids];
  const impl = (async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), body: JSON.parse(String(init.body)) });
    return json(200, {
      id: queue.shift(),
      upload: { url: S3, fields: { key: "raw/x", policy: "p'o" } },
      expires_in: 900,
    });
  }) as typeof fetch;
  return { impl, calls };
}

const deps = (fetchImpl: typeof fetch) => ({
  agentUrl: AGENT,
  headers: { authorization: "Bearer t" },
  product: "tm",
  fetchImpl,
});

describe("prepareRemoteUploads", () => {
  it("reserves each upload and returns an upload command per file", async () => {
    const { impl, calls } = slots([AID, AID2]);
    const out = await prepareRemoteUploads(
      [
        { name: "./docs/prd.pdf", bytes: 18988 },
        { name: "C:\\specs\\flow.png", bytes: 10 },
      ],
      deps(impl),
    );
    expect(calls.map((c) => c.body)).toEqual([
      { product: "tm", name: "prd.pdf", bytes: 18988, mime: "application/pdf" },
      { product: "tm", name: "flow.png", bytes: 10, mime: "image/png" },
    ]);
    expect(out[0]).toEqual({
      name: "prd.pdf",
      attachment_id: AID,
      command:
        "curl -sSf -X POST -F 'key=raw/x' -F 'policy=p'\\''o' " +
        `-F 'file=@./docs/prd.pdf' '${S3}'`,
    });
    expect(out[1].command).toContain("-F 'file=@C:\\specs\\flow.png'");
    expect(out[1].command).not.toMatch(/Bearer|access|BROWSERSTACK/i);
  });

  it.each([
    [{ name: "a;b.pdf", bytes: 3 }, /without ; or "/],
    [{ name: 'a"b.pdf', bytes: 3 }, /without ; or "/],
    [{ name: "a\nb.pdf", bytes: 3 }, /without ; or "/],
    [{ name: "run.sh", bytes: 3 }, /cannot be attached/],
    [{ name: "prd.pdf", bytes: 0 }, /exact size in bytes/],
    [{ name: "prd.pdf", bytes: 1.5 }, /exact size in bytes/],
    [{ name: "prd.pdf", bytes: 26 * 1024 * 1024 }, /limited to 25 MB/],
    [
      { name: "shot.png", bytes: 6 * 1024 * 1024 },
      /images are limited to 5 MB/,
    ],
  ])("refuses %j before reserving anything", async (file, why) => {
    const { impl, calls } = slots([AID]);
    await expect(prepareRemoteUploads([file], deps(impl))).rejects.toThrow(why);
    expect(calls).toEqual([]);
  });

  it("refuses more files than one message carries", async () => {
    const { impl } = slots([]);
    const many = Array.from({ length: 11 }, () => ({ name: "a.md", bytes: 1 }));
    await expect(prepareRemoteUploads(many, deps(impl))).rejects.toThrow(
      /At most 10/,
    );
  });
});

async function connect(extra: Record<string, unknown> = {}) {
  const server = new McpServer({ name: "t", version: "0" });
  const started: any[] = [];
  addAskBrowserStackAITool(server, {
    agentUrl: () => AGENT,
    mintToken: async () => "t",
    credentialsFor: () => ({ username: "", accessKey: "" }),
    deferredTransport: async (_url, _h, body) => {
      started.push(body);
      return { status: 200, body: { ok: true, status: "ok", answer: "done" } };
    },
    ...extra,
  });
  const client = new Client({ name: "c", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  const call = async (args: Record<string, unknown>) => {
    const res: any = await client.callTool({
      name: "askBrowserStackAI",
      arguments: args,
    });
    // The user-facing block and the assistant-only block, merged back into one view.
    const [shown, internal] = res.content;
    const extra = internal
      ? JSON.parse(internal.text.split("\n").slice(1).join("\n"))
      : {};
    return { ...JSON.parse(shown.text), ...extra };
  };
  return { call, started };
}

describe("askBrowserStackAI on the hosted server", () => {
  beforeEach(() => {
    cfg.REMOTE_MCP = true;
  });

  it("returns the commands and runs nothing", async () => {
    const { impl } = slots([AID]);
    const { call, started } = await connect({ uploadFetch: impl });
    const out = await call({
      product: "tm",
      query: "test cases from the PRD",
      files: [{ name: "./prd.pdf", bytes: 42 }],
      conversation_id: "run-1",
    });
    expect(out.status).toBe("needs_upload");
    expect(out.uploads).toEqual([
      expect.objectContaining({ name: "prd.pdf", attachment_id: AID }),
    ]);
    expect(out.next_step.params).toEqual({
      product: "tm",
      query: "test cases from the PRD",
      attachment_ids: [AID],
      conversation_id: "run-1",
    });
    expect(out.next_step.instruction).toMatch(/curl\.exe/);
    expect(started).toEqual([]);
  });

  it("asks for sizes when given bare names", async () => {
    const { impl, calls } = slots([AID]);
    const { call } = await connect({ uploadFetch: impl });
    const out = await call({ product: "tm", query: "q", files: ["prd.pdf"] });
    expect(out.status).toBe("error");
    expect(out.error).toMatch(/bytes: its exact size/);
    expect(calls).toEqual([]);
  });

  it("sends the uploaded ids with the task on the second call", async () => {
    const { call, started } = await connect();
    const out = await call({
      product: "tm",
      query: "q",
      attachment_ids: [AID, AID],
    });
    expect(out.status).toBe("ok");
    expect(started[0].attachment_ids).toEqual([AID]);
  });

  it("refuses an id it did not issue", async () => {
    const { call, started } = await connect();
    const res = await call({
      product: "tm",
      query: "q",
      attachment_ids: ["../x"],
    }).catch((e) => ({ thrown: String(e) }));
    expect(JSON.stringify(res)).toMatch(/MCP error|Invalid/);
    expect(started).toEqual([]);
  });
});
