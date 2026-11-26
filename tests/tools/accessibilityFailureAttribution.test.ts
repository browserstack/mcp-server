import { describe, expect, it } from "vitest";
import { withUpstreamScope } from "../../src/lib/upstream-status.js";
import { attributeScanFailure } from "../../src/tools/accessiblity-utils/report-answers.js";

// A failed run comes back as a 200 with the reason in prose, so without this the row
// was an unexplained failure counted against MCP, whatever the scanner actually said.

function attributed(details: Parameters<typeof attributeScanFailure>[0]) {
  const scope: Record<string, unknown> = {};
  withUpstreamScope(scope, () => attributeScanFailure(details));
  return scope;
}

const page = (reason: string) => ({
  pageUrl: "https://site.example/",
  status: "failure",
  reason,
});

describe("attributeScanFailure", () => {
  it("files a plan's fair-usage refusal as the caller's, blocked", () => {
    expect(
      attributed({
        reason: "Fair usage limit reached for your plan",
        pages: [],
      }),
    ).toEqual({ callerFault: true, blocked: true });
  });

  it("files the scanner's own fault as upstream", () => {
    expect(attributed({ reason: "Something went wrong", pages: [] })).toEqual({
      upstreamFault: true,
    });
  });

  it("files a page the scanner could not reach as the caller's site", () => {
    expect(
      attributed({ reason: "The requested page is not reachable", pages: [] }),
    ).toEqual({ callerFault: true });
    expect(attributed({ pages: [page("[HTTP 403] Forbidden")] })).toEqual({
      callerFault: true,
    });
  });

  it("lets the run's own reason decide over its pages' lines", () => {
    expect(
      attributed({
        reason: "The requested page is not reachable",
        pages: [page("Failed to start the test")],
      }),
    ).toEqual({ callerFault: true });
  });

  it("records nothing when the API gave no reason at all", () => {
    expect(attributed({ pages: [] })).toEqual({});
    expect(attributed({ reason: "  ", pages: [page("")] })).toEqual({});
  });
});
