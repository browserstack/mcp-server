import { apiClient } from "./apiClient.js";
import logger from "../logger.js";
import { BrowserStackConfig } from "./types.js";
import { getBrowserStackAuth } from "./get-auth.js";
import appConfig from "../config.js";

/**
 * The production regions, probed in this order. UNCHANGED, and the default in every
 * deployment: the override below exists for test harnesses, not for shipping.
 */
export const TM_BASE_URLS = [
  "https://test-management.browserstack.com",
  "https://test-management-eu.browserstack.com",
  "https://test-management-in.browserstack.com",
] as const;

/**
 * A TEST-HARNESS AFFORDANCE. Point region discovery at a non-production environment.
 *
 * Plural because the probe loop takes a list. It REPLACES the built-in list rather than
 * extending it — appending would leave the
 * production hosts probed first, which is the whole problem it exists to avoid: preprod-only
 * credentials 401 against production, and a 401 can send the model off to retry with a
 * different tool, so a tool-selection measurement stops meaning what it says.
 *
 * An override that parses to nothing falls back to the built-in list rather than leaving an
 * empty probe loop, which would surface as "unable to connect" with no detail. That fallback
 * is a WARNING, not a silent one: quietly using production when someone asked for preprod is
 * exactly the failure this is meant to prevent.
 */
export const TM_BASE_URLS_ENV = "BROWSERSTACK_TM_BASE_URLS";

export interface ResolvedBaseUrls {
  urls: string[];
  /** Where the list came from, so a run pointed at the wrong environment is visible. */
  source: "built-in" | "env" | "built-in (override unusable)";
}

export function resolveTMBaseUrls(): ResolvedBaseUrls {
  const raw = process.env[TM_BASE_URLS_ENV];
  if (!raw || !raw.trim())
    return { urls: [...TM_BASE_URLS], source: "built-in" };

  const urls = raw
    .split(",")
    .map((entry) => entry.trim().replace(/\/+$/, ""))
    // Anything without a scheme is a typo, not a host: silently probing it would produce a
    // confusing connection error rather than naming the real mistake.
    .filter((entry) => /^https?:\/\/\S+$/i.test(entry));

  if (!urls.length) {
    return { urls: [...TM_BASE_URLS], source: "built-in (override unusable)" };
  }
  return { urls, source: "env" };
}

let cachedBaseUrl: string | null = null;
/**
 * Which list the cached URL was discovered under.
 *
 * Keyed rather than skipped, so a value minted against production can never be served to a
 * run pointed at preprod (or the reverse) — the override would otherwise appear to work while
 * silently returning the previous environment's host.
 */
let cachedFor: string | null = null;

export async function getTMBaseURL(
  config: BrowserStackConfig,
): Promise<string> {
  const { urls, source } = resolveTMBaseUrls();
  const listKey = urls.join(",");

  // Skip the module-level cache in remote (multi-tenant) mode: it is process-shared,
  // so the first user's region would be served to every subsequent user — breaking
  // requests for users on a different region's BrowserStack account.
  if (!appConfig.REMOTE_MCP && cachedBaseUrl && cachedFor === listKey) {
    logger.debug(`Using cached TM base URL: ${cachedBaseUrl}`);
    return cachedBaseUrl;
  }

  if (source === "built-in (override unusable)") {
    logger.warn(
      `${TM_BASE_URLS_ENV} was set but no entry looked like an http(s) URL; falling back ` +
        `to the built-in production list. Requests will go to production.`,
    );
  }
  logger.info(
    `No cached TM base URL found, testing available URLs with authentication ` +
      `(list from ${source}: ${listKey})`,
  );

  const authString = getBrowserStackAuth(config);
  const [username, password] = authString.split(":");
  const authHeader =
    "Basic " + Buffer.from(`${username}:${password}`).toString("base64");

  const failures: string[] = [];

  for (const baseUrl of urls) {
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
          cachedFor = listKey;
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
