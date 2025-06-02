import axios from "axios";
import config from "../../config.js";
import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { formatAxiosError } from "../../lib/error.js"; // or correct path
import { projectIdentifierToId } from "../testmanagement-utils/TCG-utils/api.js";

// Schema for combined project/folder creation
export const CreateProjFoldSchema = z.object({
  project_name: z
    .string()
    .optional()
    .describe("Name of the project to create."),
  project_description: z
    .string()
    .optional()
    .describe("Description for the new project."),
  project_identifier: z
    .string()
    .optional()
    .describe("Existing project identifier to use for folder creation."),
  folder_name: z.string().optional().describe("Name of the folder to create."),
  folder_description: z
    .string()
    .optional()
    .describe("Description for the new folder."),
  parent_id: z
    .number()
    .optional()
    .describe("Parent folder ID; if omitted, folder is created at root."),
});

type CreateProjFoldArgs = z.infer<typeof CreateProjFoldSchema>;

/**
 * Creates a project and/or folder in BrowserStack Test Management.
 */
export async function createProjectOrFolder(
  args: CreateProjFoldArgs,
): Promise<CallToolResult> {
  const {
    project_name,
    project_description,
    project_identifier,
    folder_name,
    folder_description,
    parent_id,
  } = CreateProjFoldSchema.parse(args);

  if (!project_name && !project_identifier && !folder_name) {
    throw new Error(
      "Provide project_name (to create project), or project_identifier and folder_name (to create folder).",
    );
  }

  let projId = project_identifier;

  // Step 1: Create project if project_name provided
  if (project_name) {
    try {
      const res = await axios.post(
        "https://test-management.browserstack.com/api/v2/projects",
        { project: { name: project_name, description: project_description } },
        {
          auth: {
            username: config.browserstackUsername,
            password: config.browserstackAccessKey,
          },
          headers: { "Content-Type": "application/json" },
        },
      );

      if (!res.data.success) {
        throw new Error(
          `Failed to create project: ${JSON.stringify(res.data)}`,
        );
      }
      // Project created successfully

      projId = res.data.project.identifier;
    } catch (err) {
      return formatAxiosError(err, "Failed to create project..");
    }
  }
  // Step 2: Create folder if folder_name provided
  if (folder_name) {
    if (!projId)
      throw new Error("Cannot create folder without project_identifier.");
    try {
      const res = await axios.post(
        `https://test-management.browserstack.com/api/v2/projects/${encodeURIComponent(
          projId,
        )}/folders`,
        {
          folder: {
            name: folder_name,
            description: folder_description,
            parent_id,
          },
        },
        {
          auth: {
            username: config.browserstackUsername,
            password: config.browserstackAccessKey,
          },
          headers: { "Content-Type": "application/json" },
        },
      );

      if (!res.data.success) {
        throw new Error(`Failed to create folder: ${JSON.stringify(res.data)}`);
      }
      // Folder created successfully

      const folder = res.data.folder;
      const projectId = await projectIdentifierToId(projId);

      return {
        content: [
          {
            type: "text",
            text: `Folder successfully created:
              - ID: ${folder.id}
              - Name: ${folder.name}
              - Project Identifier: ${projId}
            Access it here: https://test-management.browserstack.com/projects/${projectId}/folder/${folder.id}/`,
          },
        ],
      };
    } catch (err) {
      return formatAxiosError(err, "Failed to create folder.");
    }
  }

  // Only project was created
  return {
    content: [
      { type: "text", text: `Project created with identifier=${projId}` },
    ],
  };
}
