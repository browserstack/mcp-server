import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A scan of a local URL goes through a BrowserStack Local tunnel. The hosted server cannot
// start one on the user's machine, but the scan API takes the identifier of a tunnel the
// user started. And a scan outlasting the 5-minute wait keeps running: the tool used to say
// "Failed to start accessibility scan" with no ids, so agents reported no scan existed.

const m = vi.hoisted(() => ({
  post: vi.fn(),
  get: vi.fn(),
  ensureOwnTunnel: vi.fn(),
  config: { REMOTE_MCP: false, USE_OWN_LOCAL_BINARY_PROCESS: false },
}));

vi.mock("../../src/lib/apiClient.js", () => ({ apiClient: { post: m.post, get: m.get } }));
vi.mock("../../src/lib/local.js", () => ({
  isLocalURL: (url: string) => new URL(url).hostname === "localhost",
  ensureOwnTunnel: m.ensureOwnTunnel,
  otherBrowserStackLocalPids: () => [],
}));
vi.mock("../../src/config.js", () => ({ default: m.config }));
vi.mock("../../src/logger.js", () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

async function scannerModule() {
  return vi.importActual<typeof import("../../src/tools/accessiblity-utils/scanner.js")>(
    "../../src/tools/accessiblity-utils/scanner.js",
  );
}

async function scanner() {
  const { AccessibilityScanner } = await scannerModule();
  const s = new AccessibilityScanner();
  s.setAuth({ username: "u", password: "p" });
  return s;
}

describe("AccessibilityScanner.startScan through a tunnel the user started", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    m.config.REMOTE_MCP = false;
    m.config.USE_OWN_LOCAL_BINARY_PROCESS = false;
    m.post.mockResolvedValue({ data: { success: true, data: { id: "1", scanRunId: "2" } } });
  });

  it("sends the user's tunnel and starts no tunnel of its own", async () => {
    m.config.REMOTE_MCP = true;

    await (await scanner()).startScan("dev", ["http://localhost:3000/cart"], undefined, {}, "my-tunnel");

    const body = m.post.mock.calls[0][0].body;
    expect(body.localTestingInfo).toEqual({ localIdentifier: "my-tunnel", localEnabled: true });
    expect(body.urlList).toEqual(["http://bs-local.com:3000/cart"]);
    expect(m.ensureOwnTunnel).not.toHaveBeenCalled();
  });

  it("sends an internal host through the user's tunnel unchanged", async () => {
    await (await scanner()).startScan("staging", ["https://staging.internal.example/"], undefined, {}, "my-tunnel");

    const body = m.post.mock.calls[0][0].body;
    expect(body.urlList).toEqual(["https://staging.internal.example/"]);
    expect(body.localTestingInfo).toEqual({ localIdentifier: "my-tunnel", localEnabled: true });
    expect(m.ensureOwnTunnel).not.toHaveBeenCalled();
  });

  it("on the hosted server, refuses a local URL without a tunnel and says how to start one", async () => {
    m.config.REMOTE_MCP = true;
    const { ScanRefusedError } = await scannerModule();

    const start = (await scanner()).startScan("dev", ["http://localhost:3000/"]);

    await expect(start).rejects.toBeInstanceOf(ScanRefusedError);
    await expect(start).rejects.toThrow(/cannot open a tunnel to a local URL on your machine/);
    await expect(start).rejects.toThrow(/--local-identifier <a name>\) and pass that name as localIdentifier/);
    expect(m.post).not.toHaveBeenCalled();
  });

  it("with USE_OWN_LOCAL_BINARY_PROCESS, takes a local URL once the tunnel's identifier is given", async () => {
    m.config.USE_OWN_LOCAL_BINARY_PROCESS = true;

    await expect(
      (await scanner()).startScan("dev", ["http://localhost:3000/"]),
    ).rejects.toThrow(/pass that name as localIdentifier/);
    await (await scanner()).startScan("dev", ["http://localhost:3000/"], undefined, {}, "mine");

    expect(m.post.mock.calls[0][0].body.localTestingInfo.localIdentifier).toBe("mine");
  });

  it("without a tunnel, still starts its own for a local URL on a local server", async () => {
    m.ensureOwnTunnel.mockResolvedValue("mcp-own");

    await (await scanner()).startScan("dev", ["http://localhost:3000/"]);

    expect(m.ensureOwnTunnel).toHaveBeenCalledWith("u", "p");
    expect(m.post.mock.calls[0][0].body.localTestingInfo.localIdentifier).toBe("mcp-own");
  });
});

describe("AccessibilityScanner.waitUntilComplete", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  const context = { sendNotification: vi.fn(), _meta: {} };
  const status = (value: string) => ({ data: { success: true, data: { status: value } } });

  it("hands back a ScanTimeoutError when the scan outlasts the wait", async () => {
    m.get.mockResolvedValue(status("processing"));
    const { ScanTimeoutError, SCAN_WAIT_MS } = await scannerModule();

    const wait = (await scanner()).waitUntilComplete("1", "2", context);
    const settled = wait.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(SCAN_WAIT_MS);

    const error = await settled;
    expect(error).toBeInstanceOf(ScanTimeoutError);
    expect((error as InstanceType<typeof ScanTimeoutError>).waitedMs).toBe(SCAN_WAIT_MS);
  });

  it("stops at a cancelled scan instead of waiting out the 5 minutes", async () => {
    m.get.mockResolvedValue(status("cancelled"));

    const wait = (await scanner()).waitUntilComplete("1", "2", context);
    await vi.advanceTimersByTimeAsync(5000);

    await expect(wait).resolves.toBe("cancelled");
  });

  it("clears the 5-minute timer once the scan finishes", async () => {
    m.get.mockResolvedValue(status("completed"));

    const wait = (await scanner()).waitUntilComplete("1", "2", context);
    await vi.advanceTimersByTimeAsync(5000);

    await expect(wait).resolves.toBe("completed");
    expect(vi.getTimerCount()).toBe(0);
  });
});
