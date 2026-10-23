import { beforeEach, describe, expect, it, vi } from "vitest";

// A Website Scanner scan can be asked for a WCAG version and level, best practices, "needs
// review" issues and advanced rules: the create-scan API takes them under scanSettings,
// and anything left out takes the API's default.

const m = vi.hoisted(() => ({
  post: vi.fn(),
  startScan: vi.fn(),
  waitUntilComplete: vi.fn(),
  getReportLink: vi.fn(),
  parse: vi.fn(),
}));

vi.mock("../../src/lib/apiClient.js", () => ({ apiClient: { post: m.post } }));
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

  it("sends no scanSettings when none are given", async () => {
    await (await scanner()).startScan("checkout", ["https://shop.example/"]);

    expect(m.post.mock.calls[0][0].body).not.toHaveProperty("scanSettings");
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

  it("passes the requested settings to the scan and says what the scan ran with", async () => {
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
    expect(text(result)).toContain(
      "Scan settings: WCAG 2.2 AAA, best practices on, needs review on (default), advanced rules on (default).",
    );
  });

  it("names the defaults when no setting is asked for", async () => {
    const { run } = await tool();

    const result = await run({ name: "checkout", pageURL: "https://shop.example/" });

    expect(text(result)).toContain(
      "Scan settings: WCAG 2.1 AA (default), best practices off (default), needs review on (default), advanced rules on (default).",
    );
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
