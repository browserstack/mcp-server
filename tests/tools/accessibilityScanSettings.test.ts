import { beforeEach, describe, expect, it, vi } from "vitest";

// A Website Scanner scan can be asked for a WCAG version and level, best practices, "needs
// review" issues, advanced rules and experimental rules: the create-scan API takes them
// under scanSettings, and anything left out takes the API's default.

const m = vi.hoisted(() => ({
  post: vi.fn(),
  get: vi.fn(),
  startScan: vi.fn(),
  waitUntilComplete: vi.fn(),
  runSettings: vi.fn(),
  getReportLink: vi.fn(),
  parse: vi.fn(),
}));

vi.mock("../../src/lib/apiClient.js", () => ({ apiClient: { post: m.post, get: m.get } }));
vi.mock("../../src/lib/local.js", () => ({
  isLocalURL: () => false,
  ensureLocalBinarySetup: vi.fn(),
  killExistingBrowserStackLocalProcesses: vi.fn(),
}));
vi.mock("../../src/logger.js", () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../src/lib/instrumentation.js", () => ({ trackMCP: vi.fn() }));
vi.mock("../../src/index.js", () => ({ trackMCP: vi.fn(), PackageJsonVersion: "0.0.0" }));

describe("AccessibilityScanner.startScan", () => {
  beforeEach(() => {
    vi.resetModules();
    m.post.mockReset();
    m.post.mockResolvedValue({ data: { success: true, data: { id: "1", scanRunId: "2" } } });
  });

  async function scanner() {
    const { AccessibilityScanner } = await vi.importActual<
      typeof import("../../src/tools/accessiblity-utils/scanner.js")
    >("../../src/tools/accessiblity-utils/scanner.js");
    const s = new AccessibilityScanner();
    s.setAuth({ username: "u", password: "p" });
    return s;
  }

  it("sends the WCAG version, best practices, needs review and advanced rules it is given", async () => {
    await (await scanner()).startScan("checkout", ["https://shop.example/"], undefined, {
      wcagVersion: "wcag22aaa",
      bestPractices: true,
      needsReview: false,
      advancedRules: false,
    });

    expect(m.post.mock.calls[0][0].body.scanSettings).toEqual({
      wcagVersion: "wcag22aaa",
      bestPractices: true,
      needsReview: false,
      advancedRules: false,
    });
  });

  it("sends only the settings it is given, so the rest take the API's defaults", async () => {
    await (await scanner()).startScan("checkout", ["https://shop.example/"], undefined, {
      bestPractices: true,
    });

    expect(m.post.mock.calls[0][0].body.scanSettings).toEqual({ bestPractices: true });
  });

  it("passes on the API's own reason for a 422, rather than assuming a duplicate name", async () => {
    m.post.mockRejectedValue({
      response: { status: 422, data: { message: "wcagVersion field must be one of: wcag21aa, wcag22aa" } },
    });

    const start = (await scanner()).startScan("checkout", ["https://shop.example/"], undefined, {
      wcagVersion: "rgaa41",
    });

    await expect(start).rejects.toThrow(/wcagVersion field must be one of/);
    await expect(start).rejects.not.toThrow(/already exists/);
  });

  it("still reads a 422 with no reason as a name already in use", async () => {
    m.post.mockRejectedValue({ response: { status: 422, data: {} } });

    await expect(
      (await scanner()).startScan("checkout", ["https://shop.example/"]),
    ).rejects.toThrow(/A scan with this name already exists/);
  });

  it("sends experimental rules off when asked, as false is a setting rather than a missing one", async () => {
    await (await scanner()).startScan("checkout", ["https://shop.example/"], undefined, {
      experimentalRules: false,
    });

    expect(m.post.mock.calls[0][0].body.scanSettings).toEqual({ experimentalRules: false });
  });

  it("sends no scanSettings when none are given", async () => {
    await (await scanner()).startScan("checkout", ["https://shop.example/"]);

    expect(m.post.mock.calls[0][0].body).not.toHaveProperty("scanSettings");
  });
});

// The run summary carries a run's WCAG version, best practices, needs review and advanced
// rules, but not experimental rules: those are read from the scan's own settings (its
// overview), which a scan started here has for this run alone.
describe("AccessibilityScanner.runSettings", () => {
  const SCANS = "https://api-accessibility.browserstack.com/api/website-scanner/v1/scans";
  const run = { ok: true, status: 200, data: { data: { wcagVersion: "wcag22aa", bestPractices: true, needsReview: true, advanced: true } } };

  beforeEach(() => {
    vi.resetModules();
    m.get.mockReset();
  });

  async function scanner() {
    const { AccessibilityScanner } = await vi.importActual<
      typeof import("../../src/tools/accessiblity-utils/scanner.js")
    >("../../src/tools/accessiblity-utils/scanner.js");
    const s = new AccessibilityScanner();
    s.setAuth({ username: "u", password: "p" });
    return s;
  }

  it("reads experimental rules from the scan's own settings, as the run summary has none", async () => {
    m.get.mockImplementation(async ({ url }: { url: string }) =>
      url === `${SCANS}/7310042/overview`
        ? { ok: true, status: 200, data: { data: { scanConfigInfo: { experimental: false } } } }
        : run,
    );

    await expect((await scanner()).runSettings("7310042", "5520318")).resolves.toEqual({
      wcagVersion: "wcag22aa",
      bestPractices: true,
      needsReview: true,
      advancedRules: true,
      experimentalRules: false,
    });
    expect(m.get.mock.calls.map(([o]) => o.url).sort()).toEqual([
      `${SCANS}/7310042/overview`,
      `${SCANS}/7310042/scan_runs/5520318`,
    ]);
  });

  it("still reads the run's settings when the scan's own cannot be read", async () => {
    m.get.mockImplementation(async ({ url }: { url: string }) =>
      url.endsWith("/overview") ? { ok: false, status: 500, data: {} } : run,
    );

    const settings = await (await scanner()).runSettings("7310042", "5520318");

    expect(settings).toMatchObject({ wcagVersion: "wcag22aa", advancedRules: true });
    expect(settings).not.toHaveProperty("experimentalRules");
  });
});

describe("startAccessibilityScan scan settings", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.doMock("../../src/tools/accessiblity-utils/scanner.js", () => ({
      AccessibilityScanner: class {
        setAuth = vi.fn();
        startScan = m.startScan;
        waitUntilComplete = m.waitUntilComplete;
        runSettings = m.runSettings;
        dashboardLink = vi.fn().mockResolvedValue(undefined);
      },
    }));
    vi.doMock("../../src/tools/accessiblity-utils/report-fetcher.js", () => ({
      AccessibilityReportFetcher: class {
        setAuth = vi.fn();
        getReportLink = m.getReportLink;
      },
    }));
    vi.doMock("../../src/tools/accessiblity-utils/report-parser.js", () => ({
      parseAccessibilityReportFromCSV: m.parse,
    }));
    m.startScan.mockResolvedValue({ data: { id: "7310042", scanRunId: "5520318" } });
    m.waitUntilComplete.mockResolvedValue("completed");
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

  const text = (result: any) => result.content.map((c: { text: string }) => c.text).join("\n");

  it("passes the requested settings to the scan and reports the settings it ran with", async () => {
    m.runSettings.mockResolvedValue({
      wcagVersion: "wcag22aaa",
      bestPractices: true,
      needsReview: true,
      advancedRules: false,
    });
    const { run } = await tool();

    const result = await run({
      name: "checkout",
      pageURL: "https://shop.example/",
      wcagVersion: "wcag22aaa",
      bestPractices: true,
    });

    expect(m.startScan).toHaveBeenCalledWith("checkout", ["https://shop.example/"], undefined, {
      wcagVersion: "wcag22aaa",
      bestPractices: true,
    });
    expect(m.runSettings).toHaveBeenCalledWith("7310042", "5520318");
    // Advanced rules read back off, as a plan without them turns them off.
    expect(text(result)).toContain(
      "Scan settings, as the scan ran: WCAG 2.2 AAA, best practices on, needs review on, advanced rules off.",
    );
  });

  it("passes experimental rules to the scan and reports them as the scan ran", async () => {
    m.runSettings.mockResolvedValue({
      wcagVersion: "wcag21aa",
      bestPractices: false,
      needsReview: true,
      advancedRules: true,
      experimentalRules: false,
    });
    const { run } = await tool();

    const result = await run({
      name: "checkout",
      pageURL: "https://shop.example/",
      experimentalRules: false,
    });

    expect(m.startScan).toHaveBeenCalledWith("checkout", ["https://shop.example/"], undefined, {
      experimentalRules: false,
    });
    expect(text(result)).toContain(
      "Scan settings, as the scan ran: WCAG 2.1 AA, best practices off, needs review on, advanced rules on, experimental rules off.",
    );
  });

  it("says only what was asked for when the run's settings cannot be read", async () => {
    m.runSettings.mockResolvedValue(undefined);
    const { run } = await tool();

    const result = await run({
      name: "checkout",
      pageURL: "https://shop.example/",
      wcagVersion: "wcag22aaa",
      bestPractices: true,
    });

    expect(text(result)).toContain(
      "Scan settings asked for: WCAG 2.2 AAA, best practices on; anything not asked for takes the scan's default.",
    );
    expect(text(result)).not.toContain("(default)");
  });

  it("takes experimental rules only as on or off", async () => {
    const { schema } = await tool();

    expect(schema.experimentalRules.safeParse(false).success).toBe(true);
    expect(schema.experimentalRules.safeParse(true).success).toBe(true);
    expect(schema.experimentalRules.safeParse("off").success).toBe(false);
  });

  it("takes only the WCAG versions the API knows, RGAA 4.1 among them", async () => {
    const { schema } = await tool();

    for (const ok of ["wcag2a", "wcag21aa", "wcag22aaa", "rgaa41"]) {
      expect(schema.wcagVersion.safeParse(ok).success).toBe(true);
    }
    for (const bad of ["wcag22", "WCAG 2.2 AA", "wcag23aa"]) {
      expect(schema.wcagVersion.safeParse(bad).success).toBe(false);
    }
  });
});

// A scan's dashboard page is named by its build, not its name: the scans list carries each
// scan's own link (scanUrl). A link made from the name alone does not open the scan.
describe("AccessibilityScanner.dashboardLink", () => {
  const SCANS = "https://api-accessibility.browserstack.com/api/website-scanner/v1/scans";
  const LINK =
    "https://accessibility.browserstack.com/site-scanner/projects/Home%20page/builds?thBuildId=k3v9q2m7x1c8b4n6z0w5r2t9y4p1s8d3f6g0h2ja&recurring=false&tunnel_vision=false";

  beforeEach(() => {
    vi.resetModules();
    m.get.mockReset();
  });

  async function scanner() {
    const { AccessibilityScanner } = await vi.importActual<
      typeof import("../../src/tools/accessiblity-utils/scanner.js")
    >("../../src/tools/accessiblity-utils/scanner.js");
    const s = new AccessibilityScanner();
    s.setAuth({ username: "u", password: "p" });
    return s;
  }

  it("reads the scan's own dashboard link from the scans list", async () => {
    m.get.mockResolvedValue({
      ok: true,
      status: 200,
      data: { data: { scans: [{ id: 7310043, scanUrl: "https://elsewhere" }, { id: 7310042, scanUrl: LINK }] } },
    });

    await expect((await scanner()).dashboardLink("7310042")).resolves.toBe(LINK);
    expect(m.get.mock.calls[0][0].url).toBe(SCANS);
  });

  it("gives no link when the scan is not on the list, or the list cannot be read", async () => {
    m.get.mockResolvedValueOnce({ ok: true, status: 200, data: { data: { scans: [{ id: 1, scanUrl: LINK }] } } });
    await expect((await scanner()).dashboardLink("7310042")).resolves.toBeUndefined();

    m.get.mockResolvedValueOnce({ ok: false, status: 500, data: {} });
    await expect((await scanner()).dashboardLink("7310042")).resolves.toBeUndefined();

    m.get.mockRejectedValueOnce(new Error("socket hang up"));
    await expect((await scanner()).dashboardLink("7310042")).resolves.toBeUndefined();
  });
});
