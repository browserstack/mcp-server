import { apiClient } from "../../lib/apiClient.js";
import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { formatAxiosError } from "../../lib/error.js";
import { getBrowserStackAuth } from "../../lib/get-auth.js";
import { BrowserStackConfig } from "../../lib/types.js";
import { getTMBaseURL } from "../../lib/tm-base-url.js";

/**
 * Schema for listing test-case templates in BrowserStack Test Management.
 */
export const ListTemplatesSchema = z.object({
  name: z
    .string()
    .optional()
    .describe("Case-insensitive substring filter on template name."),
});

export type ListTemplatesArgs = z.infer<typeof ListTemplatesSchema>;

interface TemplateResponse {
  id: number;
  name: string;
  step_type: string;
  is_default: boolean;
  is_system: boolean;
  enabled: boolean;
}

/**
 * Lists test-case templates (group-wide) so callers can resolve a template
 * name to the numeric template_id.
 *
 * Custom templates share a step_type (test_case_steps | test_case_bdd) with the
 * system templates, so the slug cannot identify them — only the id can. The
 * list is account-wide; a template must also be linked to the target project to
 * be usable there.
 */
export async function listTemplates(
  args: ListTemplatesArgs,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  try {
    const tmBaseUrl = await getTMBaseURL(config);

    // Verified working with API-TOKEN auth (same surface as form-fields-v2).
    const resp = await apiClient.get({
      url: `${tmBaseUrl}/api/v1/admin-v2/settings/templates?entity_type=TestCase&paginated=false`,
      headers: {
        "API-TOKEN": getBrowserStackAuth(config),
        accept: "application/json, text/plain, */*",
      },
    });

    let templates: TemplateResponse[] = resp.data?.templates ?? [];

    if (args.name) {
      const needle = args.name.toLowerCase();
      templates = templates.filter((t) =>
        (t.name ?? "").toLowerCase().includes(needle),
      );
    }

    if (templates.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: args.name
              ? `No templates matching "${args.name}".`
              : "No templates found.",
          },
        ],
      };
    }

    const summary = templates
      .map(
        (t) =>
          `• [template_id=${t.id}] ${t.name} — step_type=${t.step_type}${
            t.is_system ? " (system)" : ""
          }${t.is_default ? " (default)" : ""}${
            t.enabled === false ? " (disabled)" : ""
          }`,
      )
      .join("\n");

    return {
      content: [
        {
          type: "text",
          text: `Found ${templates.length} template(s):\n\n${summary}`,
        },
        {
          type: "text",
          text: JSON.stringify(
            templates.map((t) => ({
              template_id: t.id,
              name: t.name,
              step_type: t.step_type,
              is_system: t.is_system,
              is_default: t.is_default,
              enabled: t.enabled,
            })),
            null,
            2,
          ),
        },
      ],
    };
  } catch (err) {
    return formatAxiosError(err, "Failed to list templates");
  }
}
