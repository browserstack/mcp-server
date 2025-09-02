import { BrowserStackConfig } from "../../lib/types.js";
import { getBrowserStackAuth } from "../../lib/get-auth.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export async function approveOrDeclinePercyBuild(
  args: { buildId: string; action: "approve" | "unapprove" | "reject" },
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const { buildId, action } = args;

  // Get Basic Auth credentials
  const authString = getBrowserStackAuth(config);
  const auth = Buffer.from(authString).toString("base64");

  // Prepare request body
  const body = {
    data: {
      type: "reviews",
      attributes: { action },
      relationships: {
        build: { data: { type: "builds", id: buildId } },
      },
    },
  };

  // Send request to Percy API
  const response = await fetch("https://percy.io/api/v1/reviews", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Percy build ${action} failed: ${response.status} ${errorText}`,
    );
  }

  const result = await response.json();

  return {
    content: [
      {
        type: "text",
        text: `Percy build ${buildId} was ${result.data.attributes["review-state"]} by ${result.data.attributes["action-performed-by"].user_name}`,
      },
    ],
  };
}
