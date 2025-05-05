import fs from "fs";
import os from "os";
import path from "path";

const CACHE_DIR = path.join(os.homedir(), ".browserstack", "app_live_cache");
const CACHE_FILE = path.join(CACHE_DIR, "app_live.json");
const TTL_MS = 24 * 60 * 60 * 1000; // 1 day

/**
 * Fetches and caches the App Live devices JSON with a 1-day TTL.
 */
export async function getAppLiveData(): Promise<any> {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
  if (fs.existsSync(CACHE_FILE)) {
    const stats = fs.statSync(CACHE_FILE);
    if (Date.now() - stats.mtimeMs < TTL_MS) {
      return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
    }
  }
  const response = await fetch(
    "https://www.browserstack.com/list-of-browsers-and-platforms/app_live.json",
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch app live list: ${response.statusText}`);
  }
  const data = await response.json();
  fs.writeFileSync(CACHE_FILE, JSON.stringify(data), "utf8");
  return data;
}
