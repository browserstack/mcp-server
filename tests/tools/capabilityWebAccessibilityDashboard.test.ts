import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { ambiguousProducts } from "../../src/tools/capability-registry/search.js";
import { authHeaders } from "../../src/tools/capability-registry/egress.js";
import { bind } from "../../src/tools/capability-registry/bind.js";
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
    expect(dash.length).toBe(76);
    // A twin of list_automated_tests_projects that agents picked instead of it, and a UI
    // polling check no natural request reached in isolated agent sessions.
    expect(byName("list_accessibility_projects")).toBeUndefined();
    expect(byName("check_build_list_updates")).toBeUndefined();
    // Pre-2026 link redirects (old report / scan-config ids) are the dashboard's job, not an
    // agent's: kept out so they cannot be picked for a current scan id and answer 404.
    expect(byName("get_legacy_scan_report_build_id")).toBeUndefined();
    expect(byName("get_legacy_scan_config_project_name")).toBeUndefined();
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
      "hide_screen_reader_agent_violation",
      "link_ticket_to_issue",
      "mark_preferred_behavior",
      "rerun_website_scanner_scan",
      "review_needs_review_issue",
      "revoke_false_positive_feedback",
      "start_screen_reader_agent_run",
      "submit_bulk_review_decisions",
      "submit_false_positive_feedback",
      "undo_bulk_review_decisions",
      "unhide_screen_reader_agent_violation",
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

  const PRODUCT_OVERRIDE = "CAPABILITY_REGISTRY_BASE_URL_WEB_ACCESSIBILITY";
  beforeEach(() => {
    vi.resetModules();
    delete process.env[OVERRIDE];
    delete process.env[PRODUCT_OVERRIDE];
  });
  afterEach(() => {
    delete process.env[OVERRIDE];
    delete process.env[PRODUCT_OVERRIDE];
  });

  // An override of the product's host alone used to leave the dashboard on production: a
  // preprod session sent its dashboard calls to prod.
  it("refuses the dashboard host when only the product host is overridden", async () => {
    process.env[PRODUCT_OVERRIDE] = "https://accessibility-preprod.bsstag.com";
    await expect(resolveIn("us", "dashboard")).rejects.toThrow(
      /overrides product 'web_accessibility', but not its 'dashboard' host/,
    );
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

// Asked for "the report link", an agent had no way to build one: the Workflow Analyzer list
// returns no link and nothing described the dashboard's routes, so it fell back to clicking
// through a browser. Every list that returns a report says how to link it, on the first
// guidance line, which rides on each search row.
describe("report lists say how to link a report", () => {
  const web = () => shipped().web_accessibility.capabilities as any[];

  it.each([
    ["list_workflow_analyzer_reports", "/workflow-analyzer/report?ids={id}"],
    ["list_assisted_test_reports", "/assisted-test/report?ar_ids={id}"],
    ["list_accessibility_reports", "/assisted-test/report?ar_ids={id}"],
    ["list_automated_tests_builds", "?thBuildId={id}"],
    ["list_build_report_runs", "/site-scanner/projects/{scan name}/builds?thBuildId={thBuildId}"],
    ["list_website_scanner_scan_runs", "/site-scanner/projects/{scan name}/builds?thBuildId={thBuildId}"],
    ["list_custom_dashboards", "/dashboards/{id}"],
    ["get_report_comparison_summary", "/compare?ids={older thBuildId},{newer thBuildId}"],
  ])("%s links with %s", (name, route) => {
    const first: string = web().find((c) => c.name === name).guidance[0];
    expect(first).toContain("https://accessibility.browserstack.com");
    expect(first).toContain(route);
  });
});

// A dashboard's totals are merged and de-duplicated across its scans by the product. An
// agent that "double-checks" by adding up the underlying reports reports a higher, wrong
// number, so each summary says so on the line that rides on every search row.
describe("custom dashboard summaries are reported as merged", () => {
  it.each([
    "get_custom_dashboard_issue_summary",
    "get_custom_dashboard_category_summary",
    "get_custom_dashboard_score_summary",
  ])("%s says not to add up the underlying reports", (name) => {
    const first: string = byName(name).guidance[0];
    expect(first).toContain("de-duplicate");
    expect(first).toContain("never add up the underlying reports");
  });
});

// Isolated agent sessions wrote on a plain request ("Please confirm it as a real issue",
// "Re-run my scan") in 3 of 6 cases with no approval given. The server cannot see a human
// say yes, so each write leads with the rule, on the line that rides on every search row.
describe("every write asks for an explicit yes first", () => {
  const writes = (shipped().web_accessibility.capabilities as any[]).filter(
    (c) => c.mode === "write" && c.host === "dashboard",
  );

  it("covers all eleven writes", () => expect(writes.length).toBe(11));

  it.each(writes.map((c) => [c.name, c]))("%s leads with the approval rule", (_name, c: any) => {
    expect(c.guidance[0]).toMatch(/^APPROVAL FIRST/);
    expect(c.guidance[0]).toContain("is not that yes");
  });
});

// "the Workflow Analyzer browser extension, web pages" was routed to Device Control, because
// only that product claimed 'web page' and 'website'.
describe("web words no longer route a Web Accessibility user to Device Control", () => {
  it.each([
    ["the Workflow Analyzer browser extension, web pages"],
    ["the accessibility issues on my website"],
  ])("%j does not settle on devicecontrol", (query) => {
    expect(ambiguousProducts(products, query).settled).not.toBe("devicecontrol");
  });

  it("anchors 'browser extension' to Web Accessibility", () => {
    expect(ambiguousProducts(products, "issues from the browser extension").settled).toBe(
      "web_accessibility",
    );
  });
});

describe("rule views point to the WCAG guideline views", () => {
  it.each([
    ["list_build_issues_by_rule", "list_build_issues_by_guideline"],
    ["list_build_rule_components", "list_build_guideline_components"],
  ])("%s names %s first", (name, target) => {
    expect(byName(name).guidance[0]).toContain(target);
  });
});

// Review findings on #570 (validated before fixing).
describe("review fixes", () => {
  const review = () => byName("review_needs_review_issue");

  it("refuses a needs-review call without confirmed, before it is sent", () => {
    expect(() =>
      bind(review(), { path_params: { id: 1 }, body: { test_type: "TestCase", hidden: false } }),
    ).toThrow("missing required parameter(s): confirmed");
    // null is still a value: it puts the issue back to pending.
    expect(
      bind(review(), { path_params: { id: 1 }, body: { test_type: "TestCase", hidden: false, confirmed: null } }).body,
    ).toMatchObject({ confirmed: null });
  });

  it("declares nullable only on body parameters, the only place bind can send a null", () => {
    for (const product of Object.values<any>(products)) {
      for (const c of product.capabilities ?? []) {
        for (const group of ["path_params", "query"]) {
          for (const p of c[group] ?? []) expect(p.nullable, `${c.name}.${p.name}`).toBeUndefined();
        }
      }
    }
  });

  it("filters 'Not an issue' with the backend's own value", () => {
    for (const name of [
      "list_build_issues_by_rule",
      "list_build_issues_by_guideline",
      "list_build_rule_components",
      "list_build_guideline_components",
    ]) {
      const status = [...(byName(name).body ?? []), ...(byName(name).query ?? [])].find(
        (p: any) => p.name === "issue_status",
      );
      expect(status.values, name).toContain("non-issue");
      expect(status.values, name).not.toContain("not_an_issue");
    }
  });

  it.each([
    ["accessibility score of my mobile app", "app_accessibility"],
    ["accessibility score of my website", "web_accessibility"],
  ])("routes %j to %s", (query, product) => {
    expect(ambiguousProducts(products, query).settled).toBe(product);
  });
});
