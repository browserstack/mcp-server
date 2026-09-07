import { getBrowserStackAuth } from "../../lib/get-auth.js";
import { BrowserStackConfig } from "../../lib/types.js";
import { apiClient } from "../../lib/apiClient.js";
import logger from "../../logger.js";

export async function resolveAppAutomateBuildId(
  sessionId: string,
  config: BrowserStackConfig,
): Promise<string | undefined> {
  const url = `https://api.browserstack.com/app-automate/sessions/${encodeURIComponent(sessionId)}.json`;
  const authString = getBrowserStackAuth(config);
  const auth = Buffer.from(authString).toString("base64");

  const response = await apiClient.get({
    url,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
    raise_error: false,
  });

  if (!response.ok) {
    logger.warn(
      `Could not resolve build id for app-automate session ${sessionId}: ${response.status}`,
    );
    return undefined;
  }

  const session = (response.data as any)?.automation_session;
  const buildId = session?.build_hashed_id;
  return typeof buildId === "string" && buildId.trim()
    ? buildId.trim()
    : undefined;
}
