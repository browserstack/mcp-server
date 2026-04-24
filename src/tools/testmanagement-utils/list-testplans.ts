import { apiClient } from "../../lib/apiClient.js";
import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { formatAxiosError } from "../../lib/error.js";
import { getBrowserStackAuth } from "../../lib/get-auth.js";
import { BrowserStackConfig } from "../../lib/types.js";
import { getTMBaseURL } from "../../lib/tm-base-url.js";

/**
 * Schema for listing test plans in a BrowserStack Test Management project.
 */
export const ListTestPlansSchema = z.object({
  project_identifier: z
    .string()
    .describe(
      "Identifier of the project to fetch test plans from (starts with PR- followed by a number).",
    ),
  p: z.number().optional().describe("Page number."),
});

export type ListTestPlansArgs = z.infer<typeof ListTestPlansSchema>;

interface TestPlanListItem {
  identifier: string;
  name: string;
  active_state: string;
  description: string | null;
  project_id: string;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
  test_runs_count?: { active: number; closed: number };
}

/**
 * Lists test plans for a project in BrowserStack Test Management.
 */
export async function listTestPlans(
  args: ListTestPlansArgs,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  try {
    const params = new URLSearchParams();
    if (args.p !== undefined) params.append("p", args.p.toString());

    const tmBaseUrl = await getTMBaseURL(config);
    const projectId = encodeURIComponent(args.project_identifier);
    const url = `${tmBaseUrl}/api/v2/projects/${projectId}/test-plans?${params.toString()}`;

    const authString = getBrowserStackAuth(config);
    const [username, password] = authString.split(":");
    const resp = await apiClient.get({
      url,
      headers: {
        Authorization:
          "Basic " + Buffer.from(`${username}:${password}`).toString("base64"),
      },
    });

    const data = resp.data;
    if (!data.success) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to list test plans: ${JSON.stringify(data)}`,
          },
        ],
        isError: true,
      };
    }

    const plans: TestPlanListItem[] = data.test_plans ?? [];
    const info = data.info ?? {};
    const count = info.count ?? plans.length;

    if (plans.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `No test plans found in project ${args.project_identifier}.`,
          },
        ],
      };
    }

    const summary = plans
      .map(
        (p) =>
          `• ${p.identifier}: ${p.name} [${p.active_state}] — ${p.test_runs_count?.active ?? 0} active / ${p.test_runs_count?.closed ?? 0} closed run(s)`,
      )
      .join("\n");

    return {
      content: [
        {
          type: "text",
          text: `Found ${count} test plan(s) in project ${args.project_identifier}:\n\n${summary}`,
        },
        { type: "text", text: JSON.stringify(plans, null, 2) },
      ],
    };
  } catch (err) {
    return formatAxiosError(err, "Failed to list test plans");
  }
}
