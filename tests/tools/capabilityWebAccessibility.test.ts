import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  ambiguousProducts,
  searchCapabilities,
} from "../../src/tools/capability-registry/search.js";

// Web Accessibility's lists (Workflow Analyzer reports, Website Scanner scans and their runs,
// Automated Tests projects and builds, Assisted Test reports) are reached through the
// capability registry. Without them an agent asked for "the last 3 reports Priya ran" had
// no list to read and handed the question to Ask AI. What has to hold is that each list
// names the id fetchAccessibilityIssues reads, that the parameters the API ignores are not
// offered, and that the words users say reach the right product.

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
const capability = (name: string) =>
  web.capabilities.find((c: any) => c.name === name);
const queryNames = (name: string) =>
  (capability(name).query ?? []).map((q: any) => q.name);

describe("the Web Accessibility capability index", () => {
  it("ships the six lists, as paged reads, each on an entity that names it", () => {
    const names = web.capabilities.map((c: any) => c.name).sort();
    expect(names).toEqual([
      "list_assisted_test_reports",
      "list_automated_tests_builds",
      "list_automated_tests_projects",
      "list_website_scanner_scan_runs",
      "list_website_scanner_scans",
      "list_workflow_analyzer_reports",
    ]);
    for (const c of web.capabilities) {
      expect(c.mode).toBe("read");
      expect(c.paginated).toBe(true);
      expect(c.max_page_size).toBeGreaterThan(0);
      expect(web.entities[c.entity].capabilities).toContain(c.name);
    }
    for (const entity of Object.values<any>(web.entities)) {
      expect(entity.description.length).toBeLessThanOrEqual(140);
    }
    expect(web.summary.length).toBeLessThanOrEqual(900);
  });

  it("caps each page size where paging still works", () => {
    const limit = (name: string) =>
      capability(name).query.find((q: any) => q.name === "limit");
    // 100 returns 30 reports and says there is no next page.
    expect(limit("list_workflow_analyzer_reports").maximum).toBe(99);
    expect(limit("list_assisted_test_reports").maximum).toBe(99);
    // Above 25 the page holds 25 scans and the next one starts past the ones in between.
    expect(limit("list_website_scanner_scans").maximum).toBe(25);
    for (const c of web.capabilities) {
      expect(c.max_page_size).toBe(
        c.query.find((q: any) => q.name === "limit").maximum,
      );
    }
  });

  it("says a changed limit is refused only by the lists that refuse it", () => {
    // All six answer a bad next_page with 422 (InvalidPageToken). Only the Website Scanner
    // lists also answer a changed limit with 422; the Automated Tests lists answer it with
    // 400 (PagingChanged), and the Workflow Analyzer and Assisted Test lists do not check
    // it, so their pages shift instead.
    const invalidToken = web.responses.InvalidPageToken.description;
    expect(invalidToken).toMatch(/Website Scanner lists/);
    expect(invalidToken).not.toMatch(/^[^.]*limit changed/);
    for (const name of [
      "list_automated_tests_projects",
      "list_automated_tests_builds",
    ]) {
      expect(capability(name).responses["400"]).toEqual({
        $response: "PagingChanged",
      });
    }
  });

  it("does not offer the parameters the API ignores", () => {
    // The public docs list these; the handlers never read them, so each would return the
    // whole account's list while looking filtered.
    for (const ignored of ["current_user_id", "team", "page", "page_size"]) {
      expect(queryNames("list_website_scanner_scans")).not.toContain(ignored);
    }
    for (const ignored of ["projectId", "projectName", "project_id"]) {
      expect(queryNames("list_automated_tests_builds")).not.toContain(ignored);
    }
    expect(queryNames("list_automated_tests_builds")).toContain("project_name");
  });

  it("says which field each list hands to fetchAccessibilityIssues", () => {
    const guidance = (name: string) => capability(name).guidance.join(" ");
    expect(guidance("list_workflow_analyzer_reports")).toMatch(
      /workflowReportId/,
    );
    expect(guidance("list_website_scanner_scans")).toMatch(/scanId/);
    expect(guidance("list_website_scanner_scans")).toMatch(/scanRunId/);
    expect(guidance("list_website_scanner_scan_runs")).toMatch(/scanRunId/);
    expect(guidance("list_automated_tests_builds")).toMatch(/buildId/);
    // Assisted Test reports have no issue reader here, and saying so stops a wasted call.
    expect(guidance("list_assisted_test_reports")).toMatch(
      /fetchAccessibilityIssues does not read/,
    );
  });

  it.each([
    ["List my website scanner scans"],
    ["Show the builds of my automated tests project"],
    ["Find the last 3 web workflow analyzer reports Priya ran"],
    ["What did the latest scan run of our website scan find?"],
  ])("routes %j to Web Accessibility", (query) => {
    expect(ambiguousProducts(products, query).settled).toBe(
      "web_accessibility",
    );
  });

  it("asks web or app when only Workflow Analyzer is named, as both products have it", () => {
    const { products: asked } = ambiguousProducts(
      products,
      "last 3 workflow analyzer reports by Priya",
    );
    expect(asked).toEqual(
      expect.arrayContaining(["app_accessibility", "web_accessibility"]),
    );
  });

  it("leaves App Accessibility and Test Reporting questions where they were", () => {
    expect(
      ambiguousProducts(products, "List my App Accessibility reports").settled,
    ).toBe("app_accessibility");
    expect(
      ambiguousProducts(products, "Which tests are flaky in my build?").settled,
    ).toBe("tra");
  });

  it.each([
    ["list workflow analyzer reports", "list_workflow_analyzer_reports"],
    ["list website scanner scans", "list_website_scanner_scans"],
    ["list the runs of a website scanner scan", "list_website_scanner_scan_runs"],
    ["list automated tests projects", "list_automated_tests_projects"],
    ["list the builds of an automated tests project", "list_automated_tests_builds"],
    ["list assisted test reports", "list_assisted_test_reports"],
  ])("finds %j as %s", (query, expected) => {
    const { hits } = searchCapabilities(products, query, {
      product: "web_accessibility",
    });
    expect(hits[0]?.capability.name).toBe(expected);
  });
});
