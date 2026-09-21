import { apiClient } from "../../lib/apiClient.js";
import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { formatAxiosError } from "../../lib/error.js";
import { getBrowserStackAuth } from "../../lib/get-auth.js";
import { BrowserStackConfig } from "../../lib/types.js";
import { getTMBaseURL } from "../../lib/tm-base-url.js";
import { wrapUntrusted } from "../../lib/untrusted-content.js";

/**
 * Schema for fetching a single sub-test-plan by identifier under a parent test
 * plan, including its linked test runs.
 */
export const GetSubTestPlanSchema = z.object({
  project_identifier: z.string().describe("Project identifier (PR-*)."),
  parent_test_plan_identifier: z
    .string()
    .describe("Parent test plan identifier (TP-*)."),
  sub_test_plan_identifier: z
    .string()
    .describe("Sub-test-plan identifier (STP-*)."),
});

export type GetSubTestPlanArgs = z.infer<typeof GetSubTestPlanSchema>;

interface SubTestPlan {
  identifier: string;
  name: string;
  active_state: string;
  description: string | null;
  project_id: string;
  parent_plan_id: string;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
  test_runs_count?: { active: number; closed: number };
  test_runs?: Array<{ identifier: string; name: string }>;
  links?: Record<string, string>;
  tags?: string[];
  issues?: string[] | null;
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

// Validates host parity with the TM base URL to prevent SSRF if `links.test_runs`
// ever resolves to an absolute URL pointing elsewhere.
//
// The constructed fallback uses the flat shape `/test-plans/{STP}/test-runs`
// (not nested under the parent) because that is the form the v2 API itself
// returns in `sub_test_plan.links.test_runs`. The parent identifier deliberately
// does NOT appear in this URL.
function resolveEnrichmentUrl(
  linksTestRuns: string | undefined,
  tmBaseUrl: string,
  projectId: string,
  subPlanId: string,
): string {
  if (typeof linksTestRuns === "string" && linksTestRuns.length > 0) {
    if (linksTestRuns.startsWith("/")) {
      // Relative path — safe to join under tmBaseUrl.
      return `${tmBaseUrl}${linksTestRuns}`;
    }
    if (
      linksTestRuns.startsWith("http://") ||
      linksTestRuns.startsWith("https://")
    ) {
      try {
        const linkUrl = new URL(linksTestRuns);
        const baseUrl = new URL(tmBaseUrl);
        if (linkUrl.host === baseUrl.host) {
          return linksTestRuns;
        }
      } catch {
        // Fall through to constructed fallback.
      }
    }
  }
  return `${tmBaseUrl}/api/v2/projects/${projectId}/test-plans/${subPlanId}/test-runs`;
}

/**
 * Fetches a sub-test-plan by identifier and best-effort-enriches it with its
 * linked test runs. The enrichment call is fail-soft: any failure (thrown
 * AxiosError or non-success response) is swallowed into an empty runs list
 * without flipping `isError` on the primary response.
 */
export async function getSubTestPlan(
  args: GetSubTestPlanArgs,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  try {
    const tmBaseUrl = await getTMBaseURL(config);
    const projectId = encodeURIComponent(args.project_identifier);
    const parentPlanId = encodeURIComponent(args.parent_test_plan_identifier);
    const subPlanId = encodeURIComponent(args.sub_test_plan_identifier);

    const authString = getBrowserStackAuth(config);
    const [username, password] = authString.split(":");
    const authHeader =
      "Basic " + Buffer.from(`${username}:${password}`).toString("base64");

    const planResp = await apiClient.get({
      url: `${tmBaseUrl}/api/v2/projects/${projectId}/test-plans/${parentPlanId}/sub-test-plans/${subPlanId}`,
      headers: { Authorization: authHeader },
    });

    if (!planResp.data?.success) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to fetch sub-test-plan: ${JSON.stringify(planResp.data)}`,
          },
        ],
        isError: true,
      };
    }

    const plan: SubTestPlan = planResp.data.sub_test_plan;

    const enrichmentUrl = resolveEnrichmentUrl(
      plan.links?.test_runs,
      tmBaseUrl,
      projectId,
      subPlanId,
    );

    let runs: LinkedTestRun[] = [];
    try {
      const runsResp = await apiClient.get({
        url: enrichmentUrl,
        headers: { Authorization: authHeader },
      });
      if (runsResp.data?.success) {
        runs = runsResp.data.test_runs ?? [];
      }
    } catch {
      // Enrichment is best-effort — leave runs empty.
    }

    const statusSummary: Record<string, number> = {};
    let totalCases = 0;
    for (const run of runs) {
      statusSummary[run.run_state] = (statusSummary[run.run_state] ?? 0) + 1;
      totalCases += run.test_cases_count ?? 0;
    }

    const tagsLine =
      Array.isArray(plan.tags) && plan.tags.length > 0
        ? `Tags: ${plan.tags.join(", ")}`
        : null;
    const issuesLine =
      Array.isArray(plan.issues) && plan.issues.length > 0
        ? `Issues: ${plan.issues.join(", ")}`
        : null;

    const header = [
      `Sub-Test-Plan ${plan.identifier}: ${plan.name}`,
      `Parent plan: ${plan.parent_plan_id}`,
      `Status: ${plan.active_state}`,
      plan.description
        ? `Description:\n${wrapUntrusted("sub-test-plan description", plan.description)}`
        : null,
      tagsLine,
      issuesLine,
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
      : "\n\nNo test runs linked to this sub-plan.";

    return {
      content: [
        { type: "text", text: header + runsBlock },
        {
          type: "text",
          text: JSON.stringify(
            {
              sub_test_plan: plan,
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
    return formatAxiosError(err, "Failed to fetch sub-test-plan");
  }
}
