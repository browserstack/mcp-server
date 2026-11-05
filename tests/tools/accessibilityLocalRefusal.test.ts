import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A local URL the MCP cannot tunnel to (the hosted MCP, or USE_OWN_LOCAL_BINARY_PROCESS)
// is a limit of how it runs, not a bug: the answer is the way forward, as a plain result.
// It used to be an error, wrapped as "Failed to start accessibility scan: <msg>. Please open
// an issue on GitHub if the problem persists", with "If this blocks the user's task, report
// it with submitFeedback." added after it, and ".." wherever <msg> ended in a full stop.
// Calls go through the whole server, so the result is what a client gets.

const m = vi.hoisted(() => ({
  post: vi.fn(),
  get: vi.fn(),
  ensureOwnTunnel: vi.fn(),
  config: { REMOTE_MCP: false, USE_OWN_LOCAL_BINARY_PROCESS: false },
}));

vi.mock("../../src/config.js", async (importOriginal) => {
  const actual = (await importOriginal<typeof import("../../src/config.js")>())
    .default;
  return {
    default: new Proxy(actual, {
      get: (target, key) =>
        key in m.config ? (m.config as any)[key] : (target as any)[key],
    }),
  };
});
vi.mock("../../src/lib/apiClient.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/lib/apiClient.js")>()),
  apiClient: { post: m.post, get: m.get },
}));
vi.mock("../../src/lib/local.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/lib/local.js")>()),
  ensureOwnTunnel: m.ensureOwnTunnel,
  otherBrowserStackLocalPids: () => [],
}));
// No telemetry: it would post through the mocked apiClient.
vi.mock("../../src/lib/instrumentation.js", () => ({
  trackMCP: vi.fn(),
  withToolCall: (_name: string, _client: unknown, _config: unknown, fn: () => unknown) =>
    fn(),
}));
vi.mock("../../src/logger.js", () => ({
  default: { error: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));

let client: Client;

beforeEach(async () => {
  vi.clearAllMocks();
  m.config.REMOTE_MCP = false;
  m.config.USE_OWN_LOCAL_BINARY_PROCESS = false;
  const { BrowserStackMcpServer } = await import("../../src/server-factory.js");
  const server = new BrowserStackMcpServer({
    "browserstack-username": "u",
    "browserstack-access-key": "k",
  } as any);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "refusal", version: "1" });
  await Promise.all([
    client.connect(clientSide),
    server.getInstance().connect(serverSide),
  ]);
});

afterEach(async () => {
  await client.close();
});

async function scan(args: Record<string, unknown>) {
  const result = (await client.callTool({
    name: "startAccessibilityScan",
    arguments: { name: "dev", ...args },
  })) as { isError?: boolean; content: { type: string; text: string }[] };
  return { ...result, text: result.content.map((c) => c.text).join("\n") };
}

function expectGuidanceOnly(result: Awaited<ReturnType<typeof scan>>) {
  expect(result.isError).toBeFalsy();
  expect(result.content).toHaveLength(1);
  expect(result.text).toContain(
    "--local-identifier <a name>) and pass that name as localIdentifier.",
  );
  expect(result.text).toMatch(/Or scan a public URL\.$/);
  expect(result.text).not.toMatch(/GitHub|submitFeedback|Failed to/);
  expect(result.text).not.toContain("..");
  expect(m.post).not.toHaveBeenCalled();
  expect(m.ensureOwnTunnel).not.toHaveBeenCalled();
}

describe("a local URL without localIdentifier the MCP cannot tunnel to", () => {
  it("on the hosted MCP, answers with the guidance as a plain result", async () => {
    m.config.REMOTE_MCP = true;

    const result = await scan({ pageURL: "http://localhost:8791/index.html" });

    expectGuidanceOnly(result);
    expect(result.text).toMatch(
      /^This hosted BrowserStack MCP runs on BrowserStack's servers, so it cannot open a tunnel to a local URL on your machine\. Start BrowserStack Local yourself/,
    );
  });

  it("with USE_OWN_LOCAL_BINARY_PROCESS, answers with the guidance as a plain result", async () => {
    m.config.USE_OWN_LOCAL_BINARY_PROCESS = true;

    const result = await scan({ pageURL: "http://localhost:8791/index.html" });

    expectGuidanceOnly(result);
    expect(result.text).toMatch(/USE_OWN_LOCAL_BINARY_PROCESS/);
  });

  it("on the hosted MCP, still scans through the tunnel named by localIdentifier", async () => {
    m.config.REMOTE_MCP = true;
    m.post.mockRejectedValue({
      response: { status: 500, data: { message: "stop here" } },
    });

    await scan({
      pageURL: "http://localhost:8791/index.html",
      localIdentifier: "my-tunnel",
    });

    expect(m.post.mock.calls[0][0].body.localTestingInfo).toEqual({
      localIdentifier: "my-tunnel",
      localEnabled: true,
    });
  });
});

describe("the error wrapper's punctuation", () => {
  it.each([
    ["Server is down.", "Server is down. Please open"],
    ["Server is down", "Server is down. Please open"],
    ["Is the server down?", "Is the server down? Please open"],
    ["Server is down!", "Server is down! Please open"],
    ['The API said "slow down."', 'The API said "slow down." Please open'],
    ["Server is down (try later.)", "Server is down (try later.) Please open"],
    ["Server is down.  ", "Server is down. Please open"],
  ])("after %j, adds a full stop only when it is missing", async (reason, said) => {
    m.post.mockRejectedValue({ response: { status: 500, data: { message: reason } } });

    const result = await scan({ pageURL: "https://www.bstackdemo.com/" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(
      `Failed to start accessibility scan: Failed to start scan: ${said} an issue on GitHub if the problem persists`,
    );
    expect(result.content[0].text).not.toContain("..");
  });

  it("does not double the full stop of a message of its own", async () => {
    // A name refused as taken, with no reason given, both times.
    m.post.mockRejectedValue({ response: { status: 422, data: {} } });

    const result = await scan({ pageURL: "https://www.bstackdemo.com/" });

    expect(result.content[0].text).toBe(
      "Failed to start accessibility scan: A scan with this name already exists. please update the name and run again. Please open an issue on GitHub if the problem persists",
    );
  });
});
