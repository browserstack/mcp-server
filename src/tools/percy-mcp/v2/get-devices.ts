import { percyGet } from "../../../lib/percy-api/percy-auth.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export async function percyGetDevices(
  args: { build_id?: string },
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  // Get browser families
  const families = await percyGet("/browser-families", config);
  const familyList = families?.data || [];

  let output = `## Percy Browsers & Devices\n\n`;
  output += `### Browser Families\n\n`;
  output += `| Name | Slug | ID |\n|---|---|---|\n`;
  familyList.forEach((f: any) => {
    output += `| ${f.attributes?.name || "?"} | ${f.attributes?.slug || "?"} | ${f.id} |\n`;
  });

  // Get device details if build_id provided
  if (args.build_id) {
    try {
      const devices = await percyGet("/discovery/device-details", config, { build_id: args.build_id });
      const deviceList = devices?.data || devices || [];
      if (Array.isArray(deviceList) && deviceList.length) {
        output += `\n### Devices for Build ${args.build_id}\n\n`;
        output += `| Device | Width | Height |\n|---|---|---|\n`;
        deviceList.forEach((d: any) => {
          const attrs = d.attributes || d;
          output += `| ${attrs.name || "?"} | ${attrs.width || "?"} | ${attrs.height || "?"} |\n`;
        });
      }
    } catch { /* device details may not be available */ }
  }

  return { content: [{ type: "text", text: output }] };
}
