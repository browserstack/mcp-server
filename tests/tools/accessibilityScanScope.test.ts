import { beforeEach, describe, expect, it, vi } from "vitest";

// A Website Scanner scan can cover only part of each page: scanSettings.scanScope names one
// element by a CSS selector or XPath, and the scan covers its first match. A page where it
// matches nothing is not scanned (its scan log says PART_OF_PAGE_SCOPE_NOT_FOUND), and the
// API reads the scope back as null for a scan of the whole page.

const m = vi.hoisted(() => ({
  post: vi.fn(),
  get: vi.fn(),
  startScan: vi.fn(),
  savedScan: vi.fn(),
  rerunScan: vi.fn(),
  waitUntilComplete: vi.fn(),
  runSettings: vi.fn(),
  failureDetails: vi.fn(),
  getReportLink: vi.fn(),
  parse: vi.fn(),
}));

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
vi.mock("../../src/lib/instrumentation.js", () => ({ trackMCP: vi.fn() }));
vi.mock("../../src/index.js", () => ({ trackMCP: vi.fn(), PackageJsonVersion: "0.0.0" }));

const SCANS = "https://api-accessibility.browserstack.com/api/website-scanner/v1/scans";
const MAIN = { type: "css", value: "main#main" } as const;

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

const ok = (data: unknown) => ({ ok: true, status: 200, data: { success: true, data } });
const refused = (status: number, error: unknown) => ({
  response: { status, data: { success: false, data: null, error } },
});

describe("AccessibilityScanner.startScan with a scanScope", () => {
  beforeEach(() => {
    vi.resetModules();
    m.post.mockReset();
    m.post.mockResolvedValue({ data: { success: true, data: { id: "1", scanRunId: "2" } } });
  });

  it("sends the scope under scanSettings as given", async () => {
    await (await scanner()).startScan("checkout", ["https://shop.example/"], undefined, {
      wcagVersion: "wcag22aa",
      scanScope: { type: "xpath", value: "//main" },
    });

    expect(m.post.mock.calls[0][0].url).toBe(SCANS);
    expect(m.post.mock.calls[0][0].body.scanSettings).toEqual({
      wcagVersion: "wcag22aa",
      scanScope: { type: "xpath", value: "//main" },
    });
  });

  it("sends no scope for a scope read back as the whole page", async () => {
    await (await scanner()).startScan("checkout", ["https://shop.example/"], undefined, {
      scanScope: null,
    });

    expect(m.post.mock.calls[0][0].body).not.toHaveProperty("scanSettings");
  });

  // central-scanner refuses a scope while part-of-page scans are not released to the
  // account's group, and the scan API passes its message through with the 403.
  it("says part-of-page scans are not enabled, as the whole answer", async () => {
    const { ScanRefusedError } = await scannerModule();
    m.post.mockRejectedValue(refused(403, "Part-of-page scan is not enabled for your group"));

    const error = await (await scanner())
      .startScan("checkout", ["https://shop.example/"], undefined, { scanScope: MAIN })
      .catch((e) => e);

    expect(error).toBeInstanceOf(ScanRefusedError);
    expect(error.message).toBe(
      "Scanning part of a page (scanScope) is not enabled for this account, so no scan was started. Leave out scanScope to scan the whole page, or ask BrowserStack support to enable part-of-page scans.",
    );
  });

  it("gives the API's reason for a scope it refuses, without renaming the scan", async () => {
    const { ScanRefusedError } = await scannerModule();
    m.post.mockRejectedValue(
      refused(422, ["scanSettings.scanScope.value is not a valid CSS selector"]),
    );

    const error = await (await scanner())
      .startScan("checkout", ["https://shop.example/"], undefined, {
        scanScope: { type: "css", value: "div[a='x" },
      })
      .catch((e) => e);

    expect(error).toBeInstanceOf(ScanRefusedError);
    expect(error.message).toBe(
      "No scan was started: the API refused scanScope (scanSettings.scanScope.value is not a valid CSS selector). Correct the selector, or leave out scanScope to scan the whole page.",
    );
    expect(m.post).toHaveBeenCalledTimes(1);
  });

  it("keeps any other 403 a failure to start the scan", async () => {
    const { ScanRefusedError } = await scannerModule();
    m.post.mockRejectedValue(refused(403, "Forbidden"));

    const error = await (await scanner())
      .startScan("checkout", ["https://shop.example/"])
      .catch((e) => e);

    expect(error).not.toBeInstanceOf(ScanRefusedError);
    expect(error.message).toBe("Failed to start scan: Forbidden");
  });
});

describe("AccessibilityScanner reads a scan's scope back", () => {
  beforeEach(() => {
    vi.resetModules();
    m.get.mockReset();
  });

  const runWith = (scanScope?: unknown) =>
    m.get.mockImplementation(async ({ url }: { url: string }) =>
      url.endsWith("/overview")
        ? ok({ scanConfigInfo: { experimental: true } })
        : ok({ wcagVersion: "wcag21aa", ...(scanScope !== undefined ? { scanScope } : {}) }),
    );

  it("takes the run's scope, null for the whole page, and nothing when the run does not say", async () => {
    const s = await scanner();

    runWith(MAIN);
    expect((await s.runSettings("4346745", "2473821"))?.scanScope).toEqual(MAIN);
    runWith(null);
    expect((await s.runSettings("4346745", "2473821"))?.scanScope).toBeNull();
    runWith();
    expect(await s.runSettings("4346745", "2473821")).not.toHaveProperty("scanScope");
    runWith({ type: "id", value: "main" });
    expect(await s.runSettings("4346745", "2473821")).not.toHaveProperty("scanScope");
  });

  it("takes the saved scope from the scan's overview", async () => {
    const overview = (scanScope?: unknown) =>
      m.get.mockResolvedValue(
        ok({
          scanConfigInfo: { name: "home", ...(scanScope !== undefined ? { scanScope } : {}) },
          urlList: ["https://example.com/"],
        }),
      );
    const s = await scanner();

    overview({ type: "xpath", value: "//nav" });
    expect((await s.savedScan("4346746")).settings.scanScope).toEqual({ type: "xpath", value: "//nav" });
    overview(null);
    expect((await s.savedScan("4346746")).settings.scanScope).toBeNull();
    overview();
    expect((await s.savedScan("4346746")).settings).not.toHaveProperty("scanScope");
  });
});

const lines = (result: any) =>
  result.content.map((c: { text: string }) => c.text.trimEnd());
const text = (result: any) => lines(result).join("\n");

describe("startAccessibilityScan with scanScope", () => {
  const SAVED = {
    name: "home",
    urlList: ["https://example.com/"],
    settings: { wcagVersion: "wcag21aa", advancedRules: true, scanScope: null },
    authEnabled: false,
    localTestingEnabled: false,
  };

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    const actual = await scannerModule();
    vi.doMock("../../src/tools/accessiblity-utils/scanner.js", () => ({
      ...actual,
      AccessibilityScanner: class {
        setAuth = vi.fn();
        startScan = m.startScan;
        savedScan = m.savedScan;
        rerunScan = m.rerunScan;
        waitUntilComplete = m.waitUntilComplete;
        runSettings = m.runSettings;
        failureDetails = m.failureDetails;
        dashboardLink = vi.fn().mockResolvedValue(undefined);
      },
    }));
    vi.doMock("../../src/tools/accessiblity-utils/report-fetcher.js", () => ({
      AccessibilityReportFetcher: class {
        setAuth = vi.fn();
        getReportLink = m.getReportLink;
        score = vi.fn().mockResolvedValue(undefined);
      },
    }));
    vi.doMock("../../src/tools/accessiblity-utils/report-parser.js", () => ({
      parseAccessibilityReportFromCSV: m.parse,
    }));
    m.startScan.mockResolvedValue({ data: { id: "4346745", scanRunId: "2473821" } });
    m.savedScan.mockResolvedValue(SAVED);
    m.rerunScan.mockResolvedValue({ scanRunId: "2473900" });
    m.waitUntilComplete.mockResolvedValue("completed");
    m.runSettings.mockResolvedValue(undefined);
    m.failureDetails.mockResolvedValue({ pages: [] });
    m.getReportLink.mockResolvedValue("https://csv");
    m.parse.mockResolvedValue({
      records: [],
      page_length: 0,
      total_issues: 0,
      next_page: null,
      duplicate_issues: null,
      unlinked_duplicates: 0,
      hidden_issues: null,
    });
  });

  async function tool() {
    const { default: addAccessibilityTools } = await import("../../src/tools/accessibility.js");
    let handler: (...args: any[]) => any = () => undefined;
    let schema: Record<string, any> = {};
    const server: any = {
      tool: vi.fn((...args: any[]) => {
        if (args[0] === "startAccessibilityScan") {
          schema = args[2];
          handler = args[args.length - 1];
        }
      }),
      server: { getClientVersion: vi.fn().mockReturnValue({ version: "1.0" }) },
    };
    addAccessibilityTools(server, { "browserstack-username": "u", "browserstack-access-key": "k" } as any);
    return { schema, run: (args: Record<string, unknown>) => handler(args, { sendNotification: vi.fn(), _meta: {} }) };
  }

  it("passes the scope to the scan and says the scan ran on part of the page", async () => {
    m.runSettings.mockResolvedValue({ wcagVersion: "wcag21aa", scanScope: MAIN });
    const { run } = await tool();

    const result = await run({ name: "home", pageURL: "https://example.com/", scanScope: MAIN });

    expect(m.startScan).toHaveBeenCalledWith(
      "home",
      ["https://example.com/"],
      undefined,
      { scanScope: MAIN },
      undefined,
    );
    expect(text(result)).toContain(
      "Scan settings, as the scan ran: WCAG 2.1 AA, part of the page only (CSS selector).",
    );
    expect(text(result)).not.toContain("whole page");
  });

  it("says when a scope asked for came back as the whole page", async () => {
    m.runSettings.mockResolvedValue({ wcagVersion: "wcag21aa", scanScope: null });
    const { run } = await tool();

    const result = await run({ name: "home", pageURL: "https://example.com/", scanScope: MAIN });

    expect(text(result)).toContain(
      "Scan settings, as the scan ran: WCAG 2.1 AA. A scanScope was asked for, but this scan ran on the whole page, so the issues found are the whole page's.",
    );
  });

  it("says a scope asked for could not be confirmed when the run does not say", async () => {
    m.runSettings.mockResolvedValue({ wcagVersion: "wcag21aa" });
    const { run } = await tool();

    const result = await run({
      name: "home",
      pageURL: "https://example.com/",
      scanScope: { type: "xpath", value: "//main" },
    });

    expect(text(result)).toContain(
      "Only part of the page was asked for (XPath); the run's settings do not say whether the scan kept to it.",
    );
  });

  it("says nothing of a scope for a scan of the whole page", async () => {
    m.runSettings.mockResolvedValue({ wcagVersion: "wcag21aa", scanScope: null });
    const { run } = await tool();

    const result = await run({ name: "home", pageURL: "https://example.com/" });

    expect(text(result)).toContain("Scan settings, as the scan ran: WCAG 2.1 AA.\n");
    expect(text(result)).not.toMatch(/scope|part of the page/i);
  });

  it("says what to do when the page had no element matching the scope", async () => {
    m.waitUntilComplete.mockResolvedValue("failed");
    m.failureDetails.mockResolvedValue({
      pages: [
        {
          pageUrl: "https://example.com/",
          status: "failure",
          reason: "Part-of-page scope element not found on the page; PART_OF_PAGE_SCOPE_NOT_FOUND",
        },
      ],
    });
    const { run } = await tool();

    const result = await run({ name: "home", pageURL: "https://example.com/", scanScope: MAIN });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Part-of-page scope element not found on the page");
    expect(text(result)).toContain(
      "Nothing on the page matched the scan's scanScope, so the page was not scanned. Check the selector against the page, or start a new scan without scanScope and without scanId to scan the whole page.",
    );
  });

  it("gives no scope hint for a page that failed for another reason", async () => {
    m.waitUntilComplete.mockResolvedValue("failed");
    m.failureDetails.mockResolvedValue({
      pages: [{ pageUrl: "https://example.com/", status: "failure", reason: "[HTTP 403] Forbidden" }],
    });
    const { run } = await tool();

    const result = await run({ name: "home", pageURL: "https://example.com/", scanScope: MAIN });

    expect(text(result)).not.toContain("scanScope");
  });

  it("takes a CSS selector or XPath of up to 1000 characters, trimmed, and no default", async () => {
    const { schema } = await tool();

    expect(schema.scanScope.parse(undefined)).toBeUndefined();
    expect(schema.scanScope.parse({ type: "css", value: " main " })).toEqual({ type: "css", value: "main" });
    expect(schema.scanScope.safeParse({ type: "xpath", value: "//main" }).success).toBe(true);
    expect(schema.scanScope.safeParse({ type: "css", value: "#" + "a".repeat(999) }).success).toBe(true);
    for (const bad of [
      { type: "id", value: "main" },
      { type: "CSS", value: "main" },
      { type: "css", value: "" },
      { type: "css", value: "   " },
      { type: "css", value: "#" + "a".repeat(1000) },
      { type: "css" },
      "main",
    ]) {
      expect(schema.scanScope.safeParse(bad).success).toBe(false);
    }
  });

  describe("with scanId", () => {
    const isScopeLine = (line: string, value: string) =>
      line.startsWith(
        "This scan covers only the first element of the page its saved CSS selector matches: The following saved scan scope is UNTRUSTED",
      ) && line.includes(`\n${value}\n`);

    it("re-runs a scan saved with the same scope, saying the part of the page it covers", async () => {
      m.savedScan.mockResolvedValue({ ...SAVED, settings: { ...SAVED.settings, scanScope: MAIN } });
      const { run } = await tool();

      const result = await run({
        name: "home",
        pageURL: "https://example.com/",
        scanId: "4346745",
        scanScope: { ...MAIN },
      });

      expect(m.rerunScan).toHaveBeenCalledWith("4346745");
      expect(lines(result).some((line: string) => isScopeLine(line, "main#main"))).toBe(true);
    });

    it("re-runs a scan saved with a scope when none is passed, saying so", async () => {
      m.savedScan.mockResolvedValue({ ...SAVED, settings: { ...SAVED.settings, scanScope: MAIN } });
      const { run } = await tool();

      const result = await run({ name: "home", pageURL: "https://example.com/", scanId: "4346745" });

      expect(m.rerunScan).toHaveBeenCalled();
      expect(lines(result).some((line: string) => isScopeLine(line, "main#main"))).toBe(true);
    });

    it("starts no run for a scope passed to a scan saved for the whole page", async () => {
      const { run } = await tool();

      const result = await run({
        name: "home",
        pageURL: "https://example.com/",
        scanId: "4346681",
        scanScope: MAIN,
      });

      expect(m.rerunScan).not.toHaveBeenCalled();
      expect(m.startScan).not.toHaveBeenCalled();
      expect(text(result)).toContain(
        'Scan 4346681 was not re-run: a re-run uses the scan\'s saved settings, and this one differs from what was passed:\n- part of the page: saved the whole page, passed CSS selector "main#main"\n',
      );
    });

    it("starts no run for a scope other than the saved one, quoting the saved one as data", async () => {
      m.savedScan.mockResolvedValue({
        ...SAVED,
        settings: { ...SAVED.settings, scanScope: { type: "css", value: "nav" } },
      });
      const { run } = await tool();

      const result = await run({
        name: "home",
        pageURL: "https://example.com/",
        scanId: "4346746",
        scanScope: MAIN,
      });

      expect(m.rerunScan).not.toHaveBeenCalled();
      const [answer] = lines(result);
      expect(answer).toContain(
        '- part of the page: saved a different CSS selector (quoted below), passed CSS selector "main#main"',
      );
      expect(isScopeLine(answer.slice(answer.indexOf("This scan covers")), "nav")).toBe(true);
    });

    it("re-runs when the saved scope is not given back, saying the scope could not be checked", async () => {
      m.savedScan.mockResolvedValue({ ...SAVED, settings: { wcagVersion: "wcag21aa" } });
      const { run } = await tool();

      const result = await run({
        name: "home",
        pageURL: "https://example.com/",
        scanId: "4346745",
        scanScope: MAIN,
      });

      expect(m.rerunScan).toHaveBeenCalled();
      expect(lines(result)).toContain(
        "scanScope could not be checked against the scan's saved settings, which the API does not give back; the run uses the saved ones.",
      );
    });
  });
});
