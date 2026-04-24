import { BrowserStackConfig } from "../lib/types.js";

export function getBrowserStackAuth(config: BrowserStackConfig): string {
  const username = config["browserstack-username"];
  const accessKey = config["browserstack-access-key"];
  if (!username || !accessKey) {
    throw new Error("BrowserStack credentials not set on server.authHeaders");
  }
  return `${username}:${accessKey}`;
}

// Merges user-supplied credential overrides (e.g. passed through tool args
// when the user shares credentials in chat) with the server-configured
// credentials. Returns null when no usable username + access key pair is
// available, so callers can degrade gracefully instead of throwing the way
// `getBrowserStackAuth` does.
export function resolveBrowserStackAuth(
  config: BrowserStackConfig,
  overrides: { username?: string; accessKey?: string } = {},
): { config: BrowserStackConfig } | null {
  const username = (
    overrides.username?.trim() || config["browserstack-username"] || ""
  ).trim();
  const accessKey = (
    overrides.accessKey?.trim() || config["browserstack-access-key"] || ""
  ).trim();
  if (!username || !accessKey) {
    return null;
  }
  return {
    config: {
      ...config,
      "browserstack-username": username,
      "browserstack-access-key": accessKey,
    },
  };
}
