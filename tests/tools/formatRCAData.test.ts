import { describe, it, expect } from "vitest";
import { formatRCAData } from "../../src/tools/rca-agent-utils/format-rca";

describe("formatRCAData", () => {
  it("returns a no-data message when there are no test cases", () => {
    expect(formatRCAData(null)).toBe("No RCA data available.");
    expect(formatRCAData({ testCases: [] })).toBe("No RCA data available.");
  });

  it("labels a suggested fix as a proposal and appends the approval-gate directive", () => {
    const output = formatRCAData({
      testCases: [
        {
          id: 101,
          state: "failed",
          rcaData: {
            rcaData: {
              root_cause: "Selector changed",
              possible_fix: "Update the locator to the new data-testid",
            },
          },
        },
      ],
    });

    // The fix is framed as a proposal, not an instruction to apply.
    expect(output).toContain("Suggested Fix (proposal only");
    expect(output).toContain("do not apply without explicit user approval");

    // The approval-gate directive must be present so consuming agents do not
    // auto-apply code changes.
    expect(output).toContain("Action required");
    expect(output).toContain(
      "apply code changes ONLY after the user explicitly approves",
    );
    expect(output).toContain("Do not modify any files automatically");
  });

  it("omits the approval-gate directive when no fix is suggested", () => {
    const output = formatRCAData({
      testCases: [
        {
          id: 102,
          state: "failed",
          rcaData: {
            rcaData: {
              root_cause: "Network timeout",
            },
          },
        },
      ],
    });

    expect(output).toContain("Network timeout");
    expect(output).not.toContain("Action required");
    expect(output).not.toContain("Suggested Fix");
  });
});
