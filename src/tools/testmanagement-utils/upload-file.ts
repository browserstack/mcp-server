import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { apiClient } from "../../lib/apiClient.js";
import FormData from "form-data";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { getBrowserStackAuth } from "../../lib/get-auth.js";
import { signedUrlMap } from "../../lib/inmemory-store.js";
import { projectIdentifierToId } from "./TCG-utils/api.js";
import { BrowserStackConfig } from "../../lib/types.js";
import { getTMBaseURL } from "../../lib/tm-base-url.js";

/**
 * Schema for the upload file tool
 */
export const UploadFileSchema = z.object({
  project_identifier: z
    .string()
    .describe(
      "ID of the project where the file should be uploaded. Do not assume it, always ask user for it.",
    ),
  file_path: z
    .string()
    .describe("Full path to the file that should be uploaded"),
});

/**
 * Uploads a file to BrowserStack Test Management and returns the signed URL.
 */
export async function uploadFile(
  args: z.infer<typeof UploadFileSchema>,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const { project_identifier, file_path } = args;

  try {
    // Validate file exists
    if (!fs.existsSync(file_path)) {
      return {
        content: [
          {
            type: "text",
            text: `File ${file_path} does not exist.`,
          },
        ],
        isError: true,
      };
    }
    // Get the project ID
    const projectIdResponse = await projectIdentifierToId(
      project_identifier,
      config,
    );

    const formData = new FormData();
    formData.append("attachments[]", fs.createReadStream(file_path));

    const tmBaseUrl = await getTMBaseURL(config);
    const uploadUrl = `${tmBaseUrl}/api/v1/projects/${projectIdResponse}/generic/attachments/ai_uploads`;

    const response = await apiClient.post({
      url: uploadUrl,
      headers: {
        ...formData.getHeaders(),
        "API-TOKEN": getBrowserStackAuth(config),
        accept: "application/json, text/plain, */*",
      },
      body: formData,
    });

    if (
      response.status >= 200 &&
      response.status < 300 &&
      response.data.generic_attachment
    ) {
      const attachments = response.data.generic_attachment.map(
        (attachment: any) => {
          // Generate a unique ID for each attachment
          const fileId = uuidv4();

          // Store the download URL in the signedUrlMap

          const data = {
            fileId: attachment.id,
            downloadUrl: attachment.download_url,
          };

          signedUrlMap.set(fileId, data);

          return {
            name: attachment.name,
            documentID: fileId,
            contentType: attachment.content_type,
            size: attachment.size,
            projectReferenceId: projectIdResponse,
          };
        },
      );

      return {
        content: [
          {
            type: "text",
            text: `Successfully uploaded ${path.basename(file_path)} to BrowserStack Test Management.`,
          },
          {
            type: "text",
            text: JSON.stringify(attachments, null, 2),
          },
        ],
      };
    } else {
      throw new Error(`Unexpected response: ${JSON.stringify(response.data)}`);
    }
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Failed to upload file: ${
            error instanceof Error ? error.message : "Unknown error"
          }. Please check your credentials and try again.`,
        },
      ],
      isError: true,
    };
  }
}
