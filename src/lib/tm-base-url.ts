import { apiClient } from "./apiClient.js";
import logger from "../logger.js";
import { BrowserStackConfig } from "./types.js";
import { getBrowserStackAuth } from "./get-auth.js";
import appConfig from "../config.js";

const TM_BASE_URLS = [
  "https://test-management.browserstack.com",
  "https://test-management-eu.browserstack.com",
  "https://test-management-in.browserstack.com",
] as const;

let cachedBaseUrl: string | null = null;

export async function getTMBaseURL(
  config: BrowserStackConfig,
): Promise<string> {
  // Skip the module-level cache in remote (multi-tenant) mode: it is process-shared,
  // so the first user's region would be served to every subsequent user — breaking
  // requests for users on a different region's BrowserStack account.
  if (!appConfig.REMOTE_MCP && cachedBaseUrl) {
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

  const failures: string[] = [];

  for (const baseUrl of TM_BASE_URLS) {
    try {
      const res = await apiClient.get({
        url: `${baseUrl}/api/v2/projects/`,
        headers: { Authorization: authHeader },
        raise_error: false,
      });

      if (!res.ok) {
        failures.push(`${baseUrl}: HTTP ${res.status}`);
      }

      if (res.ok) {
        // Only populate the cache in single-tenant (stdio) mode; in remote mode
        // the cache must stay empty so each user discovers their own region.
        if (!appConfig.REMOTE_MCP) {
          cachedBaseUrl = baseUrl;
        }
        logger.info(`Selected TM base URL: ${baseUrl}`);
        return baseUrl;
      }
    } catch (err) {
      const code = (err as { code?: string })?.code ?? (err as Error)?.message;
      failures.push(`${baseUrl}: ${code}`);
      logger.debug(`Failed TM base URL: ${baseUrl} (${err})`);
    }
  }

  throw new Error(
    `Unable to connect to BrowserStack Test Management. Please check your credentials and network connection.Please open an issue on GitHub if the problem persists. Details: ${failures.join("; ")}`,
  );
}
