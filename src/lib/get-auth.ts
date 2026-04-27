import { BrowserStackConfig } from "../lib/types.js";

export function getBrowserStackAuth(config: BrowserStackConfig): string {
  const username = config["browserstack-username"];
  const accessKey = config["browserstack-access-key"];
  if (!username || !accessKey) {
    throw new Error("BrowserStack credentials not set on server.authHeaders");
  }
  return `${username}:${accessKey}`;
}
