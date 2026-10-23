import { beforeEach, describe, expect, it, Mock, vi } from "vitest";

// What one app issue carries. The element and what the rule measured on it (a contrast
// issue's ratio and colours, a touch target's size), so a fix can be sized; and, said once
// per page rather than on every issue, each rule's description, WCAG criteria and usual
// fix and each screen's screenshot, which were two thirds of an issue's length.

vi.mock("../../src/lib/apiClient.js", () => ({
  apiClient: { get: vi.fn() },
}));

import { apiClient } from "../../src/lib/apiClient.js";
import { AccessibilityReportFetcher } from "../../src/tools/accessiblity-utils/report-fetcher.js";
import { flattenAppSnapshots } from "../../src/tools/accessiblity-utils/app-report-fetcher.js";

const get = apiClient.get as Mock;
const BUILD_ID = "m3k8p2q7w1x5c9v4b6n0z2r8t3y7u1i5o9a4s2df";
const ok = (body: Record<string, unknown>) => ({
  ok: true,
  status: 200,
  data: { success: true, ...body },
});

const CONTRAST_ISSUE = {
  uid: "u1",
  status: "fail",
  how_to_fix_desc:
    "<document>Adjust the color of the text element or its background.</document>",
  rule_dynamic_meta: {
    font_size: "14.0",
    foreground_color: "#999999",
    background_color: "#FFFFFF",
    current_contrast_ratio: 2.85,
    expected_contrast_ratio: 4.5,
    current_ratio: "2.85:1",
    expected_ratio: "4.5:1",
    framework: "unknown",
    session_start_date: "20261022",
  },
  issue_details: [
    { label: "class", value: '"UILabel"', important: false },
    { label: "visibleText", value: '"Low contrast body copy"', important: false },
    { label: "detectedForegroundColor", value: '"#999999"', important: true },
    { label: "detectedBackgroundColor", value: '"#FFFFFF"', important: true },
    { label: "calculatedColorContrast", value: 2.85, important: true },
    { label: "fontSize", value: '"14.0"', important: true },
  ],
};

const contrastRule = (issues: Record<string, unknown>[]) => ({
  rule_id: "text-color-contrast",
  label: "Text Element Color Contrast (Minimum)",
  description: "Text must have enough contrast against its background.",
  severity: "Serious",
  guidelines: [{ message: "WCAG 2.2-1.4.3 AA" }],
  rule_issues: issues,
});

describe("an app issue's measurements", () => {
  it("carries what the rule measured on the element and what it expects", () => {
    const [row] = flattenAppSnapshots([
      {
        meta: { snapshot_id: "1", screenshot_url: "https://assets.example/s1.jpeg" },
        aggregated_results: [contrastRule([CONTRAST_ISSUE])],
      } as any,
    ]);

    expect(row.measured).toEqual({
      detectedForegroundColor: "#999999",
      detectedBackgroundColor: "#FFFFFF",
      calculatedColorContrast: 2.85,
      fontSize: "14.0",
      expected_ratio: "4.5:1",
    });
  });

  it("has none when the rule measured nothing", () => {
    const [row] = flattenAppSnapshots([
      {
        meta: { snapshot_id: "1" },
        aggregated_results: [
          contrastRule([{ uid: "u2", status: "fail", issue_details: [] }]),
        ],
      } as any,
    ]);

    expect(row).not.toHaveProperty("measured");
  });
});

describe("a page of app issues", () => {
  function fetcher() {
    const f = new AccessibilityReportFetcher();
    f.setAuth({ username: "u", password: "p" });
    return f;
  }

  beforeEach(() => vi.clearAllMocks());

  function serve(snapshots: Record<string, unknown>[]) {
    get.mockImplementation(async ({ url }: { url: string }) => {
      if (url.endsWith(BUILD_ID)) {
        return ok({
          meta_data: {
            build_id: 8,
            th_build_id: BUILD_ID,
            name: "Checkout Build",
            normalised_name: "Checkout+Build",
            project_name: "Checkout App",
            status: "failed",
            issue_summary: { total: 30, scan_count: snapshots.length },
          },
        });
      }
      if (url.includes("/snapshot")) {
        return ok({ data: { details: snapshots, info: { next: null } } });
      }
      return ok({ projects: [] });
    });
  }

  const screen = (n: number, issues: Record<string, unknown>[]) => ({
    meta: {
      snapshot_id: String(n),
      screenshot_url: `https://app-accessibility-assets.example/${"s".repeat(150)}${n}.jpeg`,
      testcase_name: "test_checkout",
    },
    aggregated_results: [contrastRule(issues)],
  });

  it("names each rule's description, WCAG criteria and fix, and each screen's screenshot, once", async () => {
    serve([screen(1, [CONTRAST_ISSUE]), screen(2, [{ ...CONTRAST_ISSUE, uid: "u9" }])]);

    const report = await fetcher().appBuildReport(BUILD_ID);

    expect(report.records).toHaveLength(2);
    for (const record of report.records) {
      expect(record).not.toHaveProperty("issue_description");
      expect(record).not.toHaveProperty("wcag");
      expect(record).not.toHaveProperty("screenshot");
      expect(record).not.toHaveProperty("how_to_fix");
    }
    for (const record of report.records) {
      expect(record).not.toHaveProperty("issue_type");
      // With no id or class, the element is known by its rule, which the record names.
      expect(record).not.toHaveProperty("component");
    }
    expect(report.rules).toEqual({
      "text-color-contrast": {
        issue_type: "Text Element Color Contrast (Minimum)",
        issue_description: "Text must have enough contrast against its background.",
        wcag: "WCAG 2.2-1.4.3 AA",
        how_to_fix: "Adjust the color of the text element or its background.",
      },
    });
    expect(Object.keys(report.screens)).toEqual([
      "Screen 1 (test_checkout)",
      "Screen 2 (test_checkout)",
    ]);
  });

  it("keeps an issue's own fix when it differs from its rule's usual one", async () => {
    serve([
      screen(1, [
        CONTRAST_ISSUE,
        { ...CONTRAST_ISSUE, uid: "u2" },
        { ...CONTRAST_ISSUE, uid: "u3", how_to_fix_desc: "<document>Use a darker grey.</document>" },
      ]),
    ]);

    const report = await fetcher().appBuildReport(BUILD_ID);

    const own = report.records.filter((r) => "how_to_fix" in r);
    expect(own).toHaveLength(1);
    expect(own[0].how_to_fix).toBe("Use a darker grey.");
  });

  it("fits about three times the issues on a page that it did when each issue repeated them", async () => {
    // Measurements are an issue's own; this is about what its rule and screen repeat.
    const plain = { uid: "u", status: "fail", how_to_fix_desc: CONTRAST_ISSUE.how_to_fix_desc, issue_details: [] };
    const thirty = Array.from({ length: 30 }, (_, i) => ({ ...plain, uid: `u${i}` }));
    serve([screen(1, thirty.slice(0, 15)), screen(2, thirty.slice(15))]);

    const report = await fetcher().appBuildReport(BUILD_ID);

    expect(report.page_length).toBe(30);
    expect(report.next_page).toBeNull();
  });
});
