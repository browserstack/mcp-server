import type { ToolSpec } from "../harness/cases.js";
import { EU_HOST } from "../harness/cases.js";

/** Any Test Management host (US, EU, IN), so a stub serves the region case too. */
const TM = String.raw`https://test-management(-eu|-in)?\.browserstack\.com`;
const tm = (path: string) => new RegExp(`^${TM}${path}(\\?.*)?$`);

/** The US probe of getTMBaseURL: the first host that answers 200 is used. */
const TM_PROBE = { method: "GET", url: tm("/api/v2/projects/") } as const;

export const testManagementSpecs: ToolSpec[] = [
  {
    tool: "listTestCases",
    args: { project_identifier: "PR-1" },
    http: [
      TM_PROBE,
      {
        method: "GET",
        url: tm("/api/v2/projects/PR-1/test-cases"),
        body: {
          success: true,
          info: { count: 1 },
          test_cases: [
            {
              identifier: "TC-1",
              title: "Remote title 7c1",
              case_type: "Functional",
              priority: "High",
            },
          ],
        },
      },
    ],
    happy: {
      isError: false,
      textMatches: [/Found 1 test case/],
      untrusted: ["Remote title 7c1"],
      calls: [{ method: "GET", url: tm("/api/v2/projects/PR-1/test-cases") }],
    },
    region: { hosts: [EU_HOST] },
  },
];
