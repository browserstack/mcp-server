import { apiClient } from "../../lib/apiClient.js";
import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { formatAxiosError } from "../../lib/error.js";
import { getBrowserStackAuth } from "../../lib/get-auth.js";
import { BrowserStackConfig } from "../../lib/types.js";
import { getTMBaseURL } from "../../lib/tm-base-url.js";

/**
 * Schema for listing folders in a BrowserStack Test Management project.
 */
export const ListFoldersSchema = z.object({
  project_identifier: z
    .string()
    .describe(
      "Identifier of the project to fetch folders from (starts with PR- followed by a number).",
    ),
  parent_id: z
    .number()
    .optional()
    .describe(
      "If provided, list sub-folders under this parent folder id. If omitted, lists top-level folders.",
    ),
  p: z.number().optional().describe("Page number."),
});

export type ListFoldersArgs = z.infer<typeof ListFoldersSchema>;

interface FolderResponse {
  id: number;
  name: string;
  description: string | null;
  parent_id: number | null;
  cases_count: number;
  sub_folders_count: number;
}

/**
 * Lists folders (or sub-folders) for a project in BrowserStack Test Management.
 */
export async function listFolders(
  args: ListFoldersArgs,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  try {
    const params = new URLSearchParams();
    if (args.p !== undefined) params.append("p", args.p.toString());

    const tmBaseUrl = await getTMBaseURL(config);
    const projectId = encodeURIComponent(args.project_identifier);

    // GET /api/v2/projects/{projectIdentifier}/folders
    // or  /api/v2/projects/{projectIdentifier}/folders/{parent_id}/sub-folders
    const path =
      args.parent_id !== undefined
        ? `folders/${args.parent_id}/sub-folders`
        : `folders`;
    const url = `${tmBaseUrl}/api/v2/projects/${projectId}/${path}?${params.toString()}`;

    const authString = getBrowserStackAuth(config);
    const [username, password] = authString.split(":");
    const resp = await apiClient.get({
      url,
      headers: {
        Authorization:
          "Basic " + Buffer.from(`${username}:${password}`).toString("base64"),
      },
    });

    const folders: FolderResponse[] = resp.data?.folders ?? [];
    const info = resp.data?.info ?? {};
    const count = info.count ?? folders.length;

    if (folders.length === 0) {
      return {
        content: [
          {
            type: "text",
            text:
              args.parent_id !== undefined
                ? `No sub-folders found under folder ${args.parent_id} in project ${args.project_identifier}.`
                : `No folders found in project ${args.project_identifier}.`,
          },
        ],
      };
    }

    const summary = folders
      .map(
        (f) =>
          `• [id=${f.id}] ${f.name} — ${f.cases_count} case(s), ${f.sub_folders_count} sub-folder(s)${f.parent_id ? ` (parent=${f.parent_id})` : ""}`,
      )
      .join("\n");

    return {
      content: [
        {
          type: "text",
          text: `Found ${count} folder(s) in project ${args.project_identifier}:\n\n${summary}`,
        },
        {
          type: "text",
          text: JSON.stringify(folders, null, 2),
        },
      ],
    };
  } catch (err) {
    return formatAxiosError(err, "Failed to list folders");
  }
}
