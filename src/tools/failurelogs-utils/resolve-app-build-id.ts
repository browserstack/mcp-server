import { SessionType } from "../../lib/constants.js";
import { BrowserStackConfig } from "../../lib/types.js";
import {
  readSessionDetails,
  SessionDetails,
} from "../automate-utils/resolve-hashed-build-id.js";

export async function readAppAutomateSession(
  sessionId: string,
  config: BrowserStackConfig,
): Promise<SessionDetails | undefined> {
  return readSessionDetails(sessionId, SessionType.AppAutomate, config);
}

export async function resolveAppAutomateBuildId(
  sessionId: string,
  config: BrowserStackConfig,
): Promise<string | undefined> {
  return (await readAppAutomateSession(sessionId, config))?.buildId;
}
