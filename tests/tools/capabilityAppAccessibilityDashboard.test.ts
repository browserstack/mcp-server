import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { authHeaders } from "../../src/tools/capability-registry/egress.js";
import { searchCapabilities } from "../../src/tools/capability-registry/search.js";
import type { TokenTransport } from "../../src/lib/central-oauth.js";

// The App Accessibility dashboard's own routes read the dashboard session cookie, or a
// central-auth Bearer carrying the `ai_agent` scope for the routes on app-accessibility's
// allowlist (SCOPED_BEARER_SCOPE_POLICIES in browserstack/app-accessibility). They live in
// the App Accessibility product with `host: dashboard` and `auth: oauth2`, next to the
// public-API lists that keep Basic. What has to hold: they mint, they reach the regional
// DASHBOARD host, they are reads on the backend's allowlist, and they leave out what
// fetchAccessibilityIssues already serves.

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
const app = products.app_accessibility;
const dash = app.capabilities.filter((c: any) => c.host === "dashboard");
const byName = (name: string) =>
  app.capabilities.find((c: any) => c.name === name);

// Mirror of the ai_agent allowlist in app-accessibility (config/initializers/constants.rb),
// as routes. A capability outside it would answer 403 ACTION_NOT_ALLOWED_FOR_SCOPE.
const BACKEND_ALLOWLIST = new Set([
  "GET /automate/api/v1/project",
  "GET /automate/api/v1/project/{project_id}/build_names",
  "GET /automate/api/v1/project/{project_id}/bundle_ids",
  "GET /automate/api/v1/project/{project_id}/build",
  "GET /automate/api/v1/build/{th_build_id}",
  "GET /automate/api/v1/project/{project_id}/build/{th_build_id}/overview",
  "GET /automate/api/v1/build/{th_build_id}/snapshot",
  "GET /automate/api/v1/build/{th_build_id}/test/{test_case_id}/snapshot",
  "GET /automate/api/v1/build/{th_build_id}/conformance-summary",
  "GET /automate/api/v1/project/{project_id}/build/{th_build_id}/test",
  "GET /automate/api/v1/project/{project_id}/build/{th_build_id}/comparable-builds",
  "GET /automate/api/v1/project/{project_id}/build/{th_build_id}/compare/{base_build_id}",
  "GET /api/v1/user",
  "GET /api/v1/app_scanner",
  "GET /api/v1/app_scanner/total",
  "GET /api/v1/app_scanner/devices",
  "GET /api/v1/app_scanner/{report_id}/meta_data",
  "GET /api/v1/app_scanner/{report_id}/overview",
  "GET /api/v1/app_scanner/{report_id}/snapshot",
  "GET /api/v1/app_scanner/{report_id}/rules",
  "GET /api/v1/app_scanner/{report_id}/wcag_levels",
  "GET /api/v1/app_scanner/{report_id}/conformance-summary",
  "GET /automate/api/v1/screen_reader/project/{project_id}/build",
  "GET /automate/api/v1/screen_reader/build/{th_build_id}",
  "GET /automate/api/v1/screen_reader/project/{project_id}/build/{th_build_id}/overview",
  "GET /automate/api/v1/screen_reader/build/{th_build_id}/snapshot",
  "POST /automate/api/v1/scan/{th_build_id}/hide-issue",
  "POST /automate/api/v1/scan/{th_build_id}/unhide-issue",
  "POST /automate/api/v1/scan/{th_build_id}/get-hide-count",
  "POST /automate/api/v1/scan/{th_build_id}/get-unhide-count",
  "POST /automate/api/v1/build/{th_build_id}/review-issue",
  "POST /api/v1/app_scanner/{report_id}/hide-issue",
  "POST /api/v1/app_scanner/{report_id}/unhide-issue",
  "POST /api/v1/app_scanner/{report_id}/get-hide-count",
  "POST /api/v1/app_scanner/{report_id}/get-unhide-count",
  "POST /api/v1/app_scanner/{report_id}/review-issue",
]);

const WRITES = [
  "hide_app_accessibility_issues",
  "hide_manual_app_accessibility_issues",
  "review_app_accessibility_issue",
  "review_manual_app_accessibility_issue",
  "unhide_app_accessibility_issues",
  "unhide_manual_app_accessibility_issues",
];

describe("the App Accessibility dashboard capabilities", () => {
  it("ship the dashboard reads and issue actions the public API does not serve", () => {
    expect(dash.map((c: any) => c.name).sort()).toEqual([
      "compare_app_accessibility_builds",
      "count_app_accessibility_issues_to_hide",
      "count_app_accessibility_issues_to_unhide",
      "count_manual_app_accessibility_issues_to_hide",
      "count_manual_app_accessibility_issues_to_unhide",
      "count_manual_app_accessibility_reports",
      "get_app_accessibility_build",
      "get_app_accessibility_build_conformance_summary",
      "get_app_accessibility_build_overview",
      "get_app_accessibility_screen_reader_build",
      "get_app_accessibility_screen_reader_build_overview",
      "get_manual_app_accessibility_report",
      "get_manual_app_accessibility_report_conformance_summary",
      "get_manual_app_accessibility_report_overview",
      "hide_app_accessibility_issues",
      "hide_manual_app_accessibility_issues",
      "list_app_accessibility_build_issues",
      "list_app_accessibility_build_names",
      "list_app_accessibility_build_tests",
      "list_app_accessibility_bundle_ids",
      "list_app_accessibility_comparable_builds",
      "list_app_accessibility_screen_reader_build_issues",
      "list_app_accessibility_screen_reader_builds",
      "list_app_accessibility_test_issues",
      "list_app_accessibility_users",
      "list_manual_app_accessibility_devices",
      "list_manual_app_accessibility_report_issues",
      "list_manual_app_accessibility_report_rules",
      "list_manual_app_accessibility_report_wcag_levels",
      "review_app_accessibility_issue",
      "review_manual_app_accessibility_issue",
      "unhide_app_accessibility_issues",
      "unhide_manual_app_accessibility_issues",
    ]);
  });

  it("sign in with a minted token while the public-API lists keep Basic", () => {
    expect(app.auth).toEqual({ type: "http", scheme: "basic" });
    for (const c of dash) expect(c.auth, c.name).toEqual({ type: "oauth2" });
    const publicApi = app.capabilities.filter((c: any) => !c.host);
    expect(publicApi.map((c: any) => c.name).sort()).toEqual([
      "list_app_accessibility_builds",
      "list_app_accessibility_projects",
      "list_manual_app_accessibility_reports",
    ]);
    for (const c of publicApi) expect(c.auth, c.name).toBeUndefined();
  });

  it("stay on the backend's ai_agent allowlist and never delete", () => {
    for (const c of dash) {
      expect(["GET", "POST"], c.name).toContain(c.method);
      expect(BACKEND_ALLOWLIST.has(`${c.method} ${c.path}`), c.name).toBe(true);
    }
  });

  it("mark only hide, unhide and review as writes; the hide counts only read", () => {
    const writes = dash
      .filter((c: any) => c.mode !== "read")
      .map((c: any) => c.name)
      .sort();
    expect(writes).toEqual(WRITES);
    for (const c of dash.filter((c: any) => c.mode !== "read"))
      expect(c.mode, c.name).toBe("write");
    for (const c of dash.filter(
      (c: any) => c.name.startsWith("count_") && c.method === "POST",
    ))
      expect(c.mode, c.name).toBe("read");
  });

  it("never offer a persistent hide, which the backend refuses an agent", () => {
    for (const c of app.capabilities) {
      const names = [...(c.body ?? []), ...(c.query ?? [])].map(
        (p: any) => p.name,
      );
      expect(names, c.name).not.toContain("persistence");
    }
  });

  it("ask for approval before every write, and say how to undo a hide", () => {
    for (const name of WRITES) {
      expect(byName(name).guidance.join(" "), name).toMatch(/APPROVAL FIRST/);
    }
    expect(byName("hide_app_accessibility_issues").guidance.join(" ")).toMatch(
      /unhide_app_accessibility_issues/,
    );
    expect(
      byName("hide_manual_app_accessibility_issues").guidance.join(" "),
    ).toMatch(/unhide_manual_app_accessibility_issues/);
  });

  it("point issue actions at the reads that carry uid and snapshot_id", () => {
    // fetchAccessibilityIssues does not return them, so an agent must read these first.
    expect(byName("hide_app_accessibility_issues").guidance.join(" ")).toMatch(
      /list_app_accessibility_build_issues/,
    );
    expect(
      byName("hide_manual_app_accessibility_issues").guidance.join(" "),
    ).toMatch(/list_manual_app_accessibility_report_issues/);
  });

  it("ship one capability per route, each on an entity that names it", () => {
    const routes = app.capabilities.map(
      (c: any) => `${c.host ?? "api"} ${c.method} ${c.path}`,
    );
    expect(new Set(routes).size).toBe(routes.length);
    for (const c of app.capabilities) {
      expect(app.entities[c.entity]?.capabilities, c.name).toContain(c.name);
    }
    for (const entity of Object.values<any>(app.entities)) {
      expect(entity.description.length).toBeLessThanOrEqual(140);
    }
    expect(app.summary.length).toBeLessThanOrEqual(900);
  });

  it("declare every path parameter the path names, and no other", () => {
    for (const c of dash) {
      const inPath = [...c.path.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]);
      const declared = (c.path_params ?? []).map((p: any) => p.name);
      expect(declared.sort(), c.name).toEqual(inPath.sort());
      for (const p of c.path_params ?? [])
        expect(p.required, `${c.name}.${p.name}`).toBe(true);
    }
  });

  it("leave out what the public-API lists already serve", () => {
    const paths = dash.map((c: any) => c.path);
    expect(paths).not.toContain("/automate/api/v1/project");
    expect(paths).not.toContain("/automate/api/v1/project/{project_id}/build");
    expect(paths).not.toContain("/api/v1/app_scanner");
  });

  it("declare no object-typed query parameter, which cannot reach the wire", () => {
    for (const c of dash) {
      for (const q of c.query ?? []) {
        expect(q.type, `${c.name}.${q.name}`).not.toBe("object");
      }
    }
  });

  it("name only capabilities that exist", () => {
    const own = new Set(app.capabilities.map((c: any) => c.name));
    const text =
      JSON.stringify(app.capabilities) + JSON.stringify(app.entities);
    const referenced = text.match(
      /\b(?:list|get|count|compare|hide|unhide|review)_(?:manual_)?app_accessibility(?:_[a-z]+)*\b/g,
    );
    for (const name of new Set(referenced)) {
      expect(own.has(name), name).toBe(true);
    }
  });

  it("tell an agent why a refused route is refused", () => {
    expect(app.responses.DashboardScopeNotAllowed.description).toMatch(
      /ACTION_NOT_ALLOWED_FOR_SCOPE/,
    );
    for (const c of dash) {
      expect(c.responses?.["401"], c.name).toBeDefined();
      expect(c.responses?.["403"], c.name).toBeDefined();
    }
  });

  it("say a feature the account lacks is refused, not missing", () => {
    // On a group without the feature these answer 404 / 403 with a 'not enabled' message,
    // exactly as the dashboard does.
    expect(
      byName("get_app_accessibility_build_conformance_summary").guidance.join(
        " ",
      ),
    ).toMatch(/not enabled/);
    expect(
      byName("list_app_accessibility_comparable_builds").guidance.join(" "),
    ).toMatch(/not enabled/);
  });
});

describe("minting for the App Accessibility dashboard", () => {
  it("sends a Bearer minted with the ai_agent scope, never Basic", async () => {
    const forms: Record<string, string>[] = [];
    const transport: TokenTransport = async (_url, form) => {
      forms.push(form);
      return {
        status: 200,
        body: { access_token: "minted-app-dashboard", expires_in: 3600 },
      };
    };
    const headers = await authHeaders(
      { username: "app_dash_user_unique", accessKey: "SECRET" },
      byName("get_app_accessibility_build_overview").auth,
      "app_accessibility",
      transport,
    );
    expect(headers.Authorization).toBe("Bearer minted-app-dashboard");
    expect(forms[0].scope.split(" ")).toEqual(
      expect.arrayContaining(["ai_agent", "oauth_user_profile"]),
    );
  });
});

describe("the App Accessibility dashboard follows the account's region", () => {
  const CONFIG = {
    "browserstack-username": "app_dash_region_user",
    "browserstack-access-key": "SECRET",
  } as any;
  const OVERRIDE =
    "CAPABILITY_REGISTRY_BASE_URL_APP_ACCESSIBILITY_HOST_DASHBOARD";
  const PRODUCT_OVERRIDE = "CAPABILITY_REGISTRY_BASE_URL_APP_ACCESSIBILITY";

  async function resolveIn(region: string | undefined, host?: string) {
    const { resolveBaseUrl } =
      await import("../../src/tools/capability-registry/config.js");
    const { withAccountRegion } =
      await import("../../src/lib/region-context.js");
    return withAccountRegion(region as any, () =>
      resolveBaseUrl("app_accessibility", CONFIG, app, undefined, host),
    );
  }

  beforeEach(() => {
    vi.resetModules();
    delete process.env[OVERRIDE];
    delete process.env[PRODUCT_OVERRIDE];
  });
  afterEach(() => {
    delete process.env[OVERRIDE];
    delete process.env[PRODUCT_OVERRIDE];
  });

  it.each([
    ["us", "https://app-accessibility.browserstack.com"],
    ["eu", "https://app-accessibility-eu.browserstack.com"],
    ["in", "https://app-accessibility-in.browserstack.com"],
  ])("sends a %s account's dashboard calls to %s", async (region, host) => {
    expect(await resolveIn(region, "dashboard")).toBe(host);
  });

  it("keeps the public-API lists on the API host", async () => {
    expect(await resolveIn("eu")).toBe(
      "https://api-app-accessibility-eu.browserstack.com",
    );
  });

  it("refuses when the account's region is unknown, instead of guessing", async () => {
    await expect(resolveIn("unknown", "dashboard")).rejects.toThrow(
      /Could not confirm your BrowserStack account's region/,
    );
  });

  // A lower-env session that overrides only the product host must not send its dashboard
  // calls to production.
  it("refuses the dashboard host when only the product host is overridden", async () => {
    process.env[PRODUCT_OVERRIDE] =
      "https://app-accessibility-rengg-regression-accessibility.bsstag.com";
    await expect(resolveIn("us", "dashboard")).rejects.toThrow(
      /overrides product 'app_accessibility', but not its 'dashboard' host/,
    );
  });

  it("lets an override reach a non-production dashboard", async () => {
    process.env[OVERRIDE] =
      "https://app-accessibility-rengg-regression-accessibility.bsstag.com";
    expect(await resolveIn("us", "dashboard")).toBe(
      "https://app-accessibility-rengg-regression-accessibility.bsstag.com",
    );
  });
});

describe("finding the dashboard reads", () => {
  it.each([
    [
      "overview of an app accessibility build",
      "get_app_accessibility_build_overview",
    ],
    [
      "list the tests in an app accessibility build",
      "list_app_accessibility_build_tests",
    ],
    [
      "compare two app accessibility builds",
      "compare_app_accessibility_builds",
    ],
    [
      "wcag conformance summary of an app accessibility build",
      "get_app_accessibility_build_conformance_summary",
    ],
    [
      "issue counts by rule for a manual app accessibility report",
      "list_manual_app_accessibility_report_rules",
    ],
    [
      "hide an issue in an app accessibility build",
      "hide_app_accessibility_issues",
    ],
    [
      "mark a needs review issue in a manual app accessibility report as not an issue",
      "review_manual_app_accessibility_issue",
    ],
    [
      "list screen reader automation builds of an app accessibility project",
      "list_app_accessibility_screen_reader_builds",
    ],
  ])("finds %j as %s", (query, expected) => {
    const { hits } = searchCapabilities(products, query, {
      product: "app_accessibility",
    });
    expect(hits.slice(0, 3).map((h: any) => h.capability.name)).toContain(
      expected,
    );
  });
});
