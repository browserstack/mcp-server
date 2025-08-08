import fs from "fs";
import os from "os";
import path from "path";
import { apiClient } from "./apiClient.js";

const CACHE_DIR = path.join(os.homedir(), ".browserstack", "combined_cache");
const CACHE_FILE = path.join(CACHE_DIR, "data.json");
const TTL_MS = 24 * 60 * 60 * 1000; // 1 day
const TTL_STARTED_MS = 3 * 60 * 60 * 1000; // 3 Hours

export enum BrowserStackProducts {
  LIVE = "live",
  APP_LIVE = "app_live",
  APP_AUTOMATE = "app_automate",
}

const URLS: Record<BrowserStackProducts, string> = {
  [BrowserStackProducts.LIVE]:
    "https://www.browserstack.com/list-of-browsers-and-platforms/live.json",
  [BrowserStackProducts.APP_LIVE]:
    "https://www.browserstack.com/list-of-browsers-and-platforms/app_live.json",
  [BrowserStackProducts.APP_AUTOMATE]:
    "https://www.browserstack.com/list-of-browsers-and-platforms/app_automate.json",
};

/**
 * Fetches and caches BrowserStack datasets (live + app_live + app_automate) with a shared TTL.
 */
export async function getDevicesAndBrowsers(
  type: BrowserStackProducts,
): Promise<any> {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }

  let cache: any = {};

  if (fs.existsSync(CACHE_FILE)) {
    const stats = fs.statSync(CACHE_FILE);
    if (Date.now() - stats.mtimeMs < TTL_MS) {
      try {
        cache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
        if (cache[type]) {
          return cache[type];
        }
      } catch (error) {
        console.error("Error parsing cache file:", error);
        // Continue with fetching fresh data
      }
    }
  }

  const liveRes = await apiClient.get({ url: URLS[type], raise_error: false });

  if (!liveRes.ok) {
    throw new Error(
      `Failed to fetch configuration from BrowserStack : ${type}=${liveRes.statusText}`,
    );
  }

  cache = {
    [type]: liveRes.data,
  };
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache), "utf8");

  return cache[type];
}

// Rate limiter for started event (3H)
export function shouldSendStartedEvent(): boolean {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
    let cache: Record<string, any> = {};
    if (fs.existsSync(CACHE_FILE)) {
      const raw = fs.readFileSync(CACHE_FILE, "utf8");
      cache = JSON.parse(raw || "{}");
      const last = parseInt(cache.lastStartedEvent, 10);
      if (!isNaN(last) && Date.now() - last < TTL_STARTED_MS) {
        return false;
      }
    }
    cache.lastStartedEvent = Date.now();
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), "utf8");
    return true;
  } catch (e) {
    return true;
  }
}
