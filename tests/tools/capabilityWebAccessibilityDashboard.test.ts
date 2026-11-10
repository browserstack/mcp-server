import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { ambiguousProducts } from "../../src/tools/capability-registry/search.js";
import { authHeaders } from "../../src/tools/capability-registry/egress.js";
import type { TokenTransport } from "../../src/lib/central-oauth.js";

// The Accessibility dashboard's own routes read only a browser session or a central-auth
// Bearer carrying the `ai_agent` scope, and for that scope only the routes on the backend's
// allowlist (SCOPED_BEARER_SCOPE_POLICIES in browserstack/accessibility). Basic auth is never
// read there, so this product is the one that declares oauth2. What has to hold: it mints,
// it follows the account's region to the DASHBOARD host (not the external API host), its
// writes are writes, and its words do not pull Web Accessibility's questions away from it.

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
const dash = products.web_accessibility_dashboard;
const byName = (name: string) =>
  dash.capabilities.find((c: any) => c.name === name);

describe("the Web Accessibility dashboard capability index", () => {
  it("signs in with a minted token, not the access key", () => {
    expect(dash.auth).toEqual({ type: "oauth2" });
    expect(dash.base_url).toBe("https://accessibility.browserstack.com");
  });

  it("ships one capability per method and path, each on an entity that names it", () => {
    const routes = dash.capabilities.map((c: any) => `${c.method} ${c.path}`);
    expect(new Set(routes).size).toBe(routes.length);
    for (const c of dash.capabilities) {
      expect(dash.entities[c.entity].capabilities).toContain(c.name);
      expect(c.intent.length).toBeGreaterThan(0);
    }
    for (const entity of Object.values<any>(dash.entities)) {
      expect(entity.description.length).toBeLessThanOrEqual(140);
    }
    expect(dash.summary.length).toBeLessThanOrEqual(900);
  });

  it("marks every route that changes data as a write, so it needs approval", () => {
    const writes = dash.capabilities
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
    for (const c of dash.capabilities) {
      if (c.method === "PATCH") expect(c.mode).not.toBe("read");
    }
  });

  it("leaves out what is served elsewhere or cannot be redacted", () => {
    const paths = dash.capabilities.map((c: any) => `${c.method} ${c.path}`);
    // Saved login configs come back with raw authData; getAccessibilityAuthConfig strips it,
    // and the registry has no way to strip a response field.
    expect(paths).not.toContain("GET /api/website-scanner/v1/auth_configs");
    // accessibilityExpert, list_website_scanner_scans and startAccessibilityScan cover these.
    expect(paths).not.toContain("POST /api/tcg-proxy/search");
    expect(paths).not.toContain("GET /api/website-scanner/v1/scans");
    expect(paths).not.toContain("POST /api/website-scanner/v1/scans");
  });

  it("names only capabilities that exist, in this product or another", () => {
    // A guidance line naming a capability that is not there sends the agent to a dead end,
    // or worse to another product's capability of that name (tm has list_test_runs).
    const known = new Set(
      Object.values<any>(products).flatMap((p) =>
        (p.capabilities ?? []).map((c: any) => c.name),
      ),
    );
    const own = new Set(dash.capabilities.map((c: any) => c.name));
    const text = JSON.stringify(dash.capabilities);
    const referenced = text.match(
      /\b(?:list|get|search|rerun|submit|undo|link|check)_[a-z]+(?:_[a-z]+)+\b/g,
    );
    for (const name of new Set(referenced)) {
      expect(known.has(name), name).toBe(true);
    }
    expect(
      [...new Set(referenced)].filter((n) => !own.has(n)).sort(),
    ).toEqual(["list_website_scanner_scan_runs", "list_website_scanner_scans"]);
  });

  it("tells an agent why a refused route is refused", () => {
    const responses = dash.responses;
    expect(responses.ScopeNotAllowed.description).toMatch(
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
      dash.auth,
      "web_accessibility_dashboard",
      transport,
    );
    expect(headers.Authorization).toBe("Bearer minted-dashboard");
    expect(headers["request-source"]).toBe("ai-chatbot");
    expect(forms[0].scope.split(" ")).toEqual(
      expect.arrayContaining(["ai_agent", "oauth_user_profile"]),
    );
  });
});

describe("the dashboard follows the account's region", () => {
  const CONFIG = {
    "browserstack-username": "dash_region_user",
    "browserstack-access-key": "SECRET",
  } as any;

  async function resolveIn(region: string | undefined) {
    const { resolveBaseUrl } =
      await import("../../src/tools/capability-registry/config.js");
    const { withAccountRegion } =
      await import("../../src/lib/region-context.js");
    return withAccountRegion(region as any, () =>
      resolveBaseUrl("web_accessibility_dashboard", CONFIG, {
        base_url: dash.base_url,
      }),
    );
  }

  beforeEach(() => {
    vi.resetModules();
    delete process.env.CAPABILITY_REGISTRY_BASE_URL_WEB_ACCESSIBILITY_DASHBOARD;
  });
  afterEach(() => {
    delete process.env.CAPABILITY_REGISTRY_BASE_URL_WEB_ACCESSIBILITY_DASHBOARD;
  });

  it.each([
    ["us", "https://accessibility.browserstack.com"],
    ["eu", "https://accessibility-eu.browserstack.com"],
    ["in", "https://accessibility-in.browserstack.com"],
  ])("sends a %s account to %s", async (region, host) => {
    expect(await resolveIn(region)).toBe(host);
  });

  it("refuses when the account's region is unknown, instead of guessing", async () => {
    await expect(resolveIn("unknown")).rejects.toThrow(
      /Could not confirm your BrowserStack account's region/,
    );
  });

  it("lets an override reach a non-production dashboard", async () => {
    process.env.CAPABILITY_REGISTRY_BASE_URL_WEB_ACCESSIBILITY_DASHBOARD =
      "https://accessibility-preprod.bsstag.com";
    expect(await resolveIn("us")).toBe(
      "https://accessibility-preprod.bsstag.com",
    );
  });
});

describe("routing to the dashboard", () => {
  it.each([
    ["Show the accessibility score on my custom dashboard"],
    ["Compare reports for the last two builds"],
    ["Start a bulk review of the issues"],
  ])("routes %j to the dashboard", (query) => {
    expect(ambiguousProducts(products, query).settled).toBe(
      "web_accessibility_dashboard",
    );
  });
});
