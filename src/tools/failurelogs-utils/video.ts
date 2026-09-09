import { getBrowserStackAuth } from "../../lib/get-auth.js";
import { BrowserStackConfig } from "../../lib/types.js";
import { apiClient } from "../../lib/apiClient.js";
import { SessionType } from "../../lib/constants.js";
import { validateLogResponse } from "./utils.js";

export async function retrieveSessionVideo(
  sessionId: string,
  sessionType: SessionType,
  config: BrowserStackConfig,
): Promise<string> {
  const product =
    sessionType === SessionType.AppAutomate ? "app-automate" : "automate";
  const url = `https://api.browserstack.com/${product}/sessions/${encodeURIComponent(sessionId)}.json`;
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

  const validationError = validateLogResponse(response, "session video");
  if (validationError) return validationError.message!;

  const videoUrl = (response.data as any)?.automation_session?.video_url;
  return typeof videoUrl === "string" && videoUrl.trim()
    ? `Session video: ${videoUrl.trim()}`
    : "No session video available for this session";
}
