import { apiClient } from "./apiClient.js";
import logger from "../logger.js";
import { BrowserStackConfig } from "./types.js";
import { getBrowserStackAuth } from "./get-auth.js";

const TM_BASE_URLS = [
  "https://test-management.browserstack.com",
  "https://test-management-eu.browserstack.com",
  "https://test-management-in.browserstack.com",
] as const;

let cachedBaseUrl: string | null = null;

export async function getTMBaseURL(
  config: BrowserStackConfig,
): Promise<string> {
  if (cachedBaseUrl) {
    logger.debug(`Using cached TM base URL: ${cachedBaseUrl}`);
    return cachedBaseUrl;
  }

  logger.info(
    "No cached TM base URL found, testing available URLs with authentication",
  );

  const authString = getBrowserStackAuth(config);
  const [username, password] = authString.split(":");
  const authHeader =
    "Basic " + Buffer.from(`${username}:${password}`).toString("base64");

  for (const baseUrl of TM_BASE_URLS) {
    try {
      const res = await apiClient.get({
        url: `${baseUrl}/api/v2/projects/`,
        headers: { Authorization: authHeader },
        raise_error: false,
      });

      if (res.ok) {
        cachedBaseUrl = baseUrl;
        logger.info(`Selected TM base URL: ${baseUrl}`);
        return baseUrl;
      }
    } catch (err) {
      logger.debug(`Failed TM base URL: ${baseUrl} (${err})`);
    }
  }

  throw new Error(
    "Unable to connect to BrowserStack Test Management. Please check your credentials and network connection.Please open an issue on GitHub if the problem persists",
  );
}
