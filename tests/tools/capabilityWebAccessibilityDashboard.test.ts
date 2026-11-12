import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { ambiguousProducts } from "../../src/tools/capability-registry/search.js";
import { authHeaders } from "../../src/tools/capability-registry/egress.js";
import type { TokenTransport } from "../../src/lib/central-oauth.js";

// The Accessibility dashboard's own routes read only a browser session or a central-auth
// Bearer carrying the `ai_agent` scope, and for that scope only the routes on the backend's
// allowlist (SCOPED_BEARER_SCOPE_POLICIES in browserstack/accessibility). Basic auth is never
// read there. They live in the Web Accessibility product, each declaring `host: dashboard`
// and `auth: oauth2`: as a second product, the router made users choose between two names
// for one product, and a search in one could not find the other's capabilities. What has to
// hold: these capabilities mint while the public-API lists keep Basic, they follow the
// account's region to the DASHBOARD host, their writes are writes, and the words users say
// still reach Web Accessibility.

vi.mock("../../src/logger.js", () => ({
  default: { error: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));

const DIR = new URL("../../capability/", import.meta.url);

function shipped(): Record<string, any> {
  const products: Record<string, any> = {};
  for (const file of readdirSync(fileURLToPath(DIR))) {
    if (!file.endsWith(".capability-index.json")) continue;
    const raw = JSON.parse(
      readFileSync(fileURLToPath(new URL(file, DIR)), "utf8"),
    );
    const [name] = Object.keys(raw).filter(
      (k) => !["schema_version", "version", "build_id"].includes(k),
    );
    products[name] = raw[name];
  }
  return products;
}

const products = shipped();
const web = products.web_accessibility;
const dash = web.capabilities.filter((c: any) => c.host === "dashboard");
const byName = (name: string) =>
  web.capabilities.find((c: any) => c.name === name);

describe("the Web Accessibility dashboard capabilities", () => {
  it("are part of Web Accessibility, not a product of their own", () => {
    expect(products.web_accessibility_dashboard).toBeUndefined();
    expect(dash.length).toBe(44);
    expect(web.hosts.dashboard).toBe("https://accessibility.browserstack.com");
  });

  it("sign in with a minted token while the public-API lists keep Basic", () => {
    expect(web.auth).toEqual({ type: "http", scheme: "basic" });
    for (const c of dash) expect(c.auth, c.name).toEqual({ type: "oauth2" });
    for (const c of web.capabilities.filter((c: any) => !c.host)) {
      expect(c.auth, c.name).toBeUndefined();
    }
  });

  it("ship one capability per method and path, each on an entity that names it", () => {
    const routes = web.capabilities.map(
      (c: any) => `${c.host ?? "api"} ${c.method} ${c.path}`,
    );
    expect(new Set(routes).size).toBe(routes.length);
    for (const c of web.capabilities) {
      expect(web.entities[c.entity].capabilities).toContain(c.name);
    }
    for (const entity of Object.values<any>(web.entities)) {
      expect(entity.description.length).toBeLessThanOrEqual(140);
    }
    expect(web.summary.length).toBeLessThanOrEqual(900);
  });

  it("mark every route that changes data as a write, so it needs approval", () => {
    const writes = web.capabilities
      .filter((c: any) => c.mode !== "read")
      .map((c: any) => c.name)
      .sort();
    expect(writes).toEqual([
      "bulk_hide_issue_components",
      "hide_issues",
      "link_ticket_to_issue",
      "rerun_website_scanner_scan",
      "review_needs_review_issue",
      "submit_bulk_review_decisions",
      "undo_bulk_review_decisions",
    ]);
    for (const c of dash) {
      if (c.method === "PATCH") expect(c.mode).not.toBe("read");
    }
  });

  it("leave out what is served elsewhere or cannot be redacted", () => {
    const paths = dash.map((c: any) => `${c.method} ${c.path}`);
    // Saved login configs come back with raw authData; getAccessibilityAuthConfig strips it,
    // and the registry has no way to strip a response field.
    expect(paths).not.toContain("GET /api/website-scanner/v1/auth_configs");
    // accessibilityExpert, list_website_scanner_scans and startAccessibilityScan cover these.
    expect(paths).not.toContain("POST /api/tcg-proxy/search");
    expect(paths).not.toContain("GET /api/website-scanner/v1/scans");
    expect(paths).not.toContain("POST /api/website-scanner/v1/scans");
  });

  it("name only capabilities that exist", () => {
    // A guidance line naming a capability that is not there sends the agent to a dead end,
    // or worse to another product's capability of that name (tm has list_test_runs).
    const own = new Set(web.capabilities.map((c: any) => c.name));
    const text = JSON.stringify(web.capabilities);
    const referenced = text.match(
      /\b(?:list|get|search|rerun|submit|undo|link|check)_[a-z]+(?:_[a-z]+)+\b/g,
    );
    for (const name of new Set(referenced)) {
      expect(own.has(name), name).toBe(true);
    }
  });

  it("declare no object-typed query parameter, which cannot reach the wire", () => {
    // fetchTransport sends a query value with String(value), so an object goes out as
    // "[object Object]" and the backend answers 422. A Rails nested filter is declared as
    // flat bracket-named strings instead (filter[impact], filter[status], ...), which
    // bind.ts matches by exact name and the backend parses back into a hash.
    for (const c of web.capabilities) {
      for (const q of c.query ?? []) {
        expect(q.type, `${c.name}.${q.name}`).not.toBe("object");
      }
    }
    const filters = byName("get_workflow_analyzer_consolidated_report")
      .query.map((q: any) => q.name)
      .filter((n: string) => n.startsWith("filter["));
    expect(filters).toEqual(
      expect.arrayContaining(["filter[impact]", "filter[status]"]),
    );
  });

  it("do not offer an undo that the backend cannot perform", () => {
    // Sending hidden=false without confirmed after "Not an issue" leaves the issue
    // confirmed=false and visible: it drops out of the report and the counts drift.
    const guidance = byName("review_needs_review_issue").guidance.join(" ");
    expect(guidance).not.toMatch(/confirmed omitted \(back to pending\)/);
    expect(guidance).toMatch(/undo_bulk_review_decisions/);
  });

  it("say nodeFields replaces the default node fields, so issueId is kept on purpose", () => {
    // Described as "extra" fields, an agent asked for html,failureSummary, got nodes with no
    // issueId, and could not mark a Workflow Analyzer finding: the backend replaces the
    // defaults (ConsolidateViewService: node_fields.presence || DEFAULT).
    const nodeFields = byName("get_workflow_analyzer_consolidated_report").query.find(
      (q: any) => q.name === "nodeFields",
    );
    expect(nodeFields.description).toMatch(/INSTEAD of the defaults/);
    expect(nodeFields.description).not.toMatch(/extra node fields/);
    expect(nodeFields.example).toMatch(/issueId/);
  });

  it("say a scan run's null issue count is unknown, not zero", () => {
    // Read as zero, "which run found issues" was answered "none" for a scan whose trends
    // show a run with 306.
    expect(
      byName("list_website_scanner_scan_runs").guidance.join(" "),
    ).toMatch(/null means not recorded here, not zero/);
    expect(byName("get_website_scanner_scan_trends").intent).toMatch(
      /every completed run/,
    );
  });

  it("tell an agent why a refused route is refused", () => {
    expect(web.responses.DashboardScopeNotAllowed.description).toMatch(
      /ACTION_NOT_ALLOWED_FOR_SCOPE/,
    );
    expect(byName("hide_issues").responses["403"]).toBeDefined();
  });
});

describe("minting for the dashboard", () => {
  it("sends a Bearer minted with the ai_agent scope, never Basic", async () => {
    const forms: Record<string, string>[] = [];
    const transport: TokenTransport = async (_url, form) => {
      forms.push(form);
      return {
        status: 200,
        body: { access_token: "minted-dashboard", expires_in: 3600 },
      };
    };
    const headers = await authHeaders(
      { username: "dash_user_unique", accessKey: "SECRET" },
      byName("list_custom_dashboards").auth,
      "web_accessibility",
      transport,
    );
    expect(headers.Authorization).toBe("Bearer minted-dashboard");
    expect(headers["request-source"]).toBe("ai-chatbot");
    expect(forms[0].scope.split(" ")).toEqual(
      expect.arrayContaining(["ai_agent", "oauth_user_profile"]),
    );
  });

  it("uses the capability's own auth over the product's, and the product's otherwise", async () => {
    // Proven with an apiKey scheme so no token is minted (no network in a unit test); the
    // oauth2 presentation itself is covered by the test above.
    const { invoke } =
      await import("../../src/tools/capability-registry/resolve.js");
    const ownAuth = {
      ...byName("list_custom_dashboards"),
      auth: { type: "apiKey", in: "header", name: "X-Capability-Auth" },
    };
    const sent: Record<string, string>[] = [];
    const transport = async (
      _method: string,
      _url: string,
      headers: Record<string, string>,
    ) => {
      sent.push(headers);
      return { status: 200, body: {} };
    };
    const creds = { username: "dash_invoke_user", accessKey: "SECRET" };
    await invoke(
      ownAuth,
      { path_params: {}, query: {}, body: undefined } as any,
      "https://dashboard.example",
      creds,
      transport,
      web.auth,
      "web_accessibility",
    );
    await invoke(
      byName("list_website_scanner_scans"),
      { path_params: {}, query: {}, body: undefined } as any,
      "https://api.example",
      creds,
      transport,
      web.auth,
      "web_accessibility",
    );
    expect(sent[0]["X-Capability-Auth"]).toBe("dash_invoke_user:SECRET");
    expect(sent[0].Authorization).toBeUndefined();
    expect(sent[1].Authorization).toMatch(/^Basic /);
    expect(sent[1]["X-Capability-Auth"]).toBeUndefined();
  });
});

describe("the dashboard follows the account's region", () => {
  const CONFIG = {
    "browserstack-username": "dash_region_user",
    "browserstack-access-key": "SECRET",
  } as any;
  const OVERRIDE = "CAPABILITY_REGISTRY_BASE_URL_WEB_ACCESSIBILITY_HOST_DASHBOARD";

  async function resolveIn(region: string | undefined, host?: string) {
    const { resolveBaseUrl } =
      await import("../../src/tools/capability-registry/config.js");
    const { withAccountRegion } =
      await import("../../src/lib/region-context.js");
    return withAccountRegion(region as any, () =>
      resolveBaseUrl("web_accessibility", CONFIG, web, undefined, host),
    );
  }

  beforeEach(() => {
    vi.resetModules();
    delete process.env[OVERRIDE];
  });
  afterEach(() => {
    delete process.env[OVERRIDE];
  });

  it.each([
    ["us", "https://accessibility.browserstack.com"],
    ["eu", "https://accessibility-eu.browserstack.com"],
    ["in", "https://accessibility-in.browserstack.com"],
  ])("sends a %s account's dashboard calls to %s", async (region, host) => {
    expect(await resolveIn(region, "dashboard")).toBe(host);
  });

  it("keeps the public-API lists on the API host", async () => {
    expect(await resolveIn("eu")).toBe(
      "https://api-accessibility-eu.browserstack.com",
    );
  });

  it("refuses when the account's region is unknown, instead of guessing", async () => {
    await expect(resolveIn("unknown", "dashboard")).rejects.toThrow(
      /Could not confirm your BrowserStack account's region/,
    );
  });

  it("lets an override reach a non-production dashboard", async () => {
    process.env[OVERRIDE] = "https://accessibility-preprod.bsstag.com";
    expect(await resolveIn("us", "dashboard")).toBe(
      "https://accessibility-preprod.bsstag.com",
    );
  });
});

describe("routing", () => {
  it.each([
    ["Show the accessibility score on my custom dashboard"],
    ["Compare reports for the last two builds"],
    ["Start a bulk review of the issues"],
  ])("routes %j to Web Accessibility", (query) => {
    expect(ambiguousProducts(products, query).settled).toBe(
      "web_accessibility",
    );
  });
});

// A user asked to pick a hide reason was offered invented ones ("Not an issue") because the
// allowed values sit only in describeCapability, and the agent asked before reading it. The
// first guidance line rides on every search row, so it must name the real list, and stay in
// step with the enum.
describe("hide reasons are offered before the contract is read", () => {
  const web = () => shipped().web_accessibility.capabilities as any[];

  it.each(["hide_issues", "bulk_hide_issue_components"])(
    "%s lists every allowed reason in a guidance line",
    (name) => {
      const capability = web().find((c) => c.name === name);
      const reasons: string[] = capability.body.find((p: any) => p.name === "reason").values;
      const line = (capability.guidance as string[]).find((g) => g.includes("offering exactly these"));
      expect(line).toBeDefined();
      for (const reason of reasons) expect(line).toContain(reason);
    },
  );
});
