import { SessionType } from "../../lib/constants.js";
import { BrowserStackConfig } from "../../lib/types.js";
import { resolveBuildIdFromSession } from "../automate-utils/resolve-hashed-build-id.js";

export async function resolveAppAutomateBuildId(
  sessionId: string,
  config: BrowserStackConfig,
): Promise<string | undefined> {
  return resolveBuildIdFromSession(sessionId, SessionType.AppAutomate, config);
}
