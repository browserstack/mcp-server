import { apiClient } from "../../lib/apiClient.js";
import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { formatAxiosError } from "../../lib/error.js";
import { getBrowserStackAuth } from "../../lib/get-auth.js";
import { BrowserStackConfig } from "../../lib/types.js";
import { getTMBaseURL } from "../../lib/tm-base-url.js";

/**
 * Schema for fetching a single test plan by identifier, including its linked test runs.
 */
export const GetTestPlanSchema = z.object({
  project_identifier: z
    .string()
    .describe(
      "Identifier of the project (starts with PR- followed by a number).",
    ),
  test_plan_identifier: z
    .string()
    .describe(
      "Identifier of the test plan (starts with TP- followed by a number).",
    ),
});

export type GetTestPlanArgs = z.infer<typeof GetTestPlanSchema>;

interface TestPlan {
  identifier: string;
  name: string;
  active_state: string;
  description: string | null;
  project_id: string;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
  test_runs_count?: { active: number; closed: number };
  test_runs?: Array<{ identifier: string; name: string }>;
  links?: Record<string, string>;
}

interface LinkedTestRun {
  identifier: string;
  name: string;
  run_state: string;
  active_state: string;
  assignee?: string | null;
  description?: string | null;
  created_at: string;
  project_id: string;
  test_cases_count: number;
}

/**
 * Fetches a test plan by identifier and its linked test runs, returning a unified view
 * suitable for generating documentation (metadata + linked runs + status summary + case count).
 */
export async function getTestPlan(
  args: GetTestPlanArgs,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  try {
    const tmBaseUrl = await getTMBaseURL(config);
    const projectId = encodeURIComponent(args.project_identifier);
    const planId = encodeURIComponent(args.test_plan_identifier);

    const authString = getBrowserStackAuth(config);
    const [username, password] = authString.split(":");
    const authHeader =
      "Basic " + Buffer.from(`${username}:${password}`).toString("base64");

    const planResp = await apiClient.get({
      url: `${tmBaseUrl}/api/v2/projects/${projectId}/test-plans/${planId}`,
      headers: { Authorization: authHeader },
    });

    if (!planResp.data?.success) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to fetch test plan: ${JSON.stringify(planResp.data)}`,
          },
        ],
        isError: true,
      };
    }

    const plan: TestPlan = planResp.data.test_plan;

    const runsResp = await apiClient.get({
      url: `${tmBaseUrl}/api/v2/projects/${projectId}/test-plans/${planId}/test-runs`,
      headers: { Authorization: authHeader },
    });

    const runs: LinkedTestRun[] = runsResp.data?.success
      ? (runsResp.data.test_runs ?? [])
      : [];

    const statusSummary: Record<string, number> = {};
    let totalCases = 0;
    for (const run of runs) {
      statusSummary[run.run_state] = (statusSummary[run.run_state] ?? 0) + 1;
      totalCases += run.test_cases_count ?? 0;
    }

    const header = [
      `Test Plan ${plan.identifier}: ${plan.name}`,
      `Status: ${plan.active_state}`,
      plan.description ? `Description: ${plan.description}` : null,
      plan.start_date || plan.end_date
        ? `Dates: ${plan.start_date ?? "—"} → ${plan.end_date ?? "—"}`
        : null,
      `Linked runs: ${runs.length} (plan counts — active ${plan.test_runs_count?.active ?? 0} / closed ${plan.test_runs_count?.closed ?? 0})`,
      `Total test cases across runs: ${totalCases}`,
      Object.keys(statusSummary).length > 0
        ? `Run-state breakdown: ${Object.entries(statusSummary)
            .map(([s, n]) => `${s}=${n}`)
            .join(", ")}`
        : null,
    ]
      .filter(Boolean)
      .join("\n");

    const runsBlock = runs.length
      ? "\n\nLinked test runs:\n" +
        runs
          .map(
            (r) =>
              `• ${r.identifier}: ${r.name} [${r.run_state}] — ${r.test_cases_count} case(s)${r.assignee ? ` (assignee: ${r.assignee})` : ""}`,
          )
          .join("\n")
      : "\n\nNo test runs linked to this plan.";

    return {
      content: [
        { type: "text", text: header + runsBlock },
        {
          type: "text",
          text: JSON.stringify(
            {
              test_plan: plan,
              linked_test_runs: runs,
              status_summary: statusSummary,
              total_test_cases: totalCases,
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (err) {
    return formatAxiosError(err, "Failed to fetch test plan");
  }
}
