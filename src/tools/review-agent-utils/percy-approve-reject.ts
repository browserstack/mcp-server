import { createHmac } from "node:crypto";
import { BrowserStackConfig } from "../../lib/types.js";
import { getBrowserStackAuth } from "../../lib/get-auth.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

const CONFIRM_TOKEN_TTL_MINUTES = 5;

function mintConfirmToken(
  authString: string,
  buildId: string,
  action: string,
  bucket: number,
): string {
  return createHmac("sha256", authString)
    .update(`${buildId}:${action}:${bucket}`)
    .digest("hex")
    .slice(0, 16);
}

export async function approveOrDeclinePercyBuild(
  args: {
    buildId: string;
    action: "approve" | "unapprove" | "reject";
    confirmToken?: string;
  },
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const { buildId, action, confirmToken } = args;

  const authString = getBrowserStackAuth(config);

  // Accept any bucket within the TTL so a token stays valid across the round-trip.
  const nowBucket = Math.floor(Date.now() / 60000);
  const valid = new Set<string>();
  for (let i = 0; i <= CONFIRM_TOKEN_TTL_MINUTES; i++) {
    valid.add(mintConfirmToken(authString, buildId, action, nowBucket - i));
  }

  if (!confirmToken || !valid.has(confirmToken)) {
    const token = mintConfirmToken(authString, buildId, action, nowBucket);
    return {
      content: [
        {
          type: "text",
          text: `This will ${action} Percy build ${buildId} and cannot be undone. To proceed, re-call managePercyBuildApproval with confirmToken:"${token}" (valid for ${CONFIRM_TOKEN_TTL_MINUTES} minutes).`,
        },
      ],
    };
  }

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
    throw new Error(`Percy build ${action} failed: ${response.status}`);
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
