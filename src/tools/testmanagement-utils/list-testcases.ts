import axios from "axios";
import config from "../../config";
import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { formatAxiosError } from "../../lib/error";

/**
 * Schema for listing test cases with optional filters.
 */
export const ListTestCasesSchema = z.object({
  project_identifier: z
    .string()
    .describe(
      "Identifier of the project to fetch test cases from.  Example: PR-12345",
    ),
  folder_id: z
    .string()
    .optional()
    .describe("If provided, only return cases in this folder."),
  case_type: z
    .string()
    .optional()
    .describe(
      "Comma-separated list of case types (e.g. functional,regression).",
    ),
  priority: z
    .string()
    .optional()
    .describe("Comma-separated list of priorities (e.g. critical,medium,low)."),

  p: z.number().optional().describe("Page number."),
});

export type ListTestCasesArgs = z.infer<typeof ListTestCasesSchema>;

/**
 * Calls BrowserStack Test Management to list test cases with filters.
 */
export async function listTestCases(
  args: ListTestCasesArgs,
): Promise<CallToolResult> {
  try {
    // Build query string
    const params = new URLSearchParams();
    if (args.folder_id) params.append("folder_id", args.folder_id);
    if (args.case_type) params.append("case_type", args.case_type);
    if (args.priority) params.append("priority", args.priority);
    if (args.p !== undefined) params.append("p", args.p.toString());

    const url = `https://test-management.browserstack.com/api/v2/projects/${encodeURIComponent(
      args.project_identifier,
    )}/test-cases?${params.toString()}`;

    const resp = await axios.get(url, {
      auth: {
        username: config.browserstackUsername,
        password: config.browserstackAccessKey,
      },
    });

    const resp_data = resp.data;
    if (!resp_data.success) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to list test cases: ${JSON.stringify(resp_data)}`,
            isError: true,
          },
        ],
        isError: true,
      };
    }

    const { test_cases, info } = resp_data;
    const count = info?.count ?? test_cases.length;

    // Summary for more focused output
    const summary = test_cases
      .map(
        (tc: any) =>
          `• ${tc.identifier}: ${tc.title} [${tc.case_type} | ${tc.priority}]`,
      )
      .join("\n");

    return {
      content: [
        {
          type: "text",
          text: `Found ${count} test case(s):\n\n${summary}`,
        },
        {
          type: "text",
          text: JSON.stringify(test_cases, null, 2),
        },
      ],
    };
  } catch (err) {
    return formatAxiosError(err, "Failed to list test cases");
  }
}
