import { beforeEach, describe, expect, it, vi } from "vitest";

// Scan names: central-scanner refuses any character outside a short list (and "--"), and
// agents name scans after page titles and paths. 21 scans in a week failed on that.
// Failed runs: the result said only "The dashboard says why".

const m = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn() }));

vi.mock("../../src/lib/apiClient.js", () => ({ apiClient: { post: m.post, get: m.get } }));
vi.mock("../../src/lib/local.js", () => ({
  isLocalURL: () => false,
  ensureLocalBinarySetup: vi.fn(),
  killExistingBrowserStackLocalProcesses: vi.fn(),
}));
vi.mock("../../src/config.js", () => ({
  default: { REMOTE_MCP: false, USE_OWN_LOCAL_BINARY_PROCESS: false },
}));
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

// The rule central-scanner applies (lib/util.rb validate_project_name).
const ALLOWED = /^[A-Za-z0-9_:*.@!$\s\-'{}[\](]*$/;

describe("cleanScanName", () => {
  it.each([
    ["Checkout / Cart | Prod", "Checkout - Cart - Prod"],
    ["Home (v2)", "Home [v2]"],
    ["Café, menu & more", "Cafe - menu - more"],
    ["docs/getting-started", "docs-getting-started"],
    ["release--candidate", "release-candidate"],
    ["50% off; today?", "50 - off - today"],
    ['Say "hi"', "Say - hi"],
    ["  Checkout  page\tone ", "Checkout page one"],
    ["Already-valid name_1.2:*@!$ {x} [y]", "Already-valid name_1.2:*@!$ {x} [y]"],
  ])("cleans %j to %j", async (name, cleaned) => {
    const { cleanScanName } = await scannerModule();
    expect(cleanScanName(name, "site.example")).toBe(cleaned);
  });

  it("falls back to the given name when nothing usable is left", async () => {
    const { cleanScanName } = await scannerModule();
    expect(cleanScanName("日本語のページ", "www.example.jp")).toBe("www.example.jp");
    expect(cleanScanName("/// | ///", "site.example")).toBe("site.example");
  });

  it("only ever gives a name the API takes, within 255 characters", async () => {
    const { cleanScanName } = await scannerModule();
    for (const name of [
      "a".repeat(400),
      "x/".repeat(200),
      "Ünïcödé — test (draft) #3 <b>bold</b> `code` \\path\\ \"q\" 'a' & | ; > < ? % , \n end",
    ]) {
      const cleaned = cleanScanName(name, "site.example");
      expect(cleaned).toMatch(ALLOWED);
      expect(cleaned).not.toContain("--");
      expect(cleaned.length).toBeLessThanOrEqual(255);
      expect(cleaned).toMatch(/[A-Za-z0-9]/);
    }
  });
});

describe("AccessibilityScanner.startScan names", () => {
  beforeEach(() => {
    vi.resetModules();
    m.post.mockReset();
    m.post.mockResolvedValue({ data: { success: true, data: { id: "1", scanRunId: "2" } } });
  });

  it("sends a cleaned name and says the name changed", async () => {
    const started = await (await scanner()).startScan("Checkout / Cart", ["https://shop.example/"]);

    expect(m.post.mock.calls[0][0].body.name).toBe("Checkout - Cart");
    expect(started).toMatchObject({ scanName: "Checkout - Cart", nameChanges: ["characters"] });
  });

  it("sends a valid name unchanged and reports no change", async () => {
    const started = await (await scanner()).startScan("checkout", ["https://shop.example/"]);

    expect(m.post.mock.calls[0][0].body.name).toBe("checkout");
    expect(started).not.toHaveProperty("scanName");
    expect(started).not.toHaveProperty("nameChanges");
  });

  it("timestamps the cleaned name when it is taken too", async () => {
    m.post
      .mockRejectedValueOnce({ response: { status: 422, data: { message: "A scan with the provided name already exists" } } })
      .mockResolvedValueOnce({ data: { success: true, data: { id: "1", scanRunId: "2" } } });

    const started = await (await scanner()).startScan("Checkout / Cart", ["https://shop.example/"]);

    const renamed = m.post.mock.calls[1][0].body.name;
    expect(renamed).toMatch(/^Checkout - Cart \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC$/);
    expect(started).toMatchObject({ scanName: renamed, nameChanges: ["characters", "taken"] });
  });
});

describe("AccessibilityScanner.failureDetails", () => {
  beforeEach(() => {
    vi.resetModules();
    m.get.mockReset();
  });

  const ok = (data: unknown) => ({ ok: true, data: { success: true, data } });
  const list = (lastScanDetails: unknown) =>
    ok({ scans: [{ id: 7, lastScanDetails }, { id: 8, lastScanDetails: { scanRunId: 2, error: "other scan" } }] });
  const logs = ok({
    urlCount: 3,
    scanLogs: [
      { pageUrl: "https://site.example/", description: "Scan complete", status: "success", error: null },
      { pageUrl: "https://site.example/a", description: "[HTTP 403] Forbidden", status: "failure", error: null },
      { pageUrl: "https://site.example/b", description: "Redirected", status: "redirect", error: "too many hops", finalRedirectUrl: "https://site.example/c" },
    ],
  });
  function route(listResp: unknown, logsResp: unknown) {
    m.get.mockImplementation(async ({ url }: { url: string }) =>
      url.endsWith("/scan_logs") ? logsResp : listResp,
    );
  }

  it("gives the run's reason and each page that did not scan", async () => {
    route(list({ scanRunId: 2, error: "The requested page is not reachable" }), logs);

    const details = await (await scanner()).failureDetails("7", "2");

    expect(details.reason).toBe("The requested page is not reachable");
    expect(details.pages).toEqual([
      { pageUrl: "https://site.example/a", status: "failure", reason: "[HTTP 403] Forbidden" },
      { pageUrl: "https://site.example/b", status: "redirect", reason: "Redirected; too many hops; redirected to https://site.example/c" },
    ]);
    expect(m.get.mock.calls.map(([o]) => o.url)).toContain(
      "https://api-accessibility.browserstack.com/api/website-scanner/v1/scans/7/scan_runs/2/scan_logs",
    );
  });

  it("takes no reason from another run of the scan", async () => {
    route(list({ scanRunId: 1, error: "an older run's reason" }), logs);

    expect((await (await scanner()).failureDetails("7", "2")).reason).toBeUndefined();
  });

  it("gives nothing, rather than an error, when the reads fail", async () => {
    m.get.mockRejectedValue(new Error("network down"));
    await expect((await scanner()).failureDetails("7", "2")).resolves.toEqual({ pages: [] });

    route({ ok: false, data: {} }, { ok: false, data: {} });
    await expect((await scanner()).failureDetails("7", "2")).resolves.toEqual({ pages: [] });
  });

  it("reads only the run's scan logs for the pages a completed run did not scan", async () => {
    route(list({ scanRunId: 2, error: "unused" }), logs);

    const pages = await (await scanner()).unscannedPages("7", "2");

    expect(pages.map((p) => p.pageUrl)).toEqual(["https://site.example/a", "https://site.example/b"]);
    expect(m.get).toHaveBeenCalledTimes(1);
    expect(m.get.mock.calls[0][0].url).toMatch(/\/scans\/7\/scan_runs\/2\/scan_logs$/);
  });

  it("gives no pages, rather than an error, when the logs cannot be read or are not a list", async () => {
    m.get.mockRejectedValue(new Error("network down"));
    await expect((await scanner()).unscannedPages("7", "2")).resolves.toEqual([]);

    m.get.mockResolvedValue({ ok: true, data: { success: true, data: { scanLogs: { not: "a list" } } } });
    await expect((await scanner()).unscannedPages("7", "2")).resolves.toEqual([]);
  });
});
