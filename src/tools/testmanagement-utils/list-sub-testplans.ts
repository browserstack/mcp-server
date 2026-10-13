import { encodePathSegment } from "../../lib/url-path.js";
import { apiClient } from "../../lib/apiClient.js";
import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { formatAxiosError } from "../../lib/error.js";
import { getBrowserStackAuth } from "../../lib/get-auth.js";
import { BrowserStackConfig } from "../../lib/types.js";
import { getTMBaseURL } from "../../lib/tm-base-url.js";

/**
 * Schema for listing sub-test-plans under a parent test plan in a BrowserStack
 * Test Management project.
 */
export const ListSubTestPlansSchema = z.object({
  project_identifier: z.string().describe("Project identifier (PR-*)."),
  parent_test_plan_identifier: z
    .string()
    .describe("Parent test plan identifier (TP-*)."),
  p: z.number().optional().describe("Page number."),
});

export type ListSubTestPlansArgs = z.infer<typeof ListSubTestPlansSchema>;

interface SubTestPlanListItem {
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
  tags?: string[];
  issues?: string[];
}

/**
 * Lists sub-test-plans under a parent test plan in BrowserStack Test Management.
 */
export async function listSubTestPlans(
  args: ListSubTestPlansArgs,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  try {
    const params = new URLSearchParams();
    if (args.p !== undefined) params.append("p", args.p.toString());

    const tmBaseUrl = await getTMBaseURL(config);
    const projectId = encodePathSegment(args.project_identifier);
    const parentPlanId = encodePathSegment(args.parent_test_plan_identifier);
    const url = `${tmBaseUrl}/api/v2/projects/${projectId}/test-plans/${parentPlanId}/sub-test-plans?${params.toString()}`;

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
            text: `Failed to list sub-test-plans: ${JSON.stringify(data)}`,
          },
        ],
        isError: true,
      };
    }

    const plans: SubTestPlanListItem[] = data.sub_test_plans ?? [];
    const info = data.info ?? {};
    const count = info.count ?? plans.length;

    if (plans.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `No sub-test-plans found under ${args.parent_test_plan_identifier} in project ${args.project_identifier}.`,
          },
        ],
      };
    }

    const summary = plans
      .map((p) => {
        const tagsSegment =
          Array.isArray(p.tags) && p.tags.length > 0
            ? ` — tags: [${p.tags.join(", ")}]`
            : "";
        return `• ${p.identifier}: ${p.name} [${p.active_state}] — ${p.test_runs_count?.active ?? 0} active / ${p.test_runs_count?.closed ?? 0} closed run(s)${tagsSegment}`;
      })
      .join("\n");

    return {
      content: [
        {
          type: "text",
          text: `Found ${count} sub-test-plan(s) under ${args.parent_test_plan_identifier} in project ${args.project_identifier}:\n\n${summary}`,
        },
        { type: "text", text: JSON.stringify(plans, null, 2) },
      ],
    };
  } catch (err) {
    return formatAxiosError(err, "Failed to list sub-test-plans");
  }
}
